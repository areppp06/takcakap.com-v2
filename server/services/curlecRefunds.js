/**
 * Curlec refunds: issue + refund webhook application.
 */
'use strict';

const db = require('../db');
const emailService = require('../emailService');
const refundService = require('./refundService');
const {
    PAYMENT_METHOD_CURLEC,
    REFUND_STATUS_PENDING,
    REFUND_STATUS_PROCESSED,
    REFUND_STATUS_FAILED,
    REFUND_ELIGIBILITY_HOURS
} = require('../config');
const {
    toNumber,
    toPositiveInteger,
    toSqlDateTimeUtc
} = require('../lib/primitives');
const {
    callCurlecApi,
    normalizeCurlecRefundStatus,
    normalizeCurlecRefundSpeed,
    isCurlecInstantRefundUnsupportedError,
    isCurlecInvalidRequestError,
    formatMinorUnitsAsMyr,
    fetchCurlecBalanceMinorUnits,
    buildCurlecRefundTimeframeMessage,
    toMinorUnits,
    normalizePaymentMethod
} = require('./curlecClient');
const { emitOrdersChangedEvent, getRefundWindowState } = require('./orders/orderEvents');

const markOrderRefundFailed = async ({
    orderId,
    amount,
    reason,
    initiatedByUserId,
    idempotencyKey,
    failureReason
}) => {
    const normalizedFailureReason = String(failureReason || 'Refund request failed').trim().slice(0, 500);
    const normalizedReason = String(reason || 'Order cancellation').trim().slice(0, 255) || null;
    const normalizedAmount = toNumber(amount);

    await db.query(
        `
            UPDATE orders
            SET
                refund_status = ?,
                refund_amount = COALESCE(?, refund_amount),
                refund_reason = COALESCE(?, refund_reason),
                refund_failed_at = UTC_TIMESTAMP(),
                refund_failure_reason = ?,
                refund_initiated_by_user_id = COALESCE(?, refund_initiated_by_user_id),
                refund_idempotency_key = COALESCE(?, refund_idempotency_key)
            WHERE id = ?
        `,
        [
            REFUND_STATUS_FAILED,
            normalizedAmount,
            normalizedReason,
            normalizedFailureReason,
            toPositiveInteger(initiatedByUserId),
            idempotencyKey || null,
            toPositiveInteger(orderId)
        ]
    );
};

