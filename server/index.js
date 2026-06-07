const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const { OAuth2Client } = require('google-auth-library');
const {
    installConsoleInterceptors,
    requestContextMiddleware,
    requestLogAndMetricsMiddleware,
    metricsAuthMiddleware,
    metricsHandler,
    recordWebhookEvent,
    recordOrderCreateEvent,
    startOrderCreateTimer
} = require('./observability');

const db = require('./db');
const lalamoveService = require('./lalamoveService');
const emailService = require('./emailService');
const { assertNoPendingMigrations } = require('./migrationRunner');
const { sendPushToUser } = require('./pushService');
const multer = require('multer');
const r2Service = require('./r2Service');

installConsoleInterceptors();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
});

const app = express();
app.disable('x-powered-by');
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
const IS_PRODUCTION = NODE_ENV === 'production';
const METRICS_ENABLED = String(process.env.METRICS_ENABLED || 'true').trim().toLowerCase() !== 'false';
const METRICS_AUTH_TOKEN = String(process.env.METRICS_AUTH_TOKEN || '').trim();
const METRICS_REQUIRE_AUTH =
    String(process.env.METRICS_REQUIRE_AUTH || (IS_PRODUCTION ? 'true' : 'false')).trim().toLowerCase() !==
    'false';
const JWT_SECRET = String(process.env.JWT_SECRET || '').trim();
const TRUST_PROXY_SETTING = String(process.env.TRUST_PROXY || '').trim();
if (TRUST_PROXY_SETTING) {
    if (TRUST_PROXY_SETTING === 'true') {
        app.set('trust proxy', true);
    } else if (TRUST_PROXY_SETTING === 'false') {
        app.set('trust proxy', false);
    } else {
        const parsedTrustProxy = Number.parseInt(TRUST_PROXY_SETTING, 10);
        if (Number.isInteger(parsedTrustProxy) && parsedTrustProxy >= 0) {
            app.set('trust proxy', parsedTrustProxy);
        }
    }
}
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '';
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'admin@takcakap.com').trim().toLowerCase();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '').trim();
const ADMIN_NAME = String(process.env.ADMIN_NAME || 'TakCakap Admin').trim();
const PAYMENT_METHOD_DUITNOW = 'DuitNow';
const PAYMENT_METHOD_CURLEC = 'Curlec';
const ALLOW_UNVERIFIED_DUITNOW_ORDERS = String(process.env.ALLOW_UNVERIFIED_DUITNOW_ORDERS || 'false')
    .trim()
    .toLowerCase() === 'true';
const DEFAULT_DUITNOW_QR_URL = String(
    process.env.DUITNOW_QR_URL ||
    'https://res.cloudinary.com/dzayh29d7/image/upload/v1770301357/KC_QR_vljdez.png'
).trim();
const parsedDefaultServiceFee = Number.parseFloat(String(process.env.DEFAULT_SERVICE_FEE ?? '1.8'));
const DEFAULT_SERVICE_FEE = Math.max(0, Number.isFinite(parsedDefaultServiceFee) ? parsedDefaultServiceFee : 1.8);
const CURLEC_API_BASE_URL = String(process.env.CURLEC_API_BASE_URL || 'https://api.razorpay.com/v1')
    .trim()
    .replace(/\/$/, '');
const CURLEC_KEY_ID = String(process.env.CURLEC_KEY_ID || '').trim();
const CURLEC_KEY_SECRET = String(process.env.CURLEC_KEY_SECRET || '').trim();
const CURLEC_WEBHOOK_SECRET = String(process.env.CURLEC_WEBHOOK_SECRET || '').trim();
const CURLEC_WEBHOOK_OLD_SECRET = String(process.env.CURLEC_WEBHOOK_OLD_SECRET || '').trim();
const LALAMOVE_API_KEY = String(process.env.LALAMOVE_API_KEY || '').trim();
const LALAMOVE_API_SECRET = String(process.env.LALAMOVE_API_SECRET || '').trim();
const LALAMOVE_WEBHOOK_SECRET = String(process.env.LALAMOVE_WEBHOOK_SECRET || '').trim();
const LALAMOVE_DEFAULT_REMARK_TEMPLATE = String(
    process.env.LALAMOVE_DEFAULT_REMARK_TEMPLATE ||
    'Order #{orderId}|{userName}|'
).trim();
const LALAMOVE_REMARK_MAX_LENGTH = Math.max(
    80,
    Number.parseInt(String(process.env.LALAMOVE_REMARK_MAX_LENGTH || '255'), 10) || 255
);
const CURLEC_CHECKOUT_NAME = String(process.env.CURLEC_CHECKOUT_NAME || 'Online Payment').trim();
const CURLEC_CHECKOUT_DESCRIPTION = String(
    process.env.CURLEC_CHECKOUT_DESCRIPTION || 'Secure online payment via Curlec'
).trim();
const CURLEC_THEME_COLOR = String(process.env.CURLEC_THEME_COLOR || '#499c49').trim();
const PUBLIC_APP_URL = String(process.env.PUBLIC_APP_URL || '').trim();
const SHOP_TIMEZONE = 'Asia/Kuala_Lumpur';
const DEFAULT_SHOP_OPEN_TIME = String(process.env.SHOP_OPEN_TIME || '09:00').trim();
const DEFAULT_SHOP_CLOSE_TIME = String(process.env.SHOP_CLOSE_TIME || '22:00').trim();
const DEFAULT_STORE_NAME = 'TakCakap KL Sentral';
const DEFAULT_STORE_PHONE = '+60123456789';
const DEFAULT_STORE_ADDRESS = 'Jalan Stesen Sentral 5, Kuala Lumpur, 50470, Malaysia';
const DEFAULT_STORE_LATITUDE = 3.1347;
const DEFAULT_STORE_LONGITUDE = 101.6869;
const DEFAULT_BRAND_LOGO_URL = String(
    process.env.RECEIPT_LOGO_URL ||
    process.env.BRAND_LOGO_URL ||
    process.env.VITE_BRAND_LOGO_URL ||
    'https://res.cloudinary.com/dzayh29d7/image/upload/v1771022152/X_d2eevj.png'
).trim();
const CORS_ORIGINS = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
const normalizeCorsOrigin = (origin) => String(origin || '').trim().replace(/\/+$/, '').toLowerCase();
const CORS_ORIGIN_SET = new Set(CORS_ORIGINS.map((origin) => normalizeCorsOrigin(origin)).filter(Boolean));
const CURLEC_CALLBACK_TRUSTED_ORIGINS = new Set(
    ['https://api.razorpay.com', 'https://checkout.razorpay.com'].map((origin) => normalizeCorsOrigin(origin))
);
const isCurlecCallbackPath = (requestPath) => {
    const normalizedPath = String(requestPath || '').split('?')[0];
    return normalizedPath === '/api/payments/curlec/callback' || normalizedPath === '/payments/curlec/callback';
};
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID || undefined);
const HH_MM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ORDER_DELIVERY_TIMING_NOW = 'NOW';
const ORDER_DELIVERY_TIMING_SCHEDULED = 'SCHEDULED';
const MIN_SCHEDULE_LEAD_MINUTES = 5;
const LALAMOVE_CANCEL_LIMIT_SECONDS = 5 * 60;
const CURLEC_HTTP_TIMEOUT_MS = Math.max(
    3000,
    Number.parseInt(String(process.env.CURLEC_HTTP_TIMEOUT_MS || '12000'), 10) || 12000
);
const REFUND_ELIGIBILITY_HOURS = Math.max(
    1,
    Number.parseInt(String(process.env.REFUND_ELIGIBILITY_HOURS || '48'), 10) || 48
);
const PICKUP_COMPLETED_REFUND_ELIGIBILITY_HOURS = Math.max(
    1,
    Number.parseInt(String(process.env.PICKUP_COMPLETED_REFUND_ELIGIBILITY_HOURS || '24'), 10) || 24
);
const REFUND_WINDOW_MS = REFUND_ELIGIBILITY_HOURS * 60 * 60 * 1000;
const REFUND_TIMEFRAME_LABEL = String(
    process.env.REFUND_TIMEFRAME_LABEL || 'Instant when available, otherwise up to 10 business days.'
).trim();
const REFUND_STATUS_PENDING = 'pending';
const REFUND_STATUS_PROCESSED = 'processed';
const REFUND_STATUS_FAILED = 'failed';
const ADMIN_ORDERS_DEFAULT_LIMIT = 40;
const ADMIN_ORDERS_MAX_LIMIT = 100;
const USER_ORDERS_DEFAULT_LIMIT = 40;
const USER_ORDERS_MAX_LIMIT = 120;
const ADMIN_ORDER_SYNC_DEFAULT_LIMIT = 100;
const ADMIN_ORDER_SYNC_MAX_LIMIT = 300;
const INTERNAL_ORDER_RECONCILIATION_TIMEOUT_MS = Math.max(
    5000,
    Number.parseInt(String(process.env.INTERNAL_ORDER_RECONCILIATION_TIMEOUT_MS || '25000'), 10) || 25000
);
const ADMIN_ORDER_EVENTS_RETRY_MS = Math.max(
    1000,
    Number.parseInt(String(process.env.ADMIN_ORDER_EVENTS_RETRY_MS || '5000'), 10) || 5000
);
const ADMIN_ORDER_EVENTS_HEARTBEAT_MS = Math.max(
    10000,
    Number.parseInt(String(process.env.ADMIN_ORDER_EVENTS_HEARTBEAT_MS || '25000'), 10) || 25000
);
const ADMIN_ORDER_STREAM_TOKEN_TTL_SECONDS = Math.max(
    30,
    Number.parseInt(String(process.env.ADMIN_ORDER_STREAM_TOKEN_TTL_SECONDS || '120'), 10) || 120
);
const AUTH_RATE_LIMIT_WINDOW_MS = Math.max(
    30 * 1000,
    Number.parseInt(String(process.env.AUTH_RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000)), 10) || 15 * 60 * 1000
);
const AUTH_RATE_LIMIT_MAX_ATTEMPTS = Math.max(
    3,
    Number.parseInt(String(process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS || '12'), 10) || 12
);
const WEBHOOK_RATE_LIMIT_WINDOW_MS = Math.max(
    1000,
    Number.parseInt(String(process.env.WEBHOOK_RATE_LIMIT_WINDOW_MS || '60000'), 10) || 60000
);
const WEBHOOK_RATE_LIMIT_MAX_REQUESTS = Math.max(
    10,
    Number.parseInt(String(process.env.WEBHOOK_RATE_LIMIT_MAX_REQUESTS || '600'), 10) || 600
);
const LALAMOVE_WEBHOOK_MAX_SKEW_SECONDS = Math.max(
    30,
    Number.parseInt(String(process.env.LALAMOVE_WEBHOOK_MAX_SKEW_SECONDS || '600'), 10) || 600
);
const orderEvents = new EventEmitter();
orderEvents.setMaxListeners(300);
let orderEventSequence = 0;

const toNumber = (value) => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};
const normalizeRemarkText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const clampLalamoveRemark = (value) => normalizeRemarkText(value).slice(0, LALAMOVE_REMARK_MAX_LENGTH);
const buildLalamoveDefaultRemark = ({ orderId, userName }) => {
    const normalizedOrderId = toPositiveInteger(orderId);
    const safeOrderId = normalizedOrderId ? String(normalizedOrderId) : String(orderId || '').trim() || 'N/A';
    const safeUserName = normalizeRemarkText(userName) || 'Customer';
    const fallback = `Order #${safeOrderId} | User: ${safeUserName}`;
    const template = normalizeRemarkText(LALAMOVE_DEFAULT_REMARK_TEMPLATE);
    if (!template) {
        return clampLalamoveRemark(fallback);
    }

    const renderedTemplate = template
        .replace(/\{orderId\}/gi, safeOrderId)
        .replace(/\{orderNo\}/gi, safeOrderId)
        .replace(/\{userName\}/gi, safeUserName)
        .replace(/\{customerName\}/gi, safeUserName);
    const normalizedTemplate = clampLalamoveRemark(renderedTemplate);
    if (!normalizedTemplate) {
        return clampLalamoveRemark(fallback);
    }

    const hasOrderId = normalizedTemplate.includes(safeOrderId);
    const hasUserName = normalizedTemplate.toLowerCase().includes(safeUserName.toLowerCase());
    if (!hasOrderId || !hasUserName) {
        return clampLalamoveRemark(fallback);
    }
    return normalizedTemplate;
};
const incrementPrefix = (prefix) => {
    const chars = prefix.split('');
    for (let i = chars.length - 1; i >= 0; i--) {
        const charCode = chars[i].charCodeAt(0);
        if (charCode < 90) { // 'Z' is 90
            chars[i] = String.fromCharCode(charCode + 1);
            break;
        } else {
            chars[i] = 'A';
        }
    }
    return chars.join('');
};

const getNextOrderCode = (lastCode) => {
    if (!lastCode) return 'AAA-001';
    const parts = lastCode.split('-');
    let prefix = parts[0];
    let num = parseInt(parts[1], 10);

    num += 1;
    if (num > 999) {
        num = 1;
        prefix = incrementPrefix(prefix);
    }
    
    const paddedNum = String(num).padStart(3, '0');
    return `${prefix}-${paddedNum}`;
};

const buildLalamoveRecipientRemark = ({ shortCode, userName, customerRemark }) => {
    const maxLimit = LALAMOVE_REMARK_MAX_LENGTH; // e.g. 80
    const cleanCustomerRemark = normalizeRemarkText(customerRemark);
    
    // Parse the 3-digit suffix (e.g. "AAA-001" -> "001")
    const codePart = String(shortCode || '').includes('-') 
        ? String(shortCode).split('-')[1] 
        : '000';

    // Get first word of username truncated to 8 characters
    const firstWord = String(userName || '').trim().split(/\s+/)[0] || 'Cust';
    const truncatedUserName = firstWord.slice(0, 8);

    // Prefix format: "#001-JohnD-"
    const prefix = `#${codePart}-${truncatedUserName}-`;

    if (!cleanCustomerRemark) {
        return prefix.slice(0, -1);
    }

    const availableSpace = maxLimit - prefix.length;
    if (availableSpace > 0) {
        return `${prefix}${cleanCustomerRemark.slice(0, availableSpace)}`;
    }

    return cleanCustomerRemark.slice(0, maxLimit);
};
const toUtcIsoString = (value) => {
    if (value === undefined || value === null) return null;
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return null;
        return value.toISOString();
    }

    const raw = String(value).trim();
    if (!raw) return null;
    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
    const hasTimezone = /Z$|[+-]\d{2}:\d{2}$/.test(normalized);
    const parsed = new Date(hasTimezone ? normalized : `${normalized}Z`);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
};
const toSqlDateTimeUtc = (value) => {
    const iso = toUtcIsoString(value);
    if (!iso) return null;
    const date = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
        date.getUTCHours()
    )}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
};
const toIsoUtcString = (value) => {
    const iso = toUtcIsoString(value);
    if (!iso) return null;
    return iso;
};
const parsePositiveIntWithBounds = (value, { fallback = null, min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const parsed = Number.parseInt(String(value || ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    if (parsed < min) return fallback;
    return Math.min(parsed, max);
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
        const [rows] = await db.query('SELECT user_id, status, lalamove_status FROM orders WHERE id = ?', [orderId]);
        if (!rows.length) return;
        const order = rows[0];

        let title = 'TakCakap Order Update';
        let body = `Your order #${orderId} status has changed.`;
        let notify = false;

        const status = String(order.status || '').trim();
        const lalaStatus = String(order.lalamove_status || '').trim();
        const r = String(reason || '').trim();

        if (r.startsWith('status_') || r === 'cancelled') {
            notify = true;
            if (status === 'Processing') {
                title = 'Order Processing 🍳';
                body = `We have started preparing your order #${orderId}!`;
            } else if (status === 'Completed') {
                title = 'Order Completed ✅';
                body = `Your order #${orderId} has been completed. Enjoy!`;
            } else if (status === 'Cancelled') {
                title = 'Order Cancelled ❌';
                body = `Your order #${orderId} has been cancelled.`;
            }
        } else if (r === 'lalamove_webhook' || r === 'lalamove_sync') {
            notify = true;
            if (lalaStatus === 'ASSIGNING_DRIVER') {
                title = 'Looking for Rider 🛵';
                body = 'We are finding a Lalamove rider for your delivery.';
            } else if (lalaStatus === 'ON_GOING') {
                title = 'Rider Found 🚀';
                body = 'A Lalamove rider is heading to the store.';
            } else if (lalaStatus === 'PICKED_UP') {
                title = 'Out for Delivery 🛵💨';
                body = 'Your food is on the way!';
            } else if (lalaStatus === 'CANCELED') {
                title = 'Delivery Cancelled ⚠️';
                body = 'The Lalamove delivery was cancelled.';
            } else {
                notify = false; // Don't notify on every small lalamove state change unless handled above
            }
        } else if (r === 'refund_processed' || r === 'refund_failed') {
            notify = true;
            title = r === 'refund_processed' ? 'Refund Processed 💸' : 'Refund Failed ⚠️';
            body = r === 'refund_processed'
                ? `A refund for order #${orderId} has been processed.`
                : `A refund attempt for order #${orderId} failed.`;
        } else if (r === 'payment_captured') {
            notify = true;
            title = 'Payment Successful 💰';
            body = `Your payment for order #${orderId} was received.`;
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
        paymentMethod: o.payment_method || PAYMENT_METHOD_DUITNOW,
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
        ...cancelState
    };
};
const toNonEmptyString = (value) => {
    if (Array.isArray(value)) {
        for (const item of value) {
            const candidate = toNonEmptyString(item);
            if (candidate) return candidate;
        }
        return '';
    }
    if (value === undefined || value === null) return '';
    const normalized = String(value).trim();
    return normalized;
};
const resolvePublicAppBaseUrl = (req) => {
    if (PUBLIC_APP_URL) {
        try {
            return new URL(PUBLIC_APP_URL).toString().replace(/\/$/, '');
        } catch {
            // fall through to request-derived fallback
        }
    }
    const forwardedProto = toNonEmptyString(String(req.headers['x-forwarded-proto'] || '').split(',')[0]);
    const protocol = forwardedProto || req.protocol || 'http';
    const forwardedHost = toNonEmptyString(String(req.headers['x-forwarded-host'] || '').split(',')[0]);
    const host = forwardedHost || toNonEmptyString(req.get('host'));
    if (host) {
        return `${protocol}://${host}`;
    }
    return `http://localhost:${PORT}`;
};
const getCurlecCallbackPayload = (req) => {
    const source = (req.method === 'POST' ? req.body : req.query) || {};
    const nestedError = source.error && typeof source.error === 'object' ? source.error : {};
    return {
        orderId: toNonEmptyString(source.razorpay_order_id || source.order_id || source.orderId),
        paymentId: toNonEmptyString(source.razorpay_payment_id || source.payment_id || source.paymentId),
        signature: toNonEmptyString(source.razorpay_signature || source.signature),
        errorCode: toNonEmptyString(source['error[code]'] || source.error_code || nestedError.code),
        errorDescription: toNonEmptyString(
            source['error[description]'] || source.error_description || nestedError.description
        )
    };
};
const buildCurlecCheckoutReturnUrl = (req, payload) => {
    const returnUrl = new URL('/checkout', resolvePublicAppBaseUrl(req));
    returnUrl.searchParams.set('curlec_return', '1');
    if (payload.orderId && payload.paymentId && payload.signature) {
        returnUrl.searchParams.set('razorpay_order_id', payload.orderId);
        returnUrl.searchParams.set('razorpay_payment_id', payload.paymentId);
        returnUrl.searchParams.set('razorpay_signature', payload.signature);
    } else {
        if (payload.errorCode) {
            returnUrl.searchParams.set('error_code', payload.errorCode);
        }
        if (payload.errorDescription) {
            returnUrl.searchParams.set('error_description', payload.errorDescription);
        }
    }
    return returnUrl.toString();
};
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

const isLalamoveInvalidQuotationError = (error) => {
    const errorId = String(error?.payload?.errors?.[0]?.id || '').trim().toUpperCase();
    if (errorId === 'ERR_INVALID_QUOTATION_ID') return true;
    const rawMessage = String(
        error?.payload?.errors?.[0]?.message ||
        error?.payload?.errors?.[0]?.detail ||
        error?.payload?.message ||
        error?.message ||
        ''
    )
        .trim()
        .toLowerCase();
    if (!rawMessage) return false;
    return rawMessage.includes('quotation') && (rawMessage.includes('invalid') || rawMessage.includes('expire'));
};

const extractLalamoveStopIds = (stops) => {
    const normalizedStops = Array.isArray(stops) ? stops : [];
    const senderStopId = String(normalizedStops?.[0]?.stopId || '').trim();
    const recipientStopId = String(normalizedStops?.[normalizedStops.length - 1]?.stopId || '').trim();
    return {
        senderStopId,
        recipientStopId
    };
};
const formatScheduledAtLabel = (utcIsoString) => {
    const iso = toUtcIsoString(utcIsoString);
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-MY', {
        timeZone: SHOP_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
};
const computeLalamoveCancelState = ({ deliveryProvider, lalamoveStatus, lalamoveOngoingAtUtc }) => {
    if (deliveryProvider !== 'Lalamove') {
        return {
            canCancelLalamove: false,
            cancelWindowMode: 'CLOSED',
            cancelWindowRemainingSeconds: 0,
            cancelWindowEndsAtUtc: null
        };
    }

    const normalizedStatus = String(lalamoveStatus || '').toUpperCase();
    const terminalOrForbiddenStatuses = new Set([
        'PICKED_UP',
        'COMPLETED',
        'CANCELED',
        'CANCELLED',
        'EXPIRED',
        'REJECTED'
    ]);
    if (terminalOrForbiddenStatuses.has(normalizedStatus)) {
        return {
            canCancelLalamove: false,
            cancelWindowMode: 'CLOSED',
            cancelWindowRemainingSeconds: 0,
            cancelWindowEndsAtUtc: null
        };
    }

    const ongoingIso = toUtcIsoString(lalamoveOngoingAtUtc);
    if (ongoingIso) {
        const endsAtMs = new Date(ongoingIso).getTime() + LALAMOVE_CANCEL_LIMIT_SECONDS * 1000;
        const remainingSeconds = Math.max(0, Math.floor((endsAtMs - Date.now()) / 1000));
        return {
            canCancelLalamove: remainingSeconds > 0,
            cancelWindowMode: remainingSeconds > 0 ? 'LIMITED' : 'CLOSED',
            cancelWindowRemainingSeconds: remainingSeconds,
            cancelWindowEndsAtUtc: new Date(endsAtMs).toISOString()
        };
    }

    if (normalizedStatus === 'ON_GOING') {
        return {
            canCancelLalamove: true,
            cancelWindowMode: 'LIMITED',
            cancelWindowRemainingSeconds: null,
            cancelWindowEndsAtUtc: null
        };
    }

    const openUntilAssignedStatuses = new Set([
        '',
        'ASSIGNING_DRIVER',
        'PENDING',
        'FINDING_DRIVER'
    ]);
    if (openUntilAssignedStatuses.has(normalizedStatus)) {
        return {
            canCancelLalamove: true,
            cancelWindowMode: 'OPEN_UNTIL_ASSIGNED',
            cancelWindowRemainingSeconds: null,
            cancelWindowEndsAtUtc: null
        };
    }

    // Unknown status: allow attempt instead of blocking.
    // Lalamove will enforce policy and return ERR_CANCELLATION_FORBIDDEN when not allowed.
    return {
        canCancelLalamove: true,
        cancelWindowMode: 'OPEN_UNTIL_ASSIGNED',
        cancelWindowRemainingSeconds: null,
        cancelWindowEndsAtUtc: null
    };
};
const roundCoordinate = (value, precision = 7) => {
    if (!Number.isFinite(value)) return null;
    return Number(value.toFixed(precision));
};
const formatMoneyMYR = (value) => `RM${Number(value || 0).toFixed(2)}`;
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

const isValidLatitude = (value) => value !== null && value >= -90 && value <= 90;
const isValidLongitude = (value) => value !== null && value >= -180 && value <= 180;

const toPositiveInteger = (value) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return null;
    return parsed;
};

const normalizePaymentMethod = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'curlec') return PAYMENT_METHOD_CURLEC;
    return PAYMENT_METHOD_DUITNOW;
};

const isCurlecConfigured = () => Boolean(CURLEC_KEY_ID && CURLEC_KEY_SECRET);

const toMinorUnits = (value) => {
    const numeric = toNumber(value);
    if (numeric === null || numeric <= 0) return null;
    return Math.round(numeric * 100);
};

const toMinorUnitsAllowZero = (value) => {
    const numeric = toNumber(value);
    if (numeric === null || numeric < 0) return null;
    return Math.round(numeric * 100);
};

const fromMinorUnits = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Number((numeric / 100).toFixed(2));
};

const normalizeCurlecPaymentPayload = (payload) => {
    const orderId = String(payload?.orderId || '').trim();
    const paymentId = String(payload?.paymentId || '').trim();
    const signature = String(payload?.signature || '').trim();

    if (!orderId || !paymentId || !signature) {
        return { value: null, error: 'Curlec payment confirmation is incomplete' };
    }
    if (orderId.length > 64 || paymentId.length > 64 || signature.length > 128) {
        return { value: null, error: 'Curlec payment confirmation payload is invalid' };
    }
    return {
        value: {
            orderId,
            paymentId,
            signature
        },
        error: null
    };
};

const safeHexEqual = (actualHex, expectedHex) => {
    try {
        const actual = Buffer.from(String(actualHex || '').trim(), 'hex');
        const expected = Buffer.from(String(expectedHex || '').trim(), 'hex');
        if (actual.length === 0 || expected.length === 0 || actual.length !== expected.length) {
            return false;
        }
        return crypto.timingSafeEqual(actual, expected);
    } catch (_error) {
        return false;
    }
};

