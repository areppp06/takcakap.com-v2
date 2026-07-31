/**
 * JWT sign/read helpers (domain-layer safe — no Express middleware).
 */
'use strict';

const jwt = require('jsonwebtoken');
const { JWT_SECRET, ADMIN_ORDER_STREAM_TOKEN_TTL_SECONDS } = require('../config');

const readBearerToken = (req) => {
    const authHeader = req.headers?.authorization || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : null;
};

const readAuthToken = (req) => readBearerToken(req);

const signAdminStreamToken = (user) =>
    jwt.sign(
        {
            sub: String(user.id),
            role: 'admin',
            purpose: 'admin_orders_stream'
        },
        JWT_SECRET,
        { expiresIn: ADMIN_ORDER_STREAM_TOKEN_TTL_SECONDS }
    );

const signAuthToken = (user) =>
    jwt.sign(
        {
            sub: String(user.id),
            role: user.role || 'user',
            email: user.email
        },
        JWT_SECRET,
        { expiresIn: '7d' }
    );

module.exports = {
    readBearerToken,
    readAuthToken,
    signAdminStreamToken,
    signAuthToken
};