const issueCurlecRefundForOrder = async ({
    order,
    amount = null,
    reason = 'Order cancellation',
    initiatedByUserId = null,
    speedRequested = 'optimum',
    idempotencyKey = '',
    eligibilityHours = REFUND_ELIGIBILITY_HOURS
}) => {
    const orderId = toPositiveInteger(order?.id);
    if (!orderId) {
        const error = new Error('Invalid order id for refund');
        error.status = 400;
        throw error;
    }

    const paymentMethod = normalizePaymentMethod(order?.payment_method || order?.paymentMethod);
    if (paymentMethod !== PAYMENT_METHOD_CURLEC) {
        const error = new Error('Automatic refund is only available for Curlec payments');
        error.status = 400;
        throw error;
    }

    const curlecPaymentId = String(order?.curlec_payment_id || order?.curlecPaymentId || '').trim();
    if (!curlecPaymentId) {
        const error = new Error('Missing Curlec payment reference for this order');
        error.status = 400;
        throw error;
    }

    const resolvedEligibilityHours = Math.max(
        1,
        Number.parseInt(String(eligibilityHours || REFUND_ELIGIBILITY_HOURS), 10) || REFUND_ELIGIBILITY_HOURS
    );
    const refundWindow = getRefundWindowState(
        order?.created_at_utc || order?.created_at || order?.createdAtUtc,
        Date.now(),
        resolvedEligibilityHours * 60 * 60 * 1000
    );
    if (!refundWindow.isEligible) {
        const error = new Error(`Refund window expired. Refunds are limited to ${resolvedEligibilityHours} hours.`);
        error.status = 409;
        throw error;
    }

    const existingRefundStatus = normalizeCurlecRefundStatus(order?.refund_status || order?.refundStatus);
    if (existingRefundStatus === REFUND_STATUS_PENDING || existingRefundStatus === REFUND_STATUS_PROCESSED) {
        const error = new Error('Refund is already in progress or completed for this order');
        error.status = 409;
        throw error;
    }

    const baseAmount = toNumber(order?.total_amount ?? order?.total);
    if (baseAmount === null || baseAmount <= 0) {
        const error = new Error('Unable to determine refundable amount for this order');
        error.status = 400;
        throw error;
    }

    const requestedAmount = amount === null ? baseAmount : toNumber(amount);
    if (requestedAmount === null || requestedAmount <= 0) {
        const error = new Error('Refund amount must be greater than 0');
        error.status = 400;
        throw error;
    }
    if (requestedAmount > baseAmount) {
        const error = new Error('Refund amount cannot exceed the captured order amount');
        error.status = 400;
        throw error;
    }

    const amountInMinorUnits = toMinorUnits(requestedAmount);
    if (!amountInMinorUnits || amountInMinorUnits < 100) {
        const error = new Error('Refund amount must be at least MYR 1.00');
        error.status = 400;
        throw error;
    }

    const normalizedSpeedRequested = String(speedRequested || '').trim().toLowerCase() === 'normal' ? 'normal' : 'optimum';
    const normalizedReason = String(reason || 'Order cancellation').trim().slice(0, 255) || 'Order cancellation';
    const normalizedIdempotencyKey =
        String(idempotencyKey || `fd-order-${orderId}-refund-${Date.now()}`)
            .trim()
            .replace(/[^a-zA-Z0-9_-]/g, '-')
            .slice(0, 128) || `fd-order-${orderId}-refund`;

    let usedIdempotencyKey = normalizedIdempotencyKey;
    const requestRefundAtSpeed = async ({ speed, idempotency }) => {
        usedIdempotencyKey = idempotency;
        const refundRequestBody = {
            amount: amountInMinorUnits
        };
        if (speed === 'optimum') {
            refundRequestBody.speed = 'optimum';
            refundRequestBody.receipt = `fd-refund-${orderId}-${Date.now()}`.slice(0, 40);
            refundRequestBody.notes = {
                source: 'foodiedash-admin',
                orderId: String(orderId),
                reason: normalizedReason
            };
        }
        return callCurlecApi({
            method: 'POST',
            endpoint: `/payments/${encodeURIComponent(curlecPaymentId)}/refund`,
            headers: {
                'X-Refund-Idempotency': idempotency
            },
            body: refundRequestBody
        });
    };

    try {
        let resolvedSpeedRequested = normalizedSpeedRequested;
        let refund;
        try {
            refund = await requestRefundAtSpeed({
                speed: normalizedSpeedRequested,
                idempotency: normalizedIdempotencyKey
            });
        } catch (primaryRefundError) {
            if (
                normalizedSpeedRequested === 'optimum' &&
                isCurlecInstantRefundUnsupportedError(primaryRefundError)
            ) {
                const fallbackIdempotencyKey =
                    `${normalizedIdempotencyKey}-normal`.slice(0, 128) ||
                    `fd-order-${orderId}-refund-normal-${Date.now()}`;
                resolvedSpeedRequested = 'normal';
                console.warn(
                    `[Refund] Instant refund unsupported for order ${orderId}; retrying with normal speed.`
                );
                refund = await requestRefundAtSpeed({
                    speed: 'normal',
                    idempotency: fallbackIdempotencyKey
                });
            } else {
                throw primaryRefundError;
            }
        }

        const refundStatus = normalizeCurlecRefundStatus(refund?.status) || REFUND_STATUS_PENDING;
        const refundId = String(refund?.id || '').trim() || null;
        const refundSpeedRequested = normalizeCurlecRefundSpeed(refund?.speed_requested) || resolvedSpeedRequested;
        const refundSpeedProcessed = normalizeCurlecRefundSpeed(refund?.speed_processed) || null;
        const refundFailureReason = String(
            refund?.error?.description ||
            refund?.error?.reason ||
            refund?.error_description ||
            refund?.error_reason ||
            ''
        )
            .trim()
            .slice(0, 500);
        const refundCreatedAtSql = refund?.created_at
            ? toSqlDateTimeUtc(new Date(Number(refund.created_at) * 1000))
            : toSqlDateTimeUtc(new Date());
        const nowSql = toSqlDateTimeUtc(new Date());

        await db.query(
            `
                UPDATE orders
                SET
                    refund_status = ?,
                    refund_amount = ?,
                    refund_id = COALESCE(?, refund_id),
                    refund_speed_requested = ?,
                    refund_speed_processed = ?,
                    refund_requested_at = COALESCE(refund_requested_at, ?),
                    refund_processed_at = CASE
                        WHEN ? = 'processed' THEN COALESCE(refund_processed_at, ?)
                        ELSE refund_processed_at
                    END,
                    refund_failed_at = CASE
                        WHEN ? = 'failed' THEN COALESCE(refund_failed_at, ?)
                        ELSE refund_failed_at
                    END,
                    refund_failure_reason = CASE
                        WHEN ? = 'failed' THEN ?
                        ELSE NULL
                    END,
                    refund_reason = ?,
                    refund_initiated_by_user_id = COALESCE(?, refund_initiated_by_user_id),
                    refund_idempotency_key = COALESCE(?, refund_idempotency_key)
                WHERE id = ?
            `,
            [
                refundStatus,
                requestedAmount,
                refundId,
                refundSpeedRequested,
                refundSpeedProcessed,
                refundCreatedAtSql || nowSql,
                refundStatus,
                nowSql,
                refundStatus,
                nowSql,
                refundStatus,
                refundFailureReason || 'Refund request failed',
                normalizedReason,
                toPositiveInteger(initiatedByUserId),
                usedIdempotencyKey,
                orderId
            ]
        );
        emitOrdersChangedEvent({
            source: 'refund',
            orderId,
            reason: `refund_${refundStatus}`
        });

        let voidSideEffects = null;
        if (refundStatus !== REFUND_STATUS_FAILED) {
            try {
                voidSideEffects = await refundService.applyOrderVoidSideEffects(orderId, {
                    reason: normalizedReason || 'Refund'
                });
                // Points clawback still runs above; no email is sent for balance changes.
                if (voidSideEffects?.voucher?.success && voidSideEffects.voucher.code) {
                    try {
                        let voucherUserId =
                            voidSideEffects.clawback?.userId ||
                            order?.user_id ||
                            order?.userId ||
                            null;
                        if (!voucherUserId) {
                            const [urows] = await db.query(
                                `SELECT user_id FROM orders WHERE id = ? LIMIT 1`,
                                [orderId]
                            );
                            voucherUserId = urows[0]?.user_id || null;
                        }
                        if (typeof emailService.queueVoucherRestoredEmail === 'function' && voucherUserId) {
                            emailService.queueVoucherRestoredEmail({
                                userId: voucherUserId,
                                orderId,
                                code: voidSideEffects.voucher.code
                            });
                        }
                    } catch (emailErr) {
                        console.error('Failed to queue voucher restored email:', emailErr);
                    }
                }
            } catch (voidError) {
                console.error(`Refund side-effects failed for order ${orderId}:`, voidError);
            }
        }

        return {
            success: refundStatus !== REFUND_STATUS_FAILED,
            orderId: String(orderId),
            voidSideEffects,
            refund: {
                id: refundId,
                status: refundStatus,
                amount: requestedAmount,
                speedRequested: refundSpeedRequested,
                speedProcessed: refundSpeedProcessed,
                timeframe: buildCurlecRefundTimeframeMessage(refundStatus),
                message:
                    refundStatus === REFUND_STATUS_FAILED
                        ? refundFailureReason || 'Refund failed'
                        : refundStatus === REFUND_STATUS_PROCESSED
                            ? 'Refund processed successfully'
                            : 'Refund request accepted'
            }
        };
    } catch (error) {
        let resolvedError = error;
        if (isCurlecInvalidRequestError(error)) {
            const availableBalanceMinor = await fetchCurlecBalanceMinorUnits();
            if (availableBalanceMinor !== null && availableBalanceMinor < amountInMinorUnits) {
                const enrichedError = new Error(
                    `Curlec refund failed due to insufficient Curlec balance. Available ${formatMinorUnitsAsMyr(
                        availableBalanceMinor
                    )}, required ${formatMinorUnitsAsMyr(
                        amountInMinorUnits
                    )}. Add funds in Curlec Dashboard (Account Settings > Balances) and retry.`
                );
                enrichedError.status = 400;
                enrichedError.payload = error?.payload || null;
                resolvedError = enrichedError;
            }
        }
        await markOrderRefundFailed({
            orderId,
            amount: requestedAmount,
            reason: normalizedReason,
            initiatedByUserId,
            idempotencyKey: usedIdempotencyKey,
            failureReason: resolvedError?.message || 'Refund request failed'
        });
        emitOrdersChangedEvent({
            source: 'refund',
            orderId,
            reason: 'refund_failed'
        });
        throw resolvedError;
    }
};

