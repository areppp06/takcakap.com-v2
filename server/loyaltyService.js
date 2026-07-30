const db = require('./db');
const {
    POINTS_PER_RM,
    computePointsFromFoodSubtotal,
    formatDebtMessage
} = require('./domain/pointsPolicy');

const getFoodSubtotalForOrder = async (connection, orderId) => {
    const [rows] = await connection.query(
        `
            SELECT COALESCE(SUM(quantity * unit_price), 0) AS food_subtotal
            FROM order_items
            WHERE order_id = ?
        `,
        [orderId]
    );
    return Number(rows[0]?.food_subtotal || 0);
};

/**
 * Award points for a completed order based on food subtotal only (excludes service + delivery fees).
 * Idempotent via unique (transaction_type, reference_id) for type=earned.
 */
async function awardPointsForOrder(orderId) {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [orders] = await connection.query(
            `SELECT id, user_id, status, short_code FROM orders WHERE id = ? FOR UPDATE`,
            [orderId]
        );
        const order = orders[0];

        if (!order || !order.user_id || order.status !== 'Completed') {
            await connection.rollback();
            return { success: false, reason: 'not_eligible' };
        }

        const [existingTxn] = await connection.query(
            `SELECT id FROM points_transactions WHERE reference_id = ? AND transaction_type = 'earned' LIMIT 1`,
            [orderId]
        );
        if (existingTxn.length > 0) {
            await connection.rollback();
            return { success: false, reason: 'already_awarded' };
        }

        const foodSubtotal = await getFoodSubtotalForOrder(connection, orderId);
        const pointsToAward = computePointsFromFoodSubtotal(foodSubtotal);

        if (pointsToAward > 0) {
            const displayId = order.short_code || `fd-${orderId}`;
            await connection.query(
                `SELECT id FROM users WHERE id = ? FOR UPDATE`,
                [order.user_id]
            );
            await connection.query(
                `INSERT INTO points_transactions (user_id, points, transaction_type, reference_id, description)
                 VALUES (?, ?, 'earned', ?, ?)`,
                [order.user_id, pointsToAward, orderId, `Points earned for order ${displayId}`]
            );
            await connection.query(
                `UPDATE users SET points_balance = points_balance + ? WHERE id = ?`,
                [pointsToAward, order.user_id]
            );
        }

        await connection.commit();
        return { success: true, points: pointsToAward };
    } catch (err) {
        await connection.rollback();
        // Unique race: treat as already awarded
        if (err?.code === 'ER_DUP_ENTRY') {
            return { success: false, reason: 'already_awarded' };
        }
        console.error('Failed to award points for order:', err);
        return { success: false, reason: 'error', error: err.message };
    } finally {
        connection.release();
    }
}

/**
 * Reverse earned points for an order (refund/cancel). Allows negative balance.
 * Idempotent via unique (cancelled_order, orderId) and orders.points_clawed_back_at.
 */
async function clawbackPointsForOrder(orderId, { reason = 'Refund' } = {}) {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [orders] = await connection.query(
            `SELECT id, user_id, short_code, points_clawed_back_at
             FROM orders WHERE id = ? FOR UPDATE`,
            [orderId]
        );
        const order = orders[0];
        if (!order || !order.user_id) {
            await connection.rollback();
            return { success: false, reason: 'order_not_found' };
        }
        if (order.points_clawed_back_at) {
            await connection.rollback();
            return { success: false, reason: 'already_clawed_back' };
        }

        const [earnRows] = await connection.query(
            `SELECT id, points FROM points_transactions
             WHERE reference_id = ? AND transaction_type = 'earned'
             LIMIT 1`,
            [orderId]
        );
        if (!earnRows.length) {
            await connection.query(
                `UPDATE orders SET points_clawed_back_at = UTC_TIMESTAMP() WHERE id = ?`,
                [orderId]
            );
            await connection.commit();
            return { success: true, points: 0, reason: 'no_earn_to_clawback' };
        }

        const earnPoints = Math.abs(Number(earnRows[0].points) || 0);
        if (earnPoints <= 0) {
            await connection.query(
                `UPDATE orders SET points_clawed_back_at = UTC_TIMESTAMP() WHERE id = ?`,
                [orderId]
            );
            await connection.commit();
            return { success: true, points: 0 };
        }

        const [existingClawback] = await connection.query(
            `SELECT id FROM points_transactions
             WHERE reference_id = ? AND transaction_type = 'cancelled_order'
             LIMIT 1`,
            [orderId]
        );
        if (existingClawback.length > 0) {
            await connection.query(
                `UPDATE orders SET points_clawed_back_at = UTC_TIMESTAMP() WHERE id = ?`,
                [orderId]
            );
            await connection.commit();
            return { success: false, reason: 'already_clawed_back' };
        }

        const displayId = order.short_code || `fd-${orderId}`;
        await connection.query(`SELECT id FROM users WHERE id = ? FOR UPDATE`, [order.user_id]);
        await connection.query(
            `INSERT INTO points_transactions (user_id, points, transaction_type, reference_id, description)
             VALUES (?, ?, 'cancelled_order', ?, ?)`,
            [
                order.user_id,
                -earnPoints,
                orderId,
                `${reason}: reversed ${earnPoints} pts from order ${displayId}`
            ]
        );
        await connection.query(
            `UPDATE users SET points_balance = points_balance - ? WHERE id = ?`,
            [earnPoints, order.user_id]
        );
        await connection.query(
            `UPDATE orders SET points_clawed_back_at = UTC_TIMESTAMP() WHERE id = ?`,
            [orderId]
        );

        const [balRows] = await connection.query(
            `SELECT points_balance FROM users WHERE id = ? LIMIT 1`,
            [order.user_id]
        );
        const balance = Number(balRows[0]?.points_balance || 0);

        await connection.commit();
        return {
            success: true,
            points: earnPoints,
            balance,
            debtPoints: balance < 0 ? Math.abs(balance) : 0,
            userId: order.user_id
        };
    } catch (err) {
        await connection.rollback();
        if (err?.code === 'ER_DUP_ENTRY') {
            return { success: false, reason: 'already_clawed_back' };
        }
        console.error('Failed to clawback points for order:', err);
        return { success: false, reason: 'error', error: err.message };
    } finally {
        connection.release();
    }
}

