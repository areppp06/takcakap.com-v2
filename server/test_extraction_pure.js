/**
 * Pure extraction unit tests (no DB/listen).
 * Run: node server/test_extraction_pure.js
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev-test-secret-at-least-32-characters-long-xx';

const {
    toNumber,
    toPositiveInteger,
    toUtcIsoString,
    toIsoUtcString,
    normalizeCurrencyCode,
    safeHexEqual,
    roundCoordinate
} = require('./lib/primitives');
const { toMinorUnits, fromMinorUnits, toMinorUnitsAllowZero } = require('./lib/money');
const { canRetryLalamoveDispatch } = require('./services/orders/orderEvents');
const { getNextOrderCode, incrementPrefix } = require('./services/orders/orderCodes');
const {
    computeLalamoveCancelState,
    mapLalamoveUpdateToOrderStatus,
    isLalamoveInvalidQuotationError
} = require('./services/lalamoveHelpers');
const { shouldAliasToApi, isBrowserDocumentRequest } = require('./middleware/apiAlias');
const {
    buildWebhookPayloadHash,
    verifyLegacyLalamoveWebhookSignature,
    parseWebhookTimestampMs
} = require('./services/webhookInbox');
const { createJsonBodyParser } = require('./middleware/bodyParser');

console.log('pure extractions');

// primitives
assert.strictEqual(toNumber('12.5'), 12.5);
assert.strictEqual(toNumber(''), null);
assert.strictEqual(toPositiveInteger('3'), 3);
assert.strictEqual(toPositiveInteger(0), null);
assert.ok(toUtcIsoString('2024-01-01 00:00:00')?.endsWith('Z'));
assert.strictEqual(toIsoUtcString, toUtcIsoString);
assert.strictEqual(normalizeCurrencyCode('myr'), 'MYR');
assert.strictEqual(roundCoordinate(1.23456789), 1.2345679);
console.log('  ✓ primitives / money');

assert.strictEqual(toMinorUnits(10.5), 1050);
assert.strictEqual(fromMinorUnits(1050), 10.5);
assert.strictEqual(toMinorUnitsAllowZero(0), 0);

// safeHexEqual
const hex = crypto.createHash('sha256').update('x').digest('hex');
assert.strictEqual(safeHexEqual(hex, hex), true);
assert.strictEqual(safeHexEqual(hex, '00' + hex.slice(2)), false);
console.log('  ✓ safeHexEqual');

// order codes
assert.strictEqual(getNextOrderCode(null), 'AAA-001');
assert.strictEqual(getNextOrderCode('AAA-001'), 'AAA-002');
assert.strictEqual(getNextOrderCode('AAA-999'), 'AAB-001');
assert.strictEqual(incrementPrefix('AAZ'), 'ABA');
console.log('  ✓ order codes');

// canRetry
assert.strictEqual(
    canRetryLalamoveDispatch({
        order_type: 'Delivery',
        status: 'Preparing',
        delivery_booking_status: 'booking_failed'
    }),
    true
);
assert.strictEqual(
    canRetryLalamoveDispatch({
        order_type: 'Delivery',
        status: 'Completed',
        delivery_booking_status: 'booked'
    }),
    false
);
assert.strictEqual(
    canRetryLalamoveDispatch({
        order_type: 'Pickup',
        status: 'Preparing',
        delivery_booking_status: 'not_required'
    }),
    false
);
console.log('  ✓ canRetryLalamoveDispatch');

// lalamove helpers
assert.strictEqual(
    mapLalamoveUpdateToOrderStatus({ lalamoveStatus: 'PICKED_UP' }),
    'Out For Delivery'
);
assert.strictEqual(
    isLalamoveInvalidQuotationError({ payload: { errors: [{ id: 'ERR_INVALID_QUOTATION_ID' }] } }),
    true
);
const cancelOpen = computeLalamoveCancelState({
    deliveryProvider: 'Lalamove',
    lalamoveStatus: 'ASSIGNING_DRIVER',
    lalamoveOngoingAtUtc: null
});
assert.strictEqual(cancelOpen.canCancelLalamove, true);
console.log('  ✓ lalamove helpers');

// api alias
assert.strictEqual(shouldAliasToApi('/orders'), true);
assert.strictEqual(shouldAliasToApi('/api/orders'), false);
assert.strictEqual(
    isBrowserDocumentRequest({ method: 'GET', headers: { accept: 'text/html' } }),
    true
);
console.log('  ✓ apiAlias');

// webhook hash + timestamp parse
const hash = buildWebhookPayloadHash('{"a":1}');
assert.strictEqual(hash.length, 64);
assert.ok(parseWebhookTimestampMs(String(Math.floor(Date.now() / 1000))) > 0);
console.log('  ✓ webhook helpers');

// rawBody: call production captureWebhookRawBody (not a reimplementation)
{
    const {
        captureWebhookRawBody,
        isWebhookRawBodyPath,
        createJsonBodyParser
    } = require('./middleware/bodyParser');
    assert.ok(typeof createJsonBodyParser() === 'function');
    assert.strictEqual(isWebhookRawBodyPath('/api/webhooks/curlec'), true);
    assert.strictEqual(isWebhookRawBodyPath('/api/orders'), false);

    const buf = Buffer.from('{"ok":true}');
    const webhookReq = { originalUrl: '/api/webhooks/lalamove' };
    captureWebhookRawBody(webhookReq, null, buf);
    assert.strictEqual(webhookReq.rawBody, '{"ok":true}');

    const orderReq = { originalUrl: '/api/orders' };
    captureWebhookRawBody(orderReq, null, buf);
    assert.strictEqual(orderReq.rawBody, undefined);

    const emptyReq = { originalUrl: '/api/webhooks/curlec' };
    captureWebhookRawBody(emptyReq, null, Buffer.alloc(0));
    assert.strictEqual(emptyReq.rawBody, undefined);
    console.log('  ✓ rawBody production verify');
}

// HMAC unit vectors (Curlec + Lalamove)
{
    const crypto = require('crypto');
    // Isolate secrets for Curlec verify
    const prev = {
        CURLEC_WEBHOOK_SECRET: process.env.CURLEC_WEBHOOK_SECRET,
        CURLEC_WEBHOOK_OLD_SECRET: process.env.CURLEC_WEBHOOK_OLD_SECRET,
        LALAMOVE_API_KEY: process.env.LALAMOVE_API_KEY,
        LALAMOVE_API_SECRET: process.env.LALAMOVE_API_SECRET,
        LALAMOVE_WEBHOOK_SECRET: process.env.LALAMOVE_WEBHOOK_SECRET
    };
    process.env.CURLEC_WEBHOOK_SECRET = 'curlec_test_secret';
    process.env.CURLEC_WEBHOOK_OLD_SECRET = '';
    process.env.LALAMOVE_API_KEY = 'pk_test_key';
    process.env.LALAMOVE_API_SECRET = 'lala_test_secret';
    process.env.LALAMOVE_WEBHOOK_SECRET = '';

    delete require.cache[require.resolve('./config')];
    delete require.cache[require.resolve('./services/curlecClient')];
    delete require.cache[require.resolve('./services/webhookInbox')];
    delete require.cache[require.resolve('./lib/primitives')];

    const { verifyCurlecWebhookSignature } = require('./services/curlecClient');
    const {
        verifyLalamoveWebhookSignature,
        verifyLegacyLalamoveWebhookSignature
    } = require('./services/webhookInbox');

    const rawBody = '{"event":"payment.captured"}';
    const goodCurlec = crypto
        .createHmac('sha256', 'curlec_test_secret')
        .update(rawBody)
        .digest('hex');
    assert.strictEqual(verifyCurlecWebhookSignature({ rawBody, signature: goodCurlec }), true);
    assert.strictEqual(verifyCurlecWebhookSignature({ rawBody, signature: 'deadbeef' }), false);

    const ts = '1700000000';
    const path = '/v3/webhook';
    const dataPayload = { order: { id: '1' } };
    const signedBody = JSON.stringify(dataPayload);
    const rawSig = `${ts}\r\nPOST\r\n${path}\r\n\r\n${signedBody}`;
    const goodLala = crypto.createHmac('sha256', 'lala_test_secret').update(rawSig).digest('hex');
    const lalaOk = verifyLalamoveWebhookSignature({
        signature: goodLala,
        timestamp: ts,
        apiKey: 'pk_test_key',
        requestPath: path,
        dataPayload,
        rawBody: signedBody
    });
    assert.strictEqual(lalaOk.ok, true);
    const lalaBad = verifyLalamoveWebhookSignature({
        signature: '00' + goodLala.slice(2),
        timestamp: ts,
        apiKey: 'pk_test_key',
        requestPath: path,
        dataPayload,
        rawBody: signedBody
    });
    assert.strictEqual(lalaBad.ok, false);

    // legacy imported and callable
    assert.strictEqual(
        typeof verifyLegacyLalamoveWebhookSignature,
        'function'
    );

    // restore env + caches
    for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    delete require.cache[require.resolve('./config')];
    delete require.cache[require.resolve('./services/curlecClient')];
    delete require.cache[require.resolve('./services/webhookInbox')];
    console.log('  ✓ HMAC Curlec + Lalamove vectors');
}

console.log('\nAll pure extraction tests passed.');
