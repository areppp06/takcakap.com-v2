/**
 * validateStartupConfig contract tests (import-safe; no startServer).
 * Env must be loaded before first config require — config.js calls dotenv first.
 * Run: node server/test_config.js
 */
'use strict';

const assert = require('assert');

// Isolate env mutations
const original = { ...process.env };

function reloadConfig() {
    delete require.cache[require.resolve('./config')];
    return require('./config');
}

function withEnv(patch, fn) {
    const keys = Object.keys(patch);
    const prev = {};
    for (const k of keys) {
        prev[k] = process.env[k];
        if (patch[k] === undefined) delete process.env[k];
        else process.env[k] = patch[k];
    }
    try {
        return fn(reloadConfig());
    } finally {
        for (const k of keys) {
            if (prev[k] === undefined) delete process.env[k];
            else process.env[k] = prev[k];
        }
        delete require.cache[require.resolve('./config')];
    }
}

console.log('config validation');

// Import does not throw even with weak JWT (validation is explicit).
withEnv({ JWT_SECRET: 'short', NODE_ENV: 'development' }, (config) => {
    assert.ok(typeof config.validateStartupConfig === 'function');
    assert.throws(() => config.validateStartupConfig(), /JWT_SECRET/);
    console.log('  ✓ import does not throw; validate fails on short JWT');
});

withEnv(
    {
        JWT_SECRET: 'x'.repeat(32),
        NODE_ENV: 'development',
        CURLEC_KEY_ID: 'pk_test',
        CURLEC_KEY_SECRET: '',
        CURLEC_WEBHOOK_SECRET: ''
    },
    (config) => {
        assert.throws(() => config.validateStartupConfig(), /CURLEC_KEY_ID and CURLEC_KEY_SECRET/);
        console.log('  ✓ Curlec key pairing enforced');
    }
);

withEnv(
    {
        JWT_SECRET: 'x'.repeat(32),
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://example.com',
        ADMIN_PASSWORD: 'secret',
        PUBLIC_APP_URL: '',
        CURLEC_KEY_ID: '',
        CURLEC_KEY_SECRET: ''
    },
    (config) => {
        assert.throws(() => config.validateStartupConfig(), /PUBLIC_APP_URL/);
        console.log('  ✓ production requires PUBLIC_APP_URL');
    }
);

withEnv(
    {
        JWT_SECRET: 'x'.repeat(32),
        NODE_ENV: 'development',
        PUBLIC_APP_URL: 'https://app.example.com',
        CURLEC_KEY_ID: '',
        CURLEC_KEY_SECRET: '',
        LALAMOVE_API_KEY: '',
        LALAMOVE_API_SECRET: '',
        METRICS_ENABLED: 'false'
    },
    (config) => {
        assert.doesNotThrow(() => config.validateStartupConfig());
        console.log('  ✓ valid minimal config passes');
    }
);

withEnv(
    {
        JWT_SECRET: 'x'.repeat(32),
        NODE_ENV: 'development',
        LALAMOVE_API_KEY: 'pk_test',
        LALAMOVE_API_SECRET: '',
        CURLEC_KEY_ID: '',
        CURLEC_KEY_SECRET: '',
        METRICS_ENABLED: 'false'
    },
    (config) => {
        assert.throws(() => config.validateStartupConfig(), /LALAMOVE_API_KEY and LALAMOVE_API_SECRET/);
        console.log('  ✓ Lalamove key pairing enforced');
    }
);

withEnv(
    {
        JWT_SECRET: 'x'.repeat(32),
        NODE_ENV: 'development',
        CURLEC_KEY_ID: 'pk_test',
        CURLEC_KEY_SECRET: 'sk_test',
        CURLEC_WEBHOOK_SECRET: '',
        LALAMOVE_API_KEY: '',
        LALAMOVE_API_SECRET: '',
        METRICS_ENABLED: 'false'
    },
    (config) => {
        assert.throws(() => config.validateStartupConfig(), /CURLEC_WEBHOOK_SECRET/);
        console.log('  ✓ Curlec webhook secret required when keys set');
    }
);

withEnv(
    {
        JWT_SECRET: 'x'.repeat(32),
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://example.com',
        ADMIN_PASSWORD: 'secret',
        PUBLIC_APP_URL: 'https://app.example.com',
        METRICS_ENABLED: 'true',
        METRICS_REQUIRE_AUTH: 'true',
        METRICS_AUTH_TOKEN: '',
        CURLEC_KEY_ID: '',
        CURLEC_KEY_SECRET: '',
        LALAMOVE_API_KEY: '',
        LALAMOVE_API_SECRET: ''
    },
    (config) => {
        assert.throws(() => config.validateStartupConfig(), /METRICS_AUTH_TOKEN/);
        console.log('  ✓ metrics auth token required when metrics auth on');
    }
);

// restore
Object.assign(process.env, original);
console.log('\nAll config tests passed.');
