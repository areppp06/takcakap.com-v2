/**
 * Admin sales overview date-range helpers (KL timezone).
 */
'use strict';

const { KUALA_LUMPUR_UTC_OFFSET_MS, MS_PER_DAY } = require('../config');

const getKualaLumpurDateParts = (utcMs = Date.now()) => {
    const klDate = new Date(utcMs + KUALA_LUMPUR_UTC_OFFSET_MS);
    return {
        year: klDate.getUTCFullYear(),
        monthIndex: klDate.getUTCMonth(),
        day: klDate.getUTCDate(),
        weekday: klDate.getUTCDay()
    };
};

const klDatePartsToUtcMs = (year, monthIndex, day) =>
    Date.UTC(year, monthIndex, day, 0, 0, 0, 0) - KUALA_LUMPUR_UTC_OFFSET_MS;

const formatKlDate = (utcMs) => {
    const { year, monthIndex, day } = getKualaLumpurDateParts(utcMs);
    return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const parseKlDateInput = (value) => {
    const raw = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const [yearText, monthText, dayText] = raw.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    const utcMs = klDatePartsToUtcMs(year, month - 1, day);
    const check = getKualaLumpurDateParts(utcMs);
    if (check.year !== year || check.monthIndex !== month - 1 || check.day !== day) {
        return null;
    }

    return {
        raw,
        year,
        monthIndex: month - 1,
        day,
        startUtcMs: utcMs
    };
};

const computeGrowthPercentage = (current, previous) => {
    const currentValue = Number(current || 0);
    const previousValue = Number(previous || 0);
    if (previousValue <= 0) {
        return currentValue <= 0 ? 0 : 100;
    }
    return ((currentValue - previousValue) / previousValue) * 100;
};

const toCsvValue = (value) => {
    const safe = String(value ?? '');
    if (/[",\n\r]/.test(safe)) {
        return `"${safe.replace(/"/g, '""')}"`;
    }
    return safe;
};

const getSalesOverviewRanges = (nowMs = Date.now()) => {
    const klParts = getKualaLumpurDateParts(nowMs);
    const dayStartUtcMs = klDatePartsToUtcMs(klParts.year, klParts.monthIndex, klParts.day);
    const daysSinceMonday = (klParts.weekday + 6) % 7;
    const weekStartUtcMs = klDatePartsToUtcMs(klParts.year, klParts.monthIndex, klParts.day - daysSinceMonday);
    const monthStartUtcMs = klDatePartsToUtcMs(klParts.year, klParts.monthIndex, 1);
    const previousMonthStartUtcMs = klDatePartsToUtcMs(klParts.year, klParts.monthIndex - 1, 1);
    const currentMonthDurationMs = Math.max(60 * 1000, nowMs - monthStartUtcMs);
    const previousMonthEndUtcMs = Math.min(monthStartUtcMs, previousMonthStartUtcMs + currentMonthDurationMs);

    return {
        day: {
            currentStartMs: dayStartUtcMs,
            currentEndMs: nowMs,
            previousStartMs: dayStartUtcMs - MS_PER_DAY,
            previousEndMs: dayStartUtcMs
        },
        week: {
            currentStartMs: weekStartUtcMs,
            currentEndMs: nowMs,
            previousStartMs: weekStartUtcMs - 7 * MS_PER_DAY,
            previousEndMs: weekStartUtcMs
        },
        month: {
            currentStartMs: monthStartUtcMs,
            currentEndMs: nowMs,
            previousStartMs: previousMonthStartUtcMs,
            previousEndMs: previousMonthEndUtcMs
        }
    };
};

module.exports = {
    KUALA_LUMPUR_UTC_OFFSET_MS,
    MS_PER_DAY,
    getKualaLumpurDateParts,
    klDatePartsToUtcMs,
    formatKlDate,
    parseKlDateInput,
    computeGrowthPercentage,
    toCsvValue,
    getSalesOverviewRanges
};
