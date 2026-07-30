/**
 * Pure unit tests for points policy (no DB).
 * Run: node server/test_points_policy.js
 */
const assert = require('assert');
const {
    POINTS_PER_RM,
    computePointsFromFoodSubtotal,
    formatDebtMessage,
    isRedeemBlockedByDebt
} = require('./domain/pointsPolicy');

function test(name, fn) {
    try {
        fn();
        console.log(`  ✓ ${name}`);
    } catch (err) {
        console.error(`  ✗ ${name}`);
        console.error(`    ${err.message}`);
        process.exitCode = 1;
    }
}

console.log('pointsPolicy');

test('POINTS_PER_RM is 10', () => {
    assert.strictEqual(POINTS_PER_RM, 10);
});

test('food subtotal floors before multiply', () => {
    assert.strictEqual(computePointsFromFoodSubtotal(25.9), 250);
    assert.strictEqual(computePointsFromFoodSubtotal(9.99), 90);
    assert.strictEqual(computePointsFromFoodSubtotal(1), 10);
});

test('zero/negative food yields 0 points', () => {
    assert.strictEqual(computePointsFromFoodSubtotal(0), 0);
    assert.strictEqual(computePointsFromFoodSubtotal(-5), 0);
    assert.strictEqual(computePointsFromFoodSubtotal(NaN), 0);
});

test('debt message copy', () => {
    assert.strictEqual(formatDebtMessage(0), null);
    assert.strictEqual(
        formatDebtMessage(10),
        'You have a 10-point debt from a previous refund. New points will clear this first.'
    );
});

test('redeem blocked only when balance negative', () => {
    assert.strictEqual(isRedeemBlockedByDebt(0), false);
    assert.strictEqual(isRedeemBlockedByDebt(5), false);
    assert.strictEqual(isRedeemBlockedByDebt(-1), true);
    assert.strictEqual(isRedeemBlockedByDebt(-10), true);
});

if (!process.exitCode) {
    console.log('\nAll points policy tests passed.');
}
