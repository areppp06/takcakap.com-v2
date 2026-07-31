/**
 * Curlec checkout sessions + order creation projections.
 */
'use strict';

const db = require('../db');
const {
    PAYMENT_METHOD_CURLEC,
    ORDER_DELIVERY_TIMING_NOW,
    ORDER_DELIVERY_TIMING_SCHEDULED
} = require('../config');
const {
    toPositiveInteger,
    tryParseJsonObject,
    normalizeCurrencyCode
} = require('../lib/primitives');

const normalizeCurlecCheckoutSessionId = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    return normalized.slice(0, 80);
};

const normalizeCurlecOrderDraftPayload = (payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { value: null, error: 'orderPayload must be an object when provided' };
    }
    let serialized = '';
    try {
        serialized = JSON.stringify(payload);
    } catch {
        return { value: null, error: 'orderPayload is not valid JSON data' };
    }
    if (!serialized || serialized === '{}' || serialized.length > 120_000) {
        return { value: null, error: 'orderPayload is invalid or too large' };
    }
    let cloned = null;
    try {
        cloned = JSON.parse(serialized);
    } catch {
        return { value: null, error: 'orderPayload is not valid JSON data' };
    }
    if (!Array.isArray(cloned?.items) || cloned.items.length === 0) {
        return { value: null, error: 'orderPayload must contain at least one item' };
    }
    cloned.paymentMethod = PAYMENT_METHOD_CURLEC;
    delete cloned.curlecPayment;
    delete cloned.curlecCheckoutSessionId;
    return { value: cloned, error: null };
};

const upsertCurlecCheckoutSession = async ({
    userId,
    sessionId,
    curlecOrderId,
    expectedAmountMinor,
    currency = 'MYR',
    orderPayload
}) => {
    const normalizedUserId = toPositiveInteger(userId);
    const normalizedSessionId = normalizeCurlecCheckoutSessionId(sessionId);
    const normalizedOrderId = String(curlecOrderId || '').trim();
    const normalizedAmountMinor = toPositiveInteger(expectedAmountMinor);
    const normalizedCurrency = normalizeCurrencyCode(currency, 'MYR');
    const payloadJson = orderPayload ? JSON.stringify(orderPayload) : null;
    if (!normalizedUserId || !normalizedSessionId || !normalizedOrderId || !normalizedAmountMinor) {
        const error = new Error('Invalid Curlec checkout session payload');
        error.status = 400;
        throw error;
    }
    await db.query(
        `
            INSERT INTO curlec_checkout_sessions (
                session_id,
                user_id,
                curlec_order_id,
                expected_amount_minor,
                currency,
                order_payload_json,
                status,
                consumed_order_id,
                consumed_at,
                payment_id,
                payment_captured_at
            )
            VALUES (?, ?, ?, ?, ?, ?, 'created', NULL, NULL, NULL, NULL)
            ON DUPLICATE KEY UPDATE
                user_id = VALUES(user_id),
                curlec_order_id = VALUES(curlec_order_id),
                expected_amount_minor = VALUES(expected_amount_minor),
                currency = VALUES(currency),
                order_payload_json = VALUES(order_payload_json),
                status = CASE
                    WHEN consumed_order_id IS NULL THEN 'created'
                    ELSE status
                END,
                updated_at = UTC_TIMESTAMP()
        `,
        [normalizedSessionId, normalizedUserId, normalizedOrderId, normalizedAmountMinor, normalizedCurrency, payloadJson]
    );
};