// Refund webhook apply
const resolveCurlecRefundStatusFromWebhook = ({ eventType, refundEntity }) => {
    const statusFromPayload = normalizeCurlecRefundStatus(refundEntity?.status);
    if (statusFromPayload) return statusFromPayload;

    const normalizedEventType = String(eventType || '').trim().toLowerCase();
    if (normalizedEventType === 'refund.processed') return REFUND_STATUS_PROCESSED;
    if (normalizedEventType === 'refund.failed') return REFUND_STATUS_FAILED;
    return REFUND_STATUS_PENDING;
};

const applyCurlecRefundWebhookUpdate = async ({ eventType, refundEntity }) => {
    const refundId = String(refundEntity?.id || '').trim();
    const paymentId = String(refundEntity?.payment_id || refundEntity?.paymentId || '').trim();

    if (!refundId && !paymentId) {
        const error = new Error('Missing refund id or payment id in webhook payload');
        error.status = 400;
        throw error;
    }

    const refundStatus = resolveCurlecRefundStatusFromWebhook({ eventType, refundEntity });
    const refundAmountMinorUnits = toPositiveInteger(refundEntity?.amount);
    const refundAmount =
        refundAmountMinorUnits !== null ? Number((refundAmountMinorUnits / 100).toFixed(2)) : null;
    const refundSpeedRequested = normalizeCurlecRefundSpeed(refundEntity?.speed_requested) || null;
    const refundSpeedProcessed = normalizeCurlecRefundSpeed(refundEntity?.speed_processed) || null;
    const refundReason = String(refundEntity?.notes?.reason || '').trim().slice(0, 255) || null;
    const refundFailureReason = String(
        refundEntity?.error_description ||
        refundEntity?.error_reason ||
        refundEntity?.acquirer_data?.error_reason ||
        ''
    )
        .trim()
        .slice(0, 500);
    const refundIdempotencyKey = String(refundEntity?.notes?.idempotencyKey || '').trim().slice(0, 128) || null;
    const refundCreatedAtSql = refundEntity?.created_at
        ? toSqlDateTimeUtc(new Date(Number(refundEntity.created_at) * 1000))
        : toSqlDateTimeUtc(new Date());
    const nowSql = toSqlDateTimeUtc(new Date());

    let orderRows = [];
    if (refundId) {
        [orderRows] = await db.query(
            `
                SELECT id, status
                FROM orders
                WHERE refund_id = ?
                LIMIT 1
            `,
            [refundId]
        );
    }
    if (!orderRows.length && paymentId) {
        [orderRows] = await db.query(
            `
                SELECT id, status
                FROM orders
                WHERE payment_method = ?
                  AND curlec_payment_id = ?
                ORDER BY id DESC
                LIMIT 1
            `,
            [PAYMENT_METHOD_CURLEC, paymentId]
        );
    }

    const existingOrder = orderRows[0];
    if (!existingOrder) {
        return {
            updated: false,
            orderId: null,
            refundStatus
        };
    }

    const orderId = toPositiveInteger(existingOrder.id);
    if (!orderId) {
        return {
            updated: false,
            orderId: null,
            refundStatus
        };
    }

    await db.query(
        `
            UPDATE orders
            SET
                refund_status = ?,
                refund_amount = COALESCE(?, refund_amount),
                refund_id = COALESCE(?, refund_id),
                refund_speed_requested = COALESCE(?, refund_speed_requested),
                refund_speed_processed = COALESCE(?, refund_speed_processed),
                refund_requested_at = COALESCE(refund_requested_at, ?),
                refund_processed_at = CASE
                    WHEN ? = 'processed' THEN COALESCE(refund_processed_at, ?)
                    ELSE refund_processed_at
                END,
                refund_failed_at = CASE
                    WHEN ? = 'failed' THEN COALESCE(refund_failed_at, ?)
                    ELSE refund_failed_at
                END,
                refund_failure_reason = CASE
                    WHEN ? = 'failed' THEN ?
                    ELSE NULL
                END,
                refund_reason = COALESCE(?, refund_reason),
                refund_idempotency_key = COALESCE(?, refund_idempotency_key)
            WHERE id = ?
        `,
        [
            refundStatus,
            refundAmount,
            refundId || null,
            refundSpeedRequested,
            refundSpeedProcessed,
            refundCreatedAtSql || nowSql,
            refundStatus,
            nowSql,
            refundStatus,
            nowSql,
            refundStatus,
            refundFailureReason || 'Refund request failed',
            refundReason,
            refundIdempotencyKey,
            orderId
        ]
    );
    emitOrdersChangedEvent({
        source: 'curlec_webhook',
        orderId,
        reason: `refund_${refundStatus}`
    });

    const orderStatus = String(existingOrder.status || '').trim();
    if (
        orderStatus === 'Cancelled' &&
        (refundStatus === REFUND_STATUS_PENDING || refundStatus === REFUND_STATUS_PROCESSED)
    ) {
        emailService.queueOrderEventEmail(orderId, 'cancelled_refund');
    }

    return {
        updated: true,
        orderId: String(orderId),
        refundStatus
    };
};


module.exports = {
    markOrderRefundFailed,
    issueCurlecRefundForOrder,
    resolveCurlecRefundStatusFromWebhook,
    applyCurlecRefundWebhookUpdate
};