const verifyCurlecPaymentSignature = ({ orderId, paymentId, signature }) => {
    if (!isCurlecConfigured()) return false;
    const digest = crypto
        .createHmac('sha256', CURLEC_KEY_SECRET)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');
    return safeHexEqual(signature, digest);
};

const callCurlecApi = async ({ method = 'GET', endpoint, body, headers = {} }) => {
    if (!isCurlecConfigured()) {
        const configError = new Error('Curlec API credentials are not configured');
        configError.status = 503;
        throw configError;
    }

    const requestHeaders = {
        Authorization: `Basic ${Buffer.from(`${CURLEC_KEY_ID}:${CURLEC_KEY_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/json',
        ...Object.fromEntries(
            Object.entries(headers || {}).map(([key, value]) => [key, String(value)])
        )
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CURLEC_HTTP_TIMEOUT_MS);
    let response;
    try {
        response = await fetch(`${CURLEC_API_BASE_URL}${endpoint}`, {
            method,
            headers: requestHeaders,
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal
        });
    } catch (error) {
        const timeoutOrNetworkError = new Error(
            error?.name === 'AbortError'
                ? `Curlec API request timed out after ${CURLEC_HTTP_TIMEOUT_MS}ms`
                : `Unable to reach Curlec API: ${error?.message || error}`
        );
        timeoutOrNetworkError.status = 502;
        timeoutOrNetworkError.cause = error;
        throw timeoutOrNetworkError;
    } finally {
        clearTimeout(timeout);
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message =
            payload?.error?.description ||
            payload?.error?.reason ||
            payload?.error?.message ||
            payload?.message ||
            'Curlec API request failed';
        const error = new Error(String(message));
        error.status = response.status >= 400 && response.status < 500 ? 400 : 502;
        error.payload = payload;
        throw error;
    }

    return payload;
};

const normalizeCurlecRefundStatus = (value) => {
    const status = String(value || '').trim().toLowerCase();
    if ([REFUND_STATUS_PENDING, REFUND_STATUS_PROCESSED, REFUND_STATUS_FAILED].includes(status)) {
        return status;
    }
    return '';
};

const normalizeCurlecRefundSpeed = (value) => {
    const speed = String(value || '').trim().toLowerCase();
    if (!speed) return '';
    if (speed === 'optimum') return 'optimum';
    if (speed === 'normal') return 'normal';
    return speed.slice(0, 32);
};

const isCurlecInstantRefundUnsupportedError = (error) => {
    const description = String(
        error?.payload?.error?.description ||
        error?.payload?.error?.message ||
        error?.message ||
        ''
    )
        .trim()
        .toLowerCase();
    return description.includes('instant refund not supported');
};

const isCurlecInvalidRequestError = (error) => {
    const description = String(
        error?.payload?.error?.description ||
        error?.payload?.error?.message ||
        error?.message ||
        ''
    )
        .trim()
        .toLowerCase();
    return description === 'invalid request sent';
};

const formatMinorUnitsAsMyr = (minorUnits) => {
    const amount = Number(minorUnits);
    if (!Number.isFinite(amount) || amount < 0) return 'RM0.00';
    return `RM${(amount / 100).toFixed(2)}`;
};

const fetchCurlecBalanceMinorUnits = async () => {
    try {
        const payload = await callCurlecApi({
            method: 'GET',
            endpoint: '/balance'
        });
        const candidateBalance = Array.isArray(payload?.items) ? payload?.items?.[0]?.balance : payload?.balance;
        const parsed = Number.parseInt(String(candidateBalance), 10);
        if (!Number.isInteger(parsed) || parsed < 0) return null;
        return parsed;
    } catch (_error) {
        return null;
    }
};

const buildCurlecRefundTimeframeMessage = (refundStatus) => {
    if (refundStatus === REFUND_STATUS_PROCESSED) {
        return 'Your refund has been processed successfully.';
    }
    return REFUND_TIMEFRAME_LABEL;
};

const verifyCurlecWebhookSignature = ({ rawBody, signature }) => {
    const webhookSecrets = [CURLEC_WEBHOOK_SECRET, CURLEC_WEBHOOK_OLD_SECRET].filter(Boolean);
    if (!webhookSecrets.length) return false;
    const payload = String(rawBody || '');
    return webhookSecrets.some((secret) => {
        const digest = crypto.createHmac('sha256', secret).update(payload).digest('hex');
        return safeHexEqual(signature, digest);
    });
};

const normalizeWebhookSignature = (value) =>
    String(value || '')
        .trim()
        .replace(/^sha256=/i, '')
        .replace(/^hmac\s+/i, '')
        .trim();

const firstHeaderValue = (value) => (Array.isArray(value) ? value[0] : value);

const normalizeWebhookRequestPath = (requestPath) => {
    const rawPath = String(requestPath || '')
        .trim()
        .split('?')[0];
    if (!rawPath) return '/';
    return rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
};

const parseLalamoveHmacAuthorizationHeader = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const token = raw.replace(/^hmac\s+/i, '').trim();
    if (!token) return null;
    const [apiKey, timestamp, signature] = token.split(':');
    if (!apiKey || !timestamp || !signature) return null;
    return {
        apiKey: String(apiKey).trim(),
        timestamp: String(timestamp).trim(),
        signature: String(signature).trim()
    };
};

const parseWebhookTimestampMs = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (/^\d+(?:\.\d+)?$/.test(raw)) {
        const numeric = Number(raw);
        if (!Number.isFinite(numeric) || numeric <= 0) return null;
        // Accept seconds (with optional decimals), milliseconds, and microseconds.
        if (numeric > 1e14) return Math.round(numeric / 1000);
        if (numeric > 1e12) return Math.round(numeric);
        return Math.round(numeric * 1000);
    }
    const parsed = new Date(raw).getTime();
    return Number.isFinite(parsed) ? parsed : null;
};

const verifyLegacyLalamoveWebhookSignature = ({ rawBody, signature, timestamp }) => {
    if (!LALAMOVE_WEBHOOK_SECRET) return false;
    const normalizedSignature = normalizeWebhookSignature(signature);
    if (!normalizedSignature) return false;

    const payload = String(rawBody || '');
    const timestampText = String(timestamp || '').trim();
    const digestRawHex = crypto.createHmac('sha256', LALAMOVE_WEBHOOK_SECRET).update(payload).digest('hex');
    const digestRawBase64 = crypto.createHmac('sha256', LALAMOVE_WEBHOOK_SECRET).update(payload).digest('base64');
    if (safeHexEqual(normalizedSignature, digestRawHex) || normalizedSignature === digestRawBase64) {
        return true;
    }

    if (timestampText) {
        const digestTimedHex = crypto
            .createHmac('sha256', LALAMOVE_WEBHOOK_SECRET)
            .update(`${timestampText}.${payload}`)
            .digest('hex');
        const digestTimedBase64 = crypto
            .createHmac('sha256', LALAMOVE_WEBHOOK_SECRET)
            .update(`${timestampText}.${payload}`)
            .digest('base64');
        if (safeHexEqual(normalizedSignature, digestTimedHex) || normalizedSignature === digestTimedBase64) {
            return true;
        }
    }

    return false;
};

const verifyLalamoveWebhookSignature = ({
    signature,
    timestamp,
    apiKey,
    requestPath,
    dataPayload,
    rawBody
}) => {
    const normalizedSignature = normalizeWebhookSignature(signature);
    if (!normalizedSignature) {
        return { ok: false, reason: 'missing_signature' };
    }

    const normalizedTimestamp = String(timestamp || '').trim();
    const normalizedApiKey = String(apiKey || '').trim();
    const normalizedRequestPath = normalizeWebhookRequestPath(requestPath);
    const hasV3Credentials = Boolean(LALAMOVE_API_KEY && LALAMOVE_API_SECRET);

    if (hasV3Credentials && normalizedApiKey) {
        if (normalizedApiKey !== LALAMOVE_API_KEY) {
            return { ok: false, reason: 'invalid_api_key' };
        }

        const signedBody = JSON.stringify(dataPayload && typeof dataPayload === 'object' ? dataPayload : {});
        const rawSignature = `${normalizedTimestamp}\r\nPOST\r\n${normalizedRequestPath}\r\n\r\n${signedBody}`;
        const digest = crypto.createHmac('sha256', LALAMOVE_API_SECRET).update(rawSignature).digest('hex');
        if (safeHexEqual(normalizedSignature, digest)) {
            return { ok: true, mode: 'v3_api_secret', timestamp: normalizedTimestamp };
        }
    }

    if (verifyLegacyLalamoveWebhookSignature({ rawBody, signature: normalizedSignature, timestamp: normalizedTimestamp })) {
        return { ok: true, mode: 'legacy_shared_secret', timestamp: normalizedTimestamp };
    }

    if (hasV3Credentials && !normalizedApiKey) {
        return { ok: false, reason: 'missing_api_key' };
    }
    if (hasV3Credentials && !normalizedTimestamp) {
        return { ok: false, reason: 'missing_timestamp' };
    }
    if (!hasV3Credentials && !LALAMOVE_WEBHOOK_SECRET) {
        return { ok: false, reason: 'verification_not_configured' };
    }
    return { ok: false, reason: 'invalid_signature' };
};

const buildWebhookPayloadHash = (rawBody) =>
    crypto.createHash('sha256').update(String(rawBody || '')).digest('hex');

const reserveWebhookEventForProcessing = async ({ provider, eventId, payloadHash }) => {
    const normalizedProvider = String(provider || '').trim().toLowerCase();
    const normalizedEventId = String(eventId || '').trim().slice(0, 191);
    const normalizedPayloadHash = String(payloadHash || '').trim().slice(0, 64);
    if (!normalizedProvider || !normalizedEventId || !normalizedPayloadHash) {
        const error = new Error('Webhook idempotency payload is invalid');
        error.status = 400;
        throw error;
    }

    try {
        await db.query(
            `
                INSERT INTO webhook_events (provider, event_id, payload_hash, status, created_at, updated_at)
                VALUES (?, ?, ?, 'processing', UTC_TIMESTAMP(), UTC_TIMESTAMP())
            `,
            [normalizedProvider, normalizedEventId, normalizedPayloadHash]
        );
        return {
            shouldProcess: true,
            provider: normalizedProvider,
            eventId: normalizedEventId
        };
    } catch (error) {
        if (error?.code !== 'ER_DUP_ENTRY') throw error;
        const [rows] = await db.query(
            `
                SELECT status, payload_hash
                FROM webhook_events
                WHERE provider = ?
                  AND event_id = ?
                LIMIT 1
            `,
            [normalizedProvider, normalizedEventId]
        );
        const existing = rows[0];
        if (!existing) {
            return {
                shouldProcess: false,
                provider: normalizedProvider,
                eventId: normalizedEventId
            };
        }

        const existingStatus = String(existing.status || '').trim().toLowerCase();
        const existingPayloadHash = String(existing.payload_hash || '').trim();
        if (existingStatus === 'processed' && existingPayloadHash === normalizedPayloadHash) {
            return {
                shouldProcess: false,
                provider: normalizedProvider,
                eventId: normalizedEventId,
                alreadyProcessed: true
            };
        }

        await db.query(
            `
                UPDATE webhook_events
                SET
                    status = 'processing',
                    payload_hash = ?,
                    last_error = NULL,
                    updated_at = UTC_TIMESTAMP()
                WHERE provider = ?
                  AND event_id = ?
            `,
            [normalizedPayloadHash, normalizedProvider, normalizedEventId]
        );
        return {
            shouldProcess: true,
            provider: normalizedProvider,
            eventId: normalizedEventId
        };
    }
};

const markWebhookEventProcessed = async ({ provider, eventId }) => {
    await db.query(
        `
            UPDATE webhook_events
            SET
                status = 'processed',
                processed_at = UTC_TIMESTAMP(),
                last_error = NULL,
                updated_at = UTC_TIMESTAMP()
            WHERE provider = ?
              AND event_id = ?
        `,
        [provider, eventId]
    );
};

const markWebhookEventFailed = async ({ provider, eventId, errorMessage }) => {
    await db.query(
        `
            UPDATE webhook_events
            SET
                status = 'failed',
                last_error = ?,
                updated_at = UTC_TIMESTAMP()
            WHERE provider = ?
              AND event_id = ?
        `,
        [String(errorMessage || 'Webhook processing failed').trim().slice(0, 500), provider, eventId]
    );
};

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

        return {
            success: refundStatus !== REFUND_STATUS_FAILED,
            orderId: String(orderId),
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

const toUserId = (value) => {
    if (value === undefined || value === null || value === '') return 1;
    const direct = toPositiveInteger(value);
    if (direct !== null) return direct;

    const raw = String(value);
    const digits = raw.match(/\d+/);
    if (!digits) return 1;
    return toPositiveInteger(digits[0]) || 1;
};

const readBearerToken = (req) => {
    const authHeader = req.headers?.authorization || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : null;
};
const readAuthToken = (req) => readBearerToken(req);

const signAdminStreamToken = (user) =>
    jwt.sign(
        {
            sub: String(user.id),
            role: 'admin',
            purpose: 'admin_orders_stream'
        },
        JWT_SECRET,
        { expiresIn: ADMIN_ORDER_STREAM_TOKEN_TTL_SECONDS }
    );

const signAuthToken = (user) =>
    jwt.sign(
        {
            sub: String(user.id),
            role: user.role || 'user',
            email: user.email
        },
        JWT_SECRET,
        { expiresIn: '7d' }
    );

const tryParseJsonObject = (value) => {
    if (!value) return null;
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(String(value));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
    } catch {
        return null;
    }
    return null;
};

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

const mapUserResponse = (row) => ({
    id: String(row.id),
    name: row.name,
    email: row.email,
    phoneNumber: row.phone_number || '',
    avatar: row.avatar_url || '',
    role: row.role || 'user',
    isSuspended: Boolean(row.is_suspended)
});

const attachAuthIfPresent = async (req, res, next) => {
    const token = readAuthToken(req);
    if (!token) return next();

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const userId = toPositiveInteger(decoded.sub);
        if (!userId) {
            return res.status(401).json({ error: 'Invalid auth token' });
        }

        const [rows] = await db.query(
            'SELECT id, email, role, is_suspended FROM users WHERE id = ? LIMIT 1',
            [userId]
        );
        const dbUser = rows[0];
        if (!dbUser) {
            return res.status(401).json({ error: 'Invalid auth token' });
        }

        req.user = {
            id: Number(dbUser.id),
            role: dbUser.role || decoded.role || 'user',
            email: dbUser.email || decoded.email || '',
            isSuspended: Boolean(dbUser.is_suspended)
        };
        return next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid or expired auth token' });
    }
};

const requireAuth = (req, res, next) =>
    attachAuthIfPresent(req, res, () => {
        if (!req.user?.id) return res.status(401).json({ error: 'Authentication required' });
        if (req.user?.isSuspended && req.user?.role !== 'admin') {
            return res.status(403).json({ error: 'Your account is suspended. Please contact support.' });
        }
        return next();
    });

const requireAdmin = (req, res, next) =>
    requireAuth(req, res, () => {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        return next();
    });

const requireAdminStreamToken = async (req, res, next) => {
    const legacyQueryToken = String(req.query?.stream_token || '').trim();
    if (legacyQueryToken) {
        return res.status(400).json({
            error: 'stream_token query parameter is deprecated. Use Authorization: Bearer <stream token>.'
        });
    }

    const streamToken = String(readBearerToken(req) || '').trim();
    if (!streamToken) {
        return res.status(401).json({ error: 'Admin stream bearer token is required' });
    }

    try {
        const decoded = jwt.verify(streamToken, JWT_SECRET);
        const userId = toPositiveInteger(decoded?.sub);
        if (!userId || decoded?.role !== 'admin' || decoded?.purpose !== 'admin_orders_stream') {
            return res.status(401).json({ error: 'Invalid stream token' });
        }
        const [rows] = await db.query(
            'SELECT id, email, role, is_suspended FROM users WHERE id = ? LIMIT 1',
            [userId]
        );
        const user = rows[0];
        if (!user || user.role !== 'admin' || Boolean(user.is_suspended)) {
            return res.status(403).json({ error: 'Admin stream access denied' });
        }
        req.user = {
            id: Number(user.id),
            role: user.role || 'admin',
            email: user.email || '',
            isSuspended: Boolean(user.is_suspended)
        };
        req.adminStreamTokenExpMs = Number(decoded?.exp || 0) > 0 ? Number(decoded.exp) * 1000 : null;
        return next();
    } catch (_error) {
        return res.status(401).json({ error: 'Invalid or expired stream token' });
    }
};

const createInMemoryRateLimiter = ({ windowMs, max, keyFn }) => {
    const counters = new Map();
    let pruneCursor = 0;

    return (req, res, next) => {
        const now = Date.now();
        const key = String(typeof keyFn === 'function' ? keyFn(req) : req.ip || 'unknown');
        const existing = counters.get(key);
        const baseRecord =
            !existing || existing.resetAt <= now
                ? { count: 0, resetAt: now + windowMs }
                : existing;
        baseRecord.count += 1;
        counters.set(key, baseRecord);

        pruneCursor += 1;
        if (pruneCursor >= 1000) {
            pruneCursor = 0;
            for (const [candidateKey, candidateRecord] of counters.entries()) {
                if (candidateRecord.resetAt <= now) {
                    counters.delete(candidateKey);
                }
            }
        }

        if (baseRecord.count > max) {
            const retryAfterSeconds = Math.max(1, Math.ceil((baseRecord.resetAt - now) / 1000));
            res.setHeader('Retry-After', String(retryAfterSeconds));
            return res.status(429).json({
                error: 'Too many requests. Please try again later.'
            });
        }
        return next();
    };
};

const authRateLimiter = createInMemoryRateLimiter({
    windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
    max: AUTH_RATE_LIMIT_MAX_ATTEMPTS,
    keyFn: (req) => `${String(req.ip || 'unknown')}:${String(req.body?.email || '').trim().toLowerCase()}`
});

const webhookRateLimiter = createInMemoryRateLimiter({
    windowMs: WEBHOOK_RATE_LIMIT_WINDOW_MS,
    max: WEBHOOK_RATE_LIMIT_MAX_REQUESTS,
    keyFn: (req) => String(req.ip || 'unknown')
});

