const express = require('express');
const db = require('./db');
const loyaltyService = require('./loyaltyService');
const emailService = require('./emailService');
const {
    formatDebtMessage,
    formatVoucherFrozenMessage,
    isVoucherUseBlockedByDebt
} = require('./domain/pointsPolicy');

module.exports = (requireAuth, requireAdmin) => {
    // Fresh Router per factory call (avoids double-register if factory invoked twice).
    const router = express.Router();

    // In-memory rate limiter for voucher validation
    const failedVoucherAttempts = new Map();

    function checkRateLimit(ip) {
        const now = Date.now();
        const windowMs = 90 * 60 * 1000; // 1hr 30mins
        const maxAttempts = 11;

        let record = failedVoucherAttempts.get(ip);
        if (!record) {
            record = { count: 0, resetTime: now + windowMs };
            failedVoucherAttempts.set(ip, record);
        }

        if (now > record.resetTime) {
            record.count = 0;
            record.resetTime = now + windowMs;
        }

        if (record.count >= maxAttempts) {
            return false;
        }
        return true;
    }

    function recordFailedAttempt(ip) {
        const record = failedVoucherAttempts.get(ip);
        if (record) {
            record.count++;
        }
    }

    // ==========================================
    // USER APIs
    // ==========================================

    router.get('/user/points', requireAuth, async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const data = await loyaltyService.getUserPointsData(req.user.id, page, limit);

            const [settings] = await db.query(`SELECT voucher_cooldown_hours FROM shop_settings LIMIT 1`);
            const cooldownHours = settings[0]?.voucher_cooldown_hours || 0;
            
            if (cooldownHours > 0) {
                data.cooldownLimitHours = cooldownHours;
                const [lastVoucher] = await db.query(`
                    SELECT created_at FROM vouchers 
                    WHERE user_id = ? AND source = 'points_redemption'
                    ORDER BY created_at DESC LIMIT 1
                `, [req.user.id]);
                
                if (lastVoucher.length > 0) {
                    const lastRedemptionTime = new Date(lastVoucher[0].created_at);
                    const cooldownEndsAt = new Date(lastRedemptionTime.getTime() + cooldownHours * 60 * 60 * 1000);
                    if (cooldownEndsAt > new Date()) {
                        data.cooldownEndsAt = cooldownEndsAt.toISOString();
                    }
                }
            }

            res.json(data);
        } catch (err) {
            console.error('Error fetching user points:', err);
            res.status(500).json({ error: 'Failed to fetch points data' });
        }
    });

    router.get('/user/vouchers', requireAuth, async (req, res) => {
        try {
            const { activeOnly } = req.query;
            let query = `SELECT * FROM vouchers WHERE user_id = ? AND is_archived = FALSE`;
            if (activeOnly === 'true') {
                query += ` AND is_active = TRUE AND times_used < max_uses AND (expires_at IS NULL OR expires_at > NOW())`;
            }
            query += ` ORDER BY created_at DESC LIMIT 200`;
            
            const [vouchers] = await db.query(query, [req.user.id]);
            res.json(vouchers);
        } catch (err) {
            console.error('Error fetching user vouchers:', err);
            res.status(500).json({ error: 'Failed to fetch vouchers' });
        }
    });

    router.get('/user/points/tiers', async (req, res) => {
        try {
            const [tiers] = await db.query(
                `SELECT id, points_required, discount_amount FROM point_redemption_tiers WHERE is_active = TRUE ORDER BY points_required ASC`
            );
            res.json(tiers);
        } catch (err) {
            console.error('Error fetching point tiers:', err);
            res.status(500).json({ error: 'Failed to fetch tiers' });
        }
    });

    router.post('/user/points/redeem', requireAuth, async (req, res) => {
        const { points } = req.body;
        const pointsToRedeem = Number(points);

        try {
            const [settings] = await db.query(`SELECT voucher_cooldown_hours FROM shop_settings LIMIT 1`);
            const cooldownHours = settings[0]?.voucher_cooldown_hours || 0;

            if (cooldownHours > 0) {
                const [lastVoucher] = await db.query(`
                    SELECT created_at FROM vouchers 
                    WHERE user_id = ? AND source = 'points_redemption'
                    ORDER BY created_at DESC LIMIT 1
                `, [req.user.id]);
                
                if (lastVoucher.length > 0) {
                    const lastRedemptionTime = new Date(lastVoucher[0].created_at);
                    const cooldownEndsAt = new Date(lastRedemptionTime.getTime() + cooldownHours * 60 * 60 * 1000);
                    if (cooldownEndsAt > new Date()) {
                        return res.status(400).json({ error: `You can only redeem one voucher every ${cooldownHours} hours.` });
                    }
                }
            }

            const [tiers] = await db.query(
                `SELECT discount_amount FROM point_redemption_tiers WHERE points_required = ? AND is_active = TRUE`,
                [pointsToRedeem]
            );

            if (tiers.length === 0) {
                return res.status(400).json({ error: 'Invalid redemption amount. Please select a valid reward.' });
            }

            const discountValue = parseFloat(tiers[0].discount_amount);
        
        const voucherConfig = {
            type: 'fixed',
            discountValue: discountValue,
            minSpend: 0,
            maxDiscount: null
        };

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
            if (err.code === 'POINTS_DEBT') {
                return res.status(400).json({
                    error: err.message,
                    code: 'POINTS_DEBT',
                    debtPoints: err.debtPoints || 0
                });
            }
            if (err.code === 'REDEEM_COOLDOWN' || /cooldown|every \d+ hours/i.test(String(err.message || ''))) {
                return res.status(400).json({ error: err.message });
            }
            if (String(err.message || '').includes('Insufficient points')) {
                return res.status(400).json({ error: 'Insufficient points' });
            }
            res.status(500).json({ error: 'Failed to redeem voucher' });
        }
    });

    router.post('/user/vouchers/validate', requireAuth, async (req, res) => {
        const clientIp = String(req.ip || req.socket?.remoteAddress || 'unknown');
        if (!checkRateLimit(clientIp)) {
            return res.status(429).json({ error: 'Too many invalid attempts. Please try again in 1 hour 30 minutes.' });
        }

        const { code, subtotal } = req.body;
        const normalizedCode = String(code || '').trim().toUpperCase();
        
        try {
            // Points debt freezes all voucher use until balance is non-negative.
            const [balRows] = await db.query(
                `SELECT points_balance FROM users WHERE id = ? LIMIT 1`,
                [req.user.id]
            );
            const balance = Number(balRows[0]?.points_balance || 0);
            if (isVoucherUseBlockedByDebt(balance)) {
                const debtPoints = Math.abs(balance);
                return res.status(400).json({
                    error: formatVoucherFrozenMessage(debtPoints),
                    code: 'POINTS_DEBT',
                    debtPoints,
                    debtMessage: formatDebtMessage(debtPoints)
                });
            }

            const [voucherRows] = await db.query(
                `SELECT * FROM vouchers WHERE code = ? AND is_archived = FALSE`,
                [normalizedCode]
            );
            const voucher = voucherRows[0];
            
            if (!voucher) {
                recordFailedAttempt(clientIp);
                return res.status(404).json({ error: 'Invalid voucher code' });
            }
            if (!voucher.is_active || voucher.times_used >= voucher.max_uses) {
                recordFailedAttempt(clientIp);
                return res.status(400).json({ error: 'Voucher is no longer valid or has reached its usage limit' });
            }
            if (new Date(voucher.expires_at) < new Date()) {
                return res.status(400).json({ error: 'Voucher has expired' });
            }
            if (voucher.user_id && voucher.user_id !== req.user.id) {
                recordFailedAttempt(clientIp);
                return res.status(400).json({ error: 'Voucher belongs to another account' });
            }
            
            if (subtotal && subtotal < Number(voucher.min_spend)) {
                return res.status(400).json({ error: `Minimum spend of RM${voucher.min_spend} required` });
            }

            // Valid code, clear their failed attempts
            failedVoucherAttempts.delete(clientIp);
            res.json({ valid: true, voucher });
        } catch (err) {
            res.status(500).json({ error: 'Failed to validate voucher' });
        }
    });

    router.get('/user/vouchers/savings', requireAuth, async (req, res) => {
        try {
            const [rows] = await db.query(
                `SELECT SUM(discount_amount) as total_saved 
                 FROM orders 
                 WHERE user_id = ? AND status = 'Completed' AND discount_amount > 0`,
                [req.user.id]
            );
            res.json({ totalSaved: Number(rows[0].total_saved || 0) });
        } catch (err) {
            console.error('Failed to fetch voucher savings:', err);
            res.status(500).json({ error: 'Failed to fetch savings' });
        }
    });

    // ==========================================
    // ADMIN APIs
    // ==========================================

    router.get('/admin/points/settings', requireAdmin, async (req, res) => {
        try {
            const [settings] = await db.query(`SELECT voucher_cooldown_hours FROM shop_settings LIMIT 1`);
            res.json({ voucher_cooldown_hours: settings[0]?.voucher_cooldown_hours || 0 });
        } catch (err) {
            console.error('Error fetching admin points settings:', err);
            res.status(500).json({ error: 'Failed to fetch settings' });
        }
    });

    router.put('/admin/points/settings', requireAdmin, async (req, res) => {
        const { voucher_cooldown_hours } = req.body;
        try {
            await db.query(`UPDATE shop_settings SET voucher_cooldown_hours = ? LIMIT 1`, [voucher_cooldown_hours || 0]);
            res.json({ success: true });
        } catch (err) {
            console.error('Error updating admin points settings:', err);
            res.status(500).json({ error: 'Failed to update settings' });
        }
    });

    router.get('/admin/points/tiers', requireAdmin, async (req, res) => {
        try {
            const [tiers] = await db.query(`SELECT * FROM point_redemption_tiers ORDER BY points_required ASC`);
            res.json(tiers);
        } catch (err) {
            console.error('Error fetching admin point tiers:', err);
            res.status(500).json({ error: 'Failed to fetch tiers' });
        }
    });

    router.post('/admin/points/tiers', requireAdmin, async (req, res) => {
        const { points_required, discount_amount, is_active } = req.body;
        try {
            await db.query(
                `INSERT INTO point_redemption_tiers (points_required, discount_amount, is_active) VALUES (?, ?, ?)`,
                [points_required, discount_amount, is_active ?? true]
            );
            res.json({ success: true });
        } catch (err) {
            console.error('Error creating point tier:', err);
            res.status(500).json({ error: 'Failed to create tier' });
        }
    });

    router.put('/admin/points/tiers/:id', requireAdmin, async (req, res) => {
        const { id } = req.params;
        const { points_required, discount_amount, is_active } = req.body;
        try {
            await db.query(
                `UPDATE point_redemption_tiers SET points_required = ?, discount_amount = ?, is_active = ? WHERE id = ?`,
                [points_required, discount_amount, is_active ?? true, id]
            );
            res.json({ success: true });
        } catch (err) {
            console.error('Error updating point tier:', err);
            res.status(500).json({ error: 'Failed to update tier' });
        }
    });

    router.delete('/admin/points/tiers/:id', requireAdmin, async (req, res) => {
        const { id } = req.params;
        try {
            await db.query(`DELETE FROM point_redemption_tiers WHERE id = ?`, [id]);
            res.json({ success: true });
        } catch (err) {
            console.error('Error deleting point tier:', err);
            res.status(500).json({ error: 'Failed to delete tier' });
        }
    });

    router.get('/admin/points/users', requireAdmin, async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;

            const [users] = await db.query(
                `SELECT id, name, email, points_balance FROM users ORDER BY points_balance DESC LIMIT ? OFFSET ?`,
                [limit, offset]
            );

            const [countResult] = await db.query(`SELECT COUNT(*) as total FROM users`);
            const total = countResult[0].total;

            res.json({ users, total, totalPages: Math.ceil(total / limit) });
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

            // Admin deduct may drive balance negative (points debt). Redeem/vouchers freeze until cleared.
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

            const [afterRows] = await connection.query(
                `SELECT points_balance FROM users WHERE id = ? LIMIT 1`,
                [userId]
            );
            const balance = Number(afterRows[0]?.points_balance || 0);
            const debtPoints = balance < 0 ? Math.abs(balance) : 0;

            await connection.commit();
            res.json({
                success: true,
                balance,
                debtPoints,
                debtMessage: formatDebtMessage(debtPoints)
            });
        } catch (err) {
            await connection.rollback();
            if (err.message === 'User not found') {
                return res.status(400).json({ error: err.message });
            }
            res.status(500).json({ error: 'Failed to adjust points' });
        } finally {
            connection.release();
        }
    });

    router.get('/admin/vouchers', requireAdmin, async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;
            const source = req.query.source || 'manual'; // 'manual' or 'points_redemption'

            const [vouchers] = await db.query(`
                SELECT v.*, u.name as user_name, u.email as user_email
                FROM vouchers v
                LEFT JOIN users u ON v.user_id = u.id
                WHERE v.is_archived = FALSE AND v.source = ?
                ORDER BY v.created_at DESC
                LIMIT ? OFFSET ?
            `, [source, limit, offset]);
            
            const [countResult] = await db.query(`SELECT COUNT(*) as total FROM vouchers WHERE is_archived = FALSE AND source = ?`, [source]);
            const total = countResult[0].total;

            res.json({ vouchers, total, totalPages: Math.ceil(total / limit) });
        } catch (err) {
            res.status(500).json({ error: 'Failed to fetch vouchers' });
        }
    });

    router.post('/admin/vouchers', requireAdmin, async (req, res) => {
        const { code, type, discount_value, min_spend, max_discount, expires_at, user_email, max_uses } = req.body;
        
        try {
            let finalUserId = null;
            let finalMaxUses = parseInt(max_uses) || 1;

            if (user_email && user_email.trim()) {
                const [users] = await db.query('SELECT id FROM users WHERE email = ?', [user_email.trim()]);
                if (users.length === 0) {
                    return res.status(400).json({ error: 'User with this email not found' });
                }
                finalUserId = users[0].id;
                finalMaxUses = 1; // Force 1 if assigned to specific user
            }

            const sqlExpiresAt = expires_at ? new Date(expires_at).toISOString().slice(0, 19).replace('T', ' ') : null;
            await db.query(
                `INSERT INTO vouchers (code, type, discount_value, min_spend, max_discount, expires_at, user_id, is_active, is_redeemed, max_uses, times_used, source, is_archived)
                 VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, FALSE, ?, 0, 'manual', FALSE)`,
                [
                    code.trim().toUpperCase(),
                    type,
                    discount_value,
                    min_spend || 0,
                    max_discount || null,
                    sqlExpiresAt,
                    finalUserId,
                    finalMaxUses
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

    router.put('/admin/vouchers/:id/delete', requireAdmin, async (req, res) => {
        try {
            await db.query(`UPDATE vouchers SET is_archived = TRUE WHERE id = ?`, [req.params.id]);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: 'Failed to delete voucher' });
        }
    });

    router.get('/admin/points/stats', requireAdmin, async (req, res) => {
        try {
            const [rows] = await db.query(`
                SELECT SUM(points) as circulating_coin
                FROM points_transactions
            `);
            const totalPoints = Number(rows[0]?.circulating_coin || 0);
            const estValueRM = totalPoints / 200;
            res.json({ circulatingCoin: totalPoints, estValueRM });
        } catch (err) {
            console.error('Failed to fetch points stats:', err);
            res.status(500).json({ error: 'Failed to fetch points stats' });
        }
    });

    router.get('/admin/vouchers/stats', requireAdmin, async (req, res) => {
        try {
            const [rows] = await db.query(`
                SELECT 
                    SUM(CASE WHEN DATE(created_at) = CURDATE() THEN discount_amount ELSE 0 END) as today,
                    SUM(CASE WHEN YEARWEEK(created_at, 1) = YEARWEEK(CURDATE(), 1) THEN discount_amount ELSE 0 END) as this_week,
                    SUM(CASE WHEN MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE()) THEN discount_amount ELSE 0 END) as this_month
                FROM orders
                WHERE voucher_id IS NOT NULL AND status != 'Cancelled'
            `);
            
            res.json({
                today: Number(rows[0]?.today || 0),
                thisWeek: Number(rows[0]?.this_week || 0),
                thisMonth: Number(rows[0]?.this_month || 0)
            });
        } catch (err) {
            console.error('Failed to fetch voucher stats:', err);
            res.status(500).json({ error: 'Failed to fetch voucher stats' });
        }
    });

    router.get('/admin/vouchers/export', requireAdmin, async (req, res) => {
        try {
            const [vouchers] = await db.query(`
                SELECT v.code, v.type, v.discount_value, v.min_spend, v.max_discount, v.expires_at, v.is_active, v.is_redeemed, v.created_at, u.email as assigned_to
                FROM vouchers v
                LEFT JOIN users u ON v.user_id = u.id
                ORDER BY v.created_at DESC
            `);
            
            let csv = 'Code,Type,Value,Min Spend,Max Discount,Expires At,Assigned To,Active,Redeemed,Created At\n';
            vouchers.forEach(v => {
                const value = v.type === 'percentage' ? `${v.discount_value}%` : `RM${v.discount_value}`;
                csv += `"${v.code}","${v.type}","${value}","${v.min_spend}","${v.max_discount || ''}","${new Date(v.expires_at).toISOString()}","${v.assigned_to || 'Public'}","${v.is_active}","${v.is_redeemed}","${new Date(v.created_at).toISOString()}"\n`;
            });

            res.header('Content-Type', 'text/csv');
            res.attachment(`vouchers_export_${new Date().toISOString().slice(0,10)}.csv`);
            res.send(csv);
        } catch (err) {
            console.error('Failed to export vouchers:', err);
            res.status(500).json({ error: 'Failed to export vouchers' });
        }
    });

    return router;
};
