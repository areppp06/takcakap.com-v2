'use strict';

/**
 * Domain routes: payments
 * Pure extraction from server/index.js monolith — behavior preserved.
 */
const crypto = require('crypto');
const db = require('../db');
const {
    CURLEC_CHECKOUT_DESCRIPTION,
    CURLEC_CHECKOUT_NAME,
    CURLEC_KEY_ID,
    CURLEC_THEME_COLOR
} = require('../config');
const { requireAuth } = require('../middleware/auth');
const { fetchPaymentOptions } = require('../services/paymentOptions');
const {
    callCurlecApi,
    toMinorUnits,
    normalizeCurlecOrderDraftPayload,
    upsertCurlecCheckoutSession,
    getCurlecCallbackPayload,
    buildCurlecCheckoutReturnUrl,
    verifyCurlecPaymentSignature
} = require('../services/curlec');
const { toNumber } = require('../lib/primitives');


module.exports = function registerPaymentsRoutes(app) {

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
            console.error('Failed to create Curlec order:', error?.payload || error?.message || error);
            const body = { error: error.message || 'Failed to create Curlec order' };
            if (process.env.NODE_ENV !== 'production' && error.payload) {
                body.details = error.payload;
            }
            return res.status(error.status || 500).json(body);
        }
    });
};
