/** Pure points policy helpers (food-subtotal earn, debt messaging). */

const POINTS_PER_RM = 10;

const computePointsFromFoodSubtotal = (foodSubtotal) => {
    const subtotal = Number(foodSubtotal);
    if (!Number.isFinite(subtotal) || subtotal <= 0) return 0;
    return Math.floor(subtotal) * POINTS_PER_RM;
};

/**
 * Short formal user-facing copy when balance is negative.
 * Debt is cleared by points earned on future completed purchases (food subtotal).
 */
const formatDebtMessage = (debtPoints) => {
    const amount = Math.max(0, Math.floor(Number(debtPoints) || 0));
    if (amount <= 0) return null;
    return `Points debt: ${amount}. Future purchases restore this balance first. Redemptions and vouchers are frozen until cleared.`;
};

const formatVoucherFrozenMessage = (debtPoints) => {
    const amount = Math.max(0, Math.floor(Number(debtPoints) || 0));
    if (amount <= 0) {
        return 'Vouchers are frozen until your points balance is non-negative.';
    }
    return `Vouchers are frozen. Clear ${amount} points debt via purchases first.`;
};

const isRedeemBlockedByDebt = (balance) => Number(balance) < 0;

/** Same rule: any points debt freezes voucher use and redemption. */
const isVoucherUseBlockedByDebt = (balance) => Number(balance) < 0;

module.exports = {
    POINTS_PER_RM,
    computePointsFromFoodSubtotal,
    formatDebtMessage,
    formatVoucherFrozenMessage,
    isRedeemBlockedByDebt,
    isVoucherUseBlockedByDebt
};