const mapLalamoveUpdateToOrderStatus = ({ eventType, lalamoveStatus }) => {
    const normalizedEventType = String(eventType || '').toUpperCase();
    const normalizedStatus = String(lalamoveStatus || '').toUpperCase();

    if (normalizedStatus === 'ASSIGNING_DRIVER') return 'Finding Rider';
    if (normalizedStatus === 'ON_GOING') return 'Rider OTW';
    if (normalizedStatus === 'PICKED_UP') return 'Out For Delivery';
    if (normalizedStatus === 'COMPLETED') return 'Completed';
    if (['CANCELED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(normalizedStatus)) {
        return 'Cancelled';
    }

    if (normalizedEventType === 'DRIVER_ASSIGNED') return 'Rider OTW';
    return null;
};

const KUALA_LUMPUR_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const getKualaLumpurDateParts = (utcMs = Date.now()) => {
    const klDate = new Date(utcMs + KUALA_LUMPUR_UTC_OFFSET_MS);
    return {
        year: klDate.getUTCFullYear(),
        monthIndex: klDate.getUTCMonth(),
        day: klDate.getUTCDate(),
        weekday: klDate.getUTCDay()
    };
};

const klDatePartsToUtcMs = (year, monthIndex, day) =>
    Date.UTC(year, monthIndex, day, 0, 0, 0, 0) - KUALA_LUMPUR_UTC_OFFSET_MS;

const formatKlDate = (utcMs) => {
    const { year, monthIndex, day } = getKualaLumpurDateParts(utcMs);
    return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const parseKlDateInput = (value) => {
    const raw = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const [yearText, monthText, dayText] = raw.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    const utcMs = klDatePartsToUtcMs(year, month - 1, day);
    const check = getKualaLumpurDateParts(utcMs);
    if (check.year !== year || check.monthIndex !== month - 1 || check.day !== day) {
        return null;
    }

    return {
        raw,
        year,
        monthIndex: month - 1,
        day,
        startUtcMs: utcMs
    };
};

const computeGrowthPercentage = (current, previous) => {
    const currentValue = Number(current || 0);
    const previousValue = Number(previous || 0);
    if (previousValue <= 0) {
        return currentValue <= 0 ? 0 : 100;
    }
    return ((currentValue - previousValue) / previousValue) * 100;
};

const toCsvValue = (value) => {
    const safe = String(value ?? '');
    if (/[",\n\r]/.test(safe)) {
        return `"${safe.replace(/"/g, '""')}"`;
    }
    return safe;
};

const getSalesOverviewRanges = (nowMs = Date.now()) => {
    const klParts = getKualaLumpurDateParts(nowMs);
    const dayStartUtcMs = klDatePartsToUtcMs(klParts.year, klParts.monthIndex, klParts.day);
    const daysSinceMonday = (klParts.weekday + 6) % 7;
    const weekStartUtcMs = klDatePartsToUtcMs(klParts.year, klParts.monthIndex, klParts.day - daysSinceMonday);
    const monthStartUtcMs = klDatePartsToUtcMs(klParts.year, klParts.monthIndex, 1);
    const previousMonthStartUtcMs = klDatePartsToUtcMs(klParts.year, klParts.monthIndex - 1, 1);
    const currentMonthDurationMs = Math.max(60 * 1000, nowMs - monthStartUtcMs);
    const previousMonthEndUtcMs = Math.min(monthStartUtcMs, previousMonthStartUtcMs + currentMonthDurationMs);

    return {
        day: {
            currentStartMs: dayStartUtcMs,
            currentEndMs: nowMs,
            previousStartMs: dayStartUtcMs - MS_PER_DAY,
            previousEndMs: dayStartUtcMs
        },
        week: {
            currentStartMs: weekStartUtcMs,
            currentEndMs: nowMs,
            previousStartMs: weekStartUtcMs - 7 * MS_PER_DAY,
            previousEndMs: weekStartUtcMs
        },
        month: {
            currentStartMs: monthStartUtcMs,
            currentEndMs: nowMs,
            previousStartMs: previousMonthStartUtcMs,
            previousEndMs: previousMonthEndUtcMs
        }
    };
};

const fetchDeliveryOptions = async (executor = db) => {
    const [rows] = await executor.query(
        `
            SELECT pickup_enabled, lalamove_enabled
            FROM delivery_options
            WHERE id = 1
            LIMIT 1
        `
    );
    const row = rows[0] || {};

    return {
        pickupEnabled: row.pickup_enabled !== undefined ? Boolean(row.pickup_enabled) : true,
        lalamoveEnabled: row.lalamove_enabled !== undefined ? Boolean(row.lalamove_enabled) : true
    };
};

const fetchPaymentOptions = async (executor = db) => {
    const [rows] = await executor.query(
        `
            SELECT duitnow_qr_url, duitnow_enabled, curlec_enabled, service_fee
            FROM payment_options
            WHERE id = 1
            LIMIT 1
        `
    );
    const row = rows[0] || {};
    const curlecConfigured = isCurlecConfigured();
    const rawServiceFee = toNumber(row.service_fee);
    const serviceFee =
        rawServiceFee !== null && rawServiceFee >= 0
            ? Number(rawServiceFee.toFixed(2))
            : Number(DEFAULT_SERVICE_FEE.toFixed(2));

    return {
        duitnowQrUrl: String(row.duitnow_qr_url || DEFAULT_DUITNOW_QR_URL).trim(),
        duitnowEnabled:
            (row.duitnow_enabled !== undefined ? Boolean(row.duitnow_enabled) : true) &&
            ALLOW_UNVERIFIED_DUITNOW_ORDERS,
        curlecEnabled: row.curlec_enabled !== undefined ? Boolean(row.curlec_enabled) : false,
        serviceFee,
        curlecConfigured,
        curlecKeyId: curlecConfigured ? CURLEC_KEY_ID : '',
        curlecDisplayName: CURLEC_CHECKOUT_NAME || 'Online Payment',
        curlecDescription: CURLEC_CHECKOUT_DESCRIPTION || 'Secure online payment via Curlec'
    };
};

const normalizeCurrencyCode = (value, fallback = 'MYR') => {
    const normalized = String(value || fallback)
        .trim()
        .toUpperCase();
    return /^[A-Z]{3,8}$/.test(normalized) ? normalized : fallback;
};

const readStopId = (stop) => String(stop?.stopId || stop?.id || '').trim() || null;

const resolveQuoteStops = (stops) => {
    const normalizedStops = Array.isArray(stops) ? stops : [];
    const senderStopId = readStopId(normalizedStops[0]);
    const recipientStopId = readStopId(normalizedStops[1]);
    return {
        senderStopId,
        recipientStopId
    };
};

const reserveDeliveryQuote = async (
    executor,
    { userId, quotationId, fee, currency, expiresAt, scheduledAtUtc, stops, metadata }
) => {
    const normalizedQuotationId = String(quotationId || '').trim();
    if (!normalizedQuotationId) {
        const error = new Error('Missing quotationId');
        error.status = 400;
        throw error;
    }
    const normalizedUserId = toPositiveInteger(userId);
    if (!normalizedUserId) {
        const error = new Error('Invalid user id for delivery quote');
        error.status = 400;
        throw error;
    }

    const feeMinorUnits = toMinorUnitsAllowZero(fee);
    if (feeMinorUnits === null) {
        const error = new Error('Invalid delivery fee');
        error.status = 400;
        throw error;
    }

    const normalizedCurrency = normalizeCurrencyCode(currency, 'MYR');
    const expiresAtSql = expiresAt ? toSqlDateTimeUtc(expiresAt) : null;
    const scheduledAtSql = scheduledAtUtc ? toSqlDateTimeUtc(scheduledAtUtc) : null;
    const { senderStopId, recipientStopId } = resolveQuoteStops(stops);
    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    await executor.query(
        `
            INSERT INTO delivery_quotes (
                user_id,
                quotation_id,
                fee,
                currency,
                expires_at,
                scheduled_at_utc,
                sender_stop_id,
                recipient_stop_id,
                metadata_json,
                used_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
            ON DUPLICATE KEY UPDATE
                user_id = VALUES(user_id),
                fee = VALUES(fee),
                currency = VALUES(currency),
                expires_at = VALUES(expires_at),
                scheduled_at_utc = VALUES(scheduled_at_utc),
                sender_stop_id = VALUES(sender_stop_id),
                recipient_stop_id = VALUES(recipient_stop_id),
                metadata_json = VALUES(metadata_json),
                used_at = NULL
        `,
        [
            normalizedUserId,
            normalizedQuotationId,
            fromMinorUnits(feeMinorUnits),
            normalizedCurrency,
            expiresAtSql,
            scheduledAtSql,
            senderStopId,
            recipientStopId,
            metadataJson
        ]
    );
};

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

const createCurlecPaymentSignature = ({ orderId, paymentId }) => {
    if (!isCurlecConfigured()) return '';
    return crypto
        .createHmac('sha256', CURLEC_KEY_SECRET)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');
};

const isValidHHMM = (value) => HH_MM_PATTERN.test(String(value || '').trim());

const hhmmToMinutes = (value) => {
    const raw = String(value || '').trim();
    if (!isValidHHMM(raw)) return null;
    const [hours, minutes] = raw.split(':').map(Number);
    return hours * 60 + minutes;
};

const getCurrentMinutesInTimezone = (timeZone) => {
    const formatter = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone
    });
    const parts = formatter.formatToParts(new Date());
    const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
    return hour * 60 + minute;
};

const isWithinOperatingWindow = (openTime, closeTime, nowMinutes) => {
    const openMinutes = hhmmToMinutes(openTime);
    const closeMinutes = hhmmToMinutes(closeTime);
    if (openMinutes === null || closeMinutes === null) return true;
    if (openMinutes === closeMinutes) return true;
    if (openMinutes < closeMinutes) {
        return nowMinutes >= openMinutes && nowMinutes < closeMinutes;
    }
    return nowMinutes >= openMinutes || nowMinutes < closeMinutes;
};

const fetchShopSettings = async (executor = db) => {
    const [rows] = await executor.query(
        `
            SELECT
                open_time,
                close_time,
                pause_orders,
                store_name,
                store_phone,
                store_address,
                store_latitude,
                store_longitude
            FROM shop_settings
            WHERE id = 1
            LIMIT 1
        `
    );
    const row = rows[0] || {};
    const openTime = isValidHHMM(row.open_time) ? String(row.open_time) : DEFAULT_SHOP_OPEN_TIME;
    const closeTime = isValidHHMM(row.close_time) ? String(row.close_time) : DEFAULT_SHOP_CLOSE_TIME;

    return {
        openTime,
        closeTime,
        pauseOrders: row.pause_orders !== undefined ? Boolean(row.pause_orders) : false,
        storeName: String(row.store_name || DEFAULT_STORE_NAME).trim(),
        storePhone: String(row.store_phone || DEFAULT_STORE_PHONE).trim(),
        storeAddress: String(row.store_address || DEFAULT_STORE_ADDRESS).trim(),
        storeLatitude: toNumber(row.store_latitude) ?? DEFAULT_STORE_LATITUDE,
        storeLongitude: toNumber(row.store_longitude) ?? DEFAULT_STORE_LONGITUDE,
        timezone: SHOP_TIMEZONE
    };
};

const computeShopStatus = (settings) => {
    const nowMinutes = getCurrentMinutesInTimezone(settings.timezone || SHOP_TIMEZONE);
    const currentHour = String(Math.floor(nowMinutes / 60)).padStart(2, '0');
    const currentMinute = String(nowMinutes % 60).padStart(2, '0');
    const currentTime = `${currentHour}:${currentMinute}`;

    const isOpenBySchedule = isWithinOperatingWindow(settings.openTime, settings.closeTime, nowMinutes);
    const pauseOrders = Boolean(settings.pauseOrders);
    const isOrderable = !pauseOrders && isOpenBySchedule;

    let message = '';
    let reason = 'open';
    if (pauseOrders) {
        reason = 'paused';
        message = 'Sorry Our Store Is Currently Busy! Online order disabled for a while - Come back again...';
    } else if (!isOpenBySchedule) {
        reason = 'closed';
        message = `Our store open at ${settings.openTime} to ${settings.closeTime}. Please comeback`;
    }

    return {
        ...settings,
        currentTime,
        isOpenBySchedule,
        isOrderable,
        reason,
        message
    };
};

const fetchShopStatus = async (executor = db) => {
    const settings = await fetchShopSettings(executor);
    return computeShopStatus(settings);
};

const syncCartWithStock = async (executor, userId = null) => {
    const hasUserFilter = userId !== null && userId !== undefined;
    const userFilterClause = hasUserFilter ? 'AND ci.user_id = ?' : '';
    const params = hasUserFilter ? [userId] : [];

    await executor.query(
        `
            UPDATE cart_items ci
            JOIN menu_items m ON m.id = ci.menu_item_id
            SET ci.quantity = m.stock
            WHERE ci.quantity > m.stock
              AND m.is_active = 1
              AND m.stock > 0
              ${userFilterClause}
        `,
        params
    );
};

const fetchCartForUser = async (userId) => {
    await syncCartWithStock(db, userId);

    const [rows] = await db.query(
        `
            SELECT
                ci.menu_item_id,
                ci.quantity,
                m.name,
                m.description,
                m.price,
                m.image_url,
                m.stock,
                m.is_active,
                c.name as category_name
            FROM cart_items ci
            JOIN menu_items m ON m.id = ci.menu_item_id
            LEFT JOIN categories c ON c.id = m.category_id
            WHERE ci.user_id = ?
            ORDER BY ci.id ASC
        `,
        [userId]
    );

    return rows.map((row) => ({
        id: String(row.menu_item_id),
        name: row.name,
        description: row.description,
        price: parseFloat(row.price),
        image: row.image_url,
        category: row.category_name || 'Uncategorized',
        stock: row.stock,
        isActive: Boolean(row.is_active),
        quantity: row.quantity
    }));
};

const buildReorderPreview = async (executor, { userId, orderId }) => {
    const [orderRows] = await executor.query(
        `
            SELECT id, user_id
            FROM orders
            WHERE id = ?
            LIMIT 1
        `,
        [orderId]
    );
    const orderRow = orderRows[0];
    if (!orderRow) {
        const error = new Error('Order not found');
        error.status = 404;
        throw error;
    }
    if (Number(orderRow.user_id) !== Number(userId)) {
        const error = new Error('You can only reorder your own orders');
        error.status = 403;
        throw error;
    }

    const [rows] = await executor.query(
        `
            SELECT
                oi.menu_item_id,
                oi.quantity,
                oi.item_name_snapshot,
                m.name AS menu_name,
                m.image_url,
                m.stock,
                m.is_active
            FROM order_items oi
            LEFT JOIN menu_items m ON m.id = oi.menu_item_id
            WHERE oi.order_id = ?
            ORDER BY oi.id ASC
        `,
        [orderId]
    );
    if (!rows.length) {
        const error = new Error('This order has no items to reorder');
        error.status = 400;
        throw error;
    }

    const availableItems = [];
    const adjustedItems = [];
    const unavailableItems = [];
    let requestedCount = 0;

    for (const row of rows) {
        const requestedQuantity = toPositiveInteger(row.quantity) || 1;
        requestedCount += requestedQuantity;
        const menuItemId = String(row.menu_item_id || '');
        const snapshotName = String(row.item_name_snapshot || '').trim();
        const liveName = String(row.menu_name || '').trim();
        const name = snapshotName || liveName || `Menu Item #${menuItemId || 'Unknown'}`;
        const image = row.image_url || '';
        const stock = Number(row.stock || 0);
        const isActive = Boolean(row.is_active);

        if (!liveName) {
            unavailableItems.push({
                menuItemId,
                name,
                image,
                requestedQuantity,
                quantity: 0,
                reason: 'Item is no longer available'
            });
            continue;
        }
        if (!isActive) {
            unavailableItems.push({
                menuItemId,
                name,
                image,
                requestedQuantity,
                quantity: 0,
                reason: 'Item is currently unavailable'
            });
            continue;
        }
        if (stock <= 0) {
            unavailableItems.push({
                menuItemId,
                name,
                image,
                requestedQuantity,
                quantity: 0,
                reason: 'Out of stock'
            });
            continue;
        }

        const quantity = Math.min(requestedQuantity, stock);
        if (quantity < requestedQuantity) {
            adjustedItems.push({
                menuItemId,
                name,
                image,
                requestedQuantity,
                quantity,
                reason: `Only ${stock} left in stock`
            });
            continue;
        }

        availableItems.push({
            menuItemId,
            name,
            image,
            requestedQuantity,
            quantity
        });
    }

    const [cartCountRows] = await executor.query(
        'SELECT COUNT(*) AS total FROM cart_items WHERE user_id = ?',
        [userId]
    );
    const hasCurrentCart = Number(cartCountRows[0]?.total || 0) > 0;

    return {
        orderId: String(orderId),
        hasCurrentCart,
        requestedCount,
        addableCount: [...availableItems, ...adjustedItems].reduce(
            (total, item) => total + Number(item.quantity || 0),
            0
        ),
        availableItems,
        adjustedItems,
        unavailableItems
    };
};

const corsBaseOptions = {
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};
const corsOptionsDelegate = (req, callback) => {
    const rawOrigin = String(req.headers.origin || '').trim();
    const normalizedOrigin = normalizeCorsOrigin(rawOrigin);

    // Allow non-browser requests and keep backward compatibility when no allowlist is set.
    if (!normalizedOrigin || CORS_ORIGINS.length === 0 || CORS_ORIGIN_SET.has(normalizedOrigin)) {
        return callback(null, { ...corsBaseOptions, origin: true });
    }

    // Curlec may return with Origin from Razorpay endpoints.
    if (isCurlecCallbackPath(req.path || req.originalUrl) && CURLEC_CALLBACK_TRUSTED_ORIGINS.has(normalizedOrigin)) {
        return callback(null, { ...corsBaseOptions, origin: true });
    }

    return callback(
        new Error(
            `Origin not allowed by CORS: ${rawOrigin || normalizedOrigin} (path: ${req.path || req.originalUrl || ''})`
        )
    );
};

app.use(requestContextMiddleware);
app.use(requestLogAndMetricsMiddleware);
app.use(cors(corsOptionsDelegate));
app.options('*', cors(corsOptionsDelegate));
app.use(
    express.json({
        limit: '256kb',
        verify: (req, _res, buffer) => {
            if (!buffer?.length) return;
            if (
                req.originalUrl.startsWith('/api/webhooks/curlec') ||
                req.originalUrl.startsWith('/webhooks/curlec') ||
                req.originalUrl.startsWith('/api/webhooks/lalamove') ||
                req.originalUrl.startsWith('/webhooks/lalamove')
            ) {
                req.rawBody = buffer.toString('utf8');
            }
        }
    })
);
app.use(express.urlencoded({ extended: false }));

const API_ALIAS_PREFIXES = [
    '/status',
    '/auth',
    '/account',
    '/delivery',
    '/delivery-options',
    '/shop-status',
    '/shop-settings',
    '/payment-options',
    '/payments',
    '/addresses',
    '/cart',
    '/categories',
    '/menu',
    '/orders',
    '/webhooks'
];

const shouldAliasToApi = (requestPath) =>
    API_ALIAS_PREFIXES.some(
        (prefix) => requestPath === prefix || requestPath.startsWith(`${prefix}/`)
    );
const isBrowserDocumentRequest = (req) => {
    const method = String(req.method || '').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return false;
    const acceptHeader = String(req.headers?.accept || '').toLowerCase();
    return acceptHeader.includes('text/html');
};

// Allow direct API calls without `/api` prefix (e.g. https://api.example.com/status).
app.use((req, _res, next) => {
    if (req.path.startsWith('/api') || req.path === '/health' || req.path === '/api/health') {
        return next();
    }
    if (shouldAliasToApi(req.path) && !isBrowserDocumentRequest(req)) {
        req.url = `/api${req.url}`;
    }
    return next();
});

// Serve Static Frontend Files (Created after 'npm run build')
app.use(express.static(path.join(__dirname, '../dist')));

const validateStartupConfig = () => {
    const problems = [];

    if (!JWT_SECRET || JWT_SECRET.length < 32) {
        problems.push('JWT_SECRET must be set and at least 32 characters long');
    }

    if (IS_PRODUCTION && CORS_ORIGINS.length === 0) {
        problems.push('CORS_ORIGINS must be set in production');
    }

    if (IS_PRODUCTION && !ADMIN_PASSWORD) {
        problems.push('ADMIN_PASSWORD must be set in production');
    }

    if ((CURLEC_KEY_ID || CURLEC_KEY_SECRET) && !CURLEC_WEBHOOK_SECRET) {
        problems.push('CURLEC_WEBHOOK_SECRET is required when Curlec is configured');
    }

    if ((CURLEC_KEY_ID && !CURLEC_KEY_SECRET) || (!CURLEC_KEY_ID && CURLEC_KEY_SECRET)) {
        problems.push('CURLEC_KEY_ID and CURLEC_KEY_SECRET must both be set together');
    }

    if ((LALAMOVE_API_KEY && !LALAMOVE_API_SECRET) || (!LALAMOVE_API_KEY && LALAMOVE_API_SECRET)) {
        problems.push('LALAMOVE_API_KEY and LALAMOVE_API_SECRET must both be set together');
    }

    if (METRICS_ENABLED && METRICS_REQUIRE_AUTH && !METRICS_AUTH_TOKEN) {
        problems.push('METRICS_AUTH_TOKEN must be set when metrics auth is required');
    }

    if (problems.length > 0) {
        const message = `Startup configuration invalid: ${problems.join('; ')}`;
        const error = new Error(message);
        error.status = 500;
        throw error;
    }
};

validateStartupConfig();

app.get('/metrics', metricsAuthMiddleware, metricsHandler);
app.get('/api/metrics', metricsAuthMiddleware, metricsHandler);

// --- 2. HEALTH CHECK ---
app.get('/health', async (req, res) => {
    try {
        await db.query('SELECT 1');
        res.json({ status: 'ok', service: 'takcakap-api', time: new Date().toISOString() });
    } catch (err) {
        res.status(503).json({ status: 'error', error: err.message });
    }
});

app.get('/api/health', async (req, res) => {
    try {
        await db.query('SELECT 1');
        res.json({ status: 'ok', service: 'takcakap-api', time: new Date().toISOString() });
    } catch (err) {
        res.status(503).json({ status: 'error', error: err.message });
    }
});

app.get('/api/status', async (req, res) => {
    try {
        await db.query('SELECT 1');
        res.json({ status: 'connected', database: 'MariaDB', time: new Date().toISOString() });
    } catch (err) {
        res.status(503).json({ status: 'disconnected', error: err.message });
    }
});

app.get('/api/delivery-options', async (_req, res) => {
    try {
        const options = await fetchDeliveryOptions(db);
        return res.json(options);
    } catch (error) {
        console.error('Failed to fetch delivery options:', error);
        return res.status(500).json({ error: 'Failed to fetch delivery options' });
    }
});

app.get('/api/admin/delivery-options', requireAdmin, async (_req, res) => {
    try {
        const options = await fetchDeliveryOptions(db);
        return res.json(options);
    } catch (error) {
        console.error('Failed to fetch admin delivery options:', error);
        return res.status(500).json({ error: 'Failed to fetch delivery options' });
    }
});

app.put('/api/admin/delivery-options', requireAdmin, async (req, res) => {
    const { pickupEnabled, lalamoveEnabled } = req.body || {};
    const hasPickup = pickupEnabled !== undefined;
    const hasLalamove = lalamoveEnabled !== undefined;

    if (!hasPickup && !hasLalamove) {
        return res.status(400).json({ error: 'pickupEnabled or lalamoveEnabled is required' });
    }
    if (hasPickup && typeof pickupEnabled !== 'boolean') {
        return res.status(400).json({ error: 'pickupEnabled must be boolean' });
    }
    if (hasLalamove && typeof lalamoveEnabled !== 'boolean') {
        return res.status(400).json({ error: 'lalamoveEnabled must be boolean' });
    }

    try {
        await db.query(
            `
                UPDATE delivery_options
                SET
                    pickup_enabled = COALESCE(?, pickup_enabled),
                    lalamove_enabled = COALESCE(?, lalamove_enabled)
                WHERE id = 1
            `,
            [hasPickup ? pickupEnabled : null, hasLalamove ? lalamoveEnabled : null]
        );
        const options = await fetchDeliveryOptions(db);
        return res.json({ success: true, ...options });
    } catch (error) {
        console.error('Failed to update delivery options:', error);
        return res.status(500).json({ error: 'Failed to update delivery options' });
    }
});

app.get('/api/payment-options', async (_req, res) => {
    try {
        const options = await fetchPaymentOptions(db);
        return res.json(options);
    } catch (error) {
        console.error('Failed to fetch payment options:', error);
        return res.status(500).json({ error: 'Failed to fetch payment options' });
    }
});

app.get('/api/admin/payment-options', requireAdmin, async (_req, res) => {
    try {
        const options = await fetchPaymentOptions(db);
        return res.json(options);
    } catch (error) {
        console.error('Failed to fetch admin payment options:', error);
        return res.status(500).json({ error: 'Failed to fetch payment options' });
    }
});

app.put('/api/admin/payment-options', requireAdmin, async (req, res) => {
    const hasDuitnowQrUrl = req.body?.duitnowQrUrl !== undefined;
    const hasDuitnowEnabled = req.body?.duitnowEnabled !== undefined;
    const hasCurlecEnabled = req.body?.curlecEnabled !== undefined;
    const hasServiceFee = req.body?.serviceFee !== undefined;

    if (!hasDuitnowQrUrl && !hasDuitnowEnabled && !hasCurlecEnabled && !hasServiceFee) {
        return res.status(400).json({
            error: 'duitnowQrUrl, duitnowEnabled, curlecEnabled, or serviceFee is required'
        });
    }

    const duitnowQrUrl = hasDuitnowQrUrl ? String(req.body?.duitnowQrUrl || '').trim() : null;
    const serviceFeeRaw = hasServiceFee ? toNumber(req.body?.serviceFee) : null;
    const normalizedServiceFee = hasServiceFee && serviceFeeRaw !== null ? Number(serviceFeeRaw.toFixed(2)) : null;
    if (hasDuitnowQrUrl) {
        if (!duitnowQrUrl) {
            return res.status(400).json({ error: 'duitnowQrUrl cannot be empty' });
        }
        if (duitnowQrUrl.length > 2048) {
            return res.status(400).json({ error: 'duitnowQrUrl is too long' });
        }
    }
    if (hasDuitnowEnabled && typeof req.body?.duitnowEnabled !== 'boolean') {
        return res.status(400).json({ error: 'duitnowEnabled must be boolean' });
    }
    if (hasCurlecEnabled && typeof req.body?.curlecEnabled !== 'boolean') {
        return res.status(400).json({ error: 'curlecEnabled must be boolean' });
    }
    if (hasServiceFee) {
        if (serviceFeeRaw === null) {
            return res.status(400).json({ error: 'serviceFee must be a valid number' });
        }
        if (serviceFeeRaw < 0) {
            return res.status(400).json({ error: 'serviceFee cannot be negative' });
        }
        if (serviceFeeRaw > 9999) {
            return res.status(400).json({ error: 'serviceFee is too large' });
        }
    }

    try {
        await db.query(
            `
                UPDATE payment_options
                SET
                    duitnow_qr_url = COALESCE(?, duitnow_qr_url),
                    duitnow_enabled = COALESCE(?, duitnow_enabled),
                    curlec_enabled = COALESCE(?, curlec_enabled),
                    service_fee = COALESCE(?, service_fee)
                WHERE id = 1
            `,
            [
                hasDuitnowQrUrl ? duitnowQrUrl : null,
                hasDuitnowEnabled ? req.body.duitnowEnabled : null,
                hasCurlecEnabled ? req.body.curlecEnabled : null,
                hasServiceFee ? normalizedServiceFee : null
            ]
        );
        const options = await fetchPaymentOptions(db);
        return res.json({ success: true, ...options });
    } catch (error) {
        console.error('Failed to update payment options:', error);
        return res.status(500).json({ error: 'Failed to update payment options' });
    }
});

app.all('/api/payments/curlec/callback', (req, res) => {
    try {
        const callbackPayload = getCurlecCallbackPayload(req);
        const redirectUrl = buildCurlecCheckoutReturnUrl(req, callbackPayload);
        return res.redirect(302, redirectUrl);
    } catch (error) {
        console.error('Failed to process Curlec callback redirect:', error);
        return res.status(500).json({ error: 'Failed to process payment callback' });
    }
});

app.post('/api/payments/curlec/order', requireAuth, async (req, res) => {
    const amount = toNumber(req.body?.amount);
    const currency = String(req.body?.currency || 'MYR')
        .trim()
        .toUpperCase();
    const hasOrderPayload = req.body?.orderPayload !== undefined && req.body?.orderPayload !== null;
    const orderPayloadResult = hasOrderPayload
        ? normalizeCurlecOrderDraftPayload(req.body?.orderPayload)
        : { value: null, error: null };

    if (amount === null || amount <= 0) {
        return res.status(400).json({ error: 'Valid amount is required' });
    }
    if (currency !== 'MYR') {
        return res.status(400).json({ error: 'Only MYR currency is supported' });
    }
    if (orderPayloadResult.error) {
        return res.status(400).json({ error: orderPayloadResult.error });
    }

    try {
        const paymentOptions = await fetchPaymentOptions(db);
        if (!paymentOptions.curlecEnabled) {
            return res.status(403).json({ error: 'Curlec payment is currently unavailable' });
        }
        if (!paymentOptions.curlecConfigured) {
            return res.status(503).json({ error: 'Curlec payment is not configured on server' });
        }

        const amountInSen = toMinorUnits(amount);
        if (!amountInSen || amountInSen <= 0) {
            return res.status(400).json({ error: 'Amount must be greater than 0' });
        }

        const checkoutSessionId = crypto.randomUUID();
        const curlecOrder = await callCurlecApi({
            method: 'POST',
            endpoint: '/orders',
            body: {
                amount: amountInSen,
                currency: 'MYR',
                receipt: String(`fd-${req.user.id}-${Date.now()}`).slice(0, 40),
                notes: {
                    source: 'foodiedash',
                    userId: String(req.user.id)
                }
            }
        });
        const createdCurlecOrderId = String(curlecOrder.id || '').trim();
        if (!createdCurlecOrderId) {
            return res.status(502).json({ error: 'Curlec order response is missing order id' });
        }
        await upsertCurlecCheckoutSession({
            userId: req.user.id,
            sessionId: checkoutSessionId,
            curlecOrderId: createdCurlecOrderId,
            expectedAmountMinor: amountInSen,
            currency: 'MYR',
            orderPayload: orderPayloadResult.value
        });

        return res.json({
            success: true,
            keyId: CURLEC_KEY_ID,
            orderId: createdCurlecOrderId,
            amount: Number(curlecOrder.amount || amountInSen),
            currency: String(curlecOrder.currency || 'MYR').toUpperCase(),
            checkoutSessionId,
            displayName: CURLEC_CHECKOUT_NAME || 'Online Payment',
            description: CURLEC_CHECKOUT_DESCRIPTION || 'Secure online payment via Curlec',
            themeColor: CURLEC_THEME_COLOR || '#499c49'
        });
    } catch (error) {
        console.error('Failed to create Curlec order:', error);
        return res.status(error.status || 500).json({
            error: error.message || 'Failed to create Curlec order',
            details: error.payload || null
        });
    }
});

app.get('/api/shop-status', async (_req, res) => {
    try {
        const status = await fetchShopStatus(db);
        return res.json(status);
    } catch (error) {
        console.error('Failed to fetch shop status:', error);
        return res.status(500).json({ error: 'Failed to fetch shop status' });
    }
});

app.get('/api/admin/shop-settings', requireAdmin, async (_req, res) => {
    try {
        const settings = await fetchShopSettings(db);
        const status = computeShopStatus(settings);
        return res.json(status);
    } catch (error) {
        console.error('Failed to fetch admin shop settings:', error);
        return res.status(500).json({ error: 'Failed to fetch shop settings' });
    }
});

app.put('/api/admin/shop-settings', requireAdmin, async (req, res) => {
    const hasOpenTime = req.body?.openTime !== undefined;
    const hasCloseTime = req.body?.closeTime !== undefined;
    const hasPauseOrders = req.body?.pauseOrders !== undefined;
    const hasStoreName = req.body?.storeName !== undefined;
    const hasStorePhone = req.body?.storePhone !== undefined;
    const hasStoreAddress = req.body?.storeAddress !== undefined;
    const hasStoreLatitude = req.body?.storeLatitude !== undefined;
    const hasStoreLongitude = req.body?.storeLongitude !== undefined;

    if (
        !hasOpenTime &&
        !hasCloseTime &&
        !hasPauseOrders &&
        !hasStoreName &&
        !hasStorePhone &&
        !hasStoreAddress &&
        !hasStoreLatitude &&
        !hasStoreLongitude
    ) {
        return res.status(400).json({
            error:
                'openTime, closeTime, pauseOrders, storeName, storePhone, storeAddress, storeLatitude, or storeLongitude is required'
        });
    }

    let openTime = null;
    let closeTime = null;
    let pauseOrders = null;
    let storeName = null;
    let storePhone = null;
    let storeAddress = null;
    let storeLatitude = null;
    let storeLongitude = null;

    if (hasOpenTime) {
        openTime = String(req.body.openTime || '').trim();
        if (!isValidHHMM(openTime)) {
            return res.status(400).json({ error: 'openTime must be in HH:MM format' });
        }
    }
    if (hasCloseTime) {
        closeTime = String(req.body.closeTime || '').trim();
        if (!isValidHHMM(closeTime)) {
            return res.status(400).json({ error: 'closeTime must be in HH:MM format' });
        }
    }
    if (hasPauseOrders) {
        if (typeof req.body.pauseOrders !== 'boolean') {
            return res.status(400).json({ error: 'pauseOrders must be boolean' });
        }
        pauseOrders = req.body.pauseOrders;
    }
    if (hasStoreName) {
        storeName = String(req.body.storeName || '').trim();
        if (!storeName) {
            return res.status(400).json({ error: 'storeName is required' });
        }
    }
    if (hasStorePhone) {
        const normalizedStorePhone = lalamoveService.normalizePhone(req.body.storePhone);
        if (!lalamoveService.isValidPhone(normalizedStorePhone)) {
            return res.status(400).json({
                error: 'Invalid storePhone format. Use E.164, e.g. +60123456789'
            });
        }
        storePhone = normalizedStorePhone;
    }
    if (hasStoreAddress) {
        storeAddress = String(req.body.storeAddress || '').trim();
        if (!storeAddress) {
            return res.status(400).json({ error: 'storeAddress is required' });
        }
    }
    if (hasStoreLatitude || hasStoreLongitude) {
        if (!hasStoreLatitude || !hasStoreLongitude) {
            return res.status(400).json({
                error: 'storeLatitude and storeLongitude must be updated together'
            });
        }
        const parsedStoreLat = toNumber(req.body.storeLatitude);
        const parsedStoreLng = toNumber(req.body.storeLongitude);
        if (parsedStoreLat === null || parsedStoreLng === null) {
            return res.status(400).json({
                error: 'storeLatitude and storeLongitude must be valid numbers'
            });
        }
        if (!isValidLatitude(parsedStoreLat) || !isValidLongitude(parsedStoreLng)) {
            return res.status(400).json({
                error: 'Invalid store coordinates. Latitude must be between -90 and 90, longitude between -180 and 180.'
            });
        }
        storeLatitude = roundCoordinate(parsedStoreLat);
        storeLongitude = roundCoordinate(parsedStoreLng);
    }

    try {
        const currentSettings = await fetchShopSettings(db);
        const nextOpenTime = openTime || currentSettings.openTime;
        const nextCloseTime = closeTime || currentSettings.closeTime;
        if (nextOpenTime === nextCloseTime) {
            return res.status(400).json({ error: 'openTime and closeTime cannot be the same' });
        }

        await db.query(
            `
                UPDATE shop_settings
                SET
                    open_time = COALESCE(?, open_time),
                    close_time = COALESCE(?, close_time),
                    pause_orders = COALESCE(?, pause_orders),
                    store_name = COALESCE(?, store_name),
                    store_phone = COALESCE(?, store_phone),
                    store_address = COALESCE(?, store_address),
                    store_latitude = COALESCE(?, store_latitude),
                    store_longitude = COALESCE(?, store_longitude)
                WHERE id = 1
            `,
            [
                openTime,
                closeTime,
                hasPauseOrders ? pauseOrders : null,
                storeName,
                storePhone,
                storeAddress,
                storeLatitude,
                storeLongitude
            ]
        );
        const settings = await fetchShopSettings(db);
        const status = computeShopStatus(settings);
        return res.json({ success: true, ...status });
    } catch (error) {
        console.error('Failed to update shop settings:', error);
        return res.status(500).json({ error: 'Failed to update shop settings' });
    }
});

app.get('/api/admin/sales/overview', requireAdmin, async (_req, res) => {
    try {
        const ranges = getSalesOverviewRanges(Date.now());
        const dayCurrentStartSql = toSqlDateTimeUtc(new Date(ranges.day.currentStartMs));
        const dayCurrentEndSql = toSqlDateTimeUtc(new Date(ranges.day.currentEndMs));
        const dayPreviousStartSql = toSqlDateTimeUtc(new Date(ranges.day.previousStartMs));
        const dayPreviousEndSql = toSqlDateTimeUtc(new Date(ranges.day.previousEndMs));
        const weekCurrentStartSql = toSqlDateTimeUtc(new Date(ranges.week.currentStartMs));
        const weekCurrentEndSql = toSqlDateTimeUtc(new Date(ranges.week.currentEndMs));
        const weekPreviousStartSql = toSqlDateTimeUtc(new Date(ranges.week.previousStartMs));
        const weekPreviousEndSql = toSqlDateTimeUtc(new Date(ranges.week.previousEndMs));
        const monthCurrentStartSql = toSqlDateTimeUtc(new Date(ranges.month.currentStartMs));
        const monthCurrentEndSql = toSqlDateTimeUtc(new Date(ranges.month.currentEndMs));
        const monthPreviousStartSql = toSqlDateTimeUtc(new Date(ranges.month.previousStartMs));
        const monthPreviousEndSql = toSqlDateTimeUtc(new Date(ranges.month.previousEndMs));

        const [rows] = await db.query(
            `
                SELECT
                    COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN total_amount ELSE 0 END), 0) AS daily_sales,
                    COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN total_amount ELSE 0 END), 0) AS daily_sales_prev,
                    COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN total_amount ELSE 0 END), 0) AS weekly_sales,
                    COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN total_amount ELSE 0 END), 0) AS weekly_sales_prev,
                    COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN total_amount ELSE 0 END), 0) AS monthly_sales,
                    COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN total_amount ELSE 0 END), 0) AS monthly_sales_prev,
                    COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END), 0) AS daily_orders,
                    COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END), 0) AS weekly_orders,
                    COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END), 0) AS monthly_orders
                FROM orders
                WHERE status <> 'Cancelled' AND status <> 'Pending Payment'
            `,
            [
                dayCurrentStartSql,
                dayCurrentEndSql,
                dayPreviousStartSql,
                dayPreviousEndSql,
                weekCurrentStartSql,
                weekCurrentEndSql,
                weekPreviousStartSql,
                weekPreviousEndSql,
                monthCurrentStartSql,
                monthCurrentEndSql,
                monthPreviousStartSql,
                monthPreviousEndSql,
                dayCurrentStartSql,
                dayCurrentEndSql,
                weekCurrentStartSql,
                weekCurrentEndSql,
                monthCurrentStartSql,
                monthCurrentEndSql
            ]
        );

        const stats = rows[0] || {};
        const dailySales = Number(stats.daily_sales || 0);
        const dailySalesPrev = Number(stats.daily_sales_prev || 0);
        const weeklySales = Number(stats.weekly_sales || 0);
        const weeklySalesPrev = Number(stats.weekly_sales_prev || 0);
        const monthlySales = Number(stats.monthly_sales || 0);
        const monthlySalesPrev = Number(stats.monthly_sales_prev || 0);
        const dailyOrders = Number(stats.daily_orders || 0);
        const weeklyOrders = Number(stats.weekly_orders || 0);
        const monthlyOrders = Number(stats.monthly_orders || 0);

        return res.json({
            timezone: SHOP_TIMEZONE,
            generatedAt: new Date().toISOString(),
            dailySales,
            weeklySales,
            monthlySales,
            dailyOrders,
            weeklyOrders,
            monthlyOrders,
            dailyGrowthPct: computeGrowthPercentage(dailySales, dailySalesPrev),
            weeklyGrowthPct: computeGrowthPercentage(weeklySales, weeklySalesPrev),
            monthlyGrowthPct: computeGrowthPercentage(monthlySales, monthlySalesPrev)
        });
    } catch (error) {
        console.error('Failed to load admin sales overview:', error);
        return res.status(500).json({ error: 'Failed to fetch sales overview' });
    }
});

app.get('/api/admin/sales/report.csv', requireAdmin, async (req, res) => {
    try {
        const preset = String(req.query?.preset || 'month').trim().toLowerCase();
        const fromText = String(req.query?.from || '').trim();
        const toText = String(req.query?.to || '').trim();
        const usingCustomRange = Boolean(fromText || toText);

        let rangeStartUtcMs = 0;
        let rangeEndUtcMs = 0;
        let filenamePrefix = 'sales-report';

        if (usingCustomRange) {
            if (!fromText || !toText) {
                return res.status(400).json({ error: 'Both from and to are required for custom range' });
            }
            const fromParsed = parseKlDateInput(fromText);
            const toParsed = parseKlDateInput(toText);
            if (!fromParsed || !toParsed) {
                return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD for from and to.' });
            }
            if (fromParsed.startUtcMs > toParsed.startUtcMs) {
                return res.status(400).json({ error: 'from date must be earlier than or equal to to date' });
            }
            rangeStartUtcMs = fromParsed.startUtcMs;
            rangeEndUtcMs = toParsed.startUtcMs + MS_PER_DAY;
            filenamePrefix = `sales-${fromParsed.raw}-to-${toParsed.raw}`;
        } else {
            const ranges = getSalesOverviewRanges(Date.now());
            if (preset === 'today') {
                rangeStartUtcMs = ranges.day.currentStartMs;
                rangeEndUtcMs = ranges.day.currentEndMs;
                filenamePrefix = `sales-today-${formatKlDate(rangeStartUtcMs)}`;
            } else if (preset === 'week') {
                rangeStartUtcMs = ranges.week.currentStartMs;
                rangeEndUtcMs = ranges.week.currentEndMs;
                filenamePrefix = `sales-week-${formatKlDate(rangeStartUtcMs)}`;
            } else {
                rangeStartUtcMs = ranges.month.currentStartMs;
                rangeEndUtcMs = ranges.month.currentEndMs;
                filenamePrefix = `sales-month-${formatKlDate(rangeStartUtcMs)}`;
            }
        }

        const rangeStartSql = toSqlDateTimeUtc(new Date(rangeStartUtcMs));
        const rangeEndSql = toSqlDateTimeUtc(new Date(rangeEndUtcMs));

        const [rows] = await db.query(
            `
                SELECT
                    o.id,
                    o.created_at,
                    o.status,
                    o.order_type,
                    o.payment_method,
                    o.total_amount,
                    o.delivery_fee,
                    o.delivery_currency,
                    o.delivery_provider,
                    o.external_order_id,
                    o.tracking_url,
                    o.delivery_timing,
                    o.scheduled_at_utc,
                    o.delivery_address,
                    o.delivery_label_snapshot,
                    o.delivery_contact_phone,
                    o.delivery_note_snapshot,
                    o.delivery_latitude,
                    o.delivery_longitude,
                    o.recipient_name_snapshot,
                    u.name AS customer_name,
                    u.email AS customer_email,
                    (
                        SELECT GROUP_CONCAT(
                            CONCAT(
                                oi.quantity,
                                'x ',
                                COALESCE(NULLIF(TRIM(oi.item_name_snapshot), ''), m.name, CONCAT('Menu Item #', oi.menu_item_id))
                            )
                            SEPARATOR '; '
                        )
                        FROM order_items oi
                        LEFT JOIN menu_items m ON m.id = oi.menu_item_id
                        WHERE oi.order_id = o.id
                    ) AS items_summary
                FROM orders o
                LEFT JOIN users u ON u.id = o.user_id
                WHERE o.status <> 'Cancelled'
                  AND o.status <> 'Pending Payment'
                  AND o.created_at >= ?
                  AND o.created_at < ?
                ORDER BY o.created_at DESC
            `,
            [rangeStartSql, rangeEndSql]
        );

        const headers = [
            'Order ID',
            'Created At (MYT)',
            'Status',
            'Order Type',
            'Customer Name',
            'Customer Email',
            'Recipient Name',
            'Contact Phone',
            'Address Label',
            'Address',
            'Address Note',
            'Latitude',
            'Longitude',
            'Items',
            'Payment Method',
            'Delivery Provider',
            'Lalamove Order ID',
            'Tracking URL',
            'Delivery Timing',
            'Scheduled At (MYT)',
            'Delivery Fee',
            'Total Amount',
            'Currency'
        ];

        const csvLines = [headers.map(toCsvValue).join(',')];
        for (const row of rows) {
            const createdIso = toUtcIsoString(row.created_at);
            const createdMyt = createdIso
                ? new Date(createdIso).toLocaleString('en-MY', {
                    timeZone: SHOP_TIMEZONE,
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                })
                : '';
            const scheduledMyt = row.scheduled_at_utc ? formatScheduledAtLabel(row.scheduled_at_utc) : '';

            const values = [
                row.id,
                createdMyt,
                row.status || '',
                row.order_type || '',
                row.customer_name || '',
                row.customer_email || '',
                row.recipient_name_snapshot || '',
                row.delivery_contact_phone || '',
                row.delivery_label_snapshot || '',
                row.delivery_address || '',
                row.delivery_note_snapshot || '',
                row.delivery_latitude ?? '',
                row.delivery_longitude ?? '',
                row.items_summary || '',
                row.payment_method || '',
                row.delivery_provider || '',
                row.external_order_id || '',
                row.tracking_url || '',
                row.delivery_timing || '',
                scheduledMyt,
                Number(row.delivery_fee || 0).toFixed(2),
                Number(row.total_amount || 0).toFixed(2),
                row.delivery_currency || 'MYR'
            ];
            csvLines.push(values.map(toCsvValue).join(','));
        }

        const filenameSafePrefix = filenamePrefix.replace(/[^a-zA-Z0-9._-]+/g, '-');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filenameSafePrefix}.csv"`);
        return res.status(200).send(`\uFEFF${csvLines.join('\n')}`);
    } catch (error) {
        console.error('Failed to generate sales CSV report:', error);
        return res.status(500).json({ error: 'Failed to generate sales report CSV' });
    }
});

