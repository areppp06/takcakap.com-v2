/**
 * Curlec domain facade — explicit named re-exports (prefer specific modules).
 */
'use strict';

const curlecClient = require('./curlecClient');
const sessions = require('./curlecSessions');
const refunds = require('./curlecRefunds');
const reconcile = require('./curlecReconcile');

module.exports = {
    normalizePaymentMethod: curlecClient.normalizePaymentMethod,
    assertCurlecPaymentMethodForNewOrder: curlecClient.assertCurlecPaymentMethodForNewOrder,
    isCurlecConfigured: curlecClient.isCurlecConfigured,
    toMinorUnits: curlecClient.toMinorUnits,
    toMinorUnitsAllowZero: curlecClient.toMinorUnitsAllowZero,
    fromMinorUnits: curlecClient.fromMinorUnits,
    normalizeCurlecPaymentPayload: curlecClient.normalizeCurlecPaymentPayload,
    verifyCurlecPaymentSignature: curlecClient.verifyCurlecPaymentSignature,
    callCurlecApi: curlecClient.callCurlecApi,
    normalizeCurlecRefundStatus: curlecClient.normalizeCurlecRefundStatus,
    normalizeCurlecRefundSpeed: curlecClient.normalizeCurlecRefundSpeed,
    isCurlecInstantRefundUnsupportedError: curlecClient.isCurlecInstantRefundUnsupportedError,
    isCurlecInvalidRequestError: curlecClient.isCurlecInvalidRequestError,
    formatMinorUnitsAsMyr: curlecClient.formatMinorUnitsAsMyr,
    fetchCurlecBalanceMinorUnits: curlecClient.fetchCurlecBalanceMinorUnits,
    buildCurlecRefundTimeframeMessage: curlecClient.buildCurlecRefundTimeframeMessage,
    verifyCurlecWebhookSignature: curlecClient.verifyCurlecWebhookSignature,
    resolvePublicAppBaseUrl: curlecClient.resolvePublicAppBaseUrl,
    getCurlecCallbackPayload: curlecClient.getCurlecCallbackPayload,
    buildCurlecCheckoutReturnUrl: curlecClient.buildCurlecCheckoutReturnUrl,
    createCurlecPaymentSignature: curlecClient.createCurlecPaymentSignature,
    ...sessions,
    ...refunds,
    ...reconcile
};
