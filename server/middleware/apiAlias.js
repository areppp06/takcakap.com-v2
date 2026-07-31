/**
 * API path aliasing (allow /orders as /api/orders for non-browser clients).
 */
'use strict';

const { API_ALIAS_PREFIXES } = require('../config');

const shouldAliasToApi = (requestPath) =>
    API_ALIAS_PREFIXES.some(
        (prefix) => requestPath === prefix || requestPath.startsWith(`${prefix}/`)
    );

const isBrowserDocumentRequest = (req) => {
    const method = String(req.method || '').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return false;
    const acceptHeader = String(req.headers?.accept || '').toLowerCase();
    return acceptHeader.includes('text/html');
};

function apiAliasMiddleware(req, _res, next) {
    if (req.path.startsWith('/api') || req.path === '/health' || req.path === '/api/health') {
        return next();
    }
    if (shouldAliasToApi(req.path) && !isBrowserDocumentRequest(req)) {
        req.url = `/api${req.url}`;
    }
    return next();
}

module.exports = {
    shouldAliasToApi,
    isBrowserDocumentRequest,
    apiAliasMiddleware
};
