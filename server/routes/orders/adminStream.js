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
const { sendFcmToAdmins } = require('../../pushService');

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
            const { token } = req.body;
            if (!token) {
                return res.status(400).json({ error: 'Token is required' });
            }
            
            // Upsert the token
            await db.query(`
                INSERT INTO admin_fcm_tokens (token) VALUES (?)
                ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP
            `, [token]);
            
            return res.json({ success: true });
        } catch (error) {
            console.error('Failed to register admin FCM token:', error);
            return res.status(500).json({ error: 'Failed to register admin FCM token' });
        }
    });

    // DEBUG: Test FCM push to all registered admin devices
    app.post('/api/admin/fcm-test', requireAdmin, async (req, res) => {
        try {
            console.log('🧪 FCM TEST: Manually triggering test push to all admin devices...');
            const [rows] = await db.query('SELECT token FROM admin_fcm_tokens');
            console.log(`🧪 FCM TEST: Found ${rows.length} token(s) in database`);
            rows.forEach((r, i) => console.log(`  Token[${i}]: ${r.token.substring(0, 20)}...`));
            
            await sendFcmToAdmins(
                'TEST ALARM 🧪',
                'This is a test notification. You should hear a looping alarm!',
                { type: 'new_order', orderId: '0' }
            );
            return res.json({ success: true, tokenCount: rows.length });
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
