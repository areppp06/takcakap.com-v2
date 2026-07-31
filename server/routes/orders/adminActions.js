/**
 * Order routes: admin status / cancel / retry-dispatch / refund
 */
'use strict';

const db = require('../../db');
const emailService = require('../../emailService');
const lalamoveService = require('../../lalamoveService');
const loyaltyService = require('../../loyaltyService');
const refundService = require('../../services/refundService');
const {
    PAYMENT_METHOD_CURLEC,
    PICKUP_COMPLETED_REFUND_ELIGIBILITY_HOURS,
    REFUND_ELIGIBILITY_HOURS,
    REFUND_STATUS_FAILED
} = require('../../config');
const { requireAdmin } = require('../../middleware/auth');
const { toNumber, toPositiveInteger } = require('../../lib/primitives');
const {
    emitOrdersChangedEvent,
    getRefundWindowState
} = require('../../services/orders/orderEvents');
const {
    buildLalamoveRecipientRemark,
    computeLalamoveCancelState,
    extractLalamoveStopIds,
    mapLalamoveUpdateToOrderStatus
} = require('../../services/lalamoveHelpers');
const {
    issueCurlecRefundForOrder,
    normalizeCurlecRefundStatus,
    normalizePaymentMethod
} = require('../../services/curlec');
const { fetchShopStatus } = require('../../services/shop');

