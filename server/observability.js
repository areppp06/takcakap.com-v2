const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const client = require('prom-client');

const SERVICE_NAME = String(process.env.SERVICE_NAME || 'takcakap-api').trim() || 'takcakap-api';
const LOG_LEVEL = String(process.env.LOG_LEVEL || 'info').trim().toLowerCase();
const LOG_HTTP_OPTIONS = String(process.env.LOG_HTTP_OPTIONS || 'false').trim().toLowerCase() === 'true';
const LOG_HTTP_304 = String(process.env.LOG_HTTP_304 || 'false').trim().toLowerCase() === 'true';
const LOG_HTTP_STATIC = String(process.env.LOG_HTTP_STATIC || 'false').trim().toLowerCase() === 'true';
const LOG_HTTP_SSE = String(process.env.LOG_HTTP_SSE || 'false').trim().toLowerCase() === 'true';
const LOG_HTTP_SUPPRESS_ROUTES = String(process.env.LOG_HTTP_SUPPRESS_ROUTES || '/api/shop-status,/shop-status')
    .split(',')
    .map((entry) => String(entry || '').trim().split('?')[0])
    .filter(Boolean);
const LOG_HTTP_SUPPRESS_ROUTE_SET = new Set(LOG_HTTP_SUPPRESS_ROUTES);
const LOG_CONSOLE_EXTRA_NEWLINE =
    String(process.env.LOG_CONSOLE_EXTRA_NEWLINE || 'true').trim().toLowerCase() !== 'false';
const LOG_TO_FILE = String(process.env.LOG_TO_FILE || 'true').trim().toLowerCase() !== 'false';
const LOG_DIR = String(process.env.LOG_DIR || path.join(__dirname, 'logs')).trim();
const LOG_FILE_NAME = String(process.env.LOG_FILE_NAME || 'app.log').trim() || 'app.log';
const LOG_MAX_BYTES = Math.max(
    1_000_000,
    Number.parseInt(String(process.env.LOG_MAX_BYTES || String(20 * 1024 * 1024)), 10) || 20 * 1024 * 1024
);
const METRICS_ENABLED = String(process.env.METRICS_ENABLED || 'true').trim().toLowerCase() !== 'false';
const METRICS_AUTH_TOKEN = String(process.env.METRICS_AUTH_TOKEN || '').trim();
const METRICS_PREFIX = String(process.env.METRICS_PREFIX || 'foodiedash_').trim() || 'foodiedash_';
const NODE_ENV = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
const METRICS_REQUIRE_AUTH =
    String(process.env.METRICS_REQUIRE_AUTH || (NODE_ENV === 'production' ? 'true' : 'false'))
        .trim()
        .toLowerCase() !== 'false';

const LOG_LEVEL_PRIORITY = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40
};

const requestContext = new AsyncLocalStorage();
let logFilePath = null;
let consoleInterceptorInstalled = false;

if (METRICS_ENABLED && METRICS_REQUIRE_AUTH && !METRICS_AUTH_TOKEN) {
    process.stderr.write(
        '[observability] Metrics auth is required but METRICS_AUTH_TOKEN is missing. /metrics access will be denied.\n'
    );
}

if (LOG_TO_FILE) {
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        logFilePath = path.join(LOG_DIR, LOG_FILE_NAME);
    } catch (error) {
        process.stderr.write(
            `[observability] Failed to initialize log directory (${LOG_DIR}): ${error?.message || error}\n`
        );
    }
}

const safeJsonValue = (value, depth = 0) => {
    if (value === null || value === undefined) return value;
    if (depth > 4) return '[depth_limited]';

    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: value.stack
        };
    }

    if (Array.isArray(value)) {
        return value.slice(0, 20).map((entry) => safeJsonValue(entry, depth + 1));
    }

    if (typeof value === 'object') {
        const output = {};
        for (const [key, entry] of Object.entries(value)) {
            output[key] = safeJsonValue(entry, depth + 1);
        }
        return output;
    }

    if (typeof value === 'bigint') {
        return value.toString();
    }

    return value;
};

const rotateLogFileIfNeeded = () => {
    if (!logFilePath) return;
    try {
        const stat = fs.statSync(logFilePath);
        if (stat.size < LOG_MAX_BYTES) return;
        const rotated = `${logFilePath}.1`;
        try {
            fs.unlinkSync(rotated);
        } catch (_error) {
            // ignore missing file
        }
        fs.renameSync(logFilePath, rotated);
    } catch (_error) {
        // ignore when file does not yet exist
    }
};

