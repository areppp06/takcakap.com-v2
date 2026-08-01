/**
 * Order routes: admin stream + FCM
 */
'use strict';

const db = require('../../db');
const {
    ADMIN_ORDER_EVENTS_HEARTBEAT_MS,
    ADMIN_ORDER_EVENTS_RETRY_MS,
    ADMIN_ORDER_STREAM_TOKEN_TTL_SECONDS
} = require('../../config');
const { requireAdmin, requireAdminStreamToken, signAdminStreamToken } = require('../../middleware/auth');
const { orderEvents } = require('../../services/orders/orderEvents');
const { sendFcmToAdmins, isFirebaseReady } = require('../../pushService');

module.exports = function register(app) {

    app.post('/api/admin/orders/stream-token', requireAdmin, async (req, res) => {
        try {
            const token = signAdminStreamToken(req.user);
            return res.json({
                token,
                expiresInSeconds: ADMIN_ORDER_STREAM_TOKEN_TTL_SECONDS
            });
        } catch (error) {
            console.error('Failed to issue admin stream token:', error);
            return res.status(500).json({ error: 'Failed to issue admin stream token' });
        }
    });

    app.post('/api/admin/fcm-token', requireAdmin, async (req, res) => {
        try {
            const token = String(req.body?.token || '').trim();
            const deviceInfo = String(req.body?.deviceInfo || req.body?.device_info || '').trim().slice(0, 255);

            if (!token) {
                return res.status(400).json({ error: 'Token is required' });
            }
            if (token.length > 512) {
                return res.status(400).json({ error: 'Token is too long' });
            }

            const userId = Number(req.user?.id) || null;

            await db.query(`
                INSERT INTO admin_fcm_tokens (token, user_id, device_info)
                VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    updated_at = CURRENT_TIMESTAMP,
                    user_id = VALUES(user_id),
                    device_info = COALESCE(NULLIF(VALUES(device_info), ''), device_info)
            `, [token, userId, deviceInfo || null]);

            console.log(
                `✅ admin FCM token registered user=${userId || 'n/a'} token=${token.substring(0, 16)}... device=${deviceInfo || 'n/a'}`
            );

            return res.json({ success: true, armed: true });
        } catch (error) {
            console.error('Failed to register admin FCM token:', error);
            return res.status(500).json({ error: 'Failed to register admin FCM token' });
        }
    });

    app.delete('/api/admin/fcm-token', requireAdmin, async (req, res) => {
        try {
            const token = String(req.body?.token || '').trim();
            const userId = Number(req.user?.id) || null;
            let deleted = 0;

            if (token) {
                const [result] = await db.query(
                    'DELETE FROM admin_fcm_tokens WHERE token = ?',
                    [token]
                );
                deleted = result?.affectedRows || 0;
            } else if (userId) {
                const [result] = await db.query(
                    'DELETE FROM admin_fcm_tokens WHERE user_id = ?',
                    [userId]
                );
                deleted = result?.affectedRows || 0;
            } else {
                return res.status(400).json({ error: 'Token or authenticated user is required' });
            }

            console.log(`🗑️ admin FCM token unregister deleted=${deleted} user=${userId || 'n/a'}`);
            return res.json({ success: true, deleted });
        } catch (error) {
            console.error('Failed to unregister admin FCM token:', error);
            return res.status(500).json({ error: 'Failed to unregister admin FCM token' });
        }
    });

    app.get('/api/admin/fcm-status', requireAdmin, async (req, res) => {
        try {
            const [rows] = await db.query(
                'SELECT token, user_id, device_info, created_at, updated_at FROM admin_fcm_tokens ORDER BY updated_at DESC'
            );
            return res.json({
                firebaseReady: isFirebaseReady(),
                tokenCount: rows.length,
                tokens: rows.map((row) => ({
                    tokenPreview: String(row.token || '').substring(0, 16) + '...',
                    userId: row.user_id,
                    deviceInfo: row.device_info || null,
                    createdAt: row.created_at,
                    updatedAt: row.updated_at
                }))
            });
        } catch (error) {
            console.error('Failed to load admin FCM status:', error);
            return res.status(500).json({ error: 'Failed to load admin FCM status' });
        }
    });

    app.post('/api/admin/fcm-test', requireAdmin, async (req, res) => {
        try {
            console.log('🧪 FCM TEST: Manually triggering test push to all admin devices...');
            if (!isFirebaseReady()) {
                return res.status(503).json({
                    success: false,
                    error: 'Firebase Admin is not initialized on the server'
                });
            }

            const [rows] = await db.query('SELECT token FROM admin_fcm_tokens');
            console.log(`🧪 FCM TEST: Found ${rows.length} token(s) in database`);
            rows.forEach((r, i) => console.log(`  Token[${i}]: ${r.token.substring(0, 20)}...`));

            if (rows.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'No admin FCM tokens registered. Open the Android app and log in as admin first.',
                    tokenCount: 0
                });
            }

            const result = await sendFcmToAdmins(
                'TEST ALARM',
                'This is a test notification. You should hear a looping alarm!',
                { type: 'new_order', orderId: '0' }
            );

            return res.json({
                success: true,
                tokenCount: rows.length,
                successCount: result?.successCount ?? 0,
                failureCount: result?.failureCount ?? 0
            });
        } catch (error) {
            console.error('FCM TEST failed:', error);
            return res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/admin/orders/stream', requireAdminStreamToken, (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        if (typeof res.flushHeaders === 'function') {
            res.flushHeaders();
        }

        const writeEvent = (eventName, payload) => {
            res.write(`event: ${eventName}\n`);
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
        };

        res.write(`retry: ${ADMIN_ORDER_EVENTS_RETRY_MS}\n\n`);
        writeEvent('connected', {
            ok: true,
            emittedAtUtc: new Date().toISOString()
        });

        const onOrdersChanged = (payload) => {
            writeEvent('orders_changed', payload);
        };
        orderEvents.on('orders_changed', onOrdersChanged);

        const heartbeatTimer = setInterval(() => {
            writeEvent('ping', { emittedAtUtc: new Date().toISOString() });
        }, ADMIN_ORDER_EVENTS_HEARTBEAT_MS);
        const streamExpiryMs =
            Number.isFinite(Number(req.adminStreamTokenExpMs)) && Number(req.adminStreamTokenExpMs) > 0
                ? Number(req.adminStreamTokenExpMs) - Date.now()
                : null;
        const expiryTimer =
            streamExpiryMs !== null && streamExpiryMs > 0
                ? setTimeout(() => {
                    writeEvent('session_expired', { emittedAtUtc: new Date().toISOString() });
                    res.end();
                }, streamExpiryMs + 250)
                : null;

        req.on('close', () => {
            clearInterval(heartbeatTimer);
            if (expiryTimer) {
                clearTimeout(expiryTimer);
            }
            orderEvents.off('orders_changed', onOrdersChanged);
        });
    });

};
