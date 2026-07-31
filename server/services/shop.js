/**
 * Shop settings & open/closed status.
 */
'use strict';

const db = require('../db');
const {
    HH_MM_PATTERN,
    SHOP_TIMEZONE,
    DEFAULT_SHOP_OPEN_TIME,
    DEFAULT_SHOP_CLOSE_TIME,
    DEFAULT_STORE_NAME,
    DEFAULT_STORE_PHONE,
    DEFAULT_STORE_ADDRESS,
    DEFAULT_STORE_LATITUDE,
    DEFAULT_STORE_LONGITUDE
} = require('../config');
const { toNumber } = require('../lib/primitives');

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

module.exports = {
    isValidHHMM,
    hhmmToMinutes,
    getCurrentMinutesInTimezone,
    isWithinOperatingWindow,
    fetchShopSettings,
    computeShopStatus,
    fetchShopStatus
};