const shouldLog = (level) => {
    const configured = LOG_LEVEL_PRIORITY[LOG_LEVEL] || LOG_LEVEL_PRIORITY.info;
    const current = LOG_LEVEL_PRIORITY[level] || LOG_LEVEL_PRIORITY.info;
    return current >= configured;
};

const getRequestContext = () => requestContext.getStore() || {};

const writeLog = (level, message, meta = {}) => {
    if (!shouldLog(level)) return;

    const context = getRequestContext();
    const payload = {
        timestamp: new Date().toISOString(),
        level,
        message: String(message || ''),
        service: SERVICE_NAME,
        pid: process.pid,
        request_id: context.requestId || undefined,
        ...safeJsonValue(meta)
    };

    const line = `${JSON.stringify(payload)}\n`;
    const consoleLine = LOG_CONSOLE_EXTRA_NEWLINE ? `${line}\n` : line;
    process.stdout.write(consoleLine);

    if (!logFilePath) return;
    rotateLogFileIfNeeded();
    fs.appendFile(logFilePath, line, (error) => {
        if (error) {
            process.stderr.write(`[observability] Failed to write log file: ${error?.message || error}\n`);
        }
    });
};

const logger = {
    debug: (message, meta) => writeLog('debug', message, meta),
    info: (message, meta) => writeLog('info', message, meta),
    warn: (message, meta) => writeLog('warn', message, meta),
    error: (message, meta) => writeLog('error', message, meta)
};

const installConsoleInterceptors = () => {
    if (consoleInterceptorInstalled) return;
    consoleInterceptorInstalled = true;

    const bindConsoleMethod = (methodName, level) => {
        const original = console[methodName].bind(console);
        console[methodName] = (...args) => {
            try {
                const [firstArg, ...restArgs] = args;
                const message =
                    typeof firstArg === 'string'
                        ? firstArg
                        : firstArg instanceof Error
                          ? firstArg.message
                          : 'console_message';
                const meta = {
                    console_method: methodName,
                    first_arg:
                        typeof firstArg === 'string'
                            ? undefined
                            : safeJsonValue(firstArg),
                    extra_args: restArgs.length ? safeJsonValue(restArgs) : undefined
                };
                writeLog(level, message, meta);
            } catch {
                original(...args);
            }
        };
    };

    bindConsoleMethod('log', 'info');
    bindConsoleMethod('info', 'info');
    bindConsoleMethod('warn', 'warn');
    bindConsoleMethod('error', 'error');
};

const sanitizeRoutePath = (rawPath) =>
    String(rawPath || '')
        .replace(/\/[0-9]+/g, '/:id')
        .replace(/[a-f0-9]{24,}/gi, ':token')
        .replace(/\?.*$/, '')
        .slice(0, 200);

const sanitizeRequestPath = (rawPath) => {
    const normalized = String(rawPath || '').split('?')[0].trim();
    if (!normalized) return '/';
    return normalized.slice(0, 300);
};

const STATIC_ASSET_PATH_RE = /\/[^/?]+\.(?:js|mjs|css|map|png|jpg|jpeg|gif|webp|svg|ico|mp3|wav|ogg|woff2?|ttf|eot)$/i;

const isStaticAssetPath = (requestPath) => {
    const normalized = String(requestPath || '');
    return normalized.startsWith('/assets/') || STATIC_ASSET_PATH_RE.test(normalized);
};

const buildMetricRouteLabel = (req) => {
    const routePath = req?.route?.path;
    const baseUrl = String(req?.baseUrl || '').trim();
    if (routePath) {
        return sanitizeRoutePath(`${baseUrl}${routePath}`);
    }
    return sanitizeRoutePath(req?.path || req?.originalUrl || 'unknown');
};

const registry = new client.Registry();
if (METRICS_ENABLED) {
    client.collectDefaultMetrics({ register: registry, prefix: METRICS_PREFIX });
}

const httpRequestsTotal = METRICS_ENABLED
    ? new client.Counter({
          name: `${METRICS_PREFIX}http_requests_total`,
          help: 'Total HTTP requests',
          labelNames: ['method', 'route', 'status_code']
      })
    : null;

const httpRequestDurationSeconds = METRICS_ENABLED
    ? new client.Histogram({
          name: `${METRICS_PREFIX}http_request_duration_seconds`,
          help: 'HTTP request duration in seconds',
          labelNames: ['method', 'route', 'status_code'],
          buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.35, 0.5, 1, 2, 4, 8, 15]
      })
    : null;

