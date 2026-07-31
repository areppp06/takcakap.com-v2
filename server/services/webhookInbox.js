/**
 * Webhook inbox: signature verification + idempotency reservation.
 */
'use strict';

const crypto = require('crypto');
const db = require('../db');
const {
    LALAMOVE_API_KEY,
    LALAMOVE_API_SECRET,
    LALAMOVE_WEBHOOK_SECRET
} = require('../config');
const { safeHexEqual, firstHeaderValue } = require('../lib/primitives');

const normalizeWebhookSignature = (value) =>
    String(value || '')
        .trim()
        .replace(/^sha256=/i, '')
        .replace(/^hmac\s+/i, '')
        .trim();

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

module.exports = {
    normalizeWebhookSignature,
    firstHeaderValue,
    normalizeWebhookRequestPath,
    parseLalamoveHmacAuthorizationHeader,
    parseWebhookTimestampMs,
    verifyLegacyLalamoveWebhookSignature,
    verifyLalamoveWebhookSignature,
    buildWebhookPayloadHash,
    reserveWebhookEventForProcessing,
    markWebhookEventProcessed,
    markWebhookEventFailed
};
