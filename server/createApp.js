/**
 * Express app factory: core middleware assembly only.
 * Route mounting and server listen live in index.js.
 */
'use strict';

const fs = require('fs');
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
 * - Prefer hop count (e.g. "1") when behind a known edge proxy.
 */
function applyTrustProxy(app) {
    if (!TRUST_PROXY_SETTING) return;
    if (TRUST_PROXY_SETTING === 'true') {
        app.set('trust proxy', true);
        if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
            console.warn(
                '[createApp] TRUST_PROXY=true trusts all X-Forwarded-* headers. Prefer hop count (e.g. TRUST_PROXY=1).'
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
 * Override with STATIC_DIST_PATH if needed.
 */
function getDistPath() {
    if (process.env.STATIC_DIST_PATH) {
        return path.resolve(process.env.STATIC_DIST_PATH);
    }
    return path.resolve(__dirname, '..', 'dist');
}

function mountStatic(app, distPath) {
    const assetsPath = path.join(distPath, 'assets');
    let assetFiles = [];
    try {
        assetFiles = fs.existsSync(assetsPath) ? fs.readdirSync(assetsPath) : [];
        console.log(
            `[createApp] static dist=${distPath} exists=${fs.existsSync(distPath)} assetsDir=${fs.existsSync(assetsPath)} assets=${assetFiles.length}`
        );
        if (assetFiles.length) {
            console.log(`[createApp] sample assets: ${assetFiles.slice(0, 5).join(', ')}`);
        } else {
            console.error('[createApp] WARNING: dist/assets is empty or missing — SPA will be blank');
        }
    } catch (e) {
        console.warn('[createApp] dist probe failed:', e?.message || e);
    }

    // /assets first, fallthrough:false → real 404 if missing (never HTML index)
    if (fs.existsSync(assetsPath)) {
        app.use(
            '/assets',
            express.static(assetsPath, {
                fallthrough: false,
                index: false,
                maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
                immutable: true,
                setHeaders(res, filePath) {
                    if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
                        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
                    } else if (filePath.endsWith('.css')) {
                        res.setHeader('Content-Type', 'text/css; charset=utf-8');
                    }
                }
            })
        );
    }

    // Rest of dist: icons, manifest, registerSW, etc.
    if (fs.existsSync(distPath)) {
        app.use(
            express.static(distPath, {
                index: false,
                fallthrough: true,
                maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
            })
        );
    }
}

/**
 * Build Express app with static assets FIRST, then API middleware.
 */
function createApp() {
    installConsoleInterceptors();

    const app = express();
    app.disable('x-powered-by');
    applyTrustProxy(app);

    const distPath = getDistPath();

    // Static BEFORE body parsers so /assets never hits SPA/API stack
    mountStatic(app, distPath);

    app.use(requestContextMiddleware);
    app.use(requestLogAndMetricsMiddleware);
    app.use(cors(corsOptionsDelegate));
    app.options('*', cors(corsOptionsDelegate));
    app.use(createJsonBodyParser());
    app.use(createUrlencodedParser());
    app.use(apiAliasMiddleware);

    // Debug: list frontend bundle (safe, no secrets)
    app.get('/api/debug/dist', (req, res) => {
        const assetsPath = path.join(distPath, 'assets');
        let assets = [];
        try {
            assets = fs.existsSync(assetsPath) ? fs.readdirSync(assetsPath) : [];
        } catch (_e) {
            assets = [];
        }
        res.json({
            distPath,
            distExists: fs.existsSync(distPath),
            indexHtml: fs.existsSync(path.join(distPath, 'index.html')),
            assetsPath,
            assetCount: assets.length,
            assets: assets.slice(0, 50),
            cwd: process.cwd(),
            dirname: __dirname
        });
    });

    return app;
}

module.exports = {
    createApp,
    applyTrustProxy,
    getDistPath
};