/**
 * Restore voucher usage counters after refund (idempotent via orders.voucher_restored_at).
 * Does not extend expiry.
 */
async function restoreVoucherForOrder(orderId) {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [orders] = await connection.query(
            `SELECT id, voucher_id, voucher_restored_at FROM orders WHERE id = ? FOR UPDATE`,
            [orderId]
        );
        const order = orders[0];
        if (!order) {
            await connection.rollback();
            return { success: false, reason: 'order_not_found' };
        }
        if (order.voucher_restored_at) {
            await connection.rollback();
            return { success: false, reason: 'already_restored' };
        }
        if (!order.voucher_id) {
            await connection.query(
                `UPDATE orders SET voucher_restored_at = UTC_TIMESTAMP() WHERE id = ?`,
                [orderId]
            );
            await connection.commit();
            return { success: true, reason: 'no_voucher' };
        }

        const [voucherRows] = await connection.query(
            `SELECT id, code, times_used, max_uses, is_active, is_archived
             FROM vouchers WHERE id = ? FOR UPDATE`,
            [order.voucher_id]
        );
        const voucher = voucherRows[0];
        if (!voucher) {
            await connection.query(
                `UPDATE orders SET voucher_restored_at = UTC_TIMESTAMP() WHERE id = ?`,
                [orderId]
            );
            await connection.commit();
            return { success: true, reason: 'voucher_missing' };
        }

        const nextTimesUsed = Math.max(0, Number(voucher.times_used || 0) - 1);
        const maxUses = Math.max(1, Number(voucher.max_uses || 1));
        await connection.query(
            `
                UPDATE vouchers
                SET times_used = ?,
                    is_redeemed = IF(? >= ?, TRUE, FALSE)
                WHERE id = ?
            `,
            [nextTimesUsed, nextTimesUsed, maxUses, voucher.id]
        );
        await connection.query(
            `UPDATE orders SET voucher_restored_at = UTC_TIMESTAMP() WHERE id = ?`,
            [orderId]
        );

        await connection.commit();
        return { success: true, code: voucher.code, timesUsed: nextTimesUsed };
    } catch (err) {
        await connection.rollback();
        console.error('Failed to restore voucher for order:', err);
        return { success: false, reason: 'error', error: err.message };
    } finally {
        connection.release();
    }
}

