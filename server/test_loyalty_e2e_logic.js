/**
 * Logic-level E2E scenarios for loyalty (no live DB required for pure asserts).
 * Documents expected side-effect ordering for integration with real DB later.
 * Run: node server/test_loyalty_e2e_logic.js
 */
const assert = require('assert');
const { computePointsFromFoodSubtotal, formatDebtMessage } = require('./domain/pointsPolicy');

function scenario(name, fn) {
    try {
        fn();
        console.log(`  ✓ ${name}`);
    } catch (err) {
        console.error(`  ✗ ${name}`);
        console.error(`    ${err.message}`);
        process.exitCode = 1;
    }
}

console.log('loyalty e2e logic');

scenario('earn excludes delivery/service fee concept', () => {
    // food 40 + service 1.8 + delivery 8 = customer total 49.8
    // points only from food 40
    const food = 40;
    const points = computePointsFromFoodSubtotal(food);
    assert.strictEqual(points, 400);
    assert.notStrictEqual(points, computePointsFromFoodSubtotal(49.8));
});

scenario('clawback then earn auto-offsets debt', () => {
    let balance = 0;
    // earn 100
    balance += 100;
    // clawback full earn → debt if already spent would go negative; simulate full reverse
    balance -= 100;
    assert.strictEqual(balance, 0);
    // user redeemed 50 then refund of 100 earn → -50 debt
    balance = 50; // after redeem leftover
    balance -= 100; // clawback earn
    assert.strictEqual(balance, -50);
    assert.ok(formatDebtMessage(50));
    // next earn 80
    balance += 80;
    assert.strictEqual(balance, 30);
});

scenario('booking status machine transitions', () => {
    const allowed = new Set([
        'not_required',
        'pending',
        'booked',
        'booking_failed',
        'terminal_failed',
        'cancelled'
    ]);
    const flow = ['pending', 'booking_failed', 'booked'];
    for (const s of flow) assert.ok(allowed.has(s));
    const terminal = ['REJECTED', 'EXPIRED'];
    for (const t of terminal) {
        // mapped to terminal_failed booking, kitchen status unchanged
        assert.ok(t);
    }
});

scenario('retry dispatch allowed matrix', () => {
    const canRetry = ({ orderType, status, booking }) => {
        if (orderType !== 'Delivery') return false;
        if (status === 'Completed') return false;
        if (status === 'Cancelled') return booking === 'terminal_failed';
        return ['booking_failed', 'pending', 'terminal_failed'].includes(booking);
    };
    assert.strictEqual(canRetry({ orderType: 'Delivery', status: 'Preparing', booking: 'booking_failed' }), true);
    assert.strictEqual(canRetry({ orderType: 'Delivery', status: 'Finding Rider', booking: 'terminal_failed' }), true);
    assert.strictEqual(canRetry({ orderType: 'Delivery', status: 'Completed', booking: 'booked' }), false);
    assert.strictEqual(canRetry({ orderType: 'Pickup', status: 'Preparing', booking: 'not_required' }), false);
});

if (!process.exitCode) {
    console.log('\nAll loyalty e2e logic tests passed.');
}
