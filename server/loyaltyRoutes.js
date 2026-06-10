const express = require('express');
const router = express.Router();
const db = require('./db');
const loyaltyService = require('./loyaltyService');
const emailService = require('./emailService');

module.exports = (requireAuth, requireAdmin) => {

    // ==========================================
    // USER APIs
    // ==========================================

    router.get('/user/points', requireAuth, async (req, res) => {
        try {
            const data = await loyaltyService.getUserPointsData(req.user.id);
            res.json(data);
        } catch (err) {
            console.error('Error fetching user points:', err);
            res.status(500).json({ error: 'Failed to fetch points data' });
        }
    });

    router.get('/user/vouchers', requireAuth, async (req, res) => {
        try {
            const [vouchers] = await db.query(
                `SELECT * FROM vouchers WHERE user_id = ? ORDER BY created_at DESC`,
                [req.user.id]
            );
            res.json(vouchers);
        } catch (err) {
            console.error('Error fetching user vouchers:', err);
            res.status(500).json({ error: 'Failed to fetch vouchers' });
        }
    });

    router.post('/user/points/redeem', requireAuth, async (req, res) => {
        const { points } = req.body;
        const pointsToRedeem = Number(points);
        
        if (!pointsToRedeem || pointsToRedeem <= 0 || pointsToRedeem % 200 !== 0) {
            return res.status(400).json({ error: 'Points must be a multiple of 200' });
        }

        const discountValue = pointsToRedeem / 200;
        
        const voucherConfig = {
            type: 'fixed',
            discountValue: discountValue,
            minSpend: 0,
            maxDiscount: null
        };

        try {
            const result = await loyaltyService.redeemVoucher(req.user.id, pointsToRedeem, voucherConfig);
            
            try {
                if (typeof emailService.queueVoucherEmail === 'function') {
                    emailService.queueVoucherEmail(req.user.id, result.code, discountValue);
                }
            } catch (emailErr) {
                console.error('Failed to queue voucher email:', emailErr);
            }

            res.json(result);
        } catch (err) {
            if (err.message === 'Insufficient points balance') {
                return res.status(400).json({ error: err.message });
            }
            res.status(500).json({ error: 'Failed to redeem voucher' });
        }
    });

    router.post('/user/vouchers/validate', requireAuth, async (req, res) => {
        const { code, subtotal } = req.body;
        const normalizedCode = String(code || '').trim().toUpperCase();
        
        try {
            const [voucherRows] = await db.query(
                `SELECT * FROM vouchers WHERE code = ?`,
                [normalizedCode]
            );
            const voucher = voucherRows[0];
            
            if (!voucher) return res.status(404).json({ error: 'Invalid voucher code' });
            if (!voucher.is_active || voucher.is_redeemed) return res.status(400).json({ error: 'Voucher is no longer valid or has been used' });
            if (new Date(voucher.expires_at) < new Date()) return res.status(400).json({ error: 'Voucher has expired' });
            if (voucher.user_id && voucher.user_id !== req.user.id) return res.status(400).json({ error: 'Voucher belongs to another account' });
            
            if (subtotal && subtotal < Number(voucher.min_spend)) {
                return res.status(400).json({ error: `Minimum spend of RM${voucher.min_spend} required` });
            }

            res.json({ valid: true, voucher });
        } catch (err) {
            res.status(500).json({ error: 'Failed to validate voucher' });
        }
    });

    // ==========================================
    // ADMIN APIs
    // ==========================================

    router.get('/admin/points/users', requireAdmin, async (req, res) => {
        try {
            const [users] = await db.query(
                `SELECT id, name, email, points_balance FROM users ORDER BY points_balance DESC`
            );
            res.json(users);
        } catch (err) {
            res.status(500).json({ error: 'Failed to fetch user points' });
        }
    });

    router.post('/admin/points/adjust', requireAdmin, async (req, res) => {
        const { userId, points, action, description } = req.body;
        const pointsAmount = Number(points);
        if (!userId || !pointsAmount || pointsAmount <= 0 || !['add', 'deduct'].includes(action)) {
            return res.status(400).json({ error: 'Invalid payload' });
        }

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            
            const [users] = await connection.query(`SELECT points_balance FROM users WHERE id = ? FOR UPDATE`, [userId]);
            if (users.length === 0) throw new Error('User not found');
            
            if (action === 'deduct' && users[0].points_balance < pointsAmount) {
                throw new Error('User balance is lower than deduction amount');
            }

            const dbAction = action === 'add' ? 'admin_add' : 'admin_deduct';
            const pointsMultiplier = action === 'add' ? 1 : -1;
            
            await connection.query(
                `UPDATE users SET points_balance = points_balance + ? WHERE id = ?`,
                [pointsAmount * pointsMultiplier, userId]
            );

            await connection.query(
                `INSERT INTO points_transactions (user_id, points, transaction_type, description)
                 VALUES (?, ?, ?, ?)`,
                [userId, pointsAmount * pointsMultiplier, dbAction, description || `Admin ${action}ed points`]
            );

            await connection.commit();
            res.json({ success: true });
        } catch (err) {
            await connection.rollback();
            if (err.message === 'User not found' || err.message === 'User balance is lower than deduction amount') {
                return res.status(400).json({ error: err.message });
            }
            res.status(500).json({ error: 'Failed to adjust points' });
        } finally {
            connection.release();
        }
    });

    router.get('/admin/vouchers', requireAdmin, async (req, res) => {
        try {
            const [vouchers] = await db.query(`
                SELECT v.*, u.name as user_name, u.email as user_email
                FROM vouchers v
                LEFT JOIN users u ON v.user_id = u.id
                ORDER BY v.created_at DESC
            `);
            res.json(vouchers);
        } catch (err) {
            res.status(500).json({ error: 'Failed to fetch vouchers' });
        }
    });

    router.post('/admin/vouchers', requireAdmin, async (req, res) => {
        const { code, type, discount_value, min_spend, max_discount, expires_at, user_id } = req.body;
        
        try {
            const sqlExpiresAt = expires_at ? new Date(expires_at).toISOString().slice(0, 19).replace('T', ' ') : null;
            await db.query(
                `INSERT INTO vouchers (code, type, discount_value, min_spend, max_discount, expires_at, user_id, is_active, is_redeemed)
                 VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, FALSE)`,
                [
                    code.trim().toUpperCase(),
                    type,
                    discount_value,
                    min_spend || 0,
                    max_discount || null,
                    sqlExpiresAt,
                    user_id || null
                ]
            );
            res.json({ success: true });
        } catch (err) {
            console.error('Voucher creation error:', err);
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ error: 'Voucher code already exists' });
            }
            res.status(500).json({ error: 'Failed to create voucher' });
        }
    });

    router.put('/admin/vouchers/:id/toggle', requireAdmin, async (req, res) => {
        try {
            await db.query(`UPDATE vouchers SET is_active = NOT is_active WHERE id = ?`, [req.params.id]);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: 'Failed to toggle voucher' });
        }
    });

    return router;
};
