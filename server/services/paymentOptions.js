/**
 * Delivery & payment option fetchers.
 */
'use strict';

const db = require('../db');
const {
    DEFAULT_SERVICE_FEE,
    CURLEC_KEY_ID,
    CURLEC_CHECKOUT_NAME,
    CURLEC_CHECKOUT_DESCRIPTION
} = require('../config');
const { toNumber } = require('../lib/primitives');
const { isCurlecConfigured } = require('./curlecClient');

const fetchDeliveryOptions = async (executor = db) => {
    const [rows] = await executor.query(
        `
            SELECT pickup_enabled, lalamove_enabled
            FROM delivery_options
            WHERE id = 1
            LIMIT 1
        `
    );
    const row = rows[0] || {};

    return {
        pickupEnabled: row.pickup_enabled !== undefined ? Boolean(row.pickup_enabled) : true,
        lalamoveEnabled: row.lalamove_enabled !== undefined ? Boolean(row.lalamove_enabled) : true
    };
};

const fetchPaymentOptions = async (executor = db) => {
    const [rows] = await executor.query(
        `
            SELECT curlec_enabled, service_fee
            FROM payment_options
            WHERE id = 1
            LIMIT 1
        `
    );
    const row = rows[0] || {};
    const curlecConfigured = isCurlecConfigured();
    const rawServiceFee = toNumber(row.service_fee);
    const serviceFee =
        rawServiceFee !== null && rawServiceFee >= 0
            ? Number(rawServiceFee.toFixed(2))
            : Number(DEFAULT_SERVICE_FEE.toFixed(2));

    return {
        curlecEnabled: row.curlec_enabled !== undefined ? Boolean(row.curlec_enabled) : true,
        serviceFee,
        curlecConfigured,
        curlecKeyId: curlecConfigured ? CURLEC_KEY_ID : '',
        curlecDisplayName: CURLEC_CHECKOUT_NAME || 'Online Payment',
        curlecDescription: CURLEC_CHECKOUT_DESCRIPTION || 'Secure online payment via Curlec'
    };
};

module.exports = {
    fetchDeliveryOptions,
    fetchPaymentOptions
};