app.post('/api/auth/google', authRateLimiter, async (req, res) => {
    try {
        if (!GOOGLE_CLIENT_ID) {
            return res.status(500).json({ error: 'GOOGLE_CLIENT_ID is not configured' });
        }

        const credential = req.body?.credential;
        if (!credential) {
            return res.status(400).json({ error: 'Missing Google credential token' });
        }

        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: GOOGLE_CLIENT_ID
        });
        const payload = ticket.getPayload();

        if (!payload?.sub || !payload?.email) {
            return res.status(400).json({ error: 'Invalid Google token payload' });
        }
        if (payload.email_verified === false) {
            return res.status(400).json({ error: 'Google account email is not verified' });
        }

        const googleId = String(payload.sub);
        const email = String(payload.email).trim().toLowerCase();
        const name = String(payload.name || 'Google User').trim();
        const avatarUrl = String(payload.picture || '');

        const [foundByGoogle] = await db.query(
            'SELECT id, name, email, role, avatar_url, phone_number, is_suspended FROM users WHERE google_id = ? LIMIT 1',
            [googleId]
        );
        const [foundByEmail] = foundByGoogle.length
            ? [[]]
            : await db.query(
                'SELECT id, name, email, role, avatar_url, phone_number, is_suspended FROM users WHERE email = ? LIMIT 1',
                [email]
            );

        let userRow = foundByGoogle[0] || foundByEmail[0] || null;

        if (userRow?.role === 'admin') {
            return res.status(403).json({ error: 'Admin accounts must sign in via admin login' });
        }
        if (userRow?.is_suspended) {
            return res.status(403).json({ error: 'Your account is suspended. Please contact support.' });
        }

        if (userRow) {
            await db.query(
                `
                    UPDATE users
                    SET google_id = ?, name = ?, email = ?, avatar_url = COALESCE(NULLIF(?, ''), avatar_url)
                    WHERE id = ?
                `,
                [googleId, name, email, avatarUrl, userRow.id]
            );
            const [rows] = await db.query(
                'SELECT id, name, email, role, avatar_url, phone_number, is_suspended FROM users WHERE id = ? LIMIT 1',
                [userRow.id]
            );
            userRow = rows[0];
        } else {
            const [insert] = await db.query(
                `
                    INSERT INTO users (name, email, google_id, role, avatar_url)
                    VALUES (?, ?, ?, 'user', ?)
                `,
                [name, email, googleId, avatarUrl]
            );
            const [rows] = await db.query(
                'SELECT id, name, email, role, avatar_url, phone_number, is_suspended FROM users WHERE id = ? LIMIT 1',
                [insert.insertId]
            );
            userRow = rows[0];
        }

        const token = signAuthToken(userRow);
        return res.json({
            token,
            user: mapUserResponse(userRow)
        });
    } catch (error) {
        console.error('Google auth failed:', error);
        return res.status(401).json({ error: 'Google authentication failed' });
    }
});

app.post('/api/auth/admin/login', authRateLimiter, async (req, res) => {
    try {
        if (!ADMIN_PASSWORD) {
            return res.status(500).json({ error: 'Admin login is not configured on server' });
        }

        const email = String(req.body?.email || '').trim().toLowerCase();
        const password = String(req.body?.password || '');
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const [rows] = await db.query(
            `
                SELECT id, name, email, role, avatar_url, phone_number, password_hash, is_suspended
                FROM users
                WHERE email = ?
                LIMIT 1
            `,
            [email]
        );
        const admin = rows[0];
        if (!admin || admin.role !== 'admin' || !admin.password_hash) {
            return res.status(401).json({ error: 'Invalid admin credentials' });
        }
        if (admin.is_suspended) {
            return res.status(403).json({ error: 'Admin account is suspended' });
        }

        const isValidPassword = await bcrypt.compare(password, admin.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid admin credentials' });
        }

        const token = signAuthToken(admin);
        return res.json({ token, user: mapUserResponse(admin) });
    } catch (error) {
        console.error('Admin login failed:', error);
        return res.status(500).json({ error: 'Admin login failed' });
    }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT id, name, email, role, avatar_url, phone_number, is_suspended FROM users WHERE id = ? LIMIT 1',
            [req.user.id]
        );
        const user = rows[0];
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        return res.json({ user: mapUserResponse(user) });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to fetch user profile' });
    }
});

app.put('/api/account', requireAuth, async (req, res) => {
    try {
        const name = req.body?.name ? String(req.body.name).trim() : null;
        const phoneNumber = req.body?.phoneNumber !== undefined ? String(req.body.phoneNumber).trim() : null;

        const fields = [];
        const values = [];
        if (name) {
            fields.push('name = ?');
            values.push(name);
        }
        if (phoneNumber !== null) {
            const normalizedPhoneNumber = phoneNumber ? lalamoveService.normalizePhone(phoneNumber) : '';
            if (phoneNumber && !lalamoveService.isValidPhone(normalizedPhoneNumber)) {
                return res.status(400).json({ error: 'Invalid phone number format. Use E.164, e.g. +60123456789' });
            }
            fields.push('phone_number = ?');
            values.push(normalizedPhoneNumber);
        }

        if (fields.length === 0) {
            return res.json({ success: true });
        }

        values.push(req.user.id);
        await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);

        const [rows] = await db.query(
            'SELECT id, name, email, role, avatar_url, phone_number, is_suspended FROM users WHERE id = ? LIMIT 1',
            [req.user.id]
        );

        return res.json({ success: true, user: mapUserResponse(rows[0]) });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to update account' });
    }
});

app.get('/api/admin/customers', requireAdmin, async (req, res) => {
    try {
        const search = String(req.query?.search || '').trim();
        const status = String(req.query?.status || 'all').trim().toLowerCase();
        const where = [`u.role = 'user'`];
        const params = [];

        if (status === 'active') {
            where.push('COALESCE(u.is_suspended, 0) = 0');
        } else if (status === 'suspended') {
            where.push('COALESCE(u.is_suspended, 0) = 1');
        }

        if (search) {
            const like = `%${search}%`;
            where.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone_number LIKE ?)');
            params.push(like, like, like);
        }

        const [rows] = await db.query(
            `
                SELECT
                    u.id,
                    u.name,
                    u.email,
                    u.phone_number,
                    u.avatar_url,
                    u.created_at,
                    COALESCE(u.is_suspended, 0) AS is_suspended,
                    u.suspended_at,
                    COUNT(o.id) AS order_count,
                    COALESCE(SUM(o.total_amount), 0) AS total_spent,
                    MAX(o.created_at) AS last_order_at
                FROM users u
                LEFT JOIN orders o ON o.user_id = u.id
                WHERE ${where.join(' AND ')}
                GROUP BY
                    u.id, u.name, u.email, u.phone_number, u.avatar_url, u.created_at, u.is_suspended, u.suspended_at
                ORDER BY u.created_at DESC
                LIMIT 500
            `,
            params
        );

        const [statsRows] = await db.query(
            `
                SELECT
                    COUNT(*) AS total_customers,
                    SUM(
                        CASE
                            WHEN COALESCE(u.is_suspended, 0) = 0
                                 AND EXISTS (
                                     SELECT 1
                                     FROM orders o_recent
                                     WHERE o_recent.user_id = u.id
                                       AND o_recent.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)
                                 )
                            THEN 1
                            ELSE 0
                        END
                    ) AS active_customers,
                    SUM(CASE WHEN COALESCE(u.is_suspended, 0) = 1 THEN 1 ELSE 0 END) AS suspended_customers,
                    SUM(CASE WHEN u.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS new_this_week
                FROM users u
                WHERE u.role = 'user'
            `
        );
        const stats = statsRows[0] || {};

        return res.json({
            stats: {
                totalCustomers: Number(stats.total_customers || 0),
                activeCustomers: Number(stats.active_customers || 0),
                suspendedCustomers: Number(stats.suspended_customers || 0),
                newThisWeek: Number(stats.new_this_week || 0)
            },
            customers: rows.map((row) => ({
                id: String(row.id),
                name: row.name || 'Customer',
                email: row.email || '',
                phoneNumber: row.phone_number || '',
                avatar: row.avatar_url || '',
                isSuspended: Boolean(row.is_suspended),
                suspendedAt: row.suspended_at ? new Date(row.suspended_at).toISOString() : null,
                createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
                orderCount: Number(row.order_count || 0),
                totalSpent: parseFloat(row.total_spent || 0),
                lastOrderAt: row.last_order_at ? new Date(row.last_order_at).toISOString() : null
            }))
        });
    } catch (error) {
        console.error('Failed to load admin customers:', error);
        return res.status(500).json({ error: 'Failed to fetch customers' });
    }
});

app.get('/api/admin/customers/:id/orders', requireAdmin, async (req, res) => {
    try {
        const customerId = toPositiveInteger(req.params.id);
        if (!customerId) {
            return res.status(400).json({ error: 'Invalid customer id' });
        }

        const [userRows] = await db.query(
            `
                SELECT id, name, email, phone_number, avatar_url, role, is_suspended, created_at
                FROM users
                WHERE id = ?
                LIMIT 1
            `,
            [customerId]
        );
        const customer = userRows[0];
        if (!customer || customer.role !== 'user') {
            return res.status(404).json({ error: 'Customer not found' });
        }

        const [orders] = await db.query(
            `
                SELECT
                    id,
                    status,
                    total_amount,
                    order_type,
                    delivery_provider,
                    tracking_url,
                    created_at
                FROM orders
                WHERE user_id = ?
                ORDER BY created_at DESC
                LIMIT 30
            `,
            [customerId]
        );
        const customerTotalSpent = orders.reduce(
            (sum, order) => sum + parseFloat(order.total_amount || 0),
            0
        );

        const orderIds = orders.map((order) => Number(order.id)).filter(Boolean);
        let itemsSummaryByOrderId = {};
        if (orderIds.length > 0) {
            const [itemsRows] = await db.query(
                `
                    SELECT
                        oi.order_id,
                        GROUP_CONCAT(
                            CONCAT(
                                oi.quantity,
                                'x ',
                                COALESCE(NULLIF(TRIM(oi.item_name_snapshot), ''), m.name, CONCAT('Menu Item #', oi.menu_item_id))
                            )
                            ORDER BY oi.id SEPARATOR ', '
                        ) AS items_summary
                    FROM order_items oi
                    LEFT JOIN menu_items m ON m.id = oi.menu_item_id
                    WHERE oi.order_id IN (?)
                    GROUP BY oi.order_id
                `,
                [orderIds]
            );
            itemsSummaryByOrderId = itemsRows.reduce((acc, row) => {
                acc[Number(row.order_id)] = row.items_summary || '';
                return acc;
            }, {});
        }

        return res.json({
            customer: {
                id: String(customer.id),
                name: customer.name || 'Customer',
                email: customer.email || '',
                phoneNumber: customer.phone_number || '',
                avatar: customer.avatar_url || '',
                isSuspended: Boolean(customer.is_suspended),
                createdAt: customer.created_at ? new Date(customer.created_at).toISOString() : null,
                orderCount: orders.length,
                totalSpent: customerTotalSpent,
                lastOrderAt: orders[0]?.created_at ? new Date(orders[0].created_at).toISOString() : null
            },
            orders: orders.map((order) => ({
                id: String(order.id),
                status: order.status,
                orderType: order.order_type,
                total: parseFloat(order.total_amount),
                deliveryProvider: order.delivery_provider || 'Internal',
                trackingUrl: order.tracking_url || null,
                date: order.created_at ? new Date(order.created_at).toISOString() : null,
                itemsSummary: itemsSummaryByOrderId[Number(order.id)] || ''
            }))
        });
    } catch (error) {
        console.error('Failed to load customer orders:', error);
        return res.status(500).json({ error: 'Failed to fetch customer orders' });
    }
});