async function getUserPointsData(userId, page = 1, limit = 10) {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 10));
    const offset = (safePage - 1) * safeLimit;

    const [users] = await db.query(`SELECT points_balance FROM users WHERE id = ?`, [userId]);
    const balance = Number(users[0]?.points_balance || 0);
    const debtPoints = balance < 0 ? Math.abs(balance) : 0;

    const [transactions] = await db.query(
        `SELECT * FROM points_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [userId, safeLimit, offset]
    );

    const [countResult] = await db.query(
        `SELECT COUNT(*) as total FROM points_transactions WHERE user_id = ?`,
        [userId]
    );
    const totalTransactions = countResult[0].total;

    return {
        balance,
        debtPoints,
        debtMessage: formatDebtMessage(debtPoints),
        transactions,
        totalTransactions
    };
}

async function redeemVoucher(userId, pointsToRedeem, voucherConfig) {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [users] = await connection.query(
            `SELECT points_balance FROM users WHERE id = ? FOR UPDATE`,
            [userId]
        );
        const balance = Number(users[0]?.points_balance || 0);

        if (balance < 0) {
            const debtPoints = Math.abs(balance);
            const error = new Error(formatDebtMessage(debtPoints));
            error.code = 'POINTS_DEBT';
            error.debtPoints = debtPoints;
            throw error;
        }

        if (balance < pointsToRedeem) {
            throw new Error('Insufficient points balance');
        }

        // Cooldown inside transaction (serializes concurrent redeems)
        const [settings] = await connection.query(
            `SELECT voucher_cooldown_hours FROM shop_settings WHERE id = 1 LIMIT 1 FOR UPDATE`
        );
        const cooldownHours = Number(settings[0]?.voucher_cooldown_hours || 0);
        if (cooldownHours > 0) {
            const [lastVoucher] = await connection.query(
                `
                    SELECT created_at FROM vouchers
                    WHERE user_id = ? AND source = 'points_redemption'
                    ORDER BY created_at DESC
                    LIMIT 1
                    FOR UPDATE
                `,
                [userId]
            );
            if (lastVoucher.length > 0) {
                const lastRedemptionTime = new Date(lastVoucher[0].created_at);
                const cooldownEndsAt = new Date(
                    lastRedemptionTime.getTime() + cooldownHours * 60 * 60 * 1000
                );
                if (cooldownEndsAt > new Date()) {
                    const error = new Error(
                        `You can only redeem one voucher every ${cooldownHours} hours.`
                    );
                    error.code = 'REDEEM_COOLDOWN';
                    throw error;
                }
            }
        }

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        let code = '';
        let voucherResult = null;
        let attempts = 0;
        const maxAttempts = 30;

        while (attempts < maxAttempts) {
            code = '';
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            for (let i = 0; i < 6; i++) {
                code += chars.charAt(Math.floor(Math.random() * chars.length));
            }

            try {
                [voucherResult] = await connection.query(
                    `INSERT INTO vouchers (code, type, discount_value, min_spend, max_discount, expires_at, is_active, user_id, is_redeemed, max_uses, times_used, source)
                     VALUES (?, ?, ?, ?, ?, ?, TRUE, ?, FALSE, 1, 0, 'points_redemption')`,
                    [
                        code,
                        voucherConfig.type,
                        voucherConfig.discountValue,
                        voucherConfig.minSpend,
                        voucherConfig.maxDiscount,
                        expiresAt,
                        userId
                    ]
                );
                break;
            } catch (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    attempts++;
                    if (attempts >= maxAttempts) {
                        throw new Error(
                            'Failed to generate a unique voucher code after maximum attempts'
                        );
                    }
                } else {
                    throw err;
                }
            }
        }

        await connection.query(
            `UPDATE users SET points_balance = points_balance - ? WHERE id = ?`,
            [pointsToRedeem, userId]
        );

        await connection.query(
            `INSERT INTO points_transactions (user_id, points, transaction_type, reference_id, description)
             VALUES (?, ?, 'redeemed', ?, ?)`,
            [
                userId,
                -pointsToRedeem,
                voucherResult.insertId,
                `Redeemed - RM ${voucherConfig.discountValue} voucher`
            ]
        );

        await connection.commit();
        return { success: true, code, discountValue: voucherConfig.discountValue };
    } catch (err) {
        await connection.rollback();
        console.error('Failed to redeem voucher:', err);
        throw err;
    } finally {
        connection.release();
    }
}

/**
 * Restock order items once when order is voided (cancel/refund).
 */
async function restockOrderItems(orderId) {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [orders] = await connection.query(
            `SELECT id, stock_restored_at FROM orders WHERE id = ? FOR UPDATE`,
            [orderId]
        );
        const order = orders[0];
        if (!order) {
            await connection.rollback();
            return { success: false, reason: 'order_not_found' };
        }
        if (order.stock_restored_at) {
            await connection.rollback();
            return { success: false, reason: 'already_restored' };
        }

        const [items] = await connection.query(
            `SELECT menu_item_id, quantity FROM order_items WHERE order_id = ?`,
            [orderId]
        );
        for (const item of items) {
            const menuItemId = Number(item.menu_item_id);
            const qty = Number(item.quantity || 0);
            if (!menuItemId || qty <= 0) continue;
            await connection.query(
                `UPDATE menu_items SET stock = stock + ? WHERE id = ?`,
                [qty, menuItemId]
            );
        }
        await connection.query(
            `UPDATE orders SET stock_restored_at = UTC_TIMESTAMP() WHERE id = ?`,
            [orderId]
        );
        await connection.commit();
        return { success: true, items: items.length };
    } catch (err) {
        await connection.rollback();
        console.error('Failed to restock order:', err);
        return { success: false, reason: 'error', error: err.message };
    } finally {
        connection.release();
    }
}

/**
 * Side effects for refund/void: clawback points, restore voucher, restock.
 */
async function applyOrderVoidSideEffects(orderId, { reason = 'Refund' } = {}) {
    const clawback = await clawbackPointsForOrder(orderId, { reason });
    const voucher = await restoreVoucherForOrder(orderId);
    const stock = await restockOrderItems(orderId);
    return { clawback, voucher, stock };
}

module.exports = {
    awardPointsForOrder,
    clawbackPointsForOrder,
    restoreVoucherForOrder,
    restockOrderItems,
    applyOrderVoidSideEffects,
    getUserPointsData,
    redeemVoucher,
    formatDebtMessage,
    computePointsFromFoodSubtotal,
    POINTS_PER_RM
};
