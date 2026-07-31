/**
 * Order create pipeline helpers extracted from the create route.
 * Route remains the HTTP/transaction adapter; heavy validation lives here.
 */
'use strict';

const {
    toPositiveInteger,
    toNumber,
    toSqlDateTimeUtc,
    toUtcIsoString
} = require('../../lib/primitives');
const {
    ORDER_DELIVERY_TIMING_NOW,
    ORDER_DELIVERY_TIMING_SCHEDULED,
    PAYMENT_METHOD_CURLEC
} = require('../../config');
const { parseScheduledAtUtc } = require('./orderEvents');
const {
    assertCurlecPaymentMethodForNewOrder,
    normalizeCurlecPaymentPayload,
    verifyCurlecPaymentSignature,
    callCurlecApi
} = require('../curlecClient');

/**
 * Client-safe error JSON: never expose provider payloads in production.
 */
function clientErrorBody(error, fallbackMessage) {
    const body = { error: error?.message || fallbackMessage || 'Request failed' };
    if (process.env.NODE_ENV !== 'production' && error?.payload) {
        body.details = error.payload;
    }
    return body;
}

/**
 * Aggregate and validate line items from request body.
 */
function aggregateRequestedItems(items) {
    const orderItems = Array.isArray(items) ? items : [];
    if (orderItems.length === 0) {
        return { ok: false, error: 'Order must contain at least one item' };
    }
    const requestedQuantityById = new Map();
    for (const item of orderItems) {
        const menuItemId = toPositiveInteger(item?.id);
        const quantity = toPositiveInteger(item?.quantity);
        if (!menuItemId || !quantity) {
            return { ok: false, error: 'Invalid order item payload' };
        }
        requestedQuantityById.set(menuItemId, (requestedQuantityById.get(menuItemId) || 0) + quantity);
    }
    return { ok: true, map: requestedQuantityById, orderItems };
}

/**
 * Normalize order type, payment method, and delivery timing for create.
 */
function normalizeCreateOrderBasics(body) {
    const orderType = body?.orderType === 'Pickup' ? 'Pickup' : 'Delivery';
    let paymentMethod;
    try {
        paymentMethod = assertCurlecPaymentMethodForNewOrder(body?.paymentMethod);
    } catch (methodError) {
        return { ok: false, status: methodError.status || 400, error: methodError.message };
    }

    const submittedTotal = toNumber(body?.total);
    if (submittedTotal === null || submittedTotal <= 0) {
        return { ok: false, status: 400, error: 'Invalid total amount' };
    }

    const isLalamoveDelivery = orderType === 'Delivery';
    const deliveryTiming =
        isLalamoveDelivery &&
        String(body?.deliveryTiming || ORDER_DELIVERY_TIMING_NOW).toUpperCase() === ORDER_DELIVERY_TIMING_SCHEDULED
            ? ORDER_DELIVERY_TIMING_SCHEDULED
            : ORDER_DELIVERY_TIMING_NOW;
    const parsedSchedule = parseScheduledAtUtc(body?.scheduledAtUtc, {
        required: deliveryTiming === ORDER_DELIVERY_TIMING_SCHEDULED
    });
    if (parsedSchedule.error) {
        return { ok: false, status: 400, error: parsedSchedule.error };
    }

    return {
        ok: true,
        orderType,
        paymentMethod,
        submittedTotal,
        isLalamoveDelivery,
        deliveryTiming,
        scheduledAtSql: parsedSchedule.value ? toSqlDateTimeUtc(parsedSchedule.value) : null,
        scheduledAtUtc: parsedSchedule.value || null
    };
}

/**
 * Validate Curlec payment proof + fetch payment details from provider.
 * Throws errors with .status (and optional .payload) for the route to map to HTTP.
 */
