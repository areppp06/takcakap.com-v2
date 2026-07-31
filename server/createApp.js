/**
 * Express app factory: core middleware assembly only.
 * Route mounting and server listen live in index.js.
 */
'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const {
    installConsoleInterceptors,
    requestContextMiddleware,
    requestLogAndMetricsMiddleware
} = require('./observability');
const { TRUST_PROXY_SETTING } = require('./config');
const { corsOptionsDelegate } = require('./middleware/cors');
const { createJsonBodyParser, createUrlencodedParser } = require('./middleware/bodyParser');
const { apiAliasMiddleware } = require('./middleware/apiAlias');

/**
 * TRUST_PROXY:
 * - Prefer hop count (e.g. "1") when behind a known edge proxy — safest for req.ip rate limits.
 * - "true" trusts all X-Forwarded-* and is a footgun if the app is reachable without a proxy.
 * - Documented production warning when TRUST_PROXY=true.
 */
function applyTrustProxy(app) {
    if (!TRUST_PROXY_SETTING) return;
    if (TRUST_PROXY_SETTING === 'true') {
        app.set('trust proxy', true);
        if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
            console.warn(
                '[createApp] TRUST_PROXY=true trusts all X-Forwarded-* headers. Prefer hop count (e.g. TRUST_PROXY=1) behind a single edge proxy so rate limits use accurate req.ip.'
            );
        }
    } else if (TRUST_PROXY_SETTING === 'false') {
        app.set('trust proxy', false);
    } else {
        const parsedTrustProxy = Number.parseInt(TRUST_PROXY_SETTING, 10);
        if (Number.isInteger(parsedTrustProxy) && parsedTrustProxy >= 0) {
            app.set('trust proxy', parsedTrustProxy);
        }
    }
}

/**
 * Absolute path to Vite production build (Docker: /app/dist).
 */
function getDistPath() {
    return path.resolve(__dirname, '..', 'dist');
}

/**
 * Build Express app with observability → CORS → JSON(rawBody) → urlencoded → alias → static.
 * Does not mount domain routes or SPA fallback.
 */
function createApp() {
    installConsoleInterceptors();

    const app = express();
    app.disable('x-powered-by');
    applyTrustProxy(app);

    const distPath = getDistPath();
    // One-time visibility for blank-page debugging in Portainer logs
    try {
        const fs = require('fs');
        const assetsDir = path.join(distPath, 'assets');
        const assetCount = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).length : 0;
        console.log(`[createApp] static dist=${distPath} exists=${fs.existsSync(distPath)} assets=${assetCount}`);
    } catch (e) {
        console.warn('[createApp] dist probe failed:', e?.message || e);
    }

    // Middleware order matters for webhooks HMAC/rawBody and metrics
    app.use(requestContextMiddleware);
    app.use(requestLogAndMetricsMiddleware);
    app.use(cors(corsOptionsDelegate));
    app.options('*', cors(corsOptionsDelegate));
    app.use(createJsonBodyParser());
    app.use(createUrlencodedParser());
    app.use(apiAliasMiddleware);
    // index: false — never auto-serve index.html from static (SPA fallback owns that)
    app.use(
        express.static(distPath, {
            index: false,
            fallthrough: true,
            maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
        })
    );

    return app;
}


module.exports = {
    createApp,
    applyTrustProxy,
    getDistPath
};
