/**
 * Server entry: createApp → mount domain routers → SPA fallback → startServer.
 * Validation runs at startup (not import-time) so unit tests can load modules safely.
 */
'use strict';

const path = require('path');
const { createApp, getDistPath } = require('./createApp');
const { validateStartupConfig, PORT, HOST } = require('./config');
const { shouldAliasToApi, isBrowserDocumentRequest } = require('./middleware/apiAlias');
const { requireAuth, requireAdmin } = require('./middleware/auth');
const { assertNoPendingMigrations } = require('./migrationRunner');
const emailService = require('./emailService');

const app = createApp();

// Domain route modules (Router + direct requires; no god-bag context)
require('./routes/health')(app);
require('./routes/shop')(app);
require('./routes/payments')(app);
require('./routes/adminSales')(app);
require('./routes/auth')(app);
require('./routes/adminCustomers')(app);
require('./routes/delivery')(app);
require('./routes/addresses')(app);
require('./routes/notifications')(app);
require('./routes/cart')(app);
require('./routes/menu')(app);
require('./routes/orders')(app);
require('./routes/webhooks')(app);

// Loyalty under /api alongside other domain routers (factory returns a fresh Router each call).
// Mounted after leaf domain modules; paths do not collide with /api/orders, /api/menu, etc.
app.use('/api', require('./loyaltyRoutes')(requireAuth, requireAdmin));

// --- HANDLE CLIENT-SIDE ROUTING ---
// Never SPA-fallback asset/extension requests (avoids MIME text/html on .js/.css → blank page).
const distIndex = path.join(getDistPath(), 'index.html');
app.get('*', (req, res) => {
    const p = req.path || '';
    if (p.startsWith('/api') || (shouldAliasToApi(p) && !isBrowserDocumentRequest(req))) {
        return res.status(404).json({ error: 'API route not found' });
    }
    // Missing static files must 404 as plain text — never index.html
    if (
        p.startsWith('/assets/') ||
        p === '/sw.js' ||
        p === '/sw.mjs' ||
        p === '/registerSW.js' ||
        p === '/manifest.webmanifest' ||
        /\.[a-zA-Z0-9]{1,12}$/.test(p)
    ) {
        return res.status(404).type('text/plain').send(`Not found: ${p}`);
    }
    return res.type('html').sendFile(distIndex, (err) => {
        if (err) {
            console.error('[spa] sendFile failed:', err.message, 'path=', distIndex);
            if (!res.headersSent) {
                res.status(500).type('text/plain').send('Frontend bundle missing (dist/index.html)');
            }
        }
    });
});

const startServer = async () => {
    validateStartupConfig();
    // Optional DB reachability log (does not fail startup; health endpoint is authoritative).
    try {
        const db = require('./db');
        if (typeof db.probeConnectionOnce === 'function') db.probeConnectionOnce();
    } catch (_e) {
        // ignore
    }
    await assertNoPendingMigrations();
    emailService.startWorker();
    await new Promise((resolve, reject) => {
        const server = app.listen(PORT, HOST, () => {
            console.log(`🚀 Backend running on http://${HOST}:${PORT}`);
            resolve();
        });
        server.on('error', (error) => {
            reject(error);
        });
    });
};

if (require.main === module) {
    startServer().catch((error) => {
        console.error('❌ Server startup failed:', error?.message || error);
        process.exit(1);
    });
}

module.exports = { app, startServer };