async function validateCurlecPaymentForCreate({ curlecPayment, paymentOptions }) {
    if (!paymentOptions?.curlecEnabled) {
        const error = new Error('Curlec payment is currently unavailable');
        error.status = 403;
        throw error;
    }
    if (!paymentOptions?.curlecConfigured) {
        const error = new Error('Curlec payment is not configured on server');
        error.status = 503;
        throw error;
    }

    const normalizedCurlecPayment = normalizeCurlecPaymentPayload(curlecPayment);
    if (normalizedCurlecPayment.error) {
        const error = new Error(normalizedCurlecPayment.error);
        error.status = 400;
        throw error;
    }
    const curlecPaymentProof = normalizedCurlecPayment.value;

    if (!verifyCurlecPaymentSignature(curlecPaymentProof)) {
        const error = new Error('Invalid Curlec payment signature');
        error.status = 400;
        throw error;
    }

    const paymentDetails = await callCurlecApi({
        endpoint: `/payments/${encodeURIComponent(curlecPaymentProof.paymentId)}`
    });
    if (String(paymentDetails.order_id || '') !== curlecPaymentProof.orderId) {
        const error = new Error('Curlec payment does not match the checkout order');
        error.status = 400;
        throw error;
    }
    const paymentStatus = String(paymentDetails.status || '').toLowerCase();
    if (!['captured', 'authorized'].includes(paymentStatus)) {
        const error = new Error('Curlec payment is not completed');
        error.status = 400;
        throw error;
    }

    const paymentAmountInMinorUnits = toPositiveInteger(paymentDetails.amount);
    if (!paymentAmountInMinorUnits) {
        const error = new Error('Unable to validate Curlec payment amount');
        error.status = 400;
        throw error;
    }

    return {
        curlecPaymentProof,
        paymentDetails,
        paymentAmountInMinorUnits,
        paymentMethod: PAYMENT_METHOD_CURLEC
    };
}

/**
 * Ensure reserved delivery quote matches the order timing/schedule.
 */
function assertDeliveryQuoteMatchesOrder({
    quote,
    normalizedDeliveryTiming,
    scheduledAtSql,
    normalizedPaymentMethod
}) {
    if (!quote) {
        const error = new Error('Delivery quotation not found. Please request a new quote.');
        error.status = 409;
        throw error;
    }
    if (quote.used_at) {
        const error = new Error('Delivery quotation already used. Please request a new quote.');
        error.status = 409;
        throw error;
    }
    const quoteExpiresAtIso = toUtcIsoString(quote.expires_at_utc_iso || quote.expires_at);
    const isQuoteExpired = quoteExpiresAtIso && new Date(quoteExpiresAtIso).getTime() <= Date.now();
    if (isQuoteExpired && normalizedPaymentMethod !== PAYMENT_METHOD_CURLEC) {
        const error = new Error('Delivery quotation expired. Please request a new quote.');
        error.status = 409;
        throw error;
    }

    const requestedScheduledSql = scheduledAtSql || null;
    const quoteScheduledSql = quote.scheduled_at_utc_sql ? String(quote.scheduled_at_utc_sql).trim() : null;
    if (normalizedDeliveryTiming === ORDER_DELIVERY_TIMING_SCHEDULED) {
        if (!requestedScheduledSql || !quoteScheduledSql || requestedScheduledSql !== quoteScheduledSql) {
            const error = new Error(
                'Scheduled delivery time no longer matches quote. Please request a new quote.'
            );
            error.status = 409;
            throw error;
        }
    } else if (quoteScheduledSql) {
        const error = new Error(
            'This quote is for scheduled delivery. Please place as scheduled or refresh quote.'
        );
        error.status = 409;
        throw error;
    }

    return {
        senderStopId: String(quote.sender_stop_id || '').trim(),
        recipientStopId: String(quote.recipient_stop_id || '').trim(),
        isQuoteExpired: Boolean(isQuoteExpired)
    };
}

module.exports = {
    clientErrorBody,
    aggregateRequestedItems,
    normalizeCreateOrderBasics,
    validateCurlecPaymentForCreate,
    assertDeliveryQuoteMatchesOrder
};
