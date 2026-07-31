/**
 * Domain routes: health / metrics / status
 */
'use strict';

const db = require('../db');
const { metricsAuthMiddleware, metricsHandler } = require('../observability');

const buildInfo = () => ({
    buildSha: String(process.env.BUILD_SHA || process.env.GITHUB_SHA || '').slice(0, 12) || null,
    buildTime: process.env.BUILD_TIME || null,
    // Bump when shipping user-order list contract fixes (items/hasMore).
    apiRevision: 'orders-page-v2'
});

module.exports = function registerHealthRoutes(app) {
    app.get('/metrics', metricsAuthMiddleware, metricsHandler);
    app.get('/api/metrics', metricsAuthMiddleware, metricsHandler);

    app.get('/health', async (req, res) => {
        try {
            await db.query('SELECT 1');
            res.json({ status: 'ok', service: 'takcakap-api', time: new Date().toISOString(), ...buildInfo() });
        } catch (err) {
            res.status(503).json({ status: 'error', error: err.message, ...buildInfo() });
        }
    });

    app.get('/api/health', async (req, res) => {
        try {
            await db.query('SELECT 1');
            res.json({ status: 'ok', service: 'takcakap-api', time: new Date().toISOString(), ...buildInfo() });
        } catch (err) {
            res.status(503).json({ status: 'error', error: err.message, ...buildInfo() });
        }
    });

    app.get('/api/status', async (req, res) => {
        try {
            await db.query('SELECT 1');
            res.json({ status: 'connected', database: 'MariaDB', time: new Date().toISOString(), ...buildInfo() });
        } catch (err) {
            res.status(503).json({ status: 'disconnected', error: err.message, ...buildInfo() });
        }
    });
};
