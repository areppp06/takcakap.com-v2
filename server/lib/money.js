/**
 * Shared minor-unit / currency money helpers.
 */
'use strict';

const { toNumber } = require('./primitives');

const toMinorUnits = (value) => {
    const numeric = toNumber(value);
    if (numeric === null || numeric <= 0) return null;
    return Math.round(numeric * 100);
};

const toMinorUnitsAllowZero = (value) => {
    const numeric = toNumber(value);
    if (numeric === null || numeric < 0) return null;
    return Math.round(numeric * 100);
};

const fromMinorUnits = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Number((numeric / 100).toFixed(2));
};

const formatMinorUnitsAsMyr = (minorUnits) => {
    const amount = Number(minorUnits);
    if (!Number.isFinite(amount) || amount < 0) return 'RM0.00';
    return `RM${(amount / 100).toFixed(2)}`;
};

module.exports = {
    toMinorUnits,
    toMinorUnitsAllowZero,
    fromMinorUnits,
    formatMinorUnitsAsMyr
};
