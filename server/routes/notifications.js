/**
 * Domain routes: notifications + public config
 */
'use strict';

const db = require('../db');
const { GOOGLE_CLIENT_ID } = require('../config');
const { requireAuth } = require('../middleware/auth');

module.exports = function registerNotificationsRoutes(app) {
    app.get('/api/notifications/vapid-public-key', (req, res) => {
        res.send(process.env.VAPID_PUBLIC_KEY || '');
    });

    app.get('/api/config/google', (req, res) => {
        res.json({ googleClientId: GOOGLE_CLIENT_ID });
    });

    app.post('/api/notifications/subscribe', requireAuth, async (req, res) => {
        const userId = req.user.id;
        const { subscription } = req.body;
        if (!subscription || !subscription.endpoint || !subscription.keys) {
            return res.status(400).json({ error: 'Invalid subscription object' });
        }

        try {
            await db.query(`
                INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    user_id = VALUES(user_id),
                    p256dh = VALUES(p256dh),
                    auth = VALUES(auth)
            `, [
                userId,
                subscription.endpoint,
                subscription.keys.p256dh,
                subscription.keys.auth
            ]);
            res.json({ success: true });
        } catch (err) {
            console.error('Failed to save push subscription:', err);
            res.status(500).json({ error: 'Failed to save subscription' });
        }
    });

    app.delete('/api/notifications/unsubscribe', requireAuth, async (req, res) => {
        const userId = req.user.id;
        const { endpoint } = req.body;
        if (!endpoint) {
            return res.status(400).json({ error: 'Endpoint required' });
        }

        try {
            await db.query('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', [userId, endpoint]);
            res.json({ success: true });
        } catch (err) {
            console.error('Failed to remove push subscription:', err);
            res.status(500).json({ error: 'Failed to remove subscription' });
        }
    });
};
