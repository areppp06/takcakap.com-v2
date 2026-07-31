/**
 * CORS options delegate (includes Curlec callback trusted origins).
 */
'use strict';

const {
    CORS_ORIGINS,
    CORS_ORIGIN_SET,
    CURLEC_CALLBACK_TRUSTED_ORIGINS,
    isCurlecCallbackPath,
    normalizeCorsOrigin
} = require('../config');

const corsBaseOptions = {
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

const corsOptionsDelegate = (req, callback) => {
    const rawOrigin = String(req.headers.origin || '').trim();
    const normalizedOrigin = normalizeCorsOrigin(rawOrigin);

    if (!normalizedOrigin || CORS_ORIGINS.length === 0 || CORS_ORIGIN_SET.has(normalizedOrigin)) {
        return callback(null, { ...corsBaseOptions, origin: true });
    }

    if (isCurlecCallbackPath(req.path || req.originalUrl) && CURLEC_CALLBACK_TRUSTED_ORIGINS.has(normalizedOrigin)) {
        return callback(null, { ...corsBaseOptions, origin: true });
    }

    return callback(
        new Error(
            `Origin not allowed by CORS: ${rawOrigin || normalizedOrigin} (path: ${req.path || req.originalUrl || ''})`
        )
    );
};

module.exports = {
    corsBaseOptions,
    corsOptionsDelegate
};