app.patch('/api/admin/customers/:id/suspension', requireAdmin, async (req, res) => {
    try {
        const customerId = toPositiveInteger(req.params.id);
        if (!customerId) {
            return res.status(400).json({ error: 'Invalid customer id' });
        }

        const isSuspended = req.body?.isSuspended;
        if (typeof isSuspended !== 'boolean') {
            return res.status(400).json({ error: 'isSuspended must be a boolean' });
        }

        const [rows] = await db.query(
            `
                SELECT id, role
                FROM users
                WHERE id = ?
                LIMIT 1
            `,
            [customerId]
        );
        const targetUser = rows[0];
        if (!targetUser) {
            return res.status(404).json({ error: 'Customer not found' });
        }
        if (targetUser.role !== 'user') {
            return res.status(400).json({ error: 'Only customer accounts can be suspended' });
        }

        await db.query(
            `
                UPDATE users
                SET is_suspended = ?, suspended_at = ?
                WHERE id = ?
            `,
            [isSuspended ? 1 : 0, isSuspended ? new Date() : null, customerId]
        );

        const [updatedRows] = await db.query(
            `
                SELECT id, name, email, phone_number, avatar_url, is_suspended, suspended_at
                FROM users
                WHERE id = ?
                LIMIT 1
            `,
            [customerId]
        );
        const updated = updatedRows[0];

        return res.json({
            success: true,
            customer: {
                id: String(updated.id),
                name: updated.name || 'Customer',
                email: updated.email || '',
                phoneNumber: updated.phone_number || '',
                avatar: updated.avatar_url || '',
                isSuspended: Boolean(updated.is_suspended),
                suspendedAt: updated.suspended_at ? new Date(updated.suspended_at).toISOString() : null
            }
        });
    } catch (error) {
        console.error('Failed to update customer suspension:', error);
        return res.status(500).json({ error: 'Failed to update customer status' });
    }
});

app.post('/api/delivery/quote', requireAuth, async (req, res) => {
    const {
        addressLine,
        latitude,
        longitude,
        recipientName,
        recipientPhone,
        note,
        deliveryTiming,
        scheduledAtUtc
    } = req.body || {};
    const normalizedDeliveryTiming =
        String(deliveryTiming || ORDER_DELIVERY_TIMING_NOW).toUpperCase() === ORDER_DELIVERY_TIMING_SCHEDULED
            ? ORDER_DELIVERY_TIMING_SCHEDULED
            : ORDER_DELIVERY_TIMING_NOW;
    const parsedSchedule = parseScheduledAtUtc(scheduledAtUtc, {
        required: normalizedDeliveryTiming === ORDER_DELIVERY_TIMING_SCHEDULED
    });
    if (parsedSchedule.error) {
        return res.status(400).json({ error: parsedSchedule.error });
    }

    const lat = toNumber(latitude);
    const lng = toNumber(longitude);

    if (!addressLine || lat === null || lng === null) {
        return res.status(400).json({ error: 'addressLine, latitude, and longitude are required' });
    }
    if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
        return res.status(400).json({
            error: 'Invalid coordinates. Latitude must be between -90 and 90, longitude between -180 and 180.'
        });
    }
    const normalizedLat = roundCoordinate(lat);
    const normalizedLng = roundCoordinate(lng);

    try {
        const shopStatus = await fetchShopStatus(db);
        if (!shopStatus.isOrderable) {
            return res.status(403).json({ error: shopStatus.message, shopStatus });
        }

        const deliveryOptions = await fetchDeliveryOptions(db);
        if (!deliveryOptions.lalamoveEnabled) {
            return res.status(403).json({ error: 'Lalamove Delivery is unavailable for now' });
        }

        const quotation = await lalamoveService.createQuotation({
            dropoffAddress: addressLine,
            dropoffLat: normalizedLat,
            dropoffLng: normalizedLng,
            dropoffNote: note,
            scheduleAt: parsedSchedule.value || undefined,
            store: {
                name: shopStatus.storeName,
                phone: shopStatus.storePhone,
                address: shopStatus.storeAddress,
                latitude: shopStatus.storeLatitude,
                longitude: shopStatus.storeLongitude
            }
        });

        const quoteFee = toNumber(quotation.priceBreakdown?.total) || 0;
        const quoteCurrency = normalizeCurrencyCode(quotation.priceBreakdown?.currency, 'MYR');
        await reserveDeliveryQuote(db, {
            userId: req.user.id,
            quotationId: quotation.quotationId,
            fee: quoteFee,
            currency: quoteCurrency,
            expiresAt: quotation.expiresAt,
            scheduledAtUtc: parsedSchedule.value || null,
            stops: quotation.stops || [],
            metadata: {
                addressLine: String(addressLine || '').trim(),
                latitude: normalizedLat,
                longitude: normalizedLng,
                recipientName: String(recipientName || '').trim(),
                recipientPhone: String(recipientPhone || '').trim(),
                note: String(note || '').trim()
            }
        });

        return res.json({
            quotationId: quotation.quotationId,
            expiresAt: quotation.expiresAt,
            fee: quoteFee,
            currency: quoteCurrency,
            serviceType: quotation.serviceType,
            stops: quotation.stops || [],
            recipientName: recipientName || 'Customer',
            recipientPhone: recipientPhone || ''
        });
    } catch (error) {
        console.error('Lalamove quotation failed:', error?.payload || error?.message || error);
        return res.status(error.status || 500).json({
            error: error.message || 'Failed to fetch quotation',
            details: error.payload || null
        });
    }
});

app.get('/api/addresses', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const [rows] = await db.query(
            `
                SELECT id, name, address_line, phone, note, latitude, longitude
                FROM user_addresses
                WHERE user_id = ?
                ORDER BY id DESC
            `,
            [userId]
        );

        const formatted = rows.map((row) => ({
            id: String(row.id),
            name: row.name,
            addressLine: row.address_line,
            phone: row.phone || '',
            note: row.note || '',
            latitude: row.latitude !== null ? Number(row.latitude) : undefined,
            longitude: row.longitude !== null ? Number(row.longitude) : undefined
        }));

        return res.json(formatted);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to fetch addresses' });
    }
});

app.post('/api/addresses', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { name, addressLine, phone, note, latitude, longitude } = req.body || {};
        const trimmedPhone = String(phone || '').trim();

        if (!name || !addressLine || !trimmedPhone) {
            return res.status(400).json({ error: 'name, addressLine, and phone are required' });
        }
        const normalizedPhone = lalamoveService.normalizePhone(trimmedPhone);
        if (!lalamoveService.isValidPhone(normalizedPhone)) {
            return res.status(400).json({ error: 'Invalid phone number format. Use E.164, e.g. +60123456789' });
        }

        const lat = toNumber(latitude);
        const lng = toNumber(longitude);
        if (lat === null || lng === null) {
            return res.status(400).json({ error: 'latitude and longitude are required' });
        }
        if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
            return res.status(400).json({
                error: 'Invalid coordinates. Latitude must be between -90 and 90, longitude between -180 and 180.'
            });
        }
        const normalizedLat = roundCoordinate(lat);
        const normalizedLng = roundCoordinate(lng);

        const [result] = await db.query(
            `
                INSERT INTO user_addresses (user_id, name, address_line, phone, note, latitude, longitude)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            [userId, name, addressLine, normalizedPhone, note || '', normalizedLat, normalizedLng]
        );

        return res.status(201).json({
            id: String(result.insertId),
            name,
            addressLine,
            phone: normalizedPhone,
            note: note || '',
            latitude: normalizedLat === null ? undefined : normalizedLat,
            longitude: normalizedLng === null ? undefined : normalizedLng
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to create address' });
    }
});

app.put('/api/addresses/:id', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const addressId = toPositiveInteger(req.params.id);
        if (!addressId) {
            return res.status(400).json({ error: 'Invalid address id' });
        }

        const { name, addressLine, phone, note, latitude, longitude } = req.body || {};
        const fields = [];
        const values = [];

        if (name !== undefined) {
            fields.push('name = ?');
            values.push(name);
        }
        if (addressLine !== undefined) {
            fields.push('address_line = ?');
            values.push(addressLine);
        }
        if (phone !== undefined) {
            const trimmedPhone = String(phone || '').trim();
            if (!trimmedPhone) {
                return res.status(400).json({ error: 'phone is required' });
            }
            const normalizedPhone = lalamoveService.normalizePhone(trimmedPhone);
            if (!lalamoveService.isValidPhone(normalizedPhone)) {
                return res.status(400).json({ error: 'Invalid phone number format. Use E.164, e.g. +60123456789' });
            }
            fields.push('phone = ?');
            values.push(normalizedPhone);
        }
        if (note !== undefined) {
            fields.push('note = ?');
            values.push(note);
        }
        if (latitude !== undefined || longitude !== undefined) {
            if (latitude === undefined || longitude === undefined) {
                return res.status(400).json({ error: 'latitude and longitude must be updated together' });
            }
            const lat = toNumber(latitude);
            const lng = toNumber(longitude);
            if (lat === null || lng === null) {
                return res.status(400).json({ error: 'latitude and longitude must be valid numbers' });
            }
            if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
                return res.status(400).json({
                    error: 'Invalid coordinates. Latitude must be between -90 and 90, longitude between -180 and 180.'
                });
            }
            const normalizedLat = roundCoordinate(lat);
            const normalizedLng = roundCoordinate(lng);
            fields.push('latitude = ?');
            values.push(normalizedLat);
            fields.push('longitude = ?');
            values.push(normalizedLng);
        }

        if (fields.length === 0) {
            return res.json({ success: true });
        }

        values.push(addressId, userId);
        await db.query(
            `UPDATE user_addresses SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
            values
        );

        return res.json({ success: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to update address' });
    }
});

app.delete('/api/addresses/:id', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const addressId = toPositiveInteger(req.params.id);
        if (!addressId) {
            return res.status(400).json({ error: 'Invalid address id' });
        }

        await db.query('DELETE FROM user_addresses WHERE id = ? AND user_id = ?', [addressId, userId]);
        return res.json({ success: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to delete address' });
    }
});

// -- PUSH NOTIFICATIONS API --
app.get('/api/notifications/vapid-public-key', (req, res) => {
    res.send(process.env.VAPID_PUBLIC_KEY || '');
});

app.post('/api/notifications/subscribe', requireAuth, async (req, res) => {
    const userId = req.user.id;
    const { subscription } = req.body;
    if (!subscription || !subscription.endpoint || !subscription.keys) {
        return res.status(400).json({ error: 'Invalid subscription object' });
    }

    try {
        await db.query(`
            INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
                user_id = VALUES(user_id), 
                p256dh = VALUES(p256dh), 
                auth = VALUES(auth)
        `, [
            userId,
            subscription.endpoint,
            subscription.keys.p256dh,
            subscription.keys.auth
        ]);
        res.json({ success: true });
    } catch (err) {
        console.error('Failed to save push subscription:', err);
        res.status(500).json({ error: 'Failed to save subscription' });
    }
});

app.delete('/api/notifications/unsubscribe', requireAuth, async (req, res) => {
    const userId = req.user.id;
    const { endpoint } = req.body;
    if (!endpoint) {
        return res.status(400).json({ error: 'Endpoint required' });
    }

    try {
        await db.query('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', [userId, endpoint]);
        res.json({ success: true });
    } catch (err) {
        console.error('Failed to remove push subscription:', err);
        res.status(500).json({ error: 'Failed to remove subscription' });
    }
});

app.get('/api/cart', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const cart = await fetchCartForUser(userId);
        return res.json(cart);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to fetch cart' });
    }
});

app.post('/api/cart/items', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const menuItemId = toPositiveInteger(req.body?.menuItemId);
        const quantity = toPositiveInteger(req.body?.quantity || 1);

        if (!menuItemId || !quantity) {
            return res.status(400).json({ error: 'menuItemId and quantity are required' });
        }

        const shopStatus = await fetchShopStatus(db);
        if (!shopStatus.isOrderable) {
            return res.status(403).json({ error: shopStatus.message, shopStatus });
        }

        await syncCartWithStock(db, userId);

        const [menuRows] = await db.query(
            'SELECT id, stock, is_active FROM menu_items WHERE id = ? LIMIT 1',
            [menuItemId]
        );
        if (menuRows.length === 0) {
            return res.status(404).json({ error: 'Menu item not found' });
        }
        const menuItem = menuRows[0];
        const availableStock = Number(menuItem.stock || 0);
        if (!menuItem.is_active || availableStock <= 0) {
            return res.status(400).json({ error: 'This item is out of stock' });
        }

        const [existingRows] = await db.query(
            'SELECT quantity FROM cart_items WHERE user_id = ? AND menu_item_id = ? LIMIT 1',
            [userId, menuItemId]
        );
        const currentQuantity = existingRows.length ? Number(existingRows[0].quantity || 0) : 0;
        const nextQuantity = currentQuantity + quantity;
        if (nextQuantity > availableStock) {
            return res.status(400).json({
                error: `Only ${availableStock} stock left for this item`
            });
        }

        await db.query(
            `
                INSERT INTO cart_items (user_id, menu_item_id, quantity)
                VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)
            `,
            [userId, menuItemId, nextQuantity]
        );

        const cart = await fetchCartForUser(userId);
        return res.json(cart);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to add cart item' });
    }
});

app.put('/api/cart/items/:menuItemId', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const menuItemId = toPositiveInteger(req.params.menuItemId);
        const quantity = toNumber(req.body?.quantity);

        if (!menuItemId || quantity === null) {
            return res.status(400).json({ error: 'menuItemId and quantity are required' });
        }

        const shopStatus = await fetchShopStatus(db);
        if (!shopStatus.isOrderable) {
            return res.status(403).json({ error: shopStatus.message, shopStatus });
        }

        await syncCartWithStock(db, userId);

        if (quantity <= 0) {
            await db.query(
                'DELETE FROM cart_items WHERE user_id = ? AND menu_item_id = ?',
                [userId, menuItemId]
            );
        } else {
            const [menuRows] = await db.query(
                'SELECT id, stock, is_active FROM menu_items WHERE id = ? LIMIT 1',
                [menuItemId]
            );
            if (menuRows.length === 0) {
                return res.status(404).json({ error: 'Menu item not found' });
            }
            const menuItem = menuRows[0];
            const availableStock = Number(menuItem.stock || 0);
            if (!menuItem.is_active || availableStock <= 0) {
                return res.status(400).json({ error: 'This item is out of stock' });
            }
            const normalizedQuantity = Math.floor(quantity);
            if (normalizedQuantity <= 0) {
                await db.query(
                    'DELETE FROM cart_items WHERE user_id = ? AND menu_item_id = ?',
                    [userId, menuItemId]
                );
                const cart = await fetchCartForUser(userId);
                return res.json(cart);
            }
            if (normalizedQuantity > availableStock) {
                return res.status(400).json({
                    error: `Only ${availableStock} stock left for this item`
                });
            }

            await db.query(
                `
                    INSERT INTO cart_items (user_id, menu_item_id, quantity)
                    VALUES (?, ?, ?)
                    ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)
                `,
                [userId, menuItemId, normalizedQuantity]
            );
        }

        const cart = await fetchCartForUser(userId);
        return res.json(cart);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to update cart item' });
    }
});

app.delete('/api/cart/items/:menuItemId', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const menuItemId = toPositiveInteger(req.params.menuItemId);
        if (!menuItemId) {
            return res.status(400).json({ error: 'Invalid menuItemId' });
        }

        await db.query(
            'DELETE FROM cart_items WHERE user_id = ? AND menu_item_id = ?',
            [userId, menuItemId]
        );
        const cart = await fetchCartForUser(userId);
        return res.json(cart);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to delete cart item' });
    }
});

app.delete('/api/cart/clear', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        await db.query('DELETE FROM cart_items WHERE user_id = ?', [userId]);
        return res.json({ success: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to clear cart' });
    }
});

