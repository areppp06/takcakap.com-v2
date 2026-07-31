/**
 * Order change events, client formatting, admin list helpers.
 */
'use strict';

const { EventEmitter } = require('events');
const db = require('../../db');
const { sendPushToUser, sendFcmToAdmins } = require('../../pushService');
const {
    ORDER_DELIVERY_TIMING_NOW,
    ORDER_DELIVERY_TIMING_SCHEDULED,
    PAYMENT_METHOD_CURLEC,
    PICKUP_COMPLETED_REFUND_ELIGIBILITY_HOURS,
    REFUND_WINDOW_MS,
    REFUND_STATUS_PENDING,
    REFUND_STATUS_PROCESSED,
    MIN_SCHEDULE_LEAD_MINUTES,
    SHOP_TIMEZONE
} = require('../../config');
const {
    toPositiveInteger,
    toUtcIsoString,
    toSqlDateTimeUtc,
    parsePositiveIntWithBounds
} = require('../../lib/primitives');
const {
    computeLalamoveCancelState,
    formatScheduledAtLabel
} = require('../lalamoveHelpers');
const {
    normalizePaymentMethod,
    normalizeCurlecRefundStatus
} = require('../curlecClient');

const orderEvents = new EventEmitter();
orderEvents.setMaxListeners(300);
let orderEventSequence = 0;

const getRefundWindowState = (createdAtLike, nowMs = Date.now(), windowMs = REFUND_WINDOW_MS) => {
    const createdAtIso = toUtcIsoString(createdAtLike);
    if (!createdAtIso) {
        return {
            createdAtIso: null,
            expiresAtIso: null,
            remainingSeconds: 0,
            isEligible: false
        };
    }

    const createdAtMs = new Date(createdAtIso).getTime();
    if (Number.isNaN(createdAtMs)) {
        return {
            createdAtIso: null,
            expiresAtIso: null,
            remainingSeconds: 0,
            isEligible: false
        };
    }

    const normalizedWindowMs = Number.isFinite(Number(windowMs)) && Number(windowMs) > 0
        ? Number(windowMs)
        : REFUND_WINDOW_MS;
    const expiresAtMs = createdAtMs + normalizedWindowMs;
    const remainingSeconds = Math.max(0, Math.floor((expiresAtMs - nowMs) / 1000));

    return {
        createdAtIso,
        expiresAtIso: new Date(expiresAtMs).toISOString(),
        remainingSeconds,
        isEligible: remainingSeconds > 0
    };
};

const parseScheduledAtUtc = (value, { required = false, minLeadMinutes = MIN_SCHEDULE_LEAD_MINUTES } = {}) => {
    const raw = String(value || '').trim();
    if (!raw) {
        if (required) {
            return { value: null, error: 'scheduledAtUtc is required for scheduled delivery' };
        }
        return { value: null, error: null };
    }

    const iso = toUtcIsoString(raw);
    if (!iso) {
        return { value: null, error: 'Invalid scheduledAtUtc datetime format' };
    }
    const scheduledMs = new Date(iso).getTime();
    const minAllowedMs = Date.now() + Math.max(1, minLeadMinutes) * 60 * 1000;
    if (scheduledMs <= minAllowedMs) {
        return {
            value: null,
            error: `Scheduled time must be at least ${Math.max(1, minLeadMinutes)} minutes in the future`
        };
    }

    return { value: iso, error: null };
};

const normalizeAdminCursorDateTime = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
        return raw;
    }
    return toSqlDateTimeUtc(value);
};

const encodeAdminOrdersCursor = ({ createdAtSql, createdAtUtc, id }) => {
    const normalizedId = toPositiveInteger(id);
    const normalizedCreatedAt = normalizeAdminCursorDateTime(createdAtSql || createdAtUtc);
    if (!normalizedId || !normalizedCreatedAt) return null;
    return Buffer.from(
        JSON.stringify({
            c: normalizedCreatedAt,
            i: normalizedId
        }),
        'utf8'
    ).toString('base64');
};

const decodeAdminOrdersCursor = (cursor) => {
    const raw = String(cursor || '').trim();
    if (!raw) return null;
    try {
        const payload = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
        const id = toPositiveInteger(payload?.i);
        const createdAtSql = normalizeAdminCursorDateTime(payload?.c);
        if (!id || !createdAtSql) return null;
        return {
            id,
            createdAtSql
        };
    } catch {
        return null;
    }
};

