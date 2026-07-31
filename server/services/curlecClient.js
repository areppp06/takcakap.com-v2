/**
 * Curlec HTTP client, signatures, and pure payment helpers.
 * Higher-level refund/webhook application lives in curlec.js.
 */
'use strict';

const crypto = require('crypto');
const {
    CURLEC_API_BASE_URL,
    CURLEC_KEY_ID,
    CURLEC_KEY_SECRET,
    CURLEC_HTTP_TIMEOUT_MS,
    CURLEC_WEBHOOK_SECRET,
    CURLEC_WEBHOOK_OLD_SECRET,
    PAYMENT_METHOD_CURLEC,
    REFUND_STATUS_PENDING,
    REFUND_STATUS_PROCESSED,
    REFUND_STATUS_FAILED,
    REFUND_TIMEFRAME_LABEL,
    PUBLIC_APP_URL,
    PORT
} = require('../config');
const {
    toNumber,
    toPositiveInteger,
    toNonEmptyString,
    safeHexEqual
} = require('../lib/primitives');
const {
    toMinorUnits,
    toMinorUnitsAllowZero,
    fromMinorUnits,
    formatMinorUnitsAsMyr
} = require('../lib/money');

const normalizePaymentMethod = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'curlec' || normalized === '') return PAYMENT_METHOD_CURLEC;
    if (normalized === 'duitnow') {
        return 'DuitNow';
    }
    return PAYMENT_METHOD_CURLEC;
};

const assertCurlecPaymentMethodForNewOrder = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized && normalized !== 'curlec') {
        const error = new Error('Only Curlec payment is supported');
        error.status = 400;
        throw error;
    }
    return PAYMENT_METHOD_CURLEC;
};

const isCurlecConfigured = () => Boolean(CURLEC_KEY_ID && CURLEC_KEY_SECRET);

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

/**
 * Resolve public app base URL for payment return redirects.
 * Never trust request Host / X-Forwarded-Host for payment redirects (open redirect).
 * Production requires PUBLIC_APP_URL via validateStartupConfig.
 */
const resolvePublicAppBaseUrl = (_req) => {
    if (PUBLIC_APP_URL) {
        try {
            return new URL(PUBLIC_APP_URL).toString().replace(/\/$/, '');
        } catch {
            const error = new Error('PUBLIC_APP_URL is not a valid absolute URL');
            error.status = 500;
            throw error;
        }
    }
    // Non-production only: local fallback for dev when env not set.
    const { IS_PRODUCTION } = require('../config');
    if (IS_PRODUCTION) {
        const error = new Error('PUBLIC_APP_URL must be configured for payment redirects');
        error.status = 500;
        throw error;
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

const createCurlecPaymentSignature = ({ orderId, paymentId }) => {
    if (!isCurlecConfigured()) return '';
    return crypto
        .createHmac('sha256', CURLEC_KEY_SECRET)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');
};

module.exports = {
    normalizePaymentMethod,
    assertCurlecPaymentMethodForNewOrder,
    isCurlecConfigured,
    toMinorUnits,
    toMinorUnitsAllowZero,
    fromMinorUnits,
    normalizeCurlecPaymentPayload,
    safeHexEqual,
    verifyCurlecPaymentSignature,
    callCurlecApi,
    normalizeCurlecRefundStatus,
    normalizeCurlecRefundSpeed,
    isCurlecInstantRefundUnsupportedError,
    isCurlecInvalidRequestError,
    formatMinorUnitsAsMyr,
    fetchCurlecBalanceMinorUnits,
    buildCurlecRefundTimeframeMessage,
    verifyCurlecWebhookSignature,
    resolvePublicAppBaseUrl,
    getCurlecCallbackPayload,
    buildCurlecCheckoutReturnUrl,
    createCurlecPaymentSignature
};