const reserveCurlecCheckoutSessionForFinalize = async (
    connection,
    { sessionId, userId, curlecOrderId, paymentId, expectedAmountMinor }
) => {
    const normalizedSessionId = normalizeCurlecCheckoutSessionId(sessionId);
    if (!normalizedSessionId) {
        const error = new Error('Missing Curlec checkout session');
        error.status = 400;
        throw error;
    }
    const normalizedUserId = toPositiveInteger(userId);
    const normalizedCurlecOrderId = String(curlecOrderId || '').trim();
    const normalizedPaymentId = String(paymentId || '').trim();
    const normalizedExpectedAmountMinor = toPositiveInteger(expectedAmountMinor);

    const [rows] = await connection.query(
        `
            SELECT
                id,
                user_id,
                curlec_order_id,
                expected_amount_minor,
                consumed_order_id,
                payment_id
            FROM curlec_checkout_sessions
            WHERE session_id = ?
            LIMIT 1
            FOR UPDATE
        `,
        [normalizedSessionId]
    );
    const sessionRow = rows[0];
    if (!sessionRow) {
        const error = new Error('Curlec checkout session is invalid or expired');
        error.status = 409;
        throw error;
    }
    if (Number(sessionRow.user_id) !== Number(normalizedUserId)) {
        const error = new Error('Curlec checkout session does not belong to this user');
        error.status = 403;
        throw error;
    }
    if (String(sessionRow.curlec_order_id || '').trim() !== normalizedCurlecOrderId) {
        const error = new Error('Curlec checkout order mismatch');
        error.status = 409;
        throw error;
    }
    if (
        normalizedExpectedAmountMinor &&
        Number(sessionRow.expected_amount_minor || 0) > 0 &&
        Number(sessionRow.expected_amount_minor) !== Number(normalizedExpectedAmountMinor)
    ) {
        const error = new Error('Curlec checkout amount mismatch');
        error.status = 409;
        throw error;
    }
    if (
        String(sessionRow.payment_id || '').trim() &&
        String(sessionRow.payment_id).trim() !== normalizedPaymentId
    ) {
        const error = new Error('Curlec checkout payment id mismatch');
        error.status = 409;
        throw error;
    }
    const consumedOrderId = toPositiveInteger(sessionRow.consumed_order_id);
    if (consumedOrderId) {
        return {
            alreadyConsumed: true,
            consumedOrderId,
            sessionId: normalizedSessionId
        };
    }

    await connection.query(
        `
            UPDATE curlec_checkout_sessions
            SET
                payment_id = COALESCE(payment_id, ?),
                payment_captured_at = COALESCE(payment_captured_at, UTC_TIMESTAMP()),
                updated_at = UTC_TIMESTAMP()
            WHERE id = ?
        `,
        [normalizedPaymentId || null, sessionRow.id]
    );

    return {
        alreadyConsumed: false,
        sessionId: normalizedSessionId,
        sessionRowId: toPositiveInteger(sessionRow.id)
    };
};

const markCurlecCheckoutSessionConsumed = async (
    connection,
    { sessionId, orderId, paymentId = null, status = 'consumed' }
) => {
    const normalizedSessionId = normalizeCurlecCheckoutSessionId(sessionId);
    const normalizedOrderId = toPositiveInteger(orderId);
    if (!normalizedSessionId || !normalizedOrderId) return;
    await connection.query(
        `
            UPDATE curlec_checkout_sessions
            SET
                consumed_order_id = COALESCE(consumed_order_id, ?),
                consumed_at = COALESCE(consumed_at, UTC_TIMESTAMP()),
                payment_id = COALESCE(payment_id, ?),
                payment_captured_at = COALESCE(payment_captured_at, UTC_TIMESTAMP()),
                status = ?,
                updated_at = UTC_TIMESTAMP()
            WHERE session_id = ?
        `,
        [normalizedOrderId, String(paymentId || '').trim() || null, String(status || 'consumed'), normalizedSessionId]
    );
};

const markCurlecCheckoutSessionStatus = async ({ sessionId, status, paymentId = null, consumedOrderId = null }) => {
    const normalizedSessionId = normalizeCurlecCheckoutSessionId(sessionId);
    if (!normalizedSessionId) return;
    await db.query(
        `
            UPDATE curlec_checkout_sessions
            SET
                status = ?,
                payment_id = COALESCE(payment_id, ?),
                payment_captured_at = CASE
                    WHEN ? IS NULL THEN payment_captured_at
                    ELSE COALESCE(payment_captured_at, UTC_TIMESTAMP())
                END,
                consumed_order_id = COALESCE(consumed_order_id, ?),
                consumed_at = CASE
                    WHEN ? IS NULL THEN consumed_at
                    ELSE COALESCE(consumed_at, UTC_TIMESTAMP())
                END,
                updated_at = UTC_TIMESTAMP()
            WHERE session_id = ?
        `,
        [
            String(status || 'created'),
            String(paymentId || '').trim() || null,
            String(paymentId || '').trim() || null,
            toPositiveInteger(consumedOrderId),
            toPositiveInteger(consumedOrderId),
            normalizedSessionId
        ]
    );
};

