/** Pure points policy helpers (food-subtotal earn, debt messaging). */

const POINTS_PER_RM = 10;

const computePointsFromFoodSubtotal = (foodSubtotal) => {
    const subtotal = Number(foodSubtotal);
    if (!Number.isFinite(subtotal) || subtotal <= 0) return 0;
    return Math.floor(subtotal) * POINTS_PER_RM;
};

const formatDebtMessage = (debtPoints) => {
    const amount = Math.max(0, Math.floor(Number(debtPoints) || 0));
    if (amount <= 0) return null;
    return `You have a ${amount}-point debt from a previous refund. New points will clear this first.`;
};

const isRedeemBlockedByDebt = (balance) => Number(balance) < 0;

module.exports = {
    POINTS_PER_RM,
    computePointsFromFoodSubtotal,
    formatDebtMessage,
    isRedeemBlockedByDebt
};
