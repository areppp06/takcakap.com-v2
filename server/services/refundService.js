/**
 * Refund / void side-effects facade.
 * Keeps order cancel/refund orchestration out of route handlers when extracted further.
 */
const loyaltyService = require('../loyaltyService');

async function applyOrderVoidSideEffects(orderId, options = {}) {
    return loyaltyService.applyOrderVoidSideEffects(orderId, options);
}

async function clawbackPointsForOrder(orderId, options = {}) {
    return loyaltyService.clawbackPointsForOrder(orderId, options);
}

async function restoreVoucherForOrder(orderId) {
    return loyaltyService.restoreVoucherForOrder(orderId);
}

async function restockOrderItems(orderId) {
    return loyaltyService.restockOrderItems(orderId);
}

module.exports = {
    applyOrderVoidSideEffects,
    clawbackPointsForOrder,
    restoreVoucherForOrder,
    restockOrderItems
};
