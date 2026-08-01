/**
 * Application configuration & startup validation.
 * Validation is explicit (call validateStartupConfig) — never import-time side effects.
 * dotenv MUST load before any process.env reads below.
 */
'use strict';

require('dotenv').config();

const NODE_ENV = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
const IS_PRODUCTION = NODE_ENV === 'production';
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const METRICS_ENABLED = String(process.env.METRICS_ENABLED || 'true').trim().toLowerCase() !== 'false';
const METRICS_AUTH_TOKEN = String(process.env.METRICS_AUTH_TOKEN || '').trim();
const METRICS_REQUIRE_AUTH =
    String(process.env.METRICS_REQUIRE_AUTH || (IS_PRODUCTION ? 'true' : 'false')).trim().toLowerCase() !==
    'false';
const JWT_SECRET = String(process.env.JWT_SECRET || '').trim();
const TRUST_PROXY_SETTING = String(process.env.TRUST_PROXY || '').trim();
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '';
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'admin@takcakap.com').trim().toLowerCase();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '').trim();
const ADMIN_NAME = String(process.env.ADMIN_NAME || 'TakCakap Admin').trim();
const PAYMENT_METHOD_CURLEC = 'Curlec';
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
const ADMIN_PORT = process.env.ADMIN_PORT || '5174';
CORS_ORIGIN_SET.add(normalizeCorsOrigin(`http://localhost:${ADMIN_PORT}`));
CORS_ORIGIN_SET.add(normalizeCorsOrigin(`http://127.0.0.1:${ADMIN_PORT}`));
const CURLEC_CALLBACK_TRUSTED_ORIGINS = new Set(
    ['https://api.razorpay.com', 'https://checkout.razorpay.com'].map((origin) => normalizeCorsOrigin(origin))
);
const isCurlecCallbackPath = (requestPath) => {
    const normalizedPath = String(requestPath || '').split('?')[0];
    return normalizedPath === '/api/payments/curlec/callback' || normalizedPath === '/payments/curlec/callback';
};
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
/** Drop / ignore admin FCM tokens not refreshed within this many days. */
const ADMIN_FCM_TOKEN_MAX_AGE_DAYS = Math.max(
    1,
    Number.parseInt(String(process.env.ADMIN_FCM_TOKEN_MAX_AGE_DAYS || '14'), 10) || 14
);
/** How often to run stale-token prune (ms). Default 6 hours. */
const ADMIN_FCM_TOKEN_PRUNE_INTERVAL_MS = Math.max(
    60 * 1000,
    Number.parseInt(String(process.env.ADMIN_FCM_TOKEN_PRUNE_INTERVAL_MS || String(6 * 60 * 60 * 1000)), 10)
        || 6 * 60 * 60 * 1000
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
const KUALA_LUMPUR_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

function validateStartupConfig() {
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

    // Payment callbacks must not fall back to request Host (open-redirect risk).
    if (IS_PRODUCTION) {
        if (!PUBLIC_APP_URL) {
            problems.push('PUBLIC_APP_URL must be set in production (absolute URL for payment redirects)');
        } else {
            try {
                const parsed = new URL(PUBLIC_APP_URL);
                if (!['http:', 'https:'].includes(parsed.protocol)) {
                    problems.push('PUBLIC_APP_URL must be an absolute http(s) URL');
                }
            } catch {
                problems.push('PUBLIC_APP_URL must be a valid absolute URL');
            }
        }
    } else if (PUBLIC_APP_URL) {
        try {
            // eslint-disable-next-line no-new
            new URL(PUBLIC_APP_URL);
        } catch {
            problems.push('PUBLIC_APP_URL must be a valid absolute URL when set');
        }
    }

    if (problems.length > 0) {
        const message = `Startup configuration invalid: ${problems.join('; ')}`;
        const error = new Error(message);
        error.status = 500;
        throw error;
    }
}

module.exports = {
    NODE_ENV,
    IS_PRODUCTION,
    PORT,
    HOST,
    METRICS_ENABLED,
    METRICS_AUTH_TOKEN,
    METRICS_REQUIRE_AUTH,
    JWT_SECRET,
    TRUST_PROXY_SETTING,
    GOOGLE_CLIENT_ID,
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    ADMIN_NAME,
    ADMIN_PORT,
    PAYMENT_METHOD_CURLEC,
    parsedDefaultServiceFee,
    DEFAULT_SERVICE_FEE,
    CURLEC_API_BASE_URL,
    CURLEC_KEY_ID,
    CURLEC_KEY_SECRET,
    CURLEC_WEBHOOK_SECRET,
    CURLEC_WEBHOOK_OLD_SECRET,
    LALAMOVE_API_KEY,
    LALAMOVE_API_SECRET,
    LALAMOVE_WEBHOOK_SECRET,
    LALAMOVE_DEFAULT_REMARK_TEMPLATE,
    LALAMOVE_REMARK_MAX_LENGTH,
    CURLEC_CHECKOUT_NAME,
    CURLEC_CHECKOUT_DESCRIPTION,
    CURLEC_THEME_COLOR,
    PUBLIC_APP_URL,
    SHOP_TIMEZONE,
    DEFAULT_SHOP_OPEN_TIME,
    DEFAULT_SHOP_CLOSE_TIME,
    DEFAULT_STORE_NAME,
    DEFAULT_STORE_PHONE,
    DEFAULT_STORE_ADDRESS,
    DEFAULT_STORE_LATITUDE,
    DEFAULT_STORE_LONGITUDE,
    DEFAULT_BRAND_LOGO_URL,
    CORS_ORIGINS,
    CORS_ORIGIN_SET,
    normalizeCorsOrigin,
    CURLEC_CALLBACK_TRUSTED_ORIGINS,
    isCurlecCallbackPath,
    HH_MM_PATTERN,
    ORDER_DELIVERY_TIMING_NOW,
    ORDER_DELIVERY_TIMING_SCHEDULED,
    MIN_SCHEDULE_LEAD_MINUTES,
    LALAMOVE_CANCEL_LIMIT_SECONDS,
    CURLEC_HTTP_TIMEOUT_MS,
    REFUND_ELIGIBILITY_HOURS,
    PICKUP_COMPLETED_REFUND_ELIGIBILITY_HOURS,
    REFUND_WINDOW_MS,
    REFUND_TIMEFRAME_LABEL,
    REFUND_STATUS_PENDING,
    REFUND_STATUS_PROCESSED,
    REFUND_STATUS_FAILED,
    ADMIN_ORDERS_DEFAULT_LIMIT,
    ADMIN_ORDERS_MAX_LIMIT,
    USER_ORDERS_DEFAULT_LIMIT,
    USER_ORDERS_MAX_LIMIT,
    ADMIN_ORDER_SYNC_DEFAULT_LIMIT,
    ADMIN_ORDER_SYNC_MAX_LIMIT,
    INTERNAL_ORDER_RECONCILIATION_TIMEOUT_MS,
    ADMIN_ORDER_EVENTS_RETRY_MS,
    ADMIN_ORDER_EVENTS_HEARTBEAT_MS,
    ADMIN_ORDER_STREAM_TOKEN_TTL_SECONDS,
    ADMIN_FCM_TOKEN_MAX_AGE_DAYS,
    ADMIN_FCM_TOKEN_PRUNE_INTERVAL_MS,
    AUTH_RATE_LIMIT_WINDOW_MS,
    AUTH_RATE_LIMIT_MAX_ATTEMPTS,
    WEBHOOK_RATE_LIMIT_WINDOW_MS,
    WEBHOOK_RATE_LIMIT_MAX_REQUESTS,
    LALAMOVE_WEBHOOK_MAX_SKEW_SECONDS,
    KUALA_LUMPUR_UTC_OFFSET_MS,
    MS_PER_DAY,
    API_ALIAS_PREFIXES,
    validateStartupConfig
};
