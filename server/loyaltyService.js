const db = require('./db');

const POINTS_PER_RM = 10;

async function awardPointsForOrder(orderId) {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // Get order details
        const [orders] = await connection.query(
            `SELECT id, user_id, total_amount, status FROM orders WHERE id = ? FOR UPDATE`,
            [orderId]
        );
        const order = orders[0];

        if (!order || !order.user_id || order.status !== 'Completed') {
            await connection.rollback();
            return false;
        }

        // Check if points already awarded for this order
        const [existingTxn] = await connection.query(
            `SELECT id FROM points_transactions WHERE reference_id = ? AND transaction_type = 'earned' LIMIT 1`,
            [orderId]
        );
        if (existingTxn.length > 0) {
            await connection.rollback();
            return false; // Already awarded
        }

        // Calculate points
        const pointsToAward = Math.floor(Number(order.total_amount)) * POINTS_PER_RM;

        if (pointsToAward > 0) {
            // Insert transaction
            await connection.query(
                `INSERT INTO points_transactions (user_id, points, transaction_type, reference_id, description)
                 VALUES (?, ?, 'earned', ?, ?)`,
                [order.user_id, pointsToAward, orderId, `Points earned for order fd-${orderId}`]
            );

            // Update user balance
            await connection.query(
                `UPDATE users SET points_balance = points_balance + ? WHERE id = ?`,
                [pointsToAward, order.user_id]
            );
        }

        await connection.commit();
        return true;
    } catch (err) {
        await connection.rollback();
        console.error('Failed to award points for order:', err);
        return false;
    } finally {
        connection.release();
    }
}

async function getUserPointsData(userId, page = 1, limit = 10) {
    const offset = (page - 1) * limit;
    const [users] = await db.query(`SELECT points_balance FROM users WHERE id = ?`, [userId]);
    const balance = users[0]?.points_balance || 0;

    const [transactions] = await db.query(
        `SELECT * FROM points_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [userId, limit, offset]
    );

    const [countResult] = await db.query(
        `SELECT COUNT(*) as total FROM points_transactions WHERE user_id = ?`,
        [userId]
    );
    const totalTransactions = countResult[0].total;

    return { balance, transactions, totalTransactions };
}

async function redeemVoucher(userId, pointsToRedeem, voucherConfig) {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [users] = await connection.query(`SELECT points_balance FROM users WHERE id = ? FOR UPDATE`, [userId]);
        const balance = users[0]?.points_balance || 0;

        if (balance < pointsToRedeem) {
            throw new Error('Insufficient points balance');
        }

        // Generate unique code
        const code = `VOUCHER-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        
        // Expiry 30 days
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        // Insert Voucher
        const [voucherResult] = await connection.query(
            `INSERT INTO vouchers (code, type, discount_value, min_spend, max_discount, expires_at, is_active, user_id, is_redeemed)
             VALUES (?, ?, ?, ?, ?, ?, TRUE, ?, FALSE)`,
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

        // Deduct points
        await connection.query(
            `UPDATE users SET points_balance = points_balance - ? WHERE id = ?`,
            [pointsToRedeem, userId]
        );

        // Log transaction
        await connection.query(
            `INSERT INTO points_transactions (user_id, points, transaction_type, reference_id, description)
             VALUES (?, ?, 'redeemed', ?, ?)`,
            [userId, -pointsToRedeem, voucherResult.insertId, `Redeemed - RM ${voucherConfig.discountValue} voucher`]
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

module.exports = {
    awardPointsForOrder,
    getUserPointsData,
    redeemVoucher,
    POINTS_PER_RM
};