const normalizeAdminOrderStatus = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized || normalized.toLowerCase() === 'all') return null;
    if (normalized.length > 50) return null;
    return normalized;
};

const normalizeAdminRefundStatusFilter = (value) => {
    const normalized = normalizeCurlecRefundStatus(value);
    return normalized || null;
};

const normalizeAdminDeliveryTiming = (value) => {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === ORDER_DELIVERY_TIMING_NOW) return ORDER_DELIVERY_TIMING_NOW;
    if (normalized === ORDER_DELIVERY_TIMING_SCHEDULED) return ORDER_DELIVERY_TIMING_SCHEDULED;
    return null;
};

const normalizeAdminSearchQuery = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '';
    return normalized.slice(0, 80);
};

const triggerOrderPushNotification = async (orderId, reason) => {
    if (!orderId) return;
    try {
        const [rows] = await db.query('SELECT user_id, status, lalamove_status, short_code FROM orders WHERE id = ?', [orderId]);
        if (!rows.length) return;
        const order = rows[0];
        const displayCode = order.short_code || orderId;

        let title = 'TakCakap Order Update';
        let body = `Your order #${displayCode} status has changed.`;
        let notify = false;

        const status = String(order.status || '').trim();
        const lalaStatus = String(order.lalamove_status || '').trim();
        const r = String(reason || '').trim();

        if (r.startsWith('status_') || r === 'cancelled') {
            notify = true;
            if (status === 'Preparing') {
                title = 'Order Preparing 🍳';
                body = `We have started preparing your order #${displayCode}!`;
            } else if (status === 'Ready to Pickup') {
                title = 'Ready to Pickup 🛍️';
                body = `Your order #${displayCode} is ready for pick up!`;
            } else if (status === 'Completed') {
                title = 'Order Completed ✅';
                body = `Your order #${displayCode} has been completed. Enjoy!`;
            } else if (status === 'Cancelled') {
                title = 'Order Cancelled ❌';
                body = `Your order #${displayCode} has been cancelled.`;
            } else {
                title = 'Order Status Updated ℹ️';
                body = `Your order #${displayCode} status has changed to ${status}.`;
            }
        } else if (
            r === 'lalamove_webhook' ||
            r === 'lalamove_sync' ||
            r === 'lalamove_booked' ||
            ['Finding Rider', 'Rider OTW', 'Out For Delivery', 'Completed', 'Cancelled'].includes(r)
        ) {
            notify = true;
            if (lalaStatus === 'ASSIGNING_DRIVER') {
                title = 'Finding Rider 🛵';
                body = `We are finding a Lalamove rider for your order #${displayCode}.`;
            } else if (lalaStatus === 'ON_GOING') {
                title = 'Rider OTW (Picking Up) 🚀';
                body = `A rider is on the way to pick up your order #${displayCode}.`;
            } else if (lalaStatus === 'PICKED_UP') {
                title = 'Out for Delivery 🛵💨';
                body = `Your order #${displayCode} is out for delivery!`;
            } else if (lalaStatus === 'CANCELED') {
                title = 'Delivery Cancelled ⚠️';
                body = `The delivery for order #${displayCode} was cancelled.`;
            } else if (lalaStatus === 'COMPLETED') {
                title = 'Order Delivered 🏁';
                body = `Your order #${displayCode} has been delivered. Enjoy!`;
            } else {
                notify = false; // Don't notify on every small lalamove state change unless handled above
            }
        } else if (r === 'refund_processed' || r === 'refund_failed') {
            notify = true;
            title = r === 'refund_processed' ? 'Refund Processed 💸' : 'Refund Failed ⚠️';
            body = r === 'refund_processed'
                ? `A refund for order #${displayCode} has been processed.`
                : `A refund attempt for order #${displayCode} failed.`;
        } else if (r === 'payment_captured') {
            notify = true;
            title = 'Payment Successful 💰';
            body = `Your payment for order #${displayCode} was received.`;
        }

        if (notify) {
            await sendPushToUser(order.user_id, title, body, '/orders');
        }
    } catch (e) {
        console.error('Push notification failed:', e);
    }
};