const webhookEventsTotal = METRICS_ENABLED
    ? new client.Counter({
          name: `${METRICS_PREFIX}webhook_events_total`,
          help: 'Webhook event processing outcomes',
          labelNames: ['provider', 'event', 'status']
      })
    : null;

const orderCreateEventsTotal = METRICS_ENABLED
    ? new client.Counter({
          name: `${METRICS_PREFIX}order_create_events_total`,
          help: 'Order creation outcomes',
          labelNames: ['status', 'payment_method', 'order_type', 'delivery_booking_status']
      })
    : null;

const orderCreateDurationSeconds = METRICS_ENABLED
    ? new client.Histogram({
          name: `${METRICS_PREFIX}order_create_duration_seconds`,
          help: 'Order creation end-to-end duration in seconds',
          labelNames: ['status', 'payment_method', 'order_type'],
          buckets: [0.05, 0.1, 0.2, 0.35, 0.5, 1, 2, 4, 8, 15, 30]
      })
    : null;

const emailOutboxJobsTotal = METRICS_ENABLED
    ? new client.Counter({
          name: `${METRICS_PREFIX}email_outbox_jobs_total`,
          help: 'Email outbox job outcomes',
          labelNames: ['status', 'event_type']
      })
    : null;

const emailOutboxPending = METRICS_ENABLED
    ? new client.Gauge({
          name: `${METRICS_PREFIX}email_outbox_pending`,
          help: 'Current pending/failed email outbox jobs awaiting retry'
      })
    : null;

const emailOutboxOldestPendingSeconds = METRICS_ENABLED
    ? new client.Gauge({
          name: `${METRICS_PREFIX}email_outbox_oldest_pending_seconds`,
          help: 'Age in seconds of the oldest pending/failed outbox job'
      })
    : null;

if (METRICS_ENABLED) {
    [
        httpRequestsTotal,
        httpRequestDurationSeconds,
        webhookEventsTotal,
        orderCreateEventsTotal,
        orderCreateDurationSeconds,
        emailOutboxJobsTotal,
        emailOutboxPending,
        emailOutboxOldestPendingSeconds
    ].forEach((metric) => registry.registerMetric(metric));
}

const requestContextMiddleware = (req, res, next) => {
    const incomingRequestId = String(req.headers['x-request-id'] || req.headers['x-correlation-id'] || '').trim();
    const requestId = incomingRequestId || crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    requestContext.run({ requestId, startedAtMs: Date.now() }, () => next());
};

const requestLogAndMetricsMiddleware = (req, res, next) => {
    const startedAtNs = process.hrtime.bigint();
    const method = String(req.method || 'GET').toUpperCase();

    res.on('finish', () => {
        const elapsedNs = process.hrtime.bigint() - startedAtNs;
        const elapsedSeconds = Number(elapsedNs) / 1e9;
        const elapsedMs = Number((elapsedSeconds * 1000).toFixed(3));
        const statusCode = Number(res.statusCode || 0);
        const routeLabel = buildMetricRouteLabel(req);
        const requestPath = sanitizeRequestPath(req.originalUrl || req.url);
        const contentLength = Number(res.getHeader('content-length') || 0);
        const isNoiseRoute =
            routeLabel === '/metrics' ||
            routeLabel === '/api/metrics' ||
            routeLabel === '/health' ||
            routeLabel === '/api/health';
        const isSseRoute = routeLabel === '/api/admin/orders/stream' || routeLabel === '/api/admin/orders/stream-token';
        const isStaticRoute = isStaticAssetPath(requestPath);
        const isSuppressedSuccessRoute =
            LOG_HTTP_SUPPRESS_ROUTE_SET.has(routeLabel) || LOG_HTTP_SUPPRESS_ROUTE_SET.has(requestPath);

        if (METRICS_ENABLED) {
            const labels = {
                method,
                route: routeLabel,
                status_code: String(statusCode || 0)
            };
            httpRequestsTotal.inc(labels);
            httpRequestDurationSeconds.observe(labels, elapsedSeconds);
        }

        if (isNoiseRoute && statusCode < 400) {
            return;
        }
        if (!LOG_HTTP_OPTIONS && method === 'OPTIONS' && statusCode < 400) {
            return;
        }
        if (!LOG_HTTP_304 && statusCode === 304) {
            return;
        }
        if (!LOG_HTTP_STATIC && isStaticRoute && statusCode < 400) {
            return;
        }
        if (!LOG_HTTP_SSE && isSseRoute && statusCode < 400) {
            return;
        }
        if (isSuppressedSuccessRoute && statusCode < 400) {
            return;
        }
        const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
        logger[level]('http_request', {
            method,
            path: requestPath,
            route: routeLabel,
            status_code: statusCode,
            duration_ms: elapsedMs,
            response_bytes: Number.isFinite(contentLength) ? contentLength : 0,
            ip: req.ip,
            user_agent: String(req.headers['user-agent'] || '').slice(0, 300)
        });
    });

    next();
};

