'use strict';

/**
 * Domain routes: shop
 * Pure extraction from server/index.js monolith — behavior preserved.
 */
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const {
    DEFAULT_SHOP_OPEN_TIME,
    DEFAULT_SHOP_CLOSE_TIME,
    DEFAULT_STORE_NAME,
    DEFAULT_STORE_PHONE,
    DEFAULT_STORE_ADDRESS,
    DEFAULT_STORE_LATITUDE,
    DEFAULT_STORE_LONGITUDE,
    DEFAULT_SERVICE_FEE,
    CURLEC_KEY_ID,
    CURLEC_CHECKOUT_NAME
} = require('../config');
const {
    isValidHHMM,
    fetchShopSettings,
    computeShopStatus,
    fetchShopStatus
} = require('../services/shop');
const lalamoveService = require('../lalamoveService');
const { fetchDeliveryOptions, fetchPaymentOptions } = require('../services/paymentOptions');
const {
    toNumber,
    isValidLatitude,
    isValidLongitude,
    roundCoordinate
} = require('../lib/primitives');
const { isCurlecConfigured } = require('../services/curlecClient');
const { getCurlecCallbackPayload, buildCurlecCheckoutReturnUrl } = require('../services/curlec');


module.exports = function registerShopRoutes(app) {

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
        const hasCurlecEnabled = req.body?.curlecEnabled !== undefined;
        const hasServiceFee = req.body?.serviceFee !== undefined;

        if (!hasCurlecEnabled && !hasServiceFee) {
            return res.status(400).json({
                error: 'curlecEnabled or serviceFee is required'
            });
        }

        const serviceFeeRaw = hasServiceFee ? toNumber(req.body?.serviceFee) : null;
        const normalizedServiceFee = hasServiceFee && serviceFeeRaw !== null ? Number(serviceFeeRaw.toFixed(2)) : null;
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
                        duitnow_enabled = FALSE,
                        curlec_enabled = COALESCE(?, curlec_enabled),
                        service_fee = COALESCE(?, service_fee)
                    WHERE id = 1
                `,
                [
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
};