const emitOrdersChangedEvent = ({ source = 'system', orderId = null, reason = '' } = {}) => {
    orderEventSequence += 1;
    const payload = {
        sequence: orderEventSequence,
        source: String(source || 'system').slice(0, 40),
        orderId: toPositiveInteger(orderId) ? String(orderId) : null,
        reason: String(reason || '').trim().slice(0, 120),
        emittedAtUtc: new Date().toISOString()
    };
    orderEvents.emit('orders_changed', payload);

    // Trigger push notification asynchronously
    triggerOrderPushNotification(payload.orderId, payload.reason).catch(() => { });

    // Trigger Admin FCM Push Notification for new orders
    if (payload.orderId && (payload.reason === 'created' || payload.reason === 'payment_captured')) {
        db.query('SELECT short_code FROM orders WHERE id = ?', [payload.orderId]).then(([rows]) => {
            if (rows.length > 0) {
                const displayCode = rows[0].short_code || payload.orderId;
                sendFcmToAdmins(
                    'NEW ORDER! 🚨',
                    `Order #${displayCode} has arrived! Open the app to view and accept.`,
                    { type: 'new_order', orderId: String(payload.orderId) }
                ).catch(() => { });
            }
        }).catch(() => { });
    }
};
const formatOrderRowForClient = (o) => {
    const cancelState = computeLalamoveCancelState({
        deliveryProvider: o.delivery_provider,
        lalamoveStatus: o.lalamove_status,
        lalamoveOngoingAtUtc: o.lalamove_ongoing_at_utc
    });
    const defaultRefundWindow = getRefundWindowState(o.created_at_utc_iso || o.created_at);
    const pickupCompletedRefundWindow = getRefundWindowState(
        o.created_at_utc_iso || o.created_at,
        Date.now(),
        PICKUP_COMPLETED_REFUND_ELIGIBILITY_HOURS * 60 * 60 * 1000
    );
    const refundStatus = normalizeCurlecRefundStatus(o.refund_status);
    const isCurlecPayment = normalizePaymentMethod(o.payment_method) === PAYMENT_METHOD_CURLEC;
    const hasActiveRefund = refundStatus === REFUND_STATUS_PENDING || refundStatus === REFUND_STATUS_PROCESSED;
    const normalizedOrderType = String(o.order_type || '').trim();
    const normalizedOrderStatus = String(o.status || '').trim();
    const isPickupOrder = normalizedOrderType === 'Pickup';
    const isLalamoveOrder = String(o.delivery_provider || '').trim() === 'Lalamove';

    let resolvedRefundWindow = defaultRefundWindow;
    if (isPickupOrder && normalizedOrderStatus === 'Completed') {
        resolvedRefundWindow = pickupCompletedRefundWindow;
    }

    let canRequestRefund = false;
    if (!hasActiveRefund && isCurlecPayment) {
        if (isPickupOrder) {
            if (normalizedOrderStatus === 'Completed' || normalizedOrderStatus === 'Cancelled') {
                canRequestRefund = resolvedRefundWindow.isEligible;
            }
        } else if (isLalamoveOrder) {
            canRequestRefund = !cancelState.canCancelLalamove && defaultRefundWindow.isEligible;
        } else if (normalizedOrderStatus === 'Cancelled') {
            canRequestRefund = defaultRefundWindow.isEligible;
        }
    }

    return {
        ...(o.scheduled_at_utc_iso
            ? {
                scheduledAtUtc: o.scheduled_at_utc_iso,
                scheduledAtLabel: formatScheduledAtLabel(o.scheduled_at_utc_iso)
            }
            : {}),
        id: String(o.id),
        shortCode: o.short_code || null,
        customerName: o.customer_name || 'Guest',
        customerAvatar: o.avatar_url,
        customerPhone:
            String(
                o.order_type === 'Delivery'
                    ? o.delivery_contact_phone || ''
                    : o.delivery_contact_phone || o.account_phone || ''
            ).trim(),
        date: new Date(o.created_at).toLocaleString(),
        status: o.status,
        total: parseFloat(o.total_amount),
        itemsSummary: String(o.items_summary || ''),
        orderType: o.order_type,
        address: o.delivery_address,
        addressLabel: o.delivery_label_snapshot || '',
        addressNote: o.delivery_note_snapshot || '',
        addressLatitude: o.delivery_latitude !== null ? parseFloat(o.delivery_latitude) : undefined,
        addressLongitude: o.delivery_longitude !== null ? parseFloat(o.delivery_longitude) : undefined,
        recipientName: o.recipient_name_snapshot || '',
        deliveryProvider: o.delivery_provider,
        externalOrderId: o.external_order_id,
        quotationId: o.quotation_id,
        trackingUrl: o.tracking_url,
        driverId: o.driver_id,
        lalamoveStatus: o.lalamove_status,
        paymentMethod: o.payment_method || PAYMENT_METHOD_CURLEC,
        refundStatus: refundStatus || undefined,
        refundAmount: o.refund_amount !== null ? parseFloat(o.refund_amount) : undefined,
        refundId: o.refund_id || undefined,
        refundSpeedRequested: o.refund_speed_requested || undefined,
        refundSpeedProcessed: o.refund_speed_processed || undefined,
        refundRequestedAtUtc: o.refund_requested_at_utc || undefined,
        refundProcessedAtUtc: o.refund_processed_at_utc || undefined,
        refundFailedAtUtc: o.refund_failed_at_utc || undefined,
        refundFailureReason: o.refund_failure_reason || undefined,
        refundReason: o.refund_reason || undefined,
        createdAtUtc: o.created_at_utc_iso || undefined,
        updatedAtUtc: o.updated_at_utc_iso || undefined,
        refundEligibleUntilUtc: resolvedRefundWindow.expiresAtIso || undefined,
        refundWindowRemainingSeconds: resolvedRefundWindow.remainingSeconds,
        isRefundEligible: resolvedRefundWindow.isEligible,
        canRequestRefund,
        deliveryFee: o.delivery_fee !== null ? parseFloat(o.delivery_fee) : undefined,
        deliveryCurrency: o.delivery_currency || undefined,
        deliveryTiming:
            String(o.delivery_timing || ORDER_DELIVERY_TIMING_NOW).toUpperCase() === ORDER_DELIVERY_TIMING_SCHEDULED
                ? ORDER_DELIVERY_TIMING_SCHEDULED
                : ORDER_DELIVERY_TIMING_NOW,
        deliveryBookingStatus: o.delivery_booking_status || undefined,
        deliveryBookingError: o.delivery_booking_error || undefined,
        deliveryBookingAttempts:
            o.delivery_booking_attempts !== undefined && o.delivery_booking_attempts !== null
                ? Number(o.delivery_booking_attempts)
                : undefined,
        canRetryDispatch: canRetryLalamoveDispatch(o),
        ...cancelState
    };
};

