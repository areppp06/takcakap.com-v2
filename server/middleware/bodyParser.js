/**
 * JSON body parser with rawBody capture for webhook HMAC verification.
 */
'use strict';

const express = require('express');

const WEBHOOK_RAW_BODY_PREFIXES = [
    '/api/webhooks/curlec',
    '/webhooks/curlec',
    '/api/webhooks/lalamove',
    '/webhooks/lalamove'
];

function isWebhookRawBodyPath(originalUrl) {
    const url = String(originalUrl || '');
    return WEBHOOK_RAW_BODY_PREFIXES.some((prefix) => url.startsWith(prefix));
}

/**
 * Capture raw body for HMAC verification on webhook paths only.
 * Exported for unit tests.
 */
function captureWebhookRawBody(req, _res, buffer) {
    if (!buffer?.length) return;
    if (isWebhookRawBodyPath(req.originalUrl)) {
        req.rawBody = buffer.toString('utf8');
    }
}

function createJsonBodyParser() {
    return express.json({
        limit: '256kb',
        verify: captureWebhookRawBody
    });
}

function createUrlencodedParser() {
    return express.urlencoded({ extended: false });
}

module.exports = {
    WEBHOOK_RAW_BODY_PREFIXES,
    isWebhookRawBodyPath,
    captureWebhookRawBody,
    createJsonBodyParser,
    createUrlencodedParser
};
