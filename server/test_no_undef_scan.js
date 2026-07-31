/**
 * Free-identifier undeclared scan for server route modules.
 *
 * Order routes: flags free ALL_CAPS, PascalCase, and camelCase identifiers
 * (catches free `isQuoteExpired` after helpers return `{ isQuoteExpired }`).
 *
 * Limitations (shallow, not ESLint):
 * - Nested block scopes not modeled (function-local still mostly captured)
 * - Full ESLint no-undef remains optional CI upgrade
 *
 * Run: node server/test_no_undef_scan.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, 'routes');
const files = [];
function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.js') && e.name !== '_deps.js') files.push(p);
    }
}
walk(ROOT);

const KEYWORDS = new Set([
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete',
    'do', 'else', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import',
    'in', 'instanceof', 'let', 'new', 'null', 'return', 'static', 'super', 'switch', 'this',
    'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'await', 'async',
    'of', 'from', 'as', 'get', 'set'
]);

const BUILTINS = new Set([
    ...KEYWORDS,
    'console', 'process', 'Buffer', 'require', 'module', 'exports', '__dirname', '__filename',
    'JSON', 'Math', 'Date', 'String', 'Number', 'Boolean', 'Array', 'Object', 'Map', 'Set',
    'Promise', 'Error', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'fetch', 'URL',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Intl', 'RegExp',
    'undefined', 'NaN', 'Infinity', 'global', 'globalThis', 'encodeURIComponent',
    'decodeURIComponent', 'Symbol', 'Proxy', 'Reflect', 'WeakMap', 'WeakSet', 'BigInt',
    'Uint8Array', 'ArrayBuffer', 'TextEncoder', 'TextDecoder', 'AbortController',
    'atob', 'btoa', 'arguments'
]);

const RISK = [
    'ORDER_DELIVERY_TIMING_SCHEDULED',
    'ORDER_DELIVERY_TIMING_NOW',
    'mapLalamoveUpdateToOrderStatus',
    'fetchShopStatus',
    'roundCoordinate',
    'lalamoveService',
    'toPositiveInteger',
    'syncCartWithStock',
    'getRefundWindowState',
    'normalizeCurrencyCode',
    'getCurlecCallbackPayload',
    'buildCurlecCheckoutReturnUrl',
    'isValidLatitude',
    'isValidLongitude',
    'PDFDocument',
    'upload',
    'r2Service',
    'orderEvents',
    'emitOrdersChangedEvent',
    'getNextOrderCode',
    'formatOrderRowForClient',
    'requireAuth',
    'requireAdmin',
    'clientErrorBody',
    'isQuoteExpired',
    'assertDeliveryQuoteMatchesOrder',
    'validateCurlecPaymentForCreate',
    'needsRefresh'
];

function stripCommentsAndStrings(code) {
    return code
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/.*$/gm, ' ')
        .replace(/`(?:\\.|[^`\\])*`/g, '""')
        .replace(/'(?:\\.|[^'\\])*'/g, '""')
        .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

function addBindingNames(declared, patternInner) {
    // patternInner may be "a, b = 1, ...rest" or object/array nested shallowly
    const cleaned = patternInner.replace(/\.\.\./g, '');
    for (const part of cleaned.split(',')) {
        let t = part.trim();
        if (!t) continue;
        // strip defaults
        t = t.split('=')[0].trim();
        // object rename: key: alias
        if (t.includes(':')) {
            t = t.split(':').pop().trim();
        }
        // strip array/object braces shallow
        t = t.replace(/[{}[\]]/g, '').trim();
        if (/^[A-Za-z_$][\w$]*$/.test(t)) declared.add(t);
    }
}

function collectDeclared(code) {
    const declared = new Set(BUILTINS);
    const stripped = stripCommentsAndStrings(code);

    // const x = require(...)
    for (const m of stripped.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) {
        declared.add(m[1]);
    }
    // const { a, b: c } = ...
    for (const m of stripped.matchAll(/\b(?:const|let|var)\s*\{([^}]+)\}\s*=/g)) {
        addBindingNames(declared, m[1]);
    }
    // const [a, b] = ...  (and nested [orderResult] etc.)
    for (const m of stripped.matchAll(/\b(?:const|let|var)\s*\[([^\]]+)\]\s*=/g)) {
        addBindingNames(declared, m[1]);
    }
    // function name(params)
    for (const m of stripped.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g)) {
        declared.add(m[1]);
        addBindingNames(declared, m[2]);
    }
    // async (req, res) =>  — require "async" so we don't match app.post( ... ) =>
    for (const m of stripped.matchAll(/\basync\s*\(([^)]*)\)\s*=>/g)) {
        addBindingNames(declared, m[1]);
    }
    // bare (err) => / (req, res, next) => not preceded by identifier (avoid fn(args) => false match)
    for (const m of stripped.matchAll(/(?<![\w$])\(([^)]*)\)\s*=>/g)) {
        addBindingNames(declared, m[1]);
    }
    // single-arg arrow: name =>
    for (const m of stripped.matchAll(/(?<![\w$])(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/g)) {
        declared.add(m[1]);
    }
    for (const m of stripped.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
        declared.add(m[1]);
    }
    for (const m of stripped.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+(?:of|in)\b/g)) {
        declared.add(m[1]);
    }
    for (const m of stripped.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s*\{([^}]+)\}\s+(?:of|in)\b/g)) {
        addBindingNames(declared, m[1]);
    }
    for (const m of stripped.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s*\[([^\]]+)\]\s+(?:of|in)\b/g)) {
        addBindingNames(declared, m[1]);
    }

    return declared;
}

function findFreeIdentifiers(code, declared) {
    const stripped = stripCommentsAndStrings(code);
    const free = new Set();
    const re = /\b([A-Za-z_$][\w$]*)\b/g;
    let m;
    while ((m = re.exec(stripped)) !== null) {
        const name = m[1];
        if (declared.has(name) || KEYWORDS.has(name) || BUILTINS.has(name)) continue;

        const idx = m.index;
        const before = stripped[idx - 1] || '';
        const after = stripped.slice(idx + name.length);
        // member property: .name or ?.name (dot already consumed before ?)
        if (before === '.') continue;
        // object key / label: name:
        if (/^\s*:/.test(after)) continue;

        free.add(name);
    }
    return free;
}

console.log('no-undef scan (routes)');
let failures = [];
for (const f of files) {
    const code = fs.readFileSync(f, 'utf8');
    const declared = collectDeclared(code);
    const free = findFreeIdentifiers(code, declared);
    const rel = path.relative(process.cwd(), f);

    for (const name of RISK) {
        if (free.has(name)) failures.push(`${rel}: ${name}`);
    }

    // Order routes: any free camelCase / ALL_CAPS / PascalCase (length > 1)
    if (f.includes(`${path.sep}orders${path.sep}`)) {
        for (const name of free) {
            if (name.length <= 1) continue;
            if (
                /^[A-Z][A-Z0-9_]+$/.test(name) ||
                /^[A-Z][a-zA-Z0-9]*$/.test(name) ||
                /^[a-z][a-zA-Z0-9]*$/.test(name)
            ) {
                failures.push(`${rel}: ${name}`);
            }
        }
    }
}

failures = [...new Set(failures)];
if (failures.length) {
    console.error(failures.join('\n'));
}
assert.strictEqual(failures.length, 0, `undeclared identifiers: ${failures.length}`);
console.log(`  ✓ scanned ${files.length} route files, 0 undeclared free identifiers (orders: camelCase+CAPS)`);
console.log('\nAll no-undef scan tests passed.');