const fetchCurlecCheckoutSessionByOrderId = async (curlecOrderId) => {
    const normalizedOrderId = String(curlecOrderId || '').trim();
    if (!normalizedOrderId) return null;
    const [rows] = await db.query(
        `
            SELECT
                id,
                session_id,
                user_id,
                curlec_order_id,
                expected_amount_minor,
                currency,
                order_payload_json,
                consumed_order_id,
                payment_id,
                status
            FROM curlec_checkout_sessions
            WHERE curlec_order_id = ?
            LIMIT 1
        `,
        [normalizedOrderId]
    );
    return rows[0] || null;
};

const fetchOrderCreationProjectionByPaymentId = async (curlecPaymentId) => {
    const normalizedPaymentId = String(curlecPaymentId || '').trim();
    if (!normalizedPaymentId) return null;
    const [rows] = await db.query(
        `
            SELECT
                id,
                short_code,
                external_order_id,
                tracking_url,
                lalamove_status,
                delivery_timing,
                DATE_FORMAT(scheduled_at_utc, '%Y-%m-%dT%H:%i:%sZ') AS scheduled_at_utc_iso
            FROM orders
            WHERE curlec_payment_id = ?
            LIMIT 1
        `,
        [normalizedPaymentId]
    );
    const order = rows[0];
    if (!order) return null;
    return {
        success: true,
        idempotent: true,
        orderId: String(order.id),
        shortCode: order.short_code || null,
        externalOrderId: order.external_order_id || null,
        trackingUrl: order.tracking_url || null,
        lalamoveStatus: order.lalamove_status || null,
        deliveryTiming:
            String(order.delivery_timing || ORDER_DELIVERY_TIMING_NOW).toUpperCase() === ORDER_DELIVERY_TIMING_SCHEDULED
                ? ORDER_DELIVERY_TIMING_SCHEDULED
                : ORDER_DELIVERY_TIMING_NOW,
        scheduledAtUtc: order.scheduled_at_utc_iso || null
    };
};

const fetchOrderCreationProjectionByOrderId = async (orderId) => {
    const normalizedOrderId = toPositiveInteger(orderId);
    if (!normalizedOrderId) return null;
    const [rows] = await db.query(
        `
            SELECT
                id,
                short_code,
                external_order_id,
                tracking_url,
                lalamove_status,
                delivery_timing,
                DATE_FORMAT(scheduled_at_utc, '%Y-%m-%dT%H:%i:%sZ') AS scheduled_at_utc_iso
            FROM orders
            WHERE id = ?
            LIMIT 1
        `,
        [normalizedOrderId]
    );
    const order = rows[0];
    if (!order) return null;
    return {
        success: true,
        idempotent: true,
        orderId: String(order.id),
        shortCode: order.short_code || null,
        externalOrderId: order.external_order_id || null,
        trackingUrl: order.tracking_url || null,
        lalamoveStatus: order.lalamove_status || null,
        deliveryTiming:
            String(order.delivery_timing || ORDER_DELIVERY_TIMING_NOW).toUpperCase() === ORDER_DELIVERY_TIMING_SCHEDULED
                ? ORDER_DELIVERY_TIMING_SCHEDULED
                : ORDER_DELIVERY_TIMING_NOW,
        scheduledAtUtc: order.scheduled_at_utc_iso || null
    };
};


module.exports = {
    normalizeCurlecCheckoutSessionId,
    normalizeCurlecOrderDraftPayload,
    upsertCurlecCheckoutSession,
    reserveCurlecCheckoutSessionForFinalize,
    markCurlecCheckoutSessionConsumed,
    markCurlecCheckoutSessionStatus,
    fetchCurlecCheckoutSessionByOrderId,
    fetchOrderCreationProjectionByPaymentId,
    fetchOrderCreationProjectionByOrderId
};