const canRetryLalamoveDispatch = (o) => {
    if (String(o.order_type || '').trim() !== 'Delivery') return false;
    const status = String(o.status || '').trim();
    if (status === 'Completed') return false;
    // Allow retry after Lalamove terminal failure even if local status was left mid-kitchen
    if (status === 'Cancelled') {
        return String(o.delivery_booking_status || '').trim() === 'terminal_failed';
    }
    const booking = String(o.delivery_booking_status || '').trim();
    if (['booking_failed', 'pending', 'terminal_failed'].includes(booking)) return true;
    // Delivery order never booked (legacy rows)
    if (!o.external_order_id && booking !== 'booked' && booking !== 'not_required') return true;
    return false;
};

const fetchImageBuffer = async (imageUrl) => {
    const url = String(imageUrl || '').trim();
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return null;
        const buffer = Buffer.from(await response.arrayBuffer());
        return buffer.length ? buffer : null;
    } catch (_error) {
        return null;
    } finally {
        clearTimeout(timeout);
    }
};

module.exports = {
    orderEvents,
    get orderEventSequence() {
        return orderEventSequence;
    },
    getRefundWindowState,
    parseScheduledAtUtc,
    normalizeAdminCursorDateTime,
    encodeAdminOrdersCursor,
    decodeAdminOrdersCursor,
    normalizeAdminOrderStatus,
    normalizeAdminRefundStatusFilter,
    normalizeAdminDeliveryTiming,
    normalizeAdminSearchQuery,
    triggerOrderPushNotification,
    emitOrdersChangedEvent,
    formatOrderRowForClient,
    canRetryLalamoveDispatch,
    fetchImageBuffer
};
