/**
 * Domain routes: health / metrics / status
 */
'use strict';

const db = require('../db');
const { metricsAuthMiddleware, metricsHandler } = require('../observability');

module.exports = function registerHealthRoutes(app) {
    app.get('/metrics', metricsAuthMiddleware, metricsHandler);
    app.get('/api/metrics', metricsAuthMiddleware, metricsHandler);

    app.get('/health', async (req, res) => {
        try {
            await db.query('SELECT 1');
            res.json({ status: 'ok', service: 'takcakap-api', time: new Date().toISOString() });
        } catch (err) {
            res.status(503).json({ status: 'error', error: err.message });
        }
    });

    app.get('/api/health', async (req, res) => {
        try {
            await db.query('SELECT 1');
            res.json({ status: 'ok', service: 'takcakap-api', time: new Date().toISOString() });
        } catch (err) {
            res.status(503).json({ status: 'error', error: err.message });
        }
    });

    app.get('/api/status', async (req, res) => {
        try {
            await db.query('SELECT 1');
            res.json({ status: 'connected', database: 'MariaDB', time: new Date().toISOString() });
        } catch (err) {
            res.status(503).json({ status: 'disconnected', error: err.message });
        }
    });
};
