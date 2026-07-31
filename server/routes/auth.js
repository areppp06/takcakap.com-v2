'use strict';

/**
 * Domain routes: auth
 * Pure extraction from server/index.js monolith — behavior preserved.
 */
const db = require('../db');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const { ADMIN_PASSWORD, GOOGLE_CLIENT_ID } = require('../config');
const { authRateLimiter } = require('../middleware/rateLimit');
const { requireAuth, signAuthToken, mapUserResponse } = require('../middleware/auth');
const lalamoveService = require('../lalamoveService');
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID || undefined);


module.exports = function registerAuthRoutes(app) {

    app.post('/api/auth/google', authRateLimiter, async (req, res) => {
        try {
            if (!GOOGLE_CLIENT_ID) {
                return res.status(500).json({ error: 'GOOGLE_CLIENT_ID is not configured' });
            }

            const credential = req.body?.credential;
            if (!credential) {
                return res.status(400).json({ error: 'Missing Google credential token' });
            }

            const ticket = await googleClient.verifyIdToken({
                idToken: credential,
                audience: GOOGLE_CLIENT_ID
            });
            const payload = ticket.getPayload();

            if (!payload?.sub || !payload?.email) {
                return res.status(400).json({ error: 'Invalid Google token payload' });
            }
            if (payload.email_verified === false) {
                return res.status(400).json({ error: 'Google account email is not verified' });
            }

            const googleId = String(payload.sub);
            const email = String(payload.email).trim().toLowerCase();
            const name = String(payload.name || 'Google User').trim();
            const avatarUrl = String(payload.picture || '');

            const [foundByGoogle] = await db.query(
                'SELECT id, name, email, role, avatar_url, phone_number, is_suspended FROM users WHERE google_id = ? LIMIT 1',
                [googleId]
            );
            const [foundByEmail] = foundByGoogle.length
                ? [[]]
                : await db.query(
                    'SELECT id, name, email, role, avatar_url, phone_number, is_suspended FROM users WHERE email = ? LIMIT 1',
                    [email]
                );

            let userRow = foundByGoogle[0] || foundByEmail[0] || null;

            if (userRow?.role === 'admin') {
                return res.status(403).json({ error: 'Admin accounts must sign in via admin login' });
            }
            if (userRow?.is_suspended) {
                return res.status(403).json({ error: 'Your account is suspended. Please contact support.' });
            }

            if (userRow) {
                await db.query(
                    `
                        UPDATE users
                        SET google_id = ?, name = ?, email = ?, avatar_url = COALESCE(NULLIF(?, ''), avatar_url)
                        WHERE id = ?
                    `,
                    [googleId, name, email, avatarUrl, userRow.id]
                );
                const [rows] = await db.query(
                    'SELECT id, name, email, role, avatar_url, phone_number, is_suspended FROM users WHERE id = ? LIMIT 1',
                    [userRow.id]
                );
                userRow = rows[0];
            } else {
                const [insert] = await db.query(
                    `
                        INSERT INTO users (name, email, google_id, role, avatar_url)
                        VALUES (?, ?, ?, 'user', ?)
                    `,
                    [name, email, googleId, avatarUrl]
                );
                const [rows] = await db.query(
                    'SELECT id, name, email, role, avatar_url, phone_number, is_suspended FROM users WHERE id = ? LIMIT 1',
                    [insert.insertId]
                );
                userRow = rows[0];
            }

            const token = signAuthToken(userRow);
            return res.json({
                token,
                user: mapUserResponse(userRow)
            });
        } catch (error) {
            console.error('Google auth failed:', error);
            return res.status(401).json({ error: 'Google authentication failed' });
        }
    });

    app.post('/api/auth/admin/login', authRateLimiter, async (req, res) => {
        try {
            if (!ADMIN_PASSWORD) {
                return res.status(500).json({ error: 'Admin login is not configured on server' });
            }

            const email = String(req.body?.email || '').trim().toLowerCase();
            const password = String(req.body?.password || '');
            if (!email || !password) {
                return res.status(400).json({ error: 'Email and password are required' });
            }

            const [rows] = await db.query(
                `
                    SELECT id, name, email, role, avatar_url, phone_number, password_hash, is_suspended
                    FROM users
                    WHERE email = ?
                    LIMIT 1
                `,
                [email]
            );
            const admin = rows[0];
            if (!admin || admin.role !== 'admin' || !admin.password_hash) {
                return res.status(401).json({ error: 'Invalid admin credentials' });
            }
            if (admin.is_suspended) {
                return res.status(403).json({ error: 'Admin account is suspended' });
            }

            const isValidPassword = await bcrypt.compare(password, admin.password_hash);
            if (!isValidPassword) {
                return res.status(401).json({ error: 'Invalid admin credentials' });
            }

            const token = signAuthToken(admin);
            return res.json({ token, user: mapUserResponse(admin) });
        } catch (error) {
            console.error('Admin login failed:', error);
            return res.status(500).json({ error: 'Admin login failed' });
        }
    });

    app.get('/api/auth/me', requireAuth, async (req, res) => {
        try {
            const [rows] = await db.query(
                'SELECT id, name, email, role, avatar_url, phone_number, is_suspended FROM users WHERE id = ? LIMIT 1',
                [req.user.id]
            );
            const user = rows[0];
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            return res.json({ user: mapUserResponse(user) });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to fetch user profile' });
        }
    });

    app.put('/api/account', requireAuth, async (req, res) => {
        try {
            const name = req.body?.name ? String(req.body.name).trim() : null;
            const phoneNumber = req.body?.phoneNumber !== undefined ? String(req.body.phoneNumber).trim() : null;

            const fields = [];
            const values = [];
            if (name) {
                fields.push('name = ?');
                values.push(name);
            }
            if (phoneNumber !== null) {
                const normalizedPhoneNumber = phoneNumber ? lalamoveService.normalizePhone(phoneNumber) : '';
                if (phoneNumber && !lalamoveService.isValidPhone(normalizedPhoneNumber)) {
                    return res.status(400).json({ error: 'Invalid phone number format. Use E.164, e.g. +60123456789' });
                }
                fields.push('phone_number = ?');
                values.push(normalizedPhoneNumber);
            }

            if (fields.length === 0) {
                return res.json({ success: true });
            }

            values.push(req.user.id);
            await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);

            const [rows] = await db.query(
                'SELECT id, name, email, role, avatar_url, phone_number, is_suspended FROM users WHERE id = ? LIMIT 1',
                [req.user.id]
            );

            return res.json({ success: true, user: mapUserResponse(rows[0]) });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to update account' });
        }
    });
};
