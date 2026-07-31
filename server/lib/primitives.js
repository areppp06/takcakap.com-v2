/**
 * Pure helpers shared across services (no DB / network).
 */
'use strict';

const crypto = require('crypto');

const toNumber = (value) => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const toPositiveInteger = (value) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return null;
    return parsed;
};

const toUtcIsoString = (value) => {
    if (value === undefined || value === null) return null;
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return null;
        return value.toISOString();
    }

    const raw = String(value).trim();
    if (!raw) return null;
    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
    const hasTimezone = /Z$|[+-]\d{2}:\d{2}$/.test(normalized);
    const parsed = new Date(hasTimezone ? normalized : `${normalized}Z`);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
};

const toSqlDateTimeUtc = (value) => {
    const iso = toUtcIsoString(value);
    if (!iso) return null;
    const date = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
        date.getUTCHours()
    )}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
};

/** @deprecated Prefer toUtcIsoString — kept as alias for call-site compatibility. */
const toIsoUtcString = toUtcIsoString;

const parsePositiveIntWithBounds = (value, { fallback = null, min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const parsed = Number.parseInt(String(value || ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    if (parsed < min) return fallback;
    return Math.min(parsed, max);
};

const toNonEmptyString = (value) => {
    if (Array.isArray(value)) {
        for (const item of value) {
            const candidate = toNonEmptyString(item);
            if (candidate) return candidate;
        }
        return '';
    }
    if (value === undefined || value === null) return '';
    const normalized = String(value).trim();
    return normalized;
};

const roundCoordinate = (value, precision = 7) => {
    if (!Number.isFinite(value)) return null;
    return Number(value.toFixed(precision));
};

const formatMoneyMYR = (value) => `RM${Number(value || 0).toFixed(2)}`;

const isValidLatitude = (value) => value !== null && value >= -90 && value <= 90;
const isValidLongitude = (value) => value !== null && value >= -180 && value <= 180;

const safeHexEqual = (actualHex, expectedHex) => {
    try {
        const actual = Buffer.from(String(actualHex || '').trim(), 'hex');
        const expected = Buffer.from(String(expectedHex || '').trim(), 'hex');
        if (actual.length === 0 || expected.length === 0 || actual.length !== expected.length) {
            return false;
        }
        return crypto.timingSafeEqual(actual, expected);
    } catch (_error) {
        return false;
    }
};

const tryParseJsonObject = (value) => {
    if (!value) return null;
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(String(value));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
    } catch {
        return null;
    }
    return null;
};

const toUserId = (value) => {
    if (value === undefined || value === null || value === '') return 1;
    const direct = toPositiveInteger(value);
    if (direct !== null) return direct;

    const raw = String(value);
    const digits = raw.match(/\d+/);
    if (!digits) return 1;
    return toPositiveInteger(digits[0]) || 1;
};

const normalizeCurrencyCode = (value, fallback = 'MYR') => {
    const normalized = String(value || fallback)
        .trim()
        .toUpperCase();
    return /^[A-Z]{3,8}$/.test(normalized) ? normalized : fallback;
};

const firstHeaderValue = (value) => (Array.isArray(value) ? value[0] : value);

module.exports = {
    toNumber,
    toPositiveInteger,
    toUtcIsoString,
    toSqlDateTimeUtc,
    toIsoUtcString,
    parsePositiveIntWithBounds,
    toNonEmptyString,
    roundCoordinate,
    formatMoneyMYR,
    isValidLatitude,
    isValidLongitude,
    safeHexEqual,
    tryParseJsonObject,
    toUserId,
    normalizeCurrencyCode,
    firstHeaderValue
};