const metricsAuthMiddleware = (req, res, next) => {
    if (!METRICS_AUTH_TOKEN) {
        if (METRICS_REQUIRE_AUTH) {
            return res.status(503).json({
                error: 'Metrics auth is required. Set METRICS_AUTH_TOKEN on the server.'
            });
        }
        return next();
    }
    const authHeader = String(req.headers.authorization || '').trim();
    const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1] || '';
    // Constant-time compare when lengths match (avoids timing oracle on metrics token).
    try {
        const a = Buffer.from(String(token));
        const b = Buffer.from(String(METRICS_AUTH_TOKEN));
        if (a.length === 0 || a.length !== b.length || !require('crypto').timingSafeEqual(a, b)) {
            return res.status(401).json({ error: 'Unauthorized metrics access' });
        }
    } catch {
        return res.status(401).json({ error: 'Unauthorized metrics access' });
    }
    return next();
};

const metricsHandler = async (_req, res) => {
    if (!METRICS_ENABLED) {
        return res.status(404).json({ error: 'Metrics endpoint is disabled' });
    }
    res.setHeader('Content-Type', registry.contentType);
    const body = await registry.metrics();
    return res.end(body);
};

const sanitizeMetricLabel = (value, fallback = 'unknown') => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return fallback;
    return normalized.replace(/[^a-z0-9_:-]+/g, '_').slice(0, 80) || fallback;
};

const recordWebhookEvent = ({ provider, eventType, status }) => {
    if (!METRICS_ENABLED) return;
    webhookEventsTotal.inc({
        provider: sanitizeMetricLabel(provider, 'unknown_provider'),
        event: sanitizeMetricLabel(eventType, 'unknown_event'),
        status: sanitizeMetricLabel(status, 'unknown_status')
    });
};

const recordOrderCreateEvent = ({ status, paymentMethod, orderType, deliveryBookingStatus = 'na' }) => {
    if (!METRICS_ENABLED) return;
    orderCreateEventsTotal.inc({
        status: sanitizeMetricLabel(status, 'unknown_status'),
        payment_method: sanitizeMetricLabel(paymentMethod, 'unknown_payment'),
        order_type: sanitizeMetricLabel(orderType, 'unknown_order_type'),
        delivery_booking_status: sanitizeMetricLabel(deliveryBookingStatus, 'na')
    });
};

const startOrderCreateTimer = ({ paymentMethod, orderType }) => {
    if (!METRICS_ENABLED) {
        return () => {};
    }
    const endTimer = orderCreateDurationSeconds.startTimer({
        payment_method: sanitizeMetricLabel(paymentMethod, 'unknown_payment'),
        order_type: sanitizeMetricLabel(orderType, 'unknown_order_type'),
        status: 'inflight'
    });
    return ({ status }) => {
        endTimer({ status: sanitizeMetricLabel(status, 'unknown_status') });
    };
};

const recordEmailOutboxJob = ({ status, eventType }) => {
    if (!METRICS_ENABLED) return;
    emailOutboxJobsTotal.inc({
        status: sanitizeMetricLabel(status, 'unknown_status'),
        event_type: sanitizeMetricLabel(eventType, 'unknown_event')
    });
};

const updateEmailOutboxState = ({ pendingCount, oldestPendingSeconds }) => {
    if (!METRICS_ENABLED) return;
    emailOutboxPending.set(Math.max(0, Number(pendingCount) || 0));
    emailOutboxOldestPendingSeconds.set(Math.max(0, Number(oldestPendingSeconds) || 0));
};

module.exports = {
    logger,
    installConsoleInterceptors,
    requestContextMiddleware,
    requestLogAndMetricsMiddleware,
    metricsAuthMiddleware,
    metricsHandler,
    recordWebhookEvent,
    recordOrderCreateEvent,
    startOrderCreateTimer,
    recordEmailOutboxJob,
    updateEmailOutboxState
};
