/**
 * Curlec capture reconciliation via internal order create.
 */
'use strict';

const db = require('../db');
const {
    PAYMENT_METHOD_CURLEC,
    INTERNAL_ORDER_RECONCILIATION_TIMEOUT_MS,
    PORT
} = require('../config');
const {
    toPositiveInteger,
    tryParseJsonObject
} = require('../lib/primitives');
const { createCurlecPaymentSignature } = require('./curlecClient');
const { signAuthToken } = require('../lib/authTokens');
const {
    normalizeCurlecCheckoutSessionId,
    markCurlecCheckoutSessionStatus,
    fetchCurlecCheckoutSessionByOrderId,
    fetchOrderCreationProjectionByPaymentId
} = require('./curlecSessions');

const reconcileCurlecCapturedPaymentViaInternalOrderCreate = async ({
    checkoutSession,
    paymentEntity
}) => {
    const sessionId = normalizeCurlecCheckoutSessionId(checkoutSession?.session_id);
    const userId = toPositiveInteger(checkoutSession?.user_id);
    const orderId = String(paymentEntity?.order_id || '').trim();
    const paymentId = String(paymentEntity?.id || '').trim();
    if (!sessionId || !userId || !orderId || !paymentId) {
        return { reconciled: false, reason: 'invalid_reconcile_payload' };
    }

    const existingOrderProjection = await fetchOrderCreationProjectionByPaymentId(paymentId);
    if (existingOrderProjection?.orderId) {
        await markCurlecCheckoutSessionStatus({
            sessionId,
            status: 'capture_reconciled',
            paymentId,
            consumedOrderId: existingOrderProjection.orderId
        });
        return {
            reconciled: true,
            orderId: existingOrderProjection.orderId,
            idempotent: true
        };
    }

    const payloadDraft = tryParseJsonObject(checkoutSession?.order_payload_json);
    if (!payloadDraft) {
        await markCurlecCheckoutSessionStatus({
            sessionId,
            status: 'captured_no_order',
            paymentId
        });
        return { reconciled: false, reason: 'missing_order_payload' };
    }

    const [userRows] = await db.query(
        `
            SELECT id, email, role
            FROM users
            WHERE id = ?
            LIMIT 1
        `,
        [userId]
    );
    const user = userRows[0];
    if (!user) {
        await markCurlecCheckoutSessionStatus({
            sessionId,
            status: 'capture_failed',
            paymentId
        });
        return { reconciled: false, reason: 'user_not_found' };
    }

    const internalRequestBody = {
        ...payloadDraft,
        paymentMethod: PAYMENT_METHOD_CURLEC,
        curlecCheckoutSessionId: sessionId,
        curlecPayment: {
            orderId,
            paymentId,
            signature: createCurlecPaymentSignature({ orderId, paymentId })
        }
    };

    const token = signAuthToken({
        id: Number(user.id),
        email: user.email || '',
        role: user.role || 'user'
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), INTERNAL_ORDER_RECONCILIATION_TIMEOUT_MS);
    try {
        const response = await fetch(`http://127.0.0.1:${PORT}/api/orders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                'x-curlec-reconcile': '1'
            },
            body: JSON.stringify(internalRequestBody),
            signal: controller.signal
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message =
                payload?.error ||
                payload?.message ||
                `Internal order reconciliation failed (${response.status})`;
            const error = new Error(message);
            error.status = response.status;
            error.payload = payload;
            throw error;
        }

        const reconciledOrderId = toPositiveInteger(payload?.orderId);
        await markCurlecCheckoutSessionStatus({
            sessionId,
            status: 'capture_reconciled',
            paymentId,
            consumedOrderId: reconciledOrderId || null
        });

        return {
            reconciled: true,
            orderId: reconciledOrderId ? String(reconciledOrderId) : null,
            idempotent: Boolean(payload?.idempotent)
        };
    } catch (error) {
        await markCurlecCheckoutSessionStatus({
            sessionId,
            status: 'capture_failed',
            paymentId
        }).catch(() => null);
        throw error;
    } finally {
        clearTimeout(timeout);
    }
};

const applyCurlecPaymentCapturedWebhookUpdate = async ({ paymentEntity }) => {
    const paymentId = String(paymentEntity?.id || '').trim();
    const curlecOrderId = String(paymentEntity?.order_id || paymentEntity?.orderId || '').trim();
    if (!paymentId || !curlecOrderId) {
        const error = new Error('Missing payment id or order id in Curlec payment webhook');
        error.status = 400;
        throw error;
    }

    const paymentStatus = String(paymentEntity?.status || '').trim().toLowerCase();
    if (paymentStatus && !['captured', 'authorized'].includes(paymentStatus)) {
        return {
            updated: false,
            orderId: null,
            reconciled: false,
            reason: 'payment_not_captured'
        };
    }

    const existingOrder = await fetchOrderCreationProjectionByPaymentId(paymentId);
    if (existingOrder?.orderId) {
        return {
            updated: false,
            orderId: existingOrder.orderId,
            reconciled: true,
            idempotent: true,
            reason: 'order_already_exists'
        };
    }

    const session = await fetchCurlecCheckoutSessionByOrderId(curlecOrderId);
    if (!session?.session_id) {
        return {
            updated: false,
            orderId: null,
            reconciled: false,
            reason: 'missing_checkout_session'
        };
    }

    const reconcileResult = await reconcileCurlecCapturedPaymentViaInternalOrderCreate({
        checkoutSession: session,
        paymentEntity
    });
    return {
        updated: Boolean(reconcileResult?.reconciled),
        orderId: reconcileResult?.orderId || null,
        reconciled: Boolean(reconcileResult?.reconciled),
        idempotent: Boolean(reconcileResult?.idempotent),
        reason: reconcileResult?.reason || ''
    };
};

module.exports = {
    reconcileCurlecCapturedPaymentViaInternalOrderCreate,
    applyCurlecPaymentCapturedWebhookUpdate
};