module.exports = function register(app) {


    app.put('/api/orders/:id/status', requireAdmin, async (req, res) => {
        const { status } = req.body;
        const orderId = toPositiveInteger(req.params.id);
        if (!orderId) {
            return res.status(400).json({ error: 'Invalid order id' });
        }

        const normalizedStatus = String(status || '').trim();
        if (!normalizedStatus) {
            return res.status(400).json({ error: 'status is required' });
        }
        const ALLOWED_ADMIN_ORDER_STATUSES = new Set([
            'Pending Payment',
            'Preparing',
            'Ready to Pickup',
            'Finding Rider',
            'Rider OTW',
            'Out For Delivery',
            'Completed',
            'Cancelled'
        ]);
        if (!ALLOWED_ADMIN_ORDER_STATUSES.has(normalizedStatus)) {
            return res.status(400).json({
                error: `Invalid status. Allowed: ${[...ALLOWED_ADMIN_ORDER_STATUSES].join(', ')}`
            });
        }

        try {
            const [rows] = await db.query(
                `
                    SELECT
                        id,
                        delivery_provider,
                        order_type,
                        status,
                        total_amount,
                        created_at,
                        DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at_utc_iso,
                        payment_method,
                        curlec_payment_id
                    FROM orders
                    WHERE id = ?
                    LIMIT 1
                `,
                [orderId]
            );
            if (rows.length === 0) {
                return res.status(404).json({ error: 'Order not found' });
            }
            if (rows[0].delivery_provider === 'Lalamove') {
                return res.status(400).json({ error: 'Lalamove order status is managed automatically via webhook' });
            }

            const order = rows[0];
            const previousStatus = String(order.status || '').trim();
            await db.query('UPDATE orders SET status = ? WHERE id = ?', [normalizedStatus, orderId]);
            emitOrdersChangedEvent({
                source: 'admin_status',
                orderId,
                reason: `status_${normalizedStatus || 'updated'}`
            });
            const shouldAttemptAutoRefund =
                normalizedStatus === 'Cancelled' &&
                previousStatus !== 'Cancelled' &&
                normalizePaymentMethod(order.payment_method) === PAYMENT_METHOD_CURLEC;

            let autoRefundError = null;
            let refund = null;
            if (shouldAttemptAutoRefund) {
                try {
                    const autoRefundResult = await issueCurlecRefundForOrder({
                        order,
                        initiatedByUserId: req.user?.id || null,
                        reason: 'Order cancellation by admin',
                        idempotencyKey: `fd-order-${orderId}-status-cancel-refund`
                    });
                    if (autoRefundResult.success) {
                        refund = autoRefundResult.refund;
                        emailService.queueOrderEventEmail(orderId, 'cancelled_refund');
                    } else {
                        autoRefundError = autoRefundResult.refund?.message || 'Refund request failed';
                    }
                } catch (refundError) {
                    autoRefundError = refundError?.message || 'Refund request failed';
                    console.error('Auto refund failed on status update:', refundError?.payload || refundError);
                }
            }

            if (normalizedStatus !== previousStatus) {
                if (normalizedStatus === 'Completed') {
                    emailService.queueOrderEventEmail(orderId, 'completed');
                    try {
                        await loyaltyService.awardPointsForOrder(orderId);
                    } catch (pointsError) {
                        console.error(`Failed to award points for order ${orderId}:`, pointsError);
                    }
                } else if (normalizedStatus === 'Cancelled') {
                    try {
                        await refundService.applyOrderVoidSideEffects(orderId, {
                            reason: shouldAttemptAutoRefund ? 'Cancel with refund' : 'Order cancelled'
                        });
                    } catch (voidError) {
                        console.error(`Failed void side-effects for order ${orderId}:`, voidError);
                    }
                    if (!shouldAttemptAutoRefund) {
                        emailService.queueOrderEventEmail(orderId, 'cancelled');
                    }
                }
            }
            res.json({
                success: true,
                autoRefundAttempted: shouldAttemptAutoRefund,
                autoRefundError,
                refund
            });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Failed to update status' });
        }
    });

    app.post('/api/admin/orders/:id/cancel', requireAdmin, async (req, res) => {
        const orderId = toPositiveInteger(req.params.id);
        if (!orderId) {
            return res.status(400).json({ error: 'Invalid order id' });
        }

        try {
            const [rows] = await db.query(
                `
                    SELECT
                        id,
                        status,
                        total_amount,
                        created_at,
                        DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at_utc_iso,
                        delivery_provider,
                        external_order_id,
                        lalamove_status,
                        DATE_FORMAT(lalamove_ongoing_at, '%Y-%m-%dT%H:%i:%sZ') AS lalamove_ongoing_at_utc,
                        payment_method,
                        curlec_payment_id,
                        refund_status
                    FROM orders
                    WHERE id = ?
                    LIMIT 1
                `,
                [orderId]
            );
            const order = rows[0];
            if (!order) {
                return res.status(404).json({ error: 'Order not found' });
            }
            if (order.delivery_provider !== 'Lalamove') {
                return res.status(400).json({ error: 'This cancellation endpoint is only for Lalamove orders' });
            }
            if (!order.external_order_id) {
                return res.status(400).json({ error: 'Missing external Lalamove order id' });
            }

            const cancelState = computeLalamoveCancelState({
                deliveryProvider: order.delivery_provider,
                lalamoveStatus: order.lalamove_status,
                lalamoveOngoingAtUtc: order.lalamove_ongoing_at_utc
            });
            if (!cancelState.canCancelLalamove) {
                return res.status(409).json({
                    error: 'Cancel window has ended for this Lalamove order',
                    cancelState
                });
            }

            await lalamoveService.cancelOrder(String(order.external_order_id));

            await db.query(
                `
                    UPDATE orders
                    SET status = 'Cancelled', lalamove_status = 'CANCELED'
                    WHERE id = ?
                `,
                [orderId]
            );
            emitOrdersChangedEvent({
                source: 'admin_cancel',
                orderId,
                reason: 'cancelled'
            });

            const shouldAttemptAutoRefund = normalizePaymentMethod(order.payment_method) === PAYMENT_METHOD_CURLEC;
            const refundWindow = getRefundWindowState(order.created_at_utc_iso || order.created_at);
            let autoRefundError = null;
            let refund = null;

            if (shouldAttemptAutoRefund) {
                try {
                    const autoRefundResult = await issueCurlecRefundForOrder({
                        order,
                        initiatedByUserId: req.user?.id || null,
                        reason: 'Delivery cancellation by admin',
                        idempotencyKey: `fd-order-${orderId}-cancel-refund`
                    });
                    if (autoRefundResult.success) {
                        refund = autoRefundResult.refund;
                        emailService.queueOrderEventEmail(orderId, 'cancelled_refund');
                    } else {
                        autoRefundError = autoRefundResult.refund?.message || 'Refund request failed';
                    }
                } catch (refundError) {
                    autoRefundError = refundError?.message || 'Refund request failed';
                    console.error('Auto refund failed after cancellation:', refundError?.payload || refundError);
                }
            }

            if (!refund && String(order.status || '').trim() !== 'Cancelled') {
                emailService.queueOrderEventEmail(orderId, 'cancelled');
            }

            return res.json({
                success: true,
                orderId: String(orderId),
                externalOrderId: String(order.external_order_id),
                status: 'Cancelled',
                autoRefundAttempted: shouldAttemptAutoRefund,
                refund,
                autoRefundError,
                refundWindow: {
                    isEligible: refundWindow.isEligible,
                    remainingSeconds: refundWindow.remainingSeconds,
                    expiresAtUtc: refundWindow.expiresAtIso
                }
            });
        } catch (error) {
            console.error('Failed to cancel Lalamove order:', error?.payload || error?.message || error);
            return res.status(error.status || 500).json({
                error: error.message || 'Failed to cancel order',
                ...(process.env.NODE_ENV !== 'production' && error.payload
                    ? { details: error.payload }
                    : {})
            });
        }
    });

    /**
     * Admin: retry Lalamove dispatch for booking_failed / terminal_failed orders.
     * Does not auto-change customer payment. Creates a fresh quotation then createOrder.
     */
    app.post('/api/admin/orders/:id/retry-dispatch', requireAdmin, async (req, res) => {
        const orderId = toPositiveInteger(req.params.id);
        if (!orderId) {
            return res.status(400).json({ error: 'Invalid order id' });
        }

        try {
            const [rows] = await db.query(
                `
                    SELECT
                        id, status, order_type, user_id,
                        delivery_address, delivery_latitude, delivery_longitude,
                        delivery_note_snapshot, delivery_contact_phone,
                        recipient_name_snapshot, short_code,
                        external_order_id, delivery_booking_status,
                        scheduled_at_utc, delivery_timing
                    FROM orders
                    WHERE id = ?
                    LIMIT 1
                `,
                [orderId]
            );
            const order = rows[0];
            if (!order) {
                return res.status(404).json({ error: 'Order not found' });
            }
            if (order.order_type !== 'Delivery') {
                return res.status(400).json({ error: 'Retry dispatch is only for delivery orders' });
            }
            const orderStatus = String(order.status || '');
            const bookingStatus = String(order.delivery_booking_status || '');
            if (orderStatus === 'Completed') {
                return res.status(409).json({ error: 'Cannot retry dispatch for completed orders' });
            }
            if (orderStatus === 'Cancelled' && bookingStatus !== 'terminal_failed') {
                return res.status(409).json({ error: 'Cannot retry dispatch for cancelled orders' });
            }
            const allowRebookTerminal =
                bookingStatus === 'terminal_failed' && Boolean(order.external_order_id);
            if (order.external_order_id && !allowRebookTerminal) {
                return res.status(409).json({
                    error: 'Order already has an active Lalamove booking. Cancel it first if you need a new dispatch.',
                    externalOrderId: order.external_order_id
                });
            }
            if (!['booking_failed', 'terminal_failed', 'pending'].includes(bookingStatus) && order.external_order_id) {
                return res.status(409).json({
                    error: `Retry not allowed for booking status: ${bookingStatus || 'unknown'}`
                });
            }
            if (!['booking_failed', 'terminal_failed', 'pending'].includes(bookingStatus) && !order.external_order_id) {
                // allow empty/unknown for never-booked delivery orders
                if (bookingStatus === 'booked' || bookingStatus === 'not_required') {
                    return res.status(409).json({
                        error: `Retry not allowed for booking status: ${bookingStatus || 'unknown'}`
                    });
                }
            }
            if (
                order.delivery_latitude === null ||
                order.delivery_longitude === null ||
                !String(order.delivery_address || '').trim()
            ) {
                return res.status(400).json({ error: 'Order is missing delivery coordinates/address for retry' });
            }

            const shopStatus = await fetchShopStatus(db);
            const scheduleAt =
                order.delivery_timing === 'SCHEDULED' && order.scheduled_at_utc
                    ? new Date(order.scheduled_at_utc)
                    : undefined;

            const quotation = await lalamoveService.createQuotation({
                dropoffAddress: order.delivery_address,
                dropoffLat: order.delivery_latitude,
                dropoffLng: order.delivery_longitude,
                dropoffNote: order.delivery_note_snapshot || '',
                scheduleAt,
                store: {
                    name: shopStatus?.storeName,
                    phone: shopStatus?.storePhone,
                    address: shopStatus?.storeAddress,
                    latitude: shopStatus?.storeLatitude,
                    longitude: shopStatus?.storeLongitude
                }
            });

            const stops = quotation?.stops || [];
            const { senderStopId, recipientStopId } = extractLalamoveStopIds(stops);
            if (!senderStopId || !recipientStopId || !quotation?.quotationId) {
                return res.status(502).json({ error: 'Failed to build a valid Lalamove quotation for retry' });
            }

            const [userRows] = await db.query(`SELECT name FROM users WHERE id = ? LIMIT 1`, [order.user_id]);
            const userName = String(userRows[0]?.name || order.recipient_name_snapshot || 'Customer');

            const lalamoveOrder = await lalamoveService.createOrder({
                quotationId: quotation.quotationId,
                senderStopId,
                recipientStopId,
                recipientName: order.recipient_name_snapshot || 'Customer',
                recipientPhone: order.delivery_contact_phone,
                recipientRemarks: buildLalamoveRecipientRemark({
                    shortCode: order.short_code,
                    userName,
                    customerRemark: order.delivery_note_snapshot || ''
                }),
                store: {
                    name: shopStatus?.storeName,
                    phone: shopStatus?.storePhone,
                    address: shopStatus?.storeAddress,
                    latitude: shopStatus?.storeLatitude,
                    longitude: shopStatus?.storeLongitude
                },
                metadata: {
                    source: 'takcakap',
                    localOrderRef: `fd-${orderId}`,
                    retry: '1'
                }
            });

            const mappedStatus =
                mapLalamoveUpdateToOrderStatus({
                    eventType: 'ORDER_CREATED',
                    lalamoveStatus: lalamoveOrder?.status || ''
                }) || 'Finding Rider';

            await db.query(
                `
                    UPDATE orders
                    SET
                        quotation_id = ?,
                        delivery_provider = 'Lalamove',
                        external_order_id = ?,
                        tracking_url = ?,
                        driver_id = ?,
                        lalamove_status = ?,
                        status = ?,
                        delivery_booking_status = 'booked',
                        delivery_booking_error = NULL,
                        delivery_booking_attempts = delivery_booking_attempts + 1,
                        delivery_last_attempt_at = UTC_TIMESTAMP()
                    WHERE id = ?
                `,
                [
                    quotation.quotationId,
                    lalamoveOrder?.orderId || null,
                    lalamoveOrder?.shareLink || null,
                    lalamoveOrder?.driverId || null,
                    String(lalamoveOrder?.status || 'ASSIGNING_DRIVER'),
                    mappedStatus,
                    orderId
                ]
            );

            emitOrdersChangedEvent({
                source: 'admin_retry_dispatch',
                orderId,
                reason: 'lalamove_booked'
            });

            return res.json({
                success: true,
                orderId: String(orderId),
                externalOrderId: lalamoveOrder?.orderId || null,
                trackingUrl: lalamoveOrder?.shareLink || null,
                status: mappedStatus,
                deliveryBookingStatus: 'booked',
                feeWarning:
                    'A new Lalamove quotation was used. Delivery fee charged to the Lalamove wallet may differ from the original customer quote.'
            });
        } catch (error) {
            console.error('Retry dispatch failed:', error?.payload || error?.message || error);
            const message = error?.message || 'Failed to retry Lalamove dispatch';
            await db
                .query(
                    `
                        UPDATE orders
                        SET
                            delivery_booking_status = 'booking_failed',
                            delivery_booking_error = ?,
                            delivery_booking_attempts = delivery_booking_attempts + 1,
                            delivery_last_attempt_at = UTC_TIMESTAMP()
                        WHERE id = ?
                    `,
                    [String(message).slice(0, 500), orderId]
                )
                .catch(() => null);
            return res.status(error.status || 500).json({
                error: message,
                ...(process.env.NODE_ENV !== 'production' && error.payload
                    ? { details: error.payload }
                    : {})
            });
        }
    });

    app.post('/api/admin/orders/:id/refund', requireAdmin, async (req, res) => {
        const orderId = toPositiveInteger(req.params.id);
        if (!orderId) {
            return res.status(400).json({ error: 'Invalid order id' });
        }

        try {
            const [rows] = await db.query(
                `
                    SELECT
                        id,
                        status,
                        order_type,
                        total_amount,
                        created_at,
                        DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at_utc_iso,
                        payment_method,
                        curlec_payment_id,
                        delivery_provider,
                        lalamove_status,
                        DATE_FORMAT(lalamove_ongoing_at, '%Y-%m-%dT%H:%i:%sZ') AS lalamove_ongoing_at_utc,
                        refund_status,
                        refund_amount,
                        refund_id
                    FROM orders
                    WHERE id = ?
                    LIMIT 1
                `,
                [orderId]
            );
            const order = rows[0];
            if (!order) {
                return res.status(404).json({ error: 'Order not found' });
            }

            if (normalizePaymentMethod(order.payment_method) !== PAYMENT_METHOD_CURLEC) {
                return res.status(400).json({ error: 'Refund is only available for Curlec paid orders' });
            }

            const normalizedOrderStatus = String(order.status || '').trim();
            const isPickupOrder = String(order.order_type || '').trim() === 'Pickup';
            const isLalamoveOrder = String(order.delivery_provider || '').trim() === 'Lalamove';
            let eligibilityHours = REFUND_ELIGIBILITY_HOURS;
            if (isPickupOrder && normalizedOrderStatus === 'Completed') {
                eligibilityHours = PICKUP_COMPLETED_REFUND_ELIGIBILITY_HOURS;
            }

            const cancelState = computeLalamoveCancelState({
                deliveryProvider: order.delivery_provider,
                lalamoveStatus: order.lalamove_status,
                lalamoveOngoingAtUtc: order.lalamove_ongoing_at_utc
            });
            if (isLalamoveOrder && cancelState.canCancelLalamove) {
                return res.status(409).json({
                    error: 'Cancel delivery first. Refund is triggered after successful cancellation.',
                    cancelState
                });
            }
            if (isPickupOrder && !['Cancelled', 'Completed'].includes(normalizedOrderStatus)) {
                return res.status(409).json({ error: 'Pickup refund is only available for cancelled/completed orders' });
            }
            if (!isPickupOrder && !isLalamoveOrder && normalizedOrderStatus !== 'Cancelled') {
                return res.status(409).json({ error: 'Order must be cancelled before initiating refund' });
            }

            const requestedAmountRaw = req.body?.amount;
            const requestedAmount =
                requestedAmountRaw === undefined || requestedAmountRaw === null || requestedAmountRaw === ''
                    ? null
                    : toNumber(requestedAmountRaw);
            if (requestedAmountRaw !== undefined && requestedAmountRaw !== null && requestedAmount === null) {
                return res.status(400).json({ error: 'Invalid refund amount' });
            }
            const reason = String(req.body?.reason || 'Order cancellation').trim() || 'Order cancellation';
            const manualRefundIdempotencyKey =
                normalizeCurlecRefundStatus(order.refund_status) === REFUND_STATUS_FAILED
                    ? `fd-order-${orderId}-manual-refund-retry-${Date.now()}`
                    : `fd-order-${orderId}-manual-refund`;

            const refundResult = await issueCurlecRefundForOrder({
                order,
                amount: requestedAmount,
                reason,
                initiatedByUserId: req.user?.id || null,
                idempotencyKey: manualRefundIdempotencyKey,
                eligibilityHours
            });

            if (!refundResult.success) {
                return res.status(502).json({
                    error: refundResult?.refund?.message || 'Refund request failed',
                    refund: refundResult.refund || null
                });
            }

            emailService.queueOrderEventEmail(orderId, 'cancelled_refund');
            const refundWindow = getRefundWindowState(
                order.created_at_utc_iso || order.created_at,
                Date.now(),
                eligibilityHours * 60 * 60 * 1000
            );

            return res.json({
                success: true,
                orderId: String(orderId),
                status: normalizedOrderStatus || 'Cancelled',
                refund: refundResult.refund,
                refundWindow: {
                    isEligible: refundWindow.isEligible,
                    remainingSeconds: refundWindow.remainingSeconds,
                    expiresAtUtc: refundWindow.expiresAtIso
                }
            });
        } catch (error) {
            console.error('Failed to issue refund:', error?.payload || error?.message || error);
            return res.status(error.status || 500).json({
                error: error.message || 'Failed to issue refund',
                ...(process.env.NODE_ENV !== 'production' && error.payload
                    ? { details: error.payload }
                    : {})
            });
        }
    });
};
