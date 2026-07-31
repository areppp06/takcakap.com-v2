/**
 * Auth middleware. JWT sign helpers live in lib/authTokens.js.
 */
'use strict';

const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('../config');
const { toPositiveInteger } = require('../lib/primitives');
const {
    readBearerToken,
    readAuthToken,
    signAdminStreamToken,
    signAuthToken
} = require('../lib/authTokens');

const mapUserResponse = (row) => ({
    id: String(row.id),
    name: row.name,
    email: row.email,
    phoneNumber: row.phone_number || '',
    avatar: row.avatar_url || '',
    role: row.role || 'user',
    isSuspended: Boolean(row.is_suspended)
});

const attachAuthIfPresent = async (req, res, next) => {
    const token = readAuthToken(req);
    if (!token) return next();

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const userId = toPositiveInteger(decoded.sub);
        if (!userId) {
            return res.status(401).json({ error: 'Invalid auth token' });
        }

        const [rows] = await db.query(
            'SELECT id, email, role, is_suspended FROM users WHERE id = ? LIMIT 1',
            [userId]
        );
        const dbUser = rows[0];
        if (!dbUser) {
            return res.status(401).json({ error: 'Invalid auth token' });
        }

        req.user = {
            id: Number(dbUser.id),
            role: dbUser.role || decoded.role || 'user',
            email: dbUser.email || decoded.email || '',
            isSuspended: Boolean(dbUser.is_suspended)
        };
        return next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid or expired auth token' });
    }
};

const requireAuth = (req, res, next) =>
    attachAuthIfPresent(req, res, () => {
        if (!req.user?.id) return res.status(401).json({ error: 'Authentication required' });
        if (req.user?.isSuspended && req.user?.role !== 'admin') {
            return res.status(403).json({ error: 'Your account is suspended. Please contact support.' });
        }
        return next();
    });

const requireAdmin = (req, res, next) =>
    requireAuth(req, res, () => {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        return next();
    });

const requireAdminStreamToken = async (req, res, next) => {
    const legacyQueryToken = String(req.query?.stream_token || '').trim();
    if (legacyQueryToken) {
        return res.status(400).json({
            error: 'stream_token query parameter is deprecated. Use Authorization: Bearer <stream token>.'
        });
    }

    const streamToken = String(readBearerToken(req) || '').trim();
    if (!streamToken) {
        return res.status(401).json({ error: 'Admin stream bearer token is required' });
    }

    try {
        const decoded = jwt.verify(streamToken, JWT_SECRET);
        const userId = toPositiveInteger(decoded?.sub);
        if (!userId || decoded?.role !== 'admin' || decoded?.purpose !== 'admin_orders_stream') {
            return res.status(401).json({ error: 'Invalid stream token' });
        }
        const [rows] = await db.query(
            'SELECT id, email, role, is_suspended FROM users WHERE id = ? LIMIT 1',
            [userId]
        );
        const user = rows[0];
        if (!user || user.role !== 'admin' || Boolean(user.is_suspended)) {
            return res.status(403).json({ error: 'Admin stream access denied' });
        }
        req.user = {
            id: Number(user.id),
            role: user.role || 'admin',
            email: user.email || '',
            isSuspended: Boolean(user.is_suspended)
        };
        req.adminStreamTokenExpMs = Number(decoded?.exp || 0) > 0 ? Number(decoded.exp) * 1000 : null;
        return next();
    } catch (_error) {
        return res.status(401).json({ error: 'Invalid or expired stream token' });
    }
};

module.exports = {
    readBearerToken,
    readAuthToken,
    signAdminStreamToken,
    signAuthToken,
    mapUserResponse,
    attachAuthIfPresent,
    requireAuth,
    requireAdmin,
    requireAdminStreamToken
};
