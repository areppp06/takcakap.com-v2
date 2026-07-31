'use strict';

/**
 * Domain routes: webhooks
 * Pure extraction from server/index.js monolith — behavior preserved.
 */
const db = require('../db');
const emailService = require('../emailService');
const loyaltyService = require('../loyaltyService');
const refundService = require('../services/refundService');
const {
    CURLEC_WEBHOOK_SECRET,
    LALAMOVE_API_KEY,
    LALAMOVE_API_SECRET,
    LALAMOVE_WEBHOOK_MAX_SKEW_SECONDS,
    LALAMOVE_WEBHOOK_SECRET
} = require('../config');
const { webhookRateLimiter } = require('../middleware/rateLimit');
const { recordWebhookEvent } = require('../observability');
const { emitOrdersChangedEvent } = require('../services/orders/orderEvents');
const { mapLalamoveUpdateToOrderStatus } = require('../services/lalamoveHelpers');
const {
    applyCurlecPaymentCapturedWebhookUpdate,
    applyCurlecRefundWebhookUpdate
} = require('../services/curlec');
const {
    buildWebhookPayloadHash,
    firstHeaderValue,
    markWebhookEventFailed,
    markWebhookEventProcessed,
    parseLalamoveHmacAuthorizationHeader,
    parseWebhookTimestampMs,
    reserveWebhookEventForProcessing,
    verifyLalamoveWebhookSignature
} = require('../services/webhookInbox');
const { verifyCurlecWebhookSignature } = require('../services/curlecClient');


module.exports = function registerWebhooksRoutes(app) {

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

            const terminalLalamove =
                ['REJECTED', 'EXPIRED', 'CANCELED', 'CANCELLED'].includes(
                    String(incomingStatus || '').toUpperCase()
                );
            const [updateResult] = await db.query(
                `UPDATE orders
                 SET
                   lalamove_status = COALESCE(?, lalamove_status),
                   driver_id = COALESCE(?, driver_id),
                   status = COALESCE(?, status),
                   lalamove_ongoing_at = CASE
                       WHEN ? = 1 OR UPPER(COALESCE(?, '')) = 'ON_GOING' THEN COALESCE(lalamove_ongoing_at, UTC_TIMESTAMP())
                       ELSE lalamove_ongoing_at
                   END,
                   delivery_booking_status = CASE
                       WHEN ? = 1 AND UPPER(COALESCE(?, '')) IN ('REJECTED', 'EXPIRED') THEN 'terminal_failed'
                       WHEN ? = 1 AND UPPER(COALESCE(?, '')) IN ('CANCELED', 'CANCELLED') THEN 'cancelled'
                       WHEN UPPER(COALESCE(?, '')) IN ('ASSIGNING_DRIVER', 'ON_GOING', 'PICKED_UP', 'COMPLETED') THEN 'booked'
                       ELSE delivery_booking_status
                   END,
                   delivery_booking_error = CASE
                       WHEN ? = 1 AND UPPER(COALESCE(?, '')) IN ('REJECTED', 'EXPIRED')
                           THEN CONCAT('Lalamove terminal status: ', COALESCE(?, 'UNKNOWN'))
                       ELSE delivery_booking_error
                   END
                 WHERE external_order_id = ?
                   AND delivery_provider = 'Lalamove'`,
                [
                    incomingStatus,
                    incomingDriverId,
                    mappedOrderStatus,
                    shouldStartCancelWindow ? 1 : 0,
                    incomingStatus,
                    terminalLalamove ? 1 : 0,
                    incomingStatus,
                    terminalLalamove ? 1 : 0,
                    incomingStatus,
                    incomingStatus,
                    terminalLalamove ? 1 : 0,
                    incomingStatus,
                    incomingStatus,
                    String(externalOrderId)
                ]
            );

            const statusChanged =
                Boolean(mappedOrderStatus) && mappedOrderStatus !== previousStatus;
            const terminalBookingEvent = ['REJECTED', 'EXPIRED'].includes(normalizedIncomingStatus);
            if (updateResult?.affectedRows > 0 && existingOrder && (statusChanged || terminalBookingEvent)) {
                emitOrdersChangedEvent({
                    source: 'lalamove_webhook',
                    orderId: existingOrder.id,
                    reason: terminalBookingEvent ? 'delivery_terminal_failed' : 'lalamove_webhook'
                });
                if (mappedOrderStatus === 'Completed') {
                    emailService.queueOrderEventEmail(existingOrder.id, 'completed');
                    try {
                        await loyaltyService.awardPointsForOrder(existingOrder.id);
                    } catch (pointsError) {
                        console.error(
                            `Failed to award points for order ${existingOrder.id}:`,
                            pointsError
                        );
                    }
                } else if (mappedOrderStatus === 'Cancelled') {
                    try {
                        await refundService.applyOrderVoidSideEffects(existingOrder.id, {
                            reason: 'Lalamove cancelled'
                        });
                    } catch (voidError) {
                        console.error(
                            `Failed void side-effects for order ${existingOrder.id}:`,
                            voidError
                        );
                    }
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
};
