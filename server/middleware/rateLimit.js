/**
 * In-memory rate limiters.
 */
'use strict';

const {
    AUTH_RATE_LIMIT_WINDOW_MS,
    AUTH_RATE_LIMIT_MAX_ATTEMPTS,
    WEBHOOK_RATE_LIMIT_WINDOW_MS,
    WEBHOOK_RATE_LIMIT_MAX_REQUESTS
} = require('../config');

const createInMemoryRateLimiter = ({ windowMs, max, keyFn }) => {
    const counters = new Map();
    let pruneCursor = 0;

    return (req, res, next) => {
        const now = Date.now();
        const key = String(typeof keyFn === 'function' ? keyFn(req) : req.ip || 'unknown');
        const existing = counters.get(key);
        const baseRecord =
            !existing || existing.resetAt <= now
                ? { count: 0, resetAt: now + windowMs }
                : existing;
        baseRecord.count += 1;
        counters.set(key, baseRecord);

        pruneCursor += 1;
        if (pruneCursor >= 1000) {
            pruneCursor = 0;
            for (const [candidateKey, candidateRecord] of counters.entries()) {
                if (candidateRecord.resetAt <= now) {
                    counters.delete(candidateKey);
                }
            }
        }

        if (baseRecord.count > max) {
            const retryAfterSeconds = Math.max(1, Math.ceil((baseRecord.resetAt - now) / 1000));
            res.setHeader('Retry-After', String(retryAfterSeconds));
            return res.status(429).json({
                error: 'Too many requests. Please try again later.'
            });
        }
        return next();
    };
};

const authRateLimiter = createInMemoryRateLimiter({
    windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
    max: AUTH_RATE_LIMIT_MAX_ATTEMPTS,
    keyFn: (req) => `${String(req.ip || 'unknown')}:${String(req.body?.email || '').trim().toLowerCase()}`
});

const webhookRateLimiter = createInMemoryRateLimiter({
    windowMs: WEBHOOK_RATE_LIMIT_WINDOW_MS,
    max: WEBHOOK_RATE_LIMIT_MAX_REQUESTS,
    keyFn: (req) => String(req.ip || 'unknown')
});

module.exports = {
    createInMemoryRateLimiter,
    authRateLimiter,
    webhookRateLimiter
};
