'use strict';

/**
 * Domain routes: delivery
 * Pure extraction from server/index.js monolith — behavior preserved.
 */
const db = require('../db');
const lalamoveService = require('../lalamoveService');
const { requireAuth } = require('../middleware/auth');
const { fetchDeliveryOptions } = require('../services/paymentOptions');
const { fetchShopStatus } = require('../services/shop');
const { reserveDeliveryQuote } = require('../services/lalamoveHelpers');
const {
    toNumber,
    isValidLatitude,
    isValidLongitude,
    roundCoordinate,
    normalizeCurrencyCode
} = require('../lib/primitives');
const { ORDER_DELIVERY_TIMING_NOW, ORDER_DELIVERY_TIMING_SCHEDULED } = require('../config');
const { parseScheduledAtUtc } = require('../services/orders/orderEvents');
const { createInMemoryRateLimiter } = require('../middleware/rateLimit');

const quoteRateLimiter = createInMemoryRateLimiter({
    windowMs: 60 * 1000,
    max: 30,
    keyFn: (req) => `delivery-quote:${req.user?.id || req.ip || 'unknown'}`
});


module.exports = function registerDeliveryRoutes(app) {

    app.post('/api/delivery/quote', requireAuth, quoteRateLimiter, async (req, res) => {
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
                dropoffAddress: String(addressLine || '').trim().slice(0, 200),
                dropoffLat: normalizedLat,
                dropoffLng: normalizedLng,
                dropoffNote: String(note || '').trim().slice(0, 66),
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
                ...(process.env.NODE_ENV !== 'production' && error.payload
                    ? { details: error.payload }
                    : {})
            });
        }
    });
};
