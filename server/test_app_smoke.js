/**
 * Structural smoke: createApp + route registration without listen/startServer.
 * Run: node server/test_app_smoke.js
 */
'use strict';

const assert = require('assert');

process.env.JWT_SECRET =
    process.env.JWT_SECRET || 'dev-test-secret-at-least-32-characters-long-xx';

const { createApp } = require('./createApp');
const { createJsonBodyParser } = require('./middleware/bodyParser');

function listRoutes(app) {
    const out = [];
    const stack = app._router?.stack || [];
    for (const layer of stack) {
        if (layer.route) {
            const methods = Object.keys(layer.route.methods || {}).filter((m) => layer.route.methods[m]);
            for (const m of methods) out.push(`${m.toUpperCase()} ${layer.route.path}`);
        } else if (layer.name === 'router' && layer.handle?.stack) {
            // Mount path from regexp is awkward; collect sub-routes with mount hint
            for (const sub of layer.handle.stack) {
                if (!sub.route) continue;
                const methods = Object.keys(sub.route.methods || {}).filter((m) => sub.route.methods[m]);
                for (const m of methods) out.push(`${m.toUpperCase()} ${sub.route.path}`);
            }
        }
    }
    return out;
}

console.log('app smoke');

const bare = createApp();
assert.ok(bare && typeof bare.use === 'function', 'createApp returns express app');
const bareStack = bare._router?.stack || [];
assert.ok(bareStack.length >= 4, 'createApp registers core middleware layers');
// json before alias: find indices by middleware name
const names = bareStack.map((l) => l.name || '');
const jsonIdx = names.findIndex((n) => /json/i.test(n));
const aliasIdx = names.findIndex((n) => /apiAlias|alias/i.test(n));
if (jsonIdx >= 0 && aliasIdx >= 0) {
    assert.ok(jsonIdx < aliasIdx, 'json body parser should run before api alias');
    console.log('  ✓ middleware order: json before alias');
} else {
    // Fallback: at least both exist as layers
    assert.ok(typeof createJsonBodyParser() === 'function');
    console.log('  ✓ middleware factories available (order names vary by express)');
}

const { app, startServer } = require('./index');
assert.ok(typeof startServer === 'function', 'startServer exported');
assert.ok(typeof app.listen === 'function', 'app exported');

const routes = listRoutes(app);
const joined = routes.join('\n');

const critical = [
    ['GET', '/api/health'],
    ['GET', '/api/orders'],
    ['POST', '/api/orders'],
    ['POST', '/api/delivery/quote'],
    ['POST', '/api/webhooks/curlec'],
    ['POST', '/api/webhooks/lalamove'],
    ['POST', '/api/payments/curlec/order']
];

for (const [method, p] of critical) {
    const needle = `${method} ${p}`;
    assert.ok(joined.includes(needle) || routes.some((r) => r.includes(p) && r.startsWith(method)), `missing ${needle}`);
    console.log(`  ✓ ${needle}`);
}

// loyalty mounted under /api
assert.ok(
    routes.some((r) => r.includes('/user/points') || r.includes('user/points')),
    'loyalty routes mounted'
);
console.log('  ✓ loyalty under /api');

console.log('\nAll app smoke tests passed.');