// --- 3. CATEGORY ROUTES ---
app.get('/api/categories', async (req, res) => {
    try {
        // Get categories with a count of active items
        const query = `
            SELECT c.*, COUNT(m.id) as itemCount 
            FROM categories c 
            LEFT JOIN menu_items m ON c.id = m.category_id 
            GROUP BY c.id 
            ORDER BY c.sort_order ASC
        `;
        const [rows] = await db.query(query);
        const formatted = rows.map(row => ({
            id: row.id.toString(),
            name: row.name,
            icon: row.icon,
            itemCount: row.itemCount || 0
        }));
        res.json(formatted);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/categories', requireAdmin, async (req, res) => {
    const { name, icon } = req.body;
    try {
        const [maxRes] = await db.query('SELECT MAX(sort_order) as maxOrder FROM categories');
        const nextOrder = (maxRes[0].maxOrder || 0) + 1;
        const [result] = await db.query(
            'INSERT INTO categories (name, icon, sort_order) VALUES (?, ?, ?)',
            [name, icon, nextOrder]
        );
        res.status(201).json({ id: result.insertId.toString(), name, icon, itemCount: 0 });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create' });
    }
});

app.put('/api/categories/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { name, icon } = req.body;
    try {
        if (name) await db.query('UPDATE categories SET name = ? WHERE id = ?', [name, id]);
        if (icon) await db.query('UPDATE categories SET icon = ? WHERE id = ?', [icon, id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update' });
    }
});

app.delete('/api/categories/:id', requireAdmin, async (req, res) => {
    try {
        await db.query('DELETE FROM categories WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete' });
    }
});

app.post('/api/categories/reorder', requireAdmin, async (req, res) => {
    const { categories } = req.body;
    if (!categories || !Array.isArray(categories)) return res.status(400).json({ error: 'Invalid data' });

    let connection = null;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        for (let i = 0; i < categories.length; i++) {
            await connection.query('UPDATE categories SET sort_order = ? WHERE id = ?', [i, categories[i].id]);
        }
        await connection.commit();
        res.json({ success: true });
    } catch (err) {
        if (connection) {
            await connection.rollback();
        }
        res.status(500).json({ error: 'Reorder failed' });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

// --- 4. MENU ITEM ROUTES ---

// GET All Menu Items (With Category Name joined)
app.get('/api/menu', async (req, res) => {
    try {
        const query = `
            SELECT m.*, c.name as category_name 
            FROM menu_items m
            LEFT JOIN categories c ON m.category_id = c.id
            ORDER BY COALESCE(c.sort_order, 2147483647) ASC, m.sort_order ASC, m.id ASC
        `;
        const [rows] = await db.query(query);

        const formatted = rows.map(row => ({
            id: row.id.toString(),
            name: row.name,
            description: row.description,
            price: parseFloat(row.price),
            image: row.image_url,
            category: row.category_name || 'Uncategorized',
            category_id: row.category_id ? row.category_id.toString() : null,
            sortOrder: Number(row.sort_order || 0),
            stock: row.stock,
            isActive: Boolean(row.is_active)
        }));

        res.json(formatted);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch menu' });
    }
});

// UPLOAD Image to Cloudflare R2
app.post('/api/admin/upload', requireAdmin, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        if (!r2Service.isR2Configured()) {
            return res.status(503).json({ error: 'Cloudflare R2 storage is not configured' });
        }

        const fileUrl = await r2Service.uploadFile(
            req.file.buffer,
            req.file.originalname,
            req.file.mimetype
        );

        res.json({ success: true, url: fileUrl });
    } catch (err) {
        console.error('[Upload] Failed to upload file:', err);
        res.status(500).json({ error: err.message || 'Failed to upload file to Cloudflare R2' });
    }
});

// CREATE Menu Item
app.post('/api/menu', requireAdmin, async (req, res) => {
    const { name, description, price, image, category_id, stock } = req.body;
    try {
        const normalizedCategoryId =
            category_id === undefined || category_id === null || category_id === ''
                ? null
                : toPositiveInteger(category_id);
        if (category_id !== undefined && category_id !== null && category_id !== '' && normalizedCategoryId === null) {
            return res.status(400).json({ error: 'Invalid category_id' });
        }

        const [maxRes] = await db.query(
            `
                SELECT COALESCE(MAX(sort_order), -1) AS maxSortOrder
                FROM menu_items
                WHERE ((category_id IS NULL AND ? IS NULL) OR category_id = ?)
            `,
            [normalizedCategoryId, normalizedCategoryId]
        );
        const nextSortOrder = Number(maxRes[0]?.maxSortOrder ?? -1) + 1;

        const [result] = await db.query(
            `INSERT INTO menu_items (name, description, price, image_url, category_id, stock, sort_order) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [name, description, price, image, normalizedCategoryId, stock || 100, nextSortOrder]
        );
        res.status(201).json({ success: true, id: result.insertId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create menu item' });
    }
});

// UPDATE Menu Item
app.put('/api/menu/:id', requireAdmin, async (req, res) => {
    const menuItemId = toPositiveInteger(req.params.id);
    const { name, description, price, image, category_id, stock, isActive } = req.body;
    if (!menuItemId) {
        return res.status(400).json({ error: 'Invalid menu item id' });
    }
    try {
        // Build dynamic query based on fields provided
        let fields = [];
        let values = [];

        const normalizedCategoryId =
            category_id === undefined
                ? undefined
                : category_id === null || category_id === ''
                    ? null
                    : toPositiveInteger(category_id);
        if (category_id !== undefined && category_id !== null && category_id !== '' && normalizedCategoryId === null) {
            return res.status(400).json({ error: 'Invalid category_id' });
        }

        let resolvedSortOrder;
        const rawSortOrder = req.body?.sortOrder ?? req.body?.sort_order;
        if (rawSortOrder !== undefined) {
            const parsedSortOrder = toNumber(rawSortOrder);
            if (parsedSortOrder === null) {
                return res.status(400).json({ error: 'Invalid sort order' });
            }
            resolvedSortOrder = Math.max(0, Math.floor(parsedSortOrder));
        }

        const [existingRows] = await db.query(
            'SELECT category_id, image_url FROM menu_items WHERE id = ? LIMIT 1',
            [menuItemId]
        );
        if (existingRows.length === 0) {
            return res.status(404).json({ error: 'Menu item not found' });
        }
        const existingCategoryId =
            existingRows[0].category_id === null ? null : Number(existingRows[0].category_id);
        const existingImage = existingRows[0].image_url;

        // If the image is changed, delete the old one from R2
        if (image !== undefined && image !== existingImage && existingImage) {
            r2Service.deleteFile(existingImage).catch((err) => {
                console.error('[Upload] Failed to delete previous image from R2 on update:', err);
            });
        }

        if (normalizedCategoryId !== undefined) {
            const categoryChanged = existingCategoryId !== normalizedCategoryId;

            if (categoryChanged && resolvedSortOrder === undefined) {
                const [maxRes] = await db.query(
                    `
                        SELECT COALESCE(MAX(sort_order), -1) AS maxSortOrder
                        FROM menu_items
                        WHERE ((category_id IS NULL AND ? IS NULL) OR category_id = ?)
                    `,
                    [normalizedCategoryId, normalizedCategoryId]
                );
                resolvedSortOrder = Number(maxRes[0]?.maxSortOrder ?? -1) + 1;
            }
        }

        if (name !== undefined) { fields.push('name = ?'); values.push(name); }
        if (description !== undefined) { fields.push('description = ?'); values.push(description); }
        if (price !== undefined) { fields.push('price = ?'); values.push(price); }
        if (image !== undefined) { fields.push('image_url = ?'); values.push(image); }
        if (normalizedCategoryId !== undefined) { fields.push('category_id = ?'); values.push(normalizedCategoryId); }
        if (resolvedSortOrder !== undefined) { fields.push('sort_order = ?'); values.push(resolvedSortOrder); }
        if (stock !== undefined) { fields.push('stock = ?'); values.push(stock); }
        if (isActive !== undefined) { fields.push('is_active = ?'); values.push(isActive); }

        if (fields.length === 0) return res.json({ success: true }); // Nothing to update

        values.push(menuItemId);
        const query = `UPDATE menu_items SET ${fields.join(', ')} WHERE id = ?`;

        await db.query(query, values);
        if (stock !== undefined || isActive !== undefined) {
            await syncCartWithStock(db);
        }
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update item' });
    }
});

// DELETE Menu Item
app.delete('/api/menu/:id', requireAdmin, async (req, res) => {
    try {
        const menuItemId = toPositiveInteger(req.params.id);
        if (!menuItemId) {
            return res.status(400).json({ error: 'Invalid menu item id' });
        }

        // Fetch the existing item to get the image URL
        const [existing] = await db.query('SELECT image_url FROM menu_items WHERE id = ? LIMIT 1', [menuItemId]);
        if (existing.length > 0 && existing[0].image_url) {
            // Delete from R2 (non-blocking)
            r2Service.deleteFile(existing[0].image_url).catch((err) => {
                console.error('[Upload] Failed to delete image from R2 on product delete:', err);
            });
        }

        await db.query('DELETE FROM menu_items WHERE id = ?', [menuItemId]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete item' });
    }
});

app.post('/api/menu/reorder', requireAdmin, async (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items) {
        return res.status(400).json({ error: 'Invalid data' });
    }

    const normalizedItems = [];
    for (const item of items) {
        const id = toPositiveInteger(item?.id);
        const rawCategoryId = item?.category_id;
        const categoryId =
            rawCategoryId === undefined || rawCategoryId === null || rawCategoryId === ''
                ? null
                : toPositiveInteger(rawCategoryId);
        if (!id || (rawCategoryId !== undefined && rawCategoryId !== null && rawCategoryId !== '' && categoryId === null)) {
            return res.status(400).json({ error: 'Invalid menu reorder payload' });
        }
        normalizedItems.push({ id, categoryId });
    }

    let connection = null;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        const nextOrderByCategory = new Map();
        for (const item of normalizedItems) {
            const categoryKey = item.categoryId === null ? 'null' : String(item.categoryId);
            const nextOrder = nextOrderByCategory.get(categoryKey) || 0;
            await connection.query(
                'UPDATE menu_items SET sort_order = ?, category_id = ? WHERE id = ?',
                [nextOrder, item.categoryId, item.id]
            );
            nextOrderByCategory.set(categoryKey, nextOrder + 1);
        }

        await connection.commit();
        return res.json({ success: true });
    } catch (err) {
        if (connection) {
            await connection.rollback();
        }
        console.error(err);
        return res.status(500).json({ error: 'Reorder failed' });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

// --- 5. ORDER ROUTES ---

const fetchOrderSummariesByOrderIds = async (orderIds, executor = db) => {
    if (!Array.isArray(orderIds) || orderIds.length === 0) return new Map();
    const normalizedIds = orderIds
        .map((id) => toPositiveInteger(id))
        .filter((id) => id !== null);
    if (!normalizedIds.length) return new Map();

    const [summaryRows] = await executor.query(
        `
            SELECT
                oi.order_id,
                GROUP_CONCAT(
                    CONCAT(
                        oi.quantity,
                        'x ',
                        COALESCE(NULLIF(TRIM(oi.item_name_snapshot), ''), m.name, CONCAT('Menu Item #', oi.menu_item_id))
                    )
                    ORDER BY oi.id
                    SEPARATOR ', '
                ) AS items_summary
            FROM order_items oi
            LEFT JOIN menu_items m ON oi.menu_item_id = m.id
            WHERE oi.order_id IN (?)
            GROUP BY oi.order_id
        `,
        [normalizedIds]
    );

    const summaryMap = new Map();
    for (const row of summaryRows) {
        const orderId = toPositiveInteger(row.order_id);
        if (!orderId) continue;
        summaryMap.set(orderId, String(row.items_summary || '').trim());
    }
    return summaryMap;
};

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
    try {
        const limit = parsePositiveIntWithBounds(req.query?.limit, {
            fallback: ADMIN_ORDERS_DEFAULT_LIMIT,
            min: 1,
            max: ADMIN_ORDERS_MAX_LIMIT
        });
        const statusFilter = normalizeAdminOrderStatus(req.query?.status);
        const refundStatusFilter = normalizeAdminRefundStatusFilter(req.query?.refundStatus);
        const deliveryTimingFilter = normalizeAdminDeliveryTiming(req.query?.deliveryTiming);
        const searchQuery = normalizeAdminSearchQuery(req.query?.q);
        const cursor = decodeAdminOrdersCursor(req.query?.cursor);

        const whereConditions = [];
        const queryParams = [];

        if (statusFilter) {
            whereConditions.push('o.status = ?');
            queryParams.push(statusFilter);
        }
        if (refundStatusFilter) {
            whereConditions.push('o.refund_status = ?');
            queryParams.push(refundStatusFilter);
        }
        if (deliveryTimingFilter) {
            whereConditions.push('o.delivery_timing = ?');
            queryParams.push(deliveryTimingFilter);
        }
        if (searchQuery) {
            const likeSearch = `%${searchQuery}%`;
            const numericSearch = searchQuery.replace(/\D+/g, '');
            const idFromSearch = toPositiveInteger(numericSearch);
            whereConditions.push(
                `(
                    ${idFromSearch ? 'o.id = ? OR' : ''}
                    LOWER(COALESCE(o.short_code, '')) LIKE ?
                    OR LOWER(COALESCE(u.name, '')) LIKE ?
                    OR LOWER(COALESCE(o.delivery_contact_phone, '')) LIKE ?
                    OR LOWER(COALESCE(u.phone_number, '')) LIKE ?
                    OR EXISTS (
                        SELECT 1
                        FROM order_items soi
                        LEFT JOIN menu_items sm ON sm.id = soi.menu_item_id
                        WHERE soi.order_id = o.id
                          AND LOWER(COALESCE(NULLIF(TRIM(soi.item_name_snapshot), ''), sm.name, '')) LIKE ?
                    )
                )`
            );
            if (idFromSearch) queryParams.push(idFromSearch);
            queryParams.push(likeSearch, likeSearch, likeSearch, likeSearch, likeSearch);
        }
        if (cursor) {
            whereConditions.push('(o.created_at < ? OR (o.created_at = ? AND o.id < ?))');
            queryParams.push(cursor.createdAtSql, cursor.createdAtSql, cursor.id);
        }
 
        const whereClause = whereConditions.length ? `WHERE ${whereConditions.join(' AND ')}` : '';
        const queryLimit = Math.max(1, Number(limit || ADMIN_ORDERS_DEFAULT_LIMIT));
 
        const [orderRows] = await db.query(
            `
                SELECT
                    o.id,
                    o.short_code,
                    o.status,
                    o.total_amount,
                    o.created_at,
                    DATE_FORMAT(o.created_at, '%Y-%m-%d %H:%i:%s') AS created_at_cursor,
                    DATE_FORMAT(o.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at_utc_iso,
                    DATE_FORMAT(o.updated_at, '%Y-%m-%dT%H:%i:%sZ') AS updated_at_utc_iso,
                    o.order_type,
                    o.delivery_address,
                    o.delivery_provider,
                    o.external_order_id,
                    o.quotation_id,
                    o.tracking_url,
                    o.driver_id,
                    o.lalamove_status,
                    o.payment_method,
                    o.refund_status,
                    o.refund_amount,
                    o.refund_id,
                    o.refund_speed_requested,
                    o.refund_speed_processed,
                    DATE_FORMAT(o.refund_requested_at, '%Y-%m-%dT%H:%i:%sZ') AS refund_requested_at_utc,
                    DATE_FORMAT(o.refund_processed_at, '%Y-%m-%dT%H:%i:%sZ') AS refund_processed_at_utc,
                    DATE_FORMAT(o.refund_failed_at, '%Y-%m-%dT%H:%i:%sZ') AS refund_failed_at_utc,
                    o.refund_failure_reason,
                    o.refund_reason,
                    o.delivery_fee,
                    o.delivery_currency,
                    o.delivery_timing,
                    DATE_FORMAT(o.scheduled_at_utc, '%Y-%m-%dT%H:%i:%sZ') AS scheduled_at_utc_iso,
                    DATE_FORMAT(o.lalamove_ongoing_at, '%Y-%m-%dT%H:%i:%sZ') AS lalamove_ongoing_at_utc,
                    o.delivery_contact_phone,
                    o.delivery_label_snapshot,
                    o.delivery_note_snapshot,
                    o.delivery_latitude,
                    o.delivery_longitude,
                    o.recipient_name_snapshot,
                    u.name AS customer_name,
                    u.avatar_url,
                    u.phone_number AS account_phone
                FROM orders o
                LEFT JOIN users u ON o.user_id = u.id
                ${whereClause}
                ORDER BY o.created_at DESC, o.id DESC
                LIMIT ?
            `,
            [...queryParams, queryLimit + 1]
        );

        const hasMore = orderRows.length > queryLimit;
        const pageRows = hasMore ? orderRows.slice(0, queryLimit) : orderRows;
        const nextRow = hasMore ? pageRows[pageRows.length - 1] : null;

        const summaryMap = await fetchOrderSummariesByOrderIds(
            pageRows.map((row) => row.id),
            db
        );

        const formattedItems = pageRows.map((row) =>
            formatOrderRowForClient({
                ...row,
                items_summary: summaryMap.get(toPositiveInteger(row.id)) || ''
            })
        );
        const latestUpdatedAtUtc = formattedItems.reduce((latest, item) => {
            const candidate = toIsoUtcString(item.updatedAtUtc || item.createdAtUtc);
            if (!candidate) return latest;
            if (!latest) return candidate;
            return new Date(candidate).getTime() > new Date(latest).getTime() ? candidate : latest;
        }, null);

        return res.json({
            items: formattedItems,
            hasMore,
            nextCursor: nextRow
                ? encodeAdminOrdersCursor({
                    createdAtSql: nextRow.created_at_cursor || nextRow.created_at,
                    id: nextRow.id
                })
                : null,
            pageSize: queryLimit,
            latestUpdatedAtUtc,
            serverTimeUtc: new Date().toISOString()
        });
    } catch (error) {
        console.error('Failed to fetch admin orders:', error);
        return res.status(500).json({ error: 'Failed to fetch admin orders' });
    }
});

app.get('/api/admin/orders/sync', requireAdmin, async (req, res) => {
    try {
        const since = toIsoUtcString(req.query?.since);
        const limit = parsePositiveIntWithBounds(req.query?.limit, {
            fallback: ADMIN_ORDER_SYNC_DEFAULT_LIMIT,
            min: 1,
            max: ADMIN_ORDER_SYNC_MAX_LIMIT
        });
        if (!since) {
            return res.json({
                changedOrderIds: [],
                hasMore: false,
                latestUpdatedAtUtc: null,
                serverTimeUtc: new Date().toISOString()
            });
        }

        const [rows] = await db.query(
            `
                SELECT
                    id,
                    DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%sZ') AS updated_at_utc_iso
                FROM orders
                WHERE updated_at > ?
                ORDER BY updated_at DESC, id DESC
                LIMIT ?
            `,
            [new Date(since), limit + 1]
        );

        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const changedOrderIds = pageRows
            .map((row) => toPositiveInteger(row.id))
            .filter((id) => id !== null)
            .map((id) => String(id));
        const latestUpdatedAtUtc = pageRows.reduce((latest, row) => {
            const candidate = toIsoUtcString(row.updated_at_utc_iso);
            if (!candidate) return latest;
            if (!latest) return candidate;
            return new Date(candidate).getTime() > new Date(latest).getTime() ? candidate : latest;
        }, since);

        return res.json({
            changedOrderIds,
            hasMore,
            latestUpdatedAtUtc,
            serverTimeUtc: new Date().toISOString()
        });
    } catch (error) {
        console.error('Failed to sync admin orders:', error);
        return res.status(500).json({ error: 'Failed to sync admin orders' });
    }
});

app.post('/api/admin/orders/stream-token', requireAdmin, async (req, res) => {
    try {
        const token = signAdminStreamToken(req.user);
        return res.json({
            token,
            expiresInSeconds: ADMIN_ORDER_STREAM_TOKEN_TTL_SECONDS
        });
    } catch (error) {
        console.error('Failed to issue admin stream token:', error);
        return res.status(500).json({ error: 'Failed to issue admin stream token' });
    }
});

app.get('/api/admin/orders/stream', requireAdminStreamToken, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
    }

    const writeEvent = (eventName, payload) => {
        res.write(`event: ${eventName}\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    res.write(`retry: ${ADMIN_ORDER_EVENTS_RETRY_MS}\n\n`);
    writeEvent('connected', {
        ok: true,
        emittedAtUtc: new Date().toISOString()
    });

    const onOrdersChanged = (payload) => {
        writeEvent('orders_changed', payload);
    };
    orderEvents.on('orders_changed', onOrdersChanged);

    const heartbeatTimer = setInterval(() => {
        writeEvent('ping', { emittedAtUtc: new Date().toISOString() });
    }, ADMIN_ORDER_EVENTS_HEARTBEAT_MS);
    const streamExpiryMs =
        Number.isFinite(Number(req.adminStreamTokenExpMs)) && Number(req.adminStreamTokenExpMs) > 0
            ? Number(req.adminStreamTokenExpMs) - Date.now()
            : null;
    const expiryTimer =
        streamExpiryMs !== null && streamExpiryMs > 0
            ? setTimeout(() => {
                writeEvent('session_expired', { emittedAtUtc: new Date().toISOString() });
                res.end();
            }, streamExpiryMs + 250)
            : null;

    req.on('close', () => {
        clearInterval(heartbeatTimer);
        if (expiryTimer) {
            clearTimeout(expiryTimer);
        }
        orderEvents.off('orders_changed', onOrdersChanged);
    });
});

app.get('/api/orders', attachAuthIfPresent, async (req, res) => {
    try {
        const mineOnly = String(req.query?.mine || '') === '1';
        if (mineOnly && !req.user?.id) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        if (mineOnly && req.user?.isSuspended && req.user?.role !== 'admin') {
            return res.status(403).json({ error: 'Your account is suspended. Please contact support.' });
        }
        if (!mineOnly) {
            if (!req.user?.id) {
                return res.status(401).json({ error: 'Authentication required' });
            }
            if (req.user.role !== 'admin') {
                return res.status(403).json({ error: 'Admin access required' });
            }
        }

        const shouldFilterByUser = mineOnly;
        const hasMinePaginationQuery =
            shouldFilterByUser && (req.query?.limit !== undefined || req.query?.cursor !== undefined);
        const shouldPaginateMine = shouldFilterByUser;
        const queryLimit = shouldPaginateMine
            ? parsePositiveIntWithBounds(req.query?.limit, {
                fallback: USER_ORDERS_DEFAULT_LIMIT,
                min: 1,
                max: USER_ORDERS_MAX_LIMIT
            })
            : null;
        const cursor = shouldFilterByUser ? decodeAdminOrdersCursor(req.query?.cursor) : null;

        const whereConditions = [];
        const params = [];
        if (shouldFilterByUser) {
            whereConditions.push('o.user_id = ?');
            params.push(req.user.id);
        }
        if (cursor) {
            whereConditions.push('(o.created_at < ? OR (o.created_at = ? AND o.id < ?))');
            params.push(cursor.createdAtSql, cursor.createdAtSql, cursor.id);
        }
        const whereClause = whereConditions.length ? `WHERE ${whereConditions.join(' AND ')}` : '';

        // Fetch orders with user info
        const [orders] = await db.query(
            `
                SELECT 
                    o.id,
                    o.short_code,
                    o.status,
                    o.total_amount,
                    o.created_at,
                    DATE_FORMAT(o.created_at, '%Y-%m-%d %H:%i:%s') AS created_at_cursor,
                    DATE_FORMAT(o.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at_utc_iso,
                    DATE_FORMAT(o.updated_at, '%Y-%m-%dT%H:%i:%sZ') AS updated_at_utc_iso,
                    o.order_type,
                    o.delivery_address,
                    o.delivery_provider,
                    o.external_order_id,
                    o.quotation_id,
                    o.tracking_url,
                    o.driver_id,
                    o.lalamove_status,
                    o.payment_method,
                    o.refund_status,
                    o.refund_amount,
                    o.refund_id,
                    o.refund_speed_requested,
                    o.refund_speed_processed,
                    DATE_FORMAT(o.refund_requested_at, '%Y-%m-%dT%H:%i:%sZ') AS refund_requested_at_utc,
                    DATE_FORMAT(o.refund_processed_at, '%Y-%m-%dT%H:%i:%sZ') AS refund_processed_at_utc,
                    DATE_FORMAT(o.refund_failed_at, '%Y-%m-%dT%H:%i:%sZ') AS refund_failed_at_utc,
                    o.refund_failure_reason,
                    o.refund_reason,
                    o.delivery_fee,
                    o.delivery_currency,
                    o.delivery_timing,
                    DATE_FORMAT(o.scheduled_at_utc, '%Y-%m-%dT%H:%i:%sZ') AS scheduled_at_utc_iso,
                    DATE_FORMAT(o.lalamove_ongoing_at, '%Y-%m-%dT%H:%i:%sZ') AS lalamove_ongoing_at_utc,
                    o.delivery_contact_phone,
                    o.delivery_label_snapshot,
                    o.delivery_note_snapshot,
                    o.delivery_latitude,
                    o.delivery_longitude,
                    o.recipient_name_snapshot,
                    u.name as customer_name,
                    u.avatar_url,
                    u.phone_number AS account_phone
                FROM orders o
                LEFT JOIN users u ON o.user_id = u.id
                ${whereClause}
                ORDER BY o.created_at DESC, o.id DESC
                ${shouldPaginateMine ? 'LIMIT ?' : ''}
            `,
            shouldPaginateMine ? [...params, queryLimit + 1] : params
        );

        const hasMore = shouldPaginateMine ? orders.length > queryLimit : false;
        const pageRows = shouldPaginateMine ? orders.slice(0, queryLimit) : orders;
        const nextRow = shouldPaginateMine && hasMore ? pageRows[pageRows.length - 1] : null;

        const summaryMap = await fetchOrderSummariesByOrderIds(
            pageRows.map((row) => row.id),
            db
        );
        for (const order of pageRows) {
            order.itemsSummary = summaryMap.get(toPositiveInteger(order.id)) || '';
        }

        // Format response to match frontend types
        const formatted = pageRows.map((o) => {
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
                id: o.id.toString(),
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
                itemsSummary: o.itemsSummary,
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
                paymentMethod: o.payment_method || 'DuitNow',
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
                ...cancelState
            };
        });

        if (shouldFilterByUser && hasMinePaginationQuery) {
            const latestUpdatedAtUtc = formatted.reduce((latest, item) => {
                const candidate = toIsoUtcString(item.updatedAtUtc || item.createdAtUtc);
                if (!candidate) return latest;
                if (!latest) return candidate;
                return new Date(candidate).getTime() > new Date(latest).getTime() ? candidate : latest;
            }, null);

            return res.json({
                items: formatted,
                hasMore,
                nextCursor: nextRow
                    ? encodeAdminOrdersCursor({
                        createdAtSql: nextRow.created_at_cursor || nextRow.created_at,
                        id: nextRow.id
                    })
                    : null,
                pageSize: queryLimit,
                latestUpdatedAtUtc,
                serverTimeUtc: new Date().toISOString()
            });
        }

        if (shouldFilterByUser) {
            return res.json(formatted);
        }

        res.json(formatted);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

app.post('/api/orders', requireAuth, async (req, res) => {
    const {
        total,
        items,
        orderType,
        address,
        addressSnapshot,
        quotationId,
        recipient,
        paymentMethod,
        curlecPayment,
        curlecCheckoutSessionId,
        deliveryTiming,
        scheduledAtUtc
    } = req.body;

    const normalizedOrderType = orderType === 'Pickup' ? 'Pickup' : 'Delivery';
    const normalizedPaymentMethod = normalizePaymentMethod(paymentMethod);
    const normalizedCurlecCheckoutSessionId = normalizeCurlecCheckoutSessionId(curlecCheckoutSessionId);
    const stopOrderCreateTimer = startOrderCreateTimer({
        paymentMethod: normalizedPaymentMethod,
        orderType: normalizedOrderType
    });
    let orderCreateMetricsCompleted = false;
    let orderCreateDeliveryBookingStatus = 'na';
    const finalizeOrderCreateMetrics = (statusLabel) => {
        if (orderCreateMetricsCompleted) return;
        orderCreateMetricsCompleted = true;
        stopOrderCreateTimer({ status: statusLabel });
        recordOrderCreateEvent({
            status: statusLabel,
            paymentMethod: normalizedPaymentMethod,
            orderType: normalizedOrderType,
            deliveryBookingStatus: orderCreateDeliveryBookingStatus
        });
    };
    res.on('finish', () => {
        if (orderCreateMetricsCompleted) return;
        if (res.statusCode >= 200 && res.statusCode < 300) {
            finalizeOrderCreateMetrics('success');
            return;
        }
        if (res.statusCode >= 400 && res.statusCode < 500) {
            finalizeOrderCreateMetrics('client_error');
            return;
        }
        finalizeOrderCreateMetrics('server_error');
    });

    const submittedTotal = toNumber(total);
    if (submittedTotal === null || submittedTotal <= 0) {
        return res.status(400).json({ error: 'Invalid total amount' });
    }
    const isLalamoveDelivery = normalizedOrderType === 'Delivery';
    const normalizedDeliveryTiming =
        isLalamoveDelivery && String(deliveryTiming || ORDER_DELIVERY_TIMING_NOW).toUpperCase() === ORDER_DELIVERY_TIMING_SCHEDULED
            ? ORDER_DELIVERY_TIMING_SCHEDULED
            : ORDER_DELIVERY_TIMING_NOW;
    const parsedSchedule = parseScheduledAtUtc(scheduledAtUtc, {
        required: normalizedDeliveryTiming === ORDER_DELIVERY_TIMING_SCHEDULED
    });
    if (parsedSchedule.error) {
        return res.status(400).json({ error: parsedSchedule.error });
    }
    const scheduledAtSql = parsedSchedule.value ? toSqlDateTimeUtc(parsedSchedule.value) : null;
    const initialStatus = 'Preparing';
    const resolvedUserId = req.user.id;
    const orderItems = Array.isArray(items) ? items : [];

    if (orderItems.length === 0) {
        return res.status(400).json({ error: 'Order must contain at least one item' });
    }

    const requestedQuantityById = new Map();
    for (const item of orderItems) {
        const menuItemId = toPositiveInteger(item?.id);
        const quantity = toPositiveInteger(item?.quantity);
        if (!menuItemId || !quantity) {
            return res.status(400).json({ error: 'Invalid order item payload' });
        }
        requestedQuantityById.set(menuItemId, (requestedQuantityById.get(menuItemId) || 0) + quantity);
    }

    let curlecPaymentProof = null;
    let paymentAmountInMinorUnits = null;
    let paymentOptions = null;
    try {
        paymentOptions = await fetchPaymentOptions(db);

        if (normalizedPaymentMethod === PAYMENT_METHOD_DUITNOW && !paymentOptions.duitnowEnabled) {
            return res.status(403).json({ error: 'DuitNow payment is currently unavailable' });
        }

        if (normalizedPaymentMethod === PAYMENT_METHOD_CURLEC) {
            if (!paymentOptions.curlecEnabled) {
                return res.status(403).json({ error: 'Curlec payment is currently unavailable' });
            }
            if (!paymentOptions.curlecConfigured) {
                return res.status(503).json({ error: 'Curlec payment is not configured on server' });
            }

            const normalizedCurlecPayment = normalizeCurlecPaymentPayload(curlecPayment);
            if (normalizedCurlecPayment.error) {
                return res.status(400).json({ error: normalizedCurlecPayment.error });
            }
            curlecPaymentProof = normalizedCurlecPayment.value;

            if (!verifyCurlecPaymentSignature(curlecPaymentProof)) {
                return res.status(400).json({ error: 'Invalid Curlec payment signature' });
            }

            const paymentDetails = await callCurlecApi({
                endpoint: `/payments/${encodeURIComponent(curlecPaymentProof.paymentId)}`
            });
            if (String(paymentDetails.order_id || '') !== curlecPaymentProof.orderId) {
                return res.status(400).json({ error: 'Curlec payment does not match the checkout order' });
            }
            const paymentStatus = String(paymentDetails.status || '').toLowerCase();
            if (!['captured', 'authorized'].includes(paymentStatus)) {
                return res.status(400).json({ error: 'Curlec payment is not completed' });
            }

            paymentAmountInMinorUnits = toPositiveInteger(paymentDetails.amount);
            if (!paymentAmountInMinorUnits) {
                return res.status(400).json({ error: 'Unable to validate Curlec payment amount' });
            }
        }
    } catch (paymentError) {
        console.error('Payment validation failed:', paymentError);
        return res.status(paymentError.status || 500).json({
            error: paymentError.message || 'Payment validation failed',
            details: paymentError.payload || null
        });
    }

    let shopStatusAtOrder = null;
    try {
        shopStatusAtOrder = await fetchShopStatus(db);
        if (!shopStatusAtOrder.isOrderable) {
            return res.status(403).json({ error: shopStatusAtOrder.message, shopStatus: shopStatusAtOrder });
        }
    } catch (statusError) {
        console.error('Failed to check shop status before order:', statusError);
        return res.status(500).json({ error: 'Failed to validate shop availability' });
    }

    let connection = null;
    let hasTransaction = false;
    let orderId = null;
    let orderCode = null;
    let normalizedItems = [];
    let deliveryQuoteReservation = null;
    let totalAmountMinorUnits = 0;
    let persistedDeliveryFee = null;
    let persistedDeliveryCurrency = null;
    let persistedDeliveryAddress = '';
    let persistedDeliveryLatitude = null;
    let persistedDeliveryLongitude = null;
    let persistedRecipientName = '';
    let persistedRecipientRemarks = '';
    let persistedDeliveryContactPhone = '';
    let persistedUserDisplayName = 'Customer';
    let curlecSessionReservation = null;
    try {
        connection = await db.getConnection();
        const [userRows] = await connection.query(
            'SELECT name, phone_number FROM users WHERE id = ? LIMIT 1',
            [resolvedUserId]
        );
        const profileName = String(userRows[0]?.name || '').trim();
        const profilePhone = String(userRows[0]?.phone_number || '').trim();
        const snapshotLabel = String(addressSnapshot?.label || '').trim();
        const snapshotAddressLine = String(addressSnapshot?.addressLine || address || '').trim();
        const snapshotNote = String(addressSnapshot?.note || recipient?.remarks || '').trim();
        const rawSnapshotLatitude = toNumber(addressSnapshot?.latitude);
        const rawSnapshotLongitude = toNumber(addressSnapshot?.longitude);
        const snapshotLatitude = isValidLatitude(rawSnapshotLatitude) ? roundCoordinate(rawSnapshotLatitude) : null;
        const snapshotLongitude = isValidLongitude(rawSnapshotLongitude) ? roundCoordinate(rawSnapshotLongitude) : null;
        const snapshotRecipientName =
            String(recipient?.name || '').trim() || profileName || 'Customer';
        persistedUserDisplayName = profileName || snapshotRecipientName || 'Customer';
        persistedDeliveryLatitude = snapshotLatitude;
        persistedDeliveryLongitude = snapshotLongitude;
        let deliveryContactPhone = normalizedOrderType === 'Pickup' ? profilePhone : '';
        if (!profilePhone) {
            return res.status(400).json({
                error: 'Phone number is required in your profile before placing an order'
            });
        }

        const deliveryOptions = await fetchDeliveryOptions(connection);
        if (normalizedOrderType === 'Pickup' && !deliveryOptions.pickupEnabled) {
            const error = new Error('Store Pickup is unavailable for now');
            error.status = 403;
            throw error;
        }
        if (normalizedOrderType === 'Delivery' && !deliveryOptions.lalamoveEnabled) {
            const error = new Error('Lalamove Delivery is unavailable for now');
            error.status = 403;
            throw error;
        }

        await connection.beginTransaction();
        hasTransaction = true;

        if (normalizedPaymentMethod === PAYMENT_METHOD_CURLEC && curlecPaymentProof?.paymentId) {
            if (normalizedCurlecCheckoutSessionId) {
                curlecSessionReservation = await reserveCurlecCheckoutSessionForFinalize(connection, {
                    sessionId: normalizedCurlecCheckoutSessionId,
                    userId: resolvedUserId,
                    curlecOrderId: curlecPaymentProof.orderId,
                    paymentId: curlecPaymentProof.paymentId,
                    expectedAmountMinor: paymentAmountInMinorUnits
                });
                if (curlecSessionReservation?.alreadyConsumed && curlecSessionReservation?.consumedOrderId) {
                    const error = new Error('This Curlec checkout session has already been finalized');
                    error.status = 409;
                    error.code = 'CURLEC_CHECKOUT_ALREADY_CONSUMED';
                    error.existingOrderId = curlecSessionReservation.consumedOrderId;
                    throw error;
                }
            }

            const [existingPaymentRows] = await connection.query(
                `
                    SELECT id
                    FROM orders
                    WHERE curlec_payment_id = ?
                    LIMIT 1
                    FOR UPDATE
                `,
                [curlecPaymentProof.paymentId]
            );
            if (existingPaymentRows.length > 0) {
                const error = new Error('This Curlec payment has already been used for an order');
                error.status = 409;
                error.code = 'CURLEC_PAYMENT_ALREADY_USED';
                error.existingOrderId = toPositiveInteger(existingPaymentRows[0].id);
                throw error;
            }
        }

        const menuItemIds = Array.from(requestedQuantityById.keys());
        const [menuRows] = await connection.query(
            `
                SELECT id, name, stock, is_active, price
                FROM menu_items
                WHERE id IN (?)
                FOR UPDATE
            `,
            [menuItemIds]
        );
        const menuById = new Map(menuRows.map((row) => [Number(row.id), row]));
        let subtotalMinorUnits = 0;
        normalizedItems = [];

        for (const [menuItemId, requestedQuantity] of requestedQuantityById.entries()) {
            const row = menuById.get(menuItemId);
            if (!row) {
                const error = new Error(`Menu item ${menuItemId} not found`);
                error.status = 404;
                throw error;
            }
            const availableStock = Number(row.stock || 0);
            const isActive = Boolean(row.is_active);
            if (!isActive || availableStock <= 0) {
                const error = new Error(`${row.name} is out of stock`);
                error.status = 400;
                throw error;
            }
            if (requestedQuantity > availableStock) {
                const error = new Error(`${row.name} only has ${availableStock} in stock`);
                error.status = 400;
                throw error;
            }

            const unitPriceMinorUnits = toMinorUnitsAllowZero(row.price);
            if (unitPriceMinorUnits === null) {
                const error = new Error(`Invalid price for menu item ${row.name}`);
                error.status = 500;
                throw error;
            }

            subtotalMinorUnits += unitPriceMinorUnits * requestedQuantity;
            normalizedItems.push({
                id: menuItemId,
                quantity: requestedQuantity,
                price: fromMinorUnits(unitPriceMinorUnits),
                snapshotName: String(row.name || '').trim() || `Menu Item #${menuItemId}`
            });
        }

        const serviceFeeMinorUnits = toMinorUnitsAllowZero(paymentOptions?.serviceFee || 0) || 0;
        let deliveryFeeMinorUnits = 0;
        let quotationIdForOrder = null;
        let senderStopId = null;
        let recipientStopId = null;

        if (isLalamoveDelivery) {
            const normalizedQuotationId = String(quotationId || '').trim();
            if (!normalizedQuotationId) {
                const error = new Error('Missing Lalamove quotationId for delivery order');
                error.status = 400;
                throw error;
            }

            const [quoteRows] = await connection.query(
                `
                    SELECT
                        id,
                        fee,
                        currency,
                        expires_at,
                        DATE_FORMAT(expires_at, '%Y-%m-%dT%H:%i:%sZ') AS expires_at_utc_iso,
                        scheduled_at_utc,
                        DATE_FORMAT(scheduled_at_utc, '%Y-%m-%d %H:%i:%s') AS scheduled_at_utc_sql,
                        sender_stop_id,
                        recipient_stop_id,
                        used_at
                    FROM delivery_quotes
                    WHERE quotation_id = ?
                      AND user_id = ?
                    LIMIT 1
                    FOR UPDATE
                `,
                [normalizedQuotationId, resolvedUserId]
            );
            const quote = quoteRows[0];
            if (!quote) {
                const error = new Error('Delivery quotation not found. Please refresh delivery quote.');
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
                    const error = new Error('Scheduled delivery time no longer matches quote. Please request a new quote.');
                    error.status = 409;
                    throw error;
                }
            } else if (quoteScheduledSql) {
                const error = new Error('This quote is for scheduled delivery. Please place as scheduled or refresh quote.');
                error.status = 409;
                throw error;
            }

            senderStopId = String(quote.sender_stop_id || '').trim();
            recipientStopId = String(quote.recipient_stop_id || '').trim();
            if (!senderStopId || !recipientStopId) {
                const error = new Error('Delivery quote is missing stop information. Please request a new quote.');
                error.status = 400;
                throw error;
            }
            if (!snapshotAddressLine) {
                const error = new Error('Delivery address is required');
                error.status = 400;
                throw error;
            }
            const normalizedRecipientPhone = lalamoveService.normalizePhone(
                recipient?.phone || addressSnapshot?.phone || ''
            );
            if (!lalamoveService.isValidPhone(normalizedRecipientPhone)) {
                const error = new Error('Recipient phone is required and must be valid, e.g. +60123456789');
                error.status = 400;
                throw error;
            }
            deliveryContactPhone = normalizedRecipientPhone;
            deliveryFeeMinorUnits = toMinorUnitsAllowZero(quote.fee) || 0;
            quotationIdForOrder = normalizedQuotationId;
            persistedDeliveryCurrency = normalizeCurrencyCode(quote.currency, 'MYR');
            deliveryQuoteReservation = {
                id: toPositiveInteger(quote.id),
                quotationId: normalizedQuotationId,
                senderStopId,
                recipientStopId,
                needsRefresh: Boolean(isQuoteExpired)
            };
        }

        totalAmountMinorUnits = subtotalMinorUnits + serviceFeeMinorUnits + deliveryFeeMinorUnits;
        if (totalAmountMinorUnits <= 0) {
            const error = new Error('Computed order total is invalid');
            error.status = 400;
            throw error;
        }
        const submittedMinorUnits = toMinorUnitsAllowZero(submittedTotal);
        if (submittedMinorUnits === null || Math.abs(submittedMinorUnits - totalAmountMinorUnits) > 1) {
            const error = new Error('Order total has changed. Please refresh and try again.');
            error.status = 409;
            error.expectedTotal = fromMinorUnits(totalAmountMinorUnits);
            throw error;
        }

        if (normalizedPaymentMethod === PAYMENT_METHOD_CURLEC) {
            if (!paymentAmountInMinorUnits || paymentAmountInMinorUnits !== totalAmountMinorUnits) {
                const error = new Error(
                    `Curlec paid amount mismatch. Expected ${totalAmountMinorUnits}, got ${paymentAmountInMinorUnits || 0}`
                );
                error.status = 400;
                throw error;
            }
        }

        const normalizedTotalAmount = fromMinorUnits(totalAmountMinorUnits);
        persistedDeliveryFee = isLalamoveDelivery ? fromMinorUnits(deliveryFeeMinorUnits) : null;
        persistedDeliveryAddress = normalizedOrderType === 'Delivery' ? snapshotAddressLine : address || '';
        persistedRecipientName = snapshotRecipientName || null;
        persistedRecipientRemarks = snapshotNote || '';
        persistedDeliveryContactPhone = deliveryContactPhone || null;

        // 0. Generate short_code sequentially
        const [lastOrderRows] = await connection.query(
            `SELECT short_code FROM orders ORDER BY id DESC LIMIT 1 FOR UPDATE`
        );
        const lastCode = lastOrderRows[0]?.short_code || null;
        orderCode = getNextOrderCode(lastCode);

        // 1. Create Order
        const [orderResult] = await connection.query(
            `INSERT INTO orders (
                user_id,
                status,
                total_amount,
                order_type,
                delivery_address,
                delivery_label_snapshot,
                delivery_note_snapshot,
                delivery_latitude,
                delivery_longitude,
                recipient_name_snapshot,
                delivery_provider,
                external_order_id,
                quotation_id,
                tracking_url,
                driver_id,
                lalamove_status,
                payment_method,
                curlec_order_id,
                curlec_payment_id,
                delivery_fee,
                delivery_currency,
                delivery_timing,
                scheduled_at_utc,
                lalamove_ongoing_at,
                delivery_contact_phone,
                short_code
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                resolvedUserId,
                initialStatus,
                normalizedTotalAmount,
                normalizedOrderType,
                persistedDeliveryAddress,
                snapshotLabel || null,
                snapshotNote || null,
                snapshotLatitude,
                snapshotLongitude,
                persistedRecipientName || null,
                'Internal',
                null,
                quotationIdForOrder,
                null,
                null,
                null,
                normalizedPaymentMethod,
                normalizedPaymentMethod === PAYMENT_METHOD_CURLEC ? curlecPaymentProof?.orderId || null : null,
                normalizedPaymentMethod === PAYMENT_METHOD_CURLEC ? curlecPaymentProof?.paymentId || null : null,
                persistedDeliveryFee,
                persistedDeliveryCurrency,
                normalizedDeliveryTiming,
                scheduledAtSql,
                null,
                persistedDeliveryContactPhone,
                orderCode
            ]
        );
        orderId = orderResult.insertId;

        // 2. Create Order Items
        for (const item of normalizedItems) {
            await connection.query(
                `INSERT INTO order_items (order_id, menu_item_id, item_name_snapshot, quantity, unit_price) VALUES (?, ?, ?, ?, ?)`,
                [orderId, item.id, item.snapshotName, item.quantity, item.price]
            );
        }

        // 3. Deduct stock
        for (const [menuItemId, requestedQuantity] of requestedQuantityById.entries()) {
            await connection.query(
                'UPDATE menu_items SET stock = stock - ? WHERE id = ?',
                [requestedQuantity, menuItemId]
            );
        }

        if (deliveryQuoteReservation?.id) {
            const [quoteUsageResult] = await connection.query(
                `
                    UPDATE delivery_quotes
                    SET used_at = UTC_TIMESTAMP()
                    WHERE id = ?
                      AND used_at IS NULL
                `,
                [deliveryQuoteReservation.id]
            );
            if (quoteUsageResult?.affectedRows !== 1) {
                const error = new Error('Delivery quotation already used. Please request a new quote.');
                error.status = 409;
                throw error;
            }
        }

        // 4. Keep carts synced with latest stock
        await syncCartWithStock(connection);

        if (
            normalizedPaymentMethod === PAYMENT_METHOD_CURLEC &&
            normalizedCurlecCheckoutSessionId &&
            curlecPaymentProof?.paymentId &&
            orderId
        ) {
            await markCurlecCheckoutSessionConsumed(connection, {
                sessionId: normalizedCurlecCheckoutSessionId,
                orderId,
                paymentId: curlecPaymentProof.paymentId,
                status: 'consumed'
            });
        }

        await connection.commit();
        hasTransaction = false;
        emitOrdersChangedEvent({
            source: 'order_create',
            orderId,
            reason: 'created'
        });
    } catch (err) {
        if (hasTransaction && connection) {
            await connection.rollback();
        }

        if (normalizedPaymentMethod === PAYMENT_METHOD_CURLEC) {
            try {
                if (
                    (err.code === 'CURLEC_CHECKOUT_ALREADY_CONSUMED' || err.code === 'CURLEC_PAYMENT_ALREADY_USED') &&
                    err.existingOrderId
                ) {
                    const [existingRows] = await db.query(
                        `
                            SELECT curlec_payment_id
                            FROM orders
                            WHERE id = ?
                            LIMIT 1
                        `,
                        [err.existingOrderId]
                    );
                    const existingPaymentId = String(existingRows[0]?.curlec_payment_id || '').trim();
                    const projection =
                        (existingPaymentId
                            ? await fetchOrderCreationProjectionByPaymentId(existingPaymentId)
                            : null) || (await fetchOrderCreationProjectionByOrderId(err.existingOrderId));
                    if (projection) {
                        await markCurlecCheckoutSessionStatus({
                            sessionId: normalizedCurlecCheckoutSessionId,
                            status: 'consumed',
                            paymentId: existingPaymentId || curlecPaymentProof?.paymentId || null,
                            consumedOrderId: projection.orderId
                        }).catch(() => null);
                        return res.status(200).json(projection);
                    }
                }

                if (
                    (err.code === 'CURLEC_PAYMENT_ALREADY_USED' || err.code === 'ER_DUP_ENTRY') &&
                    curlecPaymentProof?.paymentId
                ) {
                    const projection = await fetchOrderCreationProjectionByPaymentId(curlecPaymentProof.paymentId);
                    if (projection) {
                        await markCurlecCheckoutSessionStatus({
                            sessionId: normalizedCurlecCheckoutSessionId,
                            status: 'consumed',
                            paymentId: curlecPaymentProof.paymentId,
                            consumedOrderId: projection.orderId
                        }).catch(() => null);
                        return res.status(200).json(projection);
                    }
                }
            } catch (lookupError) {
                console.error('Failed to fetch existing order for duplicate Curlec payment:', lookupError);
            }
        }

        console.error(err);
        return res.status(err.status || 500).json({
            error: err.message || 'Order creation failed',
            details: err.payload || null,
            expectedTotal: err.expectedTotal ?? undefined
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }

    let lalamoveOrder = null;
    let deliveryBookingStatus = null;
    let deliveryBookingMessage = null;
    if (isLalamoveDelivery && orderId && deliveryQuoteReservation) {
        const refreshDeliveryQuoteReservation = async () => {
            if (!persistedDeliveryAddress || persistedDeliveryLatitude === null || persistedDeliveryLongitude === null) {
                const error = new Error('Delivery quote refresh requires a valid address and coordinates');
                error.status = 409;
                throw error;
            }
            const refreshedQuotation = await lalamoveService.createQuotation({
                dropoffAddress: persistedDeliveryAddress,
                dropoffLat: persistedDeliveryLatitude,
                dropoffLng: persistedDeliveryLongitude,
                dropoffNote: persistedRecipientRemarks || '',
                scheduleAt: parsedSchedule.value || undefined,
                store: {
                    name: shopStatusAtOrder?.storeName,
                    phone: shopStatusAtOrder?.storePhone,
                    address: shopStatusAtOrder?.storeAddress,
                    latitude: shopStatusAtOrder?.storeLatitude,
                    longitude: shopStatusAtOrder?.storeLongitude
                }
            });
            const refreshedQuotationId = String(refreshedQuotation?.quotationId || '').trim();
            if (!refreshedQuotationId) {
                const error = new Error('Unable to refresh delivery quotation');
                error.status = 502;
                throw error;
            }
            const refreshedStops = refreshedQuotation?.stops || [];
            const { senderStopId, recipientStopId } = extractLalamoveStopIds(refreshedStops);
            if (!senderStopId || !recipientStopId) {
                const error = new Error('Refreshed delivery quote is missing stop information');
                error.status = 502;
                throw error;
            }

            const refreshedQuoteFee = toNumber(refreshedQuotation?.priceBreakdown?.total) ?? persistedDeliveryFee ?? 0;
            const refreshedQuoteCurrency = normalizeCurrencyCode(
                refreshedQuotation?.priceBreakdown?.currency,
                persistedDeliveryCurrency || 'MYR'
            );

            await reserveDeliveryQuote(db, {
                userId: resolvedUserId,
                quotationId: refreshedQuotationId,
                fee: refreshedQuoteFee,
                currency: refreshedQuoteCurrency,
                expiresAt: refreshedQuotation?.expiresAt || null,
                scheduledAtUtc: parsedSchedule.value || null,
                stops: refreshedStops,
                metadata: {
                    addressLine: persistedDeliveryAddress,
                    latitude: persistedDeliveryLatitude,
                    longitude: persistedDeliveryLongitude,
                    recipientName: persistedRecipientName || 'Customer',
                    recipientPhone: persistedDeliveryContactPhone || '',
                    note: persistedRecipientRemarks || ''
                }
            }).catch((quotePersistError) => {
                console.warn(
                    `Failed to persist refreshed quotation ${refreshedQuotationId} for order ${orderId}:`,
                    quotePersistError?.message || quotePersistError
                );
            });

            return {
                ...deliveryQuoteReservation,
                quotationId: refreshedQuotationId,
                senderStopId,
                recipientStopId,
                needsRefresh: false,
                refreshed: true
            };
        };

        let dispatchReservation = deliveryQuoteReservation;
        let didRefreshQuote = false;
        try {
            const createLalamoveDispatchOrder = async () =>
                lalamoveService.createOrder({
                    quotationId: dispatchReservation.quotationId,
                    senderStopId: dispatchReservation.senderStopId,
                    recipientStopId: dispatchReservation.recipientStopId,
                    recipientName: persistedRecipientName || 'Customer',
                    recipientPhone: persistedDeliveryContactPhone,
                    recipientRemarks: buildLalamoveRecipientRemark({
                        shortCode: orderCode,
                        userName: persistedUserDisplayName || persistedRecipientName || 'Customer',
                        customerRemark: persistedRecipientRemarks || ''
                    }),
                    store: {
                        name: shopStatusAtOrder?.storeName,
                        phone: shopStatusAtOrder?.storePhone,
                        address: shopStatusAtOrder?.storeAddress,
                        latitude: shopStatusAtOrder?.storeLatitude,
                        longitude: shopStatusAtOrder?.storeLongitude
                    },
                    metadata: {
                        source: 'takcakap',
                        localOrderRef: `fd-${orderId}`
                    }
                });

            if (dispatchReservation?.needsRefresh) {
                dispatchReservation = await refreshDeliveryQuoteReservation();
                didRefreshQuote = true;
            }

            try {
                lalamoveOrder = await createLalamoveDispatchOrder();
            } catch (initialDispatchError) {
                if (!didRefreshQuote && isLalamoveInvalidQuotationError(initialDispatchError)) {
                    dispatchReservation = await refreshDeliveryQuoteReservation();
                    didRefreshQuote = true;
                    lalamoveOrder = await createLalamoveDispatchOrder();
                } else {
                    throw initialDispatchError;
                }
            }

            const mappedStatus =
                mapLalamoveUpdateToOrderStatus({
                    eventType: 'ORDER_CREATED',
                    lalamoveStatus: lalamoveOrder?.status || ''
                }) || 'Finding Rider';
            const normalizedLalamoveStatus = String(lalamoveOrder?.status || '').trim() || 'ASSIGNING_DRIVER';
            const ongoingAtSql =
                String(normalizedLalamoveStatus).toUpperCase() === 'ON_GOING'
                    ? toSqlDateTimeUtc(new Date())
                    : null;

            const [dispatchPersistResult] = await db.query(
                `
                    UPDATE orders
                    SET
                        quotation_id = COALESCE(?, quotation_id),
                        delivery_provider = 'Lalamove',
                        external_order_id = ?,
                        tracking_url = ?,
                        driver_id = ?,
                        lalamove_status = ?,
                        status = CASE WHEN status = 'Cancelled' THEN status ELSE ? END,
                        lalamove_ongoing_at = CASE
                            WHEN ? IS NULL THEN lalamove_ongoing_at
                            ELSE COALESCE(lalamove_ongoing_at, ?)
                        END
                    WHERE id = ?
                      AND status <> 'Cancelled'
                `,
                [
                    didRefreshQuote ? dispatchReservation.quotationId : null,
                    lalamoveOrder?.orderId || null,
                    lalamoveOrder?.shareLink || null,
                    lalamoveOrder?.driverId || null,
                    normalizedLalamoveStatus,
                    mappedStatus,
                    ongoingAtSql,
                    ongoingAtSql,
                    orderId
                ]
            );
            if (dispatchPersistResult?.affectedRows !== 1) {
                deliveryBookingStatus = 'cancelled_before_dispatch_commit';
                deliveryBookingMessage = 'Order was cancelled before delivery booking completed.';
                if (lalamoveOrder?.orderId) {
                    await lalamoveService.cancelOrder(String(lalamoveOrder.orderId)).catch((cancelError) => {
                        console.warn(
                            `Failed to cancel orphaned Lalamove order ${lalamoveOrder.orderId} after local cancellation:`,
                            cancelError?.payload || cancelError?.message || cancelError
                        );
                    });
                }
                emitOrdersChangedEvent({
                    source: 'order_dispatch',
                    orderId,
                    reason: 'lalamove_aborted_cancelled'
                });
                lalamoveOrder = null;
            } else if (didRefreshQuote && dispatchReservation?.quotationId) {
                await db
                    .query(
                        `
                            UPDATE delivery_quotes
                            SET used_at = COALESCE(used_at, UTC_TIMESTAMP())
                            WHERE quotation_id = ?
                              AND user_id = ?
                            LIMIT 1
                        `,
                        [dispatchReservation.quotationId, resolvedUserId]
                    )
                    .catch(() => null);
                emitOrdersChangedEvent({
                    source: 'order_dispatch',
                    orderId,
                    reason: 'lalamove_booked'
                });
                deliveryBookingStatus = 'booked';
            } else if (dispatchPersistResult?.affectedRows === 1) {
                emitOrdersChangedEvent({
                    source: 'order_dispatch',
                    orderId,
                    reason: 'lalamove_booked'
                });
                deliveryBookingStatus = 'booked';
            }
        } catch (dispatchError) {
            deliveryBookingStatus = 'pending_manual_dispatch';
            deliveryBookingMessage =
                dispatchError?.message || 'Delivery has been queued and will be assigned manually.';
            console.error(
                `Lalamove dispatch failed for order ${orderId}:`,
                JSON.stringify(dispatchError?.payload || dispatchError?.message || dispatchError)
            );
            await db
                .query(
                    `
                        UPDATE orders
                        SET lalamove_status = 'BOOKING_FAILED'
                        WHERE id = ?
                          AND external_order_id IS NULL
                    `,
                    [orderId]
                )
                .catch(() => null);

            emitOrdersChangedEvent({
                source: 'order_dispatch',
                orderId,
                reason: 'lalamove_booking_failed'
            });
        }
    }
    orderCreateDeliveryBookingStatus = deliveryBookingStatus || 'na';
    const responseLalamoveStatus =
        lalamoveOrder?.status ||
        (deliveryBookingStatus === 'cancelled_before_dispatch_commit'
            ? null
            : isLalamoveDelivery
                ? 'BOOKING_FAILED'
                : null);

    emailService.queueOrderEventEmail(orderId, 'payment_success');
    return res.json({
        success: true,
        orderId: orderId.toString(),
        shortCode: orderCode,
        externalOrderId: lalamoveOrder?.orderId || null,
        trackingUrl: lalamoveOrder?.shareLink || null,
        lalamoveStatus: responseLalamoveStatus,
        deliveryTiming: normalizedDeliveryTiming,
        scheduledAtUtc: parsedSchedule.value || null,
        total: fromMinorUnits(totalAmountMinorUnits),
        deliveryFee: persistedDeliveryFee,
        deliveryCurrency: persistedDeliveryCurrency,
        deliveryBookingStatus,
        deliveryBookingMessage
    });
});

app.get('/api/orders/:id/reorder-preview', requireAuth, async (req, res) => {
    try {
        const orderId = toPositiveInteger(req.params.id);
        if (!orderId) {
            return res.status(400).json({ error: 'Invalid order id' });
        }
        const preview = await buildReorderPreview(db, {
            userId: req.user.id,
            orderId
        });
        return res.json(preview);
    } catch (error) {
        console.error('Reorder preview failed:', error);
        return res.status(error.status || 500).json({
            error: error.message || 'Failed to build reorder preview'
        });
    }
});

app.post('/api/orders/:id/reorder', requireAuth, async (req, res) => {
    const userId = req.user.id;
    const orderId = toPositiveInteger(req.params.id);
    const cartMode = String(req.body?.cartMode || 'replace').trim().toLowerCase() === 'merge' ? 'merge' : 'replace';

    if (!orderId) {
        return res.status(400).json({ error: 'Invalid order id' });
    }

    let connection = null;
    let hasTransaction = false;
    try {
        const preview = await buildReorderPreview(db, { userId, orderId });
        const candidates = [...preview.availableItems, ...preview.adjustedItems];
        if (!candidates.length) {
            return res.status(400).json({ error: 'No available items to reorder', preview });
        }

        connection = await db.getConnection();
        await connection.beginTransaction();
        hasTransaction = true;

        if (cartMode === 'replace') {
            await connection.query('DELETE FROM cart_items WHERE user_id = ?', [userId]);
        }

        let addedCount = 0;
        let skippedCount = 0;

        for (const item of candidates) {
            const menuItemId = toPositiveInteger(item.menuItemId);
            const requestedQuantity = toPositiveInteger(item.quantity);
            if (!menuItemId || !requestedQuantity) {
                skippedCount += 1;
                continue;
            }

            const [menuRows] = await connection.query(
                `
                    SELECT stock, is_active
                    FROM menu_items
                    WHERE id = ?
                    LIMIT 1
                    FOR UPDATE
                `,
                [menuItemId]
            );
            const menuRow = menuRows[0];
            if (!menuRow || !menuRow.is_active || Number(menuRow.stock || 0) <= 0) {
                skippedCount += 1;
                continue;
            }

            const availableStock = Number(menuRow.stock || 0);
            let existingQuantity = 0;
            if (cartMode === 'merge') {
                const [cartRows] = await connection.query(
                    `
                        SELECT quantity
                        FROM cart_items
                        WHERE user_id = ? AND menu_item_id = ?
                        LIMIT 1
                    `,
                    [userId, menuItemId]
                );
                existingQuantity = Number(cartRows[0]?.quantity || 0);
            }

            const finalQuantity = Math.min(existingQuantity + requestedQuantity, availableStock);
            if (finalQuantity <= 0) {
                skippedCount += 1;
                continue;
            }

            await connection.query(
                `
                    INSERT INTO cart_items (user_id, menu_item_id, quantity)
                    VALUES (?, ?, ?)
                    ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)
                `,
                [userId, menuItemId, finalQuantity]
            );
            addedCount += Math.max(finalQuantity - existingQuantity, 0);
        }

        await syncCartWithStock(connection, userId);
        await connection.commit();
        hasTransaction = false;

        const cart = await fetchCartForUser(userId);
        return res.json({
            success: true,
            cartMode,
            addedCount,
            skippedCount,
            preview,
            cart
        });
    } catch (error) {
        if (connection && hasTransaction) {
            await connection.rollback();
        }
        console.error('Reorder apply failed:', error);
        return res.status(error.status || 500).json({
            error: error.message || 'Failed to apply reorder'
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

app.get('/api/orders/:id/receipt', requireAuth, async (req, res) => {
    try {
        const orderId = toPositiveInteger(req.params.id);
        if (!orderId) {
            return res.status(400).json({ error: 'Invalid order id' });
        }

        const [orderRows] = await db.query(
            `
                SELECT
                    o.id,
                    o.short_code,
                    o.user_id,
                    o.status,
                    o.total_amount,
                    o.created_at,
                    o.order_type,
                    o.delivery_address,
                    o.delivery_provider,
                    o.delivery_fee,
                    o.delivery_currency,
                    o.payment_method,
                    u.name AS customer_name,
                    u.email AS customer_email,
                    u.phone_number AS customer_phone
                FROM orders o
                LEFT JOIN users u ON u.id = o.user_id
                WHERE o.id = ?
                LIMIT 1
            `,
            [orderId]
        );
        const order = orderRows[0];
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        if (req.user.role !== 'admin' && Number(order.user_id) !== Number(req.user.id)) {
            return res.status(403).json({ error: 'You can only download your own receipt' });
        }

        const [itemRows] = await db.query(
            `
                SELECT
                    oi.menu_item_id,
                    oi.item_name_snapshot,
                    oi.quantity,
                    oi.unit_price,
                    m.name AS menu_name
                FROM order_items oi
                LEFT JOIN menu_items m ON m.id = oi.menu_item_id
                WHERE oi.order_id = ?
                ORDER BY oi.id ASC
            `,
            [orderId]
        );

        const items = itemRows.map((row) => ({
            name: String(row.item_name_snapshot || row.menu_name || `Menu Item #${row.menu_item_id}`),
            quantity: Number(row.quantity || 0),
            unitPrice: Number(row.unit_price || 0),
            lineTotal: Number(row.quantity || 0) * Number(row.unit_price || 0)
        }));
        const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
        const deliveryFee = Number(order.delivery_fee || 0);
        const total = Number(order.total_amount || 0);
        const serviceFee = Math.max(total - subtotal - deliveryFee, 0);

        const createdAtText = new Date(order.created_at).toLocaleString('en-MY', {
            timeZone: SHOP_TIMEZONE,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        const paymentMethodLabel = String(order.payment_method || 'DuitNow').trim() || 'DuitNow';
        const receiptNumber = order.short_code || `FD-${String(order.id).padStart(6, '0')}`;
        const logoBuffer = await fetchImageBuffer(DEFAULT_BRAND_LOGO_URL);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="receipt-${order.id}.pdf"`);

        const doc = new PDFDocument({ margin: 28, size: 'A5' });
        doc.on('error', (pdfError) => {
            console.error('Receipt PDF generation failed:', pdfError);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Failed to generate receipt PDF' });
            }
        });
        doc.pipe(res);

        const left = doc.page.margins.left;
        const top = doc.page.margins.top;
        const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const pageBottom = doc.page.height - doc.page.margins.bottom;
        let y = top;

        // Header block
        doc.roundedRect(left, y, contentWidth, 86, 10).fill('#fff7fe');
        if (logoBuffer) {
            doc.image(logoBuffer, left + 12, y + 16, { fit: [78, 36], align: 'left' });
        }
        const titleX = logoBuffer ? left + 100 : left + 14;
        doc.fillColor('#111111').font('Helvetica-Bold').fontSize(18).text('ORDER RECEIPT', titleX, y + 16);
        doc.fillColor('#666666').font('Helvetica').fontSize(10).text('TakCakap Malaysia', titleX, y + 38);
        doc.fillColor('#9d2d8f').font('Helvetica-Bold').fontSize(9).text(receiptNumber, titleX, y + 56);
        y += 100;

        // Receipt info card (single-column label/value pairs for stable alignment on A5)
        const infoRows = [
            ['Receipt No', receiptNumber],
            ['Order ID', String(order.id)],
            ['Date', createdAtText],
            ['Status', String(order.status)],
            ['Order Type', String(order.order_type)],
            ['Payment', paymentMethodLabel]
        ];
        const infoRowHeight = 14;
        const infoCardHeight = 16 + infoRows.length * infoRowHeight + 8;
        const labelX = left + 12;
        const valueX = left + 126;
        const valueWidth = contentWidth - (valueX - left) - 12;

        doc.roundedRect(left, y, contentWidth, infoCardHeight, 10).fill('#fafafa');
        let infoY = y + 12;
        infoRows.forEach(([label, value]) => {
            doc.fillColor('#7a7a7a').font('Helvetica-Bold').fontSize(8).text(label.toUpperCase(), labelX, infoY);
            doc.fillColor('#111111').font('Helvetica').fontSize(10).text(value, valueX, infoY - 1, {
                width: valueWidth,
                align: 'right',
                ellipsis: true
            });
            infoY += infoRowHeight;
        });
        y += infoCardHeight + 14;

        // Customer
        doc.fillColor('#111111').font('Helvetica-Bold').fontSize(10).text('Customer', left, y);
        y += 14;
        doc.font('Helvetica').fontSize(10).fillColor('#222222').text(order.customer_name || 'Guest', left, y);
        y += 14;
        if (order.customer_email) {
            doc.fillColor('#444444').fontSize(9).text(order.customer_email, left, y);
            y += 12;
        }
        if (order.customer_phone) {
            doc.fillColor('#444444').fontSize(9).text(order.customer_phone, left, y);
            y += 12;
        }
        y += 8;

        // Items table header
        doc.fillColor('#7a7a7a').font('Helvetica-Bold').fontSize(8);
        doc.text('ITEM', left, y, { width: contentWidth - 125 });
        doc.text('QTY', left + contentWidth - 122, y, { width: 26, align: 'right' });
        doc.text('PRICE', left + contentWidth - 94, y, { width: 42, align: 'right' });
        doc.text('TOTAL', left + contentWidth - 48, y, { width: 48, align: 'right' });
        y += 12;
        doc.moveTo(left, y).lineTo(left + contentWidth, y).strokeColor('#e6e6e6').lineWidth(1).stroke();
        y += 8;

        doc.font('Helvetica').fontSize(9).fillColor('#111111');
        if (!items.length) {
            doc.text('No items found for this order.', left, y);
            y += 16;
        } else {
            items.forEach((item) => {
                if (y > pageBottom - 130) {
                    doc.addPage({ size: 'A5', margin: 28 });
                    y = doc.page.margins.top;
                }
                const itemNameHeight = doc.heightOfString(item.name, {
                    width: contentWidth - 125
                });
                const rowHeight = Math.max(12, itemNameHeight) + 4;
                doc.text(item.name, left, y, { width: contentWidth - 125 });
                doc.text(String(item.quantity), left + contentWidth - 122, y, { width: 26, align: 'right' });
                doc.text(formatMoneyMYR(item.unitPrice), left + contentWidth - 94, y, { width: 42, align: 'right' });
                doc.text(formatMoneyMYR(item.lineTotal), left + contentWidth - 48, y, { width: 48, align: 'right' });
                y += rowHeight;
            });
        }

        y += 8;
        if (y > pageBottom - 150) {
            doc.addPage({ size: 'A5', margin: 28 });
            y = doc.page.margins.top;
        }

        // Totals block
        const totalBlockHeight = order.order_type === 'Delivery' ? 74 : 58;
        doc.roundedRect(left + contentWidth - 190, y, 190, totalBlockHeight, 10).fill('#f7f7f7');
        let ty = y + 10;
        doc.fillColor('#666666').font('Helvetica').fontSize(9);
        doc.text('Subtotal', left + contentWidth - 178, ty);
        doc.text(formatMoneyMYR(subtotal), left + contentWidth - 92, ty, { width: 82, align: 'right' });
        ty += 14;
        doc.text('Service Fee', left + contentWidth - 178, ty);
        doc.text(formatMoneyMYR(serviceFee), left + contentWidth - 92, ty, { width: 82, align: 'right' });
        ty += 14;
        if (order.order_type === 'Delivery') {
            doc.text('Delivery Fee', left + contentWidth - 178, ty);
            doc.text(formatMoneyMYR(deliveryFee), left + contentWidth - 92, ty, { width: 82, align: 'right' });
            ty += 14;
        }
        doc.font('Helvetica-Bold').fillColor('#111111');
        doc.text('Grand Total', left + contentWidth - 178, ty);
        doc.text(formatMoneyMYR(total), left + contentWidth - 92, ty, { width: 82, align: 'right' });
        y += totalBlockHeight + 10;

        if (order.order_type === 'Delivery' && order.delivery_address) {
            if (y > pageBottom - 90) {
                doc.addPage({ size: 'A5', margin: 28 });
                y = doc.page.margins.top;
            }
            doc.fillColor('#111111').font('Helvetica-Bold').fontSize(10).text('Delivery Address', left, y);
            y += 14;
            doc.font('Helvetica').fontSize(9).fillColor('#444444').text(String(order.delivery_address), left, y, {
                width: contentWidth
            });
        }

        // Footer
        const footerY = doc.page.height - doc.page.margins.bottom - 24;
        doc.moveTo(left, footerY).lineTo(left + contentWidth, footerY).strokeColor('#ececec').lineWidth(1).stroke();
        doc.fillColor('#777777').font('Helvetica').fontSize(8).text(
            'This is a computer-generated receipt. Thank you for supporting TakCakap.',
            left,
            footerY + 6,
            { width: contentWidth, align: 'center' }
        );

        doc.end();
    } catch (err) {
        console.error('Receipt endpoint failed:', err);
        return res.status(500).json({ error: 'Failed to generate receipt' });
    }
});

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
            } else if (normalizedStatus === 'Cancelled' && !refund) {
                emailService.queueOrderEventEmail(orderId, 'cancelled');
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
            details: error.payload || null
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
            details: error.payload || null
        });
    }
});

app.post('/api/webhooks/curlec', webhookRateLimiter, async (req, res) => {
    let webhookReservation = null;
    try {
        if (!CURLEC_WEBHOOK_SECRET) {
            recordWebhookEvent({ provider: 'curlec', eventType: 'unknown', status: 'config_error' });
            return res.status(503).json({ error: 'CURLEC_WEBHOOK_SECRET is not configured on the server' });
        }

        const signatureHeader = req.headers['x-razorpay-signature'];
        const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
        const rawBody = String(req.rawBody || '');

        if (!rawBody) {
            recordWebhookEvent({ provider: 'curlec', eventType: 'unknown', status: 'invalid_payload' });
            return res.status(400).json({ error: 'Missing raw webhook payload' });
        }
        if (!signature || !verifyCurlecWebhookSignature({ rawBody, signature })) {
            recordWebhookEvent({ provider: 'curlec', eventType: 'unknown', status: 'invalid_signature' });
            return res.status(401).json({ error: 'Invalid webhook signature' });
        }

        const eventType = String(req.body?.event || '').trim().toLowerCase();
        if (!eventType) {
            recordWebhookEvent({ provider: 'curlec', eventType: 'unknown', status: 'invalid_event' });
            return res.status(400).json({ error: 'Missing webhook event type' });
        }

        const isRefundEvent = eventType.startsWith('refund.');
        const isPaymentCapturedEvent = eventType === 'payment.captured';
        if (!isRefundEvent && !isPaymentCapturedEvent) {
            recordWebhookEvent({ provider: 'curlec', eventType, status: 'ignored' });
            return res.status(200).json({ success: true, ignored: true, reason: 'unsupported_event' });
        }

        const refundEntity = req.body?.payload?.refund?.entity || req.body?.payload?.refund || null;
        const paymentEntity = req.body?.payload?.payment?.entity || req.body?.payload?.payment || null;
        if (isRefundEvent && (!refundEntity || typeof refundEntity !== 'object')) {
            recordWebhookEvent({ provider: 'curlec', eventType, status: 'invalid_payload' });
            return res.status(400).json({ error: 'Missing refund payload entity' });
        }
        if (isPaymentCapturedEvent && (!paymentEntity || typeof paymentEntity !== 'object')) {
            recordWebhookEvent({ provider: 'curlec', eventType, status: 'invalid_payload' });
            return res.status(400).json({ error: 'Missing payment payload entity' });
        }

        const eventIdHeader = firstHeaderValue(req.headers['x-razorpay-event-id']);
        const rawEventId = String(eventIdHeader || req.body?.id || '').trim();
        const entityEventId =
            String(
                refundEntity?.id ||
                refundEntity?.payment_id ||
                paymentEntity?.id ||
                paymentEntity?.order_id ||
                ''
            ).trim() || buildWebhookPayloadHash(rawBody).slice(0, 24);
        const derivedEventId = rawEventId || `${eventType}:${entityEventId}`;
        webhookReservation = await reserveWebhookEventForProcessing({
            provider: 'curlec',
            eventId: derivedEventId,
            payloadHash: buildWebhookPayloadHash(rawBody)
        });
        if (!webhookReservation.shouldProcess) {
            recordWebhookEvent({ provider: 'curlec', eventType, status: 'duplicate' });
            return res.status(200).json({
                success: true,
                ignored: true,
                reason: 'duplicate_event'
            });
        }

        let updateResult = null;
        if (isRefundEvent) {
            updateResult = await applyCurlecRefundWebhookUpdate({
                eventType,
                refundEntity
            });
        } else {
            updateResult = await applyCurlecPaymentCapturedWebhookUpdate({
                paymentEntity
            });
        }

        await markWebhookEventProcessed(webhookReservation);
        recordWebhookEvent({ provider: 'curlec', eventType, status: 'processed' });

        return res.status(200).json({
            success: true,
            event: eventType,
            updated: updateResult.updated,
            orderId: updateResult.orderId,
            refundStatus: updateResult.refundStatus,
            reconciled: updateResult.reconciled,
            idempotent: updateResult.idempotent,
            reason: updateResult.reason || undefined
        });
    } catch (error) {
        if (webhookReservation?.provider && webhookReservation?.eventId) {
            await markWebhookEventFailed({
                provider: webhookReservation.provider,
                eventId: webhookReservation.eventId,
                errorMessage: error?.message || 'Curlec webhook processing failed'
            }).catch(() => null);
        }
        recordWebhookEvent({
            provider: 'curlec',
            eventType: req.body?.event || 'unknown',
            status: 'failed'
        });
        console.error('Curlec webhook processing failed:', error?.payload || error?.message || error);
        return res.status(error.status || 500).json({
            error: error.message || 'Curlec webhook processing failed'
        });
    }
});

app.get('/api/webhooks/lalamove', webhookRateLimiter, (_req, res) => {
    return res.status(200).json({
        success: true,
        message: 'Lalamove webhook endpoint is reachable'
    });
});

app.post('/api/webhooks/lalamove', webhookRateLimiter, async (req, res) => {
    let webhookReservation = null;
    try {
        const hasV3Verification = Boolean(LALAMOVE_API_KEY && LALAMOVE_API_SECRET);
        const hasLegacyVerification = Boolean(LALAMOVE_WEBHOOK_SECRET);
        if (!hasV3Verification && !hasLegacyVerification) {
            recordWebhookEvent({ provider: 'lalamove', eventType: 'unknown', status: 'config_error' });
            return res.status(503).json({
                error: 'Lalamove webhook verification is not configured (set LALAMOVE_API_KEY/LALAMOVE_API_SECRET)'
            });
        }

        const rawBody = String(req.rawBody || '');
        const rawBodyTrimmed = rawBody.trim();
        const hasBodyObject =
            req.body &&
            typeof req.body === 'object' &&
            !Array.isArray(req.body) &&
            Object.keys(req.body).length > 0;

        const authorizationHeader = firstHeaderValue(req.headers['authorization']);
        const parsedAuthorization = parseLalamoveHmacAuthorizationHeader(authorizationHeader);
        const signatureHeader = firstHeaderValue(req.headers['x-lalamove-signature'] || req.headers['x-signature']);
        const timestampHeader = firstHeaderValue(req.headers['x-lalamove-timestamp'] || req.headers['x-timestamp']);

        const signature = String(req.body?.signature || signatureHeader || parsedAuthorization?.signature || '').trim();
        const timestamp = String(req.body?.timestamp || parsedAuthorization?.timestamp || timestampHeader || '').trim();
        const apiKey = String(req.body?.apiKey || parsedAuthorization?.apiKey || '').trim();

        if ((rawBodyTrimmed === '' || rawBodyTrimmed === '{}') && !hasBodyObject && !signature && !timestamp && !apiKey) {
            // Lalamove calls the webhook URL with an empty payload during first-time setup validation.
            recordWebhookEvent({ provider: 'lalamove', eventType: 'unknown', status: 'handshake' });
            return res.status(200).json({ success: true, acknowledged: true, reason: 'initial_handshake' });
        }

        const eventType = String(
            req.body?.eventType ||
            req.body?.type ||
            req.body?.event ||
            req.body?.data?.eventType ||
            req.body?.data?.type ||
            req.body?.data?.event ||
            'UNKNOWN'
        ).trim();
        const payload = req.body?.data && typeof req.body?.data === 'object' ? req.body.data : req.body || {};
        const externalOrderIdCandidate =
            payload.orderId ||
            payload.orderID ||
            payload?.order?.orderId ||
            payload?.order?.id ||
            null;

        const verification = verifyLalamoveWebhookSignature({
            rawBody,
            signature,
            timestamp,
            apiKey,
            requestPath: req.originalUrl || req.path,
            dataPayload: payload
        });
        if (!verification.ok) {
            const status =
                verification.reason === 'verification_not_configured'
                    ? 'config_error'
                    : verification.reason === 'missing_timestamp'
                        ? 'invalid_timestamp'
                        : 'invalid_signature';
            recordWebhookEvent({ provider: 'lalamove', eventType: eventType || 'unknown', status });
            if (verification.reason === 'missing_timestamp' && !externalOrderIdCandidate) {
                // Keep non-order callbacks from retrying indefinitely when providers omit timestamp metadata.
                return res.status(200).json({ success: true, ignored: true, reason: 'missing_timestamp_non_order' });
            }
            const responseStatus =
                verification.reason === 'verification_not_configured'
                    ? 503
                    : verification.reason === 'missing_timestamp'
                        ? 400
                        : 401;
            return res.status(responseStatus).json({
                error:
                    verification.reason === 'verification_not_configured'
                        ? 'Lalamove webhook verification is not configured'
                        : verification.reason === 'missing_timestamp'
                            ? 'Missing Lalamove webhook timestamp'
                            : 'Invalid Lalamove webhook signature'
            });
        }

        if (timestamp) {
            const timestampMs = parseWebhookTimestampMs(timestamp);
            if (!timestampMs) {
                recordWebhookEvent({ provider: 'lalamove', eventType: eventType || 'unknown', status: 'invalid_timestamp' });
                return res.status(400).json({ error: 'Invalid Lalamove webhook timestamp' });
            }
            const ageMs = Math.abs(Date.now() - timestampMs);
            if (ageMs > LALAMOVE_WEBHOOK_MAX_SKEW_SECONDS * 1000) {
                recordWebhookEvent({ provider: 'lalamove', eventType: eventType || 'unknown', status: 'stale_timestamp' });
                return res.status(401).json({ error: 'Stale Lalamove webhook timestamp' });
            }
        }

        const rawEventId = String(
            req.body?.eventId ||
            req.body?.id ||
            payload?.eventId ||
            payload?.id ||
            payload?.messageId ||
            ''
        ).trim();
        const payloadHash = buildWebhookPayloadHash(rawBody);
        const fallbackEventId = `${String(eventType || 'UNKNOWN').trim()}:${payloadHash.slice(0, 24)}`;
        webhookReservation = await reserveWebhookEventForProcessing({
            provider: 'lalamove',
            eventId: rawEventId || fallbackEventId,
            payloadHash
        });
        if (!webhookReservation.shouldProcess) {
            recordWebhookEvent({ provider: 'lalamove', eventType, status: 'duplicate' });
            return res.status(200).json({ success: true, ignored: true, reason: 'duplicate_event' });
        }

        const normalizedEventType = String(eventType || '').toUpperCase();
        // Lalamove may push account-level events that are not tied to an order.
        if (normalizedEventType === 'WALLET_BALANCE_CHANGED') {
            await markWebhookEventProcessed(webhookReservation);
            recordWebhookEvent({ provider: 'lalamove', eventType, status: 'ignored' });
            return res.status(200).json({ success: true, ignored: true, reason: 'unsupported_event' });
        }

        const externalOrderId = externalOrderIdCandidate;

        if (!externalOrderId) {
            // Acknowledge and mark as processed to prevent endless provider retries on non-order payload variants.
            await markWebhookEventProcessed(webhookReservation);
            recordWebhookEvent({ provider: 'lalamove', eventType, status: 'ignored' });
            return res.status(200).json({ success: true, ignored: true, reason: 'missing_order_id' });
        }

        const [existingRows] = await db.query(
            `
                SELECT id, status
                FROM orders
                WHERE external_order_id = ?
                  AND delivery_provider = 'Lalamove'
                LIMIT 1
            `,
            [String(externalOrderId)]
        );
        const existingOrder = existingRows[0] || null;
        const previousStatus = String(existingOrder?.status || '').trim();

        const incomingStatus =
            payload.status ||
            payload.orderStatus ||
            payload?.order?.status ||
            null;

        const incomingDriverId =
            payload.driverId ||
            payload?.driver?.driverId ||
            payload?.driver?.id ||
            null;
        const normalizedIncomingStatus = String(incomingStatus || '').toUpperCase();
        const shouldStartCancelWindow =
            normalizedEventType === 'DRIVER_ASSIGNED' || normalizedIncomingStatus === 'ON_GOING';

        const mappedOrderStatus = mapLalamoveUpdateToOrderStatus({
            eventType,
            lalamoveStatus: incomingStatus
        });

        const [updateResult] = await db.query(
            `UPDATE orders
             SET
               lalamove_status = COALESCE(?, lalamove_status),
               driver_id = COALESCE(?, driver_id),
               status = COALESCE(?, status),
               lalamove_ongoing_at = CASE
                   WHEN ? = 1 OR UPPER(COALESCE(?, '')) = 'ON_GOING' THEN COALESCE(lalamove_ongoing_at, UTC_TIMESTAMP())
                   ELSE lalamove_ongoing_at
               END
             WHERE external_order_id = ?
               AND delivery_provider = 'Lalamove'`,
            [
                incomingStatus,
                incomingDriverId,
                mappedOrderStatus,
                shouldStartCancelWindow ? 1 : 0,
                incomingStatus,
                String(externalOrderId)
            ]
        );

        if (
            updateResult?.affectedRows > 0 &&
            existingOrder &&
            mappedOrderStatus &&
            mappedOrderStatus !== previousStatus
        ) {
            emitOrdersChangedEvent({
                source: 'lalamove_webhook',
                orderId: existingOrder.id,
                reason: mappedOrderStatus || 'status_update'
            });
            if (mappedOrderStatus === 'Completed') {
                emailService.queueOrderEventEmail(existingOrder.id, 'completed');
            } else if (mappedOrderStatus === 'Cancelled') {
                emailService.queueOrderEventEmail(existingOrder.id, 'cancelled');
            }
        }

        await markWebhookEventProcessed(webhookReservation);
        recordWebhookEvent({ provider: 'lalamove', eventType, status: 'processed' });

        console.log(`Webhook received: ${eventType} for Lalamove order ${externalOrderId}`);
        return res.status(200).json({ success: true });
    } catch (error) {
        if (webhookReservation?.provider && webhookReservation?.eventId) {
            await markWebhookEventFailed({
                provider: webhookReservation.provider,
                eventId: webhookReservation.eventId,
                errorMessage: error?.message || 'Webhook processing failed'
            }).catch(() => null);
        }
        recordWebhookEvent({
            provider: 'lalamove',
            eventType: req.body?.type || req.body?.eventType || req.body?.event || 'unknown',
            status: 'failed'
        });
        console.error('Webhook processing failed:', error);
        return res.status(error.status || 500).json({ error: error.message || 'Webhook processing failed' });
    }
});

// --- HANDLE CLIENT-SIDE ROUTING ---
// Return JSON 404 for unknown API paths; keep SPA fallback for frontend routes.
app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || (shouldAliasToApi(req.path) && !isBrowserDocumentRequest(req))) {
        return res.status(404).json({ error: 'API route not found' });
    }
    return res.sendFile(path.join(__dirname, '../dist/index.html'));
});

const startServer = async () => {
    await assertNoPendingMigrations();
    emailService.startWorker();
    await new Promise((resolve, reject) => {
        const server = app.listen(PORT, HOST, () => {
            console.log(`🚀 Backend running on http://${HOST}:${PORT}`);
            resolve();
        });
        server.on('error', (error) => {
            reject(error);
        });
    });
};

startServer().catch((error) => {
    console.error('❌ Server startup failed:', error?.message || error);
    process.exit(1);
});
