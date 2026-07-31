/**
 * Server entry: createApp → mount domain routers → SPA fallback → startServer.
 * Validation runs at startup (not import-time) so unit tests can load modules safely.
 */
'use strict';

const path = require('path');
const { createApp } = require('./createApp');
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
// Return JSON 404 for unknown API paths; keep SPA fallback for frontend routes.
app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || (shouldAliasToApi(req.path) && !isBrowserDocumentRequest(req))) {
        return res.status(404).json({ error: 'API route not found' });
    }
    return res.sendFile(path.join(__dirname, '../dist/index.html'));
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
