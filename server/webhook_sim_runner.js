const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { spawn } = require('child_process');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');

const projectDir = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(projectDir, '.env') });

const APP_PORT = 3110;
const MOCK_CURLEC_PORT = 9901;
const APP_BASE = `http://127.0.0.1:${APP_PORT}`;

const mustEnv = ['DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_SECRET', 'CURLEC_WEBHOOK_SECRET', 'LALAMOVE_API_KEY', 'LALAMOVE_API_SECRET'];
for (const key of mustEnv) {
  if (!String(process.env[key] || '').trim()) throw new Error(`Missing env ${key}`);
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT || 3306),
  waitForConnections: true,
  connectionLimit: 6,
  queueLimit: 0
});

let mockServer = null;
let appProc = null;
let mockState = { paymentById: new Map() };
let restoreState = null;
let artifacts = {
  curlecOrderId: null,
  curlecPaymentId: null,
  curlecSessionId: null,
  curlecEventId: null,
  lalamoveOrderId: null,
  lalamoveEventId: null
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const isAbortLikeError = (error) => {
  const name = String(error?.name || '').toLowerCase();
  if (name === 'aborterror') return true;
  return /aborted|abort/i.test(String(error?.message || ''));
};

const parseSseEventBlock = (block) => {
  let eventName = 'message';
  const dataLines = [];
  for (const line of String(block || '').split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const separatorIndex = line.indexOf(':');
    const field = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line;
    const value = separatorIndex >= 0 ? line.slice(separatorIndex + 1).trimStart() : '';
    if (field === 'event' && value) {
      eventName = value;
    } else if (field === 'data') {
      dataLines.push(value);
    }
  }
  const rawData = dataLines.join('\n');
  let data = rawData;
  if (rawData) {
    try {
      data = JSON.parse(rawData);
    } catch (_error) {}
  }
  return { eventName, rawData, data };
};

const waitForSseEvent = async ({
  streamToken,
  eventName,
  timeoutMs = 15000,
  predicate = () => true
}) => {
  const controller = new AbortController();
  let timedOut = false;
  let matched = null;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let response;
  let reader = null;
  try {
    response = await fetch(`${APP_BASE}/api/admin/orders/stream?t=${Date.now()}`, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${String(streamToken || '').trim()}`
      },
      signal: controller.signal
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`SSE connect failed: ${response.status} ${body}`);
    }
    reader = response.body?.getReader();
    if (!reader) {
      throw new Error('SSE response body is unavailable');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    while (!matched) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '');

      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const rawBlock = buffer.slice(0, boundary).trim();
        buffer = buffer.slice(boundary + 2);
        if (rawBlock) {
          const parsed = parseSseEventBlock(rawBlock);
          if (parsed.eventName === eventName && predicate(parsed.data, parsed.rawData)) {
            matched = parsed;
            break;
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  } catch (error) {
    if (!matched && !timedOut && !isAbortLikeError(error)) {
      throw error;
    }
  } finally {
    clearTimeout(timeout);
    if (reader) {
      try {
        await reader.cancel();
      } catch (_error) {}
    }
    controller.abort();
  }

  if (matched) return matched;
  if (timedOut) throw new Error(`Timed out waiting for SSE event '${eventName}'`);
  throw new Error(`SSE stream closed before receiving event '${eventName}'`);
};

const waitHealth = async (url, timeoutMs = 30000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch (_e) {}
    await sleep(250);
  }
  return false;
};

const startMockCurlec = async () => {
  mockServer = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8') || '{}';
    const body = JSON.parse(raw || '{}');

    if (req.method === 'POST' && req.url === '/v1/orders') {
      const amount = Number(body?.amount || 0);
      const currency = String(body?.currency || 'MYR').toUpperCase();
      const orderId = `order_sim_${Date.now()}`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: orderId, amount, currency }));
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/v1/payments/')) {
      const paymentId = decodeURIComponent(req.url.replace('/v1/payments/', '').split('?')[0]);
      const mapped = mockState.paymentById.get(paymentId);
      if (!mapped) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { description: 'payment not found' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: paymentId,
        order_id: mapped.orderId,
        status: 'captured',
        amount: mapped.amountMinor
      }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  await new Promise((resolve, reject) => {
    mockServer.once('error', reject);
    mockServer.listen(MOCK_CURLEC_PORT, '127.0.0.1', resolve);
  });
};

const startApp = async () => {
  appProc = spawn('node', ['server/index.js'], {
    cwd: projectDir,
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      CURLEC_API_BASE_URL: `http://127.0.0.1:${MOCK_CURLEC_PORT}/v1`,
      CURLEC_KEY_ID: 'mock_key',
      CURLEC_KEY_SECRET: 'mock_secret'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  appProc.stdout.on('data', (d) => process.stdout.write(`[app] ${d.toString()}`));
  appProc.stderr.on('data', (d) => process.stderr.write(`[app:err] ${d.toString()}`));

  const ok = await waitHealth(`${APP_BASE}/api/health`);
  if (!ok) throw new Error('App did not become healthy');
};

const hmacHex = (secret, raw) => crypto.createHmac('sha256', secret).update(raw).digest('hex');

const signLalamove = ({ secret, timestamp, requestPath, dataPayload }) => {
  const raw = `${timestamp}\r\nPOST\r\n${requestPath}\r\n\r\n${JSON.stringify(dataPayload || {})}`;
  return crypto.createHmac('sha256', secret).update(raw).digest('hex');
};

const issueAdminStreamToken = async (adminAuthToken) => {
  const res = await fetch(`${APP_BASE}/api/admin/orders/stream-token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminAuthToken}`
    }
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`stream-token failed: ${res.status} ${JSON.stringify(json)}`);
  }
  const token = String(json.token || '').trim();
  assert(token, `stream-token response missing token: ${JSON.stringify(json)}`);
  return token;
};

const forceTestReadyFlags = async () => {
  const [shopRows] = await pool.query(`SELECT open_time, close_time, pause_orders FROM shop_settings WHERE id = 1 LIMIT 1`);
  const [deliveryRows] = await pool.query(`SELECT pickup_enabled FROM delivery_options WHERE id = 1 LIMIT 1`);
  const [paymentRows] = await pool.query(`SELECT curlec_enabled FROM payment_options WHERE id = 1 LIMIT 1`);

  restoreState = {
    shop: shopRows[0] || { open_time: '09:00', close_time: '22:00', pause_orders: 0 },
    pickup_enabled: Number(deliveryRows[0]?.pickup_enabled ?? 1),
    curlec_enabled: Number(paymentRows[0]?.curlec_enabled ?? 1)
  };

  await pool.query(`UPDATE shop_settings SET open_time = '00:00', close_time = '00:00', pause_orders = 0 WHERE id = 1`);
  await pool.query(`UPDATE delivery_options SET pickup_enabled = 1 WHERE id = 1`);
  await pool.query(`UPDATE payment_options SET curlec_enabled = 1 WHERE id = 1`);
};

const restoreFlags = async () => {
  if (!restoreState) return;
  await pool.query(`UPDATE shop_settings SET open_time = ?, close_time = ?, pause_orders = ? WHERE id = 1`, [
    String(restoreState.shop.open_time || '09:00'),
    String(restoreState.shop.close_time || '22:00'),
    Number(restoreState.shop.pause_orders || 0)
  ]);
  await pool.query(`UPDATE delivery_options SET pickup_enabled = ? WHERE id = 1`, [Number(restoreState.pickup_enabled || 0)]);
  await pool.query(`UPDATE payment_options SET curlec_enabled = ? WHERE id = 1`, [Number(restoreState.curlec_enabled || 0)]);
};

const cleanupArtifacts = async () => {
  // restore stock before deleting sim orders
  const [simOrderRows] = await pool.query(`SELECT id FROM orders WHERE curlec_payment_id LIKE 'pay_sim_%' OR external_order_id LIKE 'LM_SIM_%'`);
  for (const order of simOrderRows) {
    const [oiRows] = await pool.query(`SELECT menu_item_id, quantity FROM order_items WHERE order_id = ?`, [Number(order.id)]);
    for (const oi of oiRows) {
      await pool.query(`UPDATE menu_items SET stock = stock + ? WHERE id = ?`, [Number(oi.quantity || 0), Number(oi.menu_item_id)]);
    }
  }

  await pool.query(`DELETE FROM orders WHERE curlec_payment_id LIKE 'pay_sim_%' OR external_order_id LIKE 'LM_SIM_%'`);
  await pool.query(`DELETE FROM curlec_checkout_sessions WHERE curlec_order_id LIKE 'order_sim_%' OR payment_id LIKE 'pay_sim_%'`);
  await pool.query(`DELETE FROM webhook_events WHERE event_id LIKE 'evt_curlec_%' OR event_id LIKE 'evt_lalamove_%'`);
};

const stopAll = async () => {
  if (appProc && !appProc.killed) {
    appProc.kill('SIGTERM');
    await sleep(400);
    if (!appProc.killed) appProc.kill('SIGKILL');
  }
  if (mockServer) {
    await new Promise((resolve) => mockServer.close(() => resolve()));
  }
  await pool.end();
};

(async () => {
  const output = {};
  try {
    await cleanupArtifacts();
    await forceTestReadyFlags();
    await startMockCurlec();
    await startApp();

    const [userRows] = await pool.query(
      `SELECT id, email, role, phone_number, is_suspended FROM users WHERE TRIM(COALESCE(phone_number, '')) <> '' AND is_suspended = 0 ORDER BY id ASC LIMIT 1`
    );
    const user = userRows[0];
    if (!user) throw new Error('No active user with phone number found');
    const [adminRows] = await pool.query(
      `SELECT id, email, role, is_suspended FROM users WHERE role = 'admin' AND is_suspended = 0 ORDER BY id ASC LIMIT 1`
    );
    const admin = adminRows[0];
    if (!admin) throw new Error('No active admin user found');

    const [itemRows] = await pool.query(
      `SELECT id, price, stock FROM menu_items WHERE is_active = 1 AND stock > 0 ORDER BY id ASC LIMIT 1`
    );
    const item = itemRows[0];
    if (!item) throw new Error('No active in-stock menu item found');

    const [paymentRows] = await pool.query(`SELECT service_fee FROM payment_options WHERE id = 1 LIMIT 1`);
    const serviceFee = Number(paymentRows[0]?.service_fee || 0);

    const total = Number((Number(item.price) + serviceFee).toFixed(2));
    const totalMinor = Math.round(total * 100);

    const token = jwt.sign(
      { sub: String(user.id), role: user.role || 'user', email: user.email || '' },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );
    const adminToken = jwt.sign(
      { sub: String(admin.id), role: 'admin', email: admin.email || '' },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );
    const adminStreamToken = await issueAdminStreamToken(adminToken);

    const legacyStreamRes = await fetch(`${APP_BASE}/api/admin/orders/stream?stream_token=legacy_test`);
    const legacyStreamBody = await legacyStreamRes.json().catch(() => ({}));
    assert(legacyStreamRes.status === 400, `legacy stream token must return 400, got ${legacyStreamRes.status}`);

    const missingAuthRes = await fetch(`${APP_BASE}/api/admin/orders/stream`);
    const missingAuthBody = await missingAuthRes.json().catch(() => ({}));
    assert(missingAuthRes.status === 401, `missing stream auth must return 401, got ${missingAuthRes.status}`);

    const connectedSseEvent = await waitForSseEvent({
      streamToken: adminStreamToken,
      eventName: 'connected',
      timeoutMs: 10000
    });

    output.sseAuth = {
      streamTokenIssued: true,
      legacyQueryStatus: legacyStreamRes.status,
      legacyQueryBody: legacyStreamBody,
      missingAuthStatus: missingAuthRes.status,
      missingAuthBody: missingAuthBody,
      connectedEvent: connectedSseEvent.data || null
    };

    const orderPayload = {
      items: [{ id: Number(item.id), quantity: 1 }],
      total,
      orderType: 'Pickup',
      paymentMethod: 'Curlec'
    };

    const initRes = await fetch(`${APP_BASE}/api/payments/curlec/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ amount: total, currency: 'MYR', orderPayload })
    });
    const initJson = await initRes.json().catch(() => ({}));
    if (!initRes.ok) throw new Error(`checkout init failed: ${initRes.status} ${JSON.stringify(initJson)}`);

    artifacts.curlecSessionId = String(initJson.checkoutSessionId || '').trim();
    const curlecOrderId = String(initJson.orderId || '').trim();
    if (!artifacts.curlecSessionId || !curlecOrderId) {
      throw new Error(`invalid checkout init response: ${JSON.stringify(initJson)}`);
    }

    artifacts.curlecPaymentId = `pay_sim_${Date.now()}`;
    artifacts.curlecEventId = `evt_curlec_${Date.now()}`;
    mockState.paymentById.set(artifacts.curlecPaymentId, { orderId: curlecOrderId, amountMinor: totalMinor });

    const curlecPayload = {
      id: artifacts.curlecEventId,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: artifacts.curlecPaymentId,
            order_id: curlecOrderId,
            status: 'captured',
            amount: totalMinor
          }
        }
      }
    };
    const curlecRaw = JSON.stringify(curlecPayload);
    const curlecSig = hmacHex(process.env.CURLEC_WEBHOOK_SECRET, curlecRaw);
    const curlecSsePromise = waitForSseEvent({
      streamToken: adminStreamToken,
      eventName: 'orders_changed',
      timeoutMs: 15000,
      predicate: (data) => String(data?.source || '').toLowerCase() === 'order_create'
    });

    const curlecWhRes = await fetch(`${APP_BASE}/api/webhooks/curlec`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': curlecSig,
        'x-razorpay-event-id': artifacts.curlecEventId
      },
      body: curlecRaw
    });
    const curlecWhJson = await curlecWhRes.json().catch(() => ({}));
    if (!curlecWhRes.ok) throw new Error(`curlec webhook failed: ${curlecWhRes.status} ${JSON.stringify(curlecWhJson)}`);

    const [createdRows] = await pool.query(
      `SELECT id, status, payment_method, curlec_payment_id, total_amount FROM orders WHERE curlec_payment_id = ? LIMIT 1`,
      [artifacts.curlecPaymentId]
    );
    if (!createdRows[0]) throw new Error('curlec webhook did not create/reconcile order');
    artifacts.curlecOrderId = Number(createdRows[0].id);
    const curlecSseEvent = await curlecSsePromise;

    const [sessionRows] = await pool.query(
      `SELECT session_id, status, consumed_order_id, payment_id FROM curlec_checkout_sessions WHERE session_id = ? LIMIT 1`,
      [artifacts.curlecSessionId]
    );
    const session = sessionRows[0];
    if (!session) throw new Error('curlec session row missing');

    output.curlec = {
      webhookResponse: curlecWhJson,
      orderRow: {
        id: String(createdRows[0].id),
        status: String(createdRows[0].status || ''),
        paymentMethod: String(createdRows[0].payment_method || ''),
        totalAmount: Number(createdRows[0].total_amount)
      },
      sessionRow: {
        status: String(session.status || ''),
        consumedOrderId: session.consumed_order_id ? String(session.consumed_order_id) : null,
        paymentId: String(session.payment_id || '')
      },
      sseOrdersChanged: curlecSseEvent.data || null
    };

    const statusSsePromise = waitForSseEvent({
      streamToken: adminStreamToken,
      eventName: 'orders_changed',
      timeoutMs: 15000,
      predicate: (data) =>
        String(data?.source || '').toLowerCase() === 'admin_status' &&
        String(data?.orderId || '') === String(artifacts.curlecOrderId)
    });

    const statusUpdateRes = await fetch(`${APP_BASE}/api/orders/${artifacts.curlecOrderId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: 'Preparing' })
    });
    const statusUpdateJson = await statusUpdateRes.json().catch(() => ({}));
    assert(statusUpdateRes.ok, `order status update failed: ${statusUpdateRes.status} ${JSON.stringify(statusUpdateJson)}`);
    const [statusRows] = await pool.query(`SELECT status FROM orders WHERE id = ? LIMIT 1`, [artifacts.curlecOrderId]);
    assert(String(statusRows[0]?.status || '') === 'Preparing', 'order status did not update to Preparing');
    const statusSseEvent = await statusSsePromise;
    output.orderStatusUpdate = {
      response: statusUpdateJson,
      dbStatus: String(statusRows[0]?.status || ''),
      sseOrdersChanged: statusSseEvent.data || null
    };

    const externalOrderId = `LM_SIM_${Date.now()}`;
    const [ins] = await pool.query(
      `INSERT INTO orders (user_id, status, total_amount, order_type, delivery_address, delivery_provider, external_order_id, lalamove_status, payment_method)
       VALUES (?, 'Finding Rider', 9.99, 'Delivery', 'Simulation Address', 'Lalamove', ?, 'ASSIGNING_DRIVER', 'DuitNow')`,
      [Number(user.id), externalOrderId]
    );
    artifacts.lalamoveOrderId = Number(ins.insertId);

    artifacts.lalamoveEventId = `evt_lalamove_${Date.now()}`;
    const lData = { orderId: externalOrderId, status: 'ON_GOING', driverId: 'driver_sim_1' };
    const ts = String(Date.now());
    const lSig = signLalamove({
      secret: process.env.LALAMOVE_API_SECRET,
      timestamp: ts,
      requestPath: '/api/webhooks/lalamove',
      dataPayload: lData
    });

    const lPayload = {
      eventId: artifacts.lalamoveEventId,
      eventType: 'ORDER_STATUS_CHANGED',
      apiKey: process.env.LALAMOVE_API_KEY,
      timestamp: ts,
      signature: lSig,
      data: lData
    };
    const lalamoveSsePromise = waitForSseEvent({
      streamToken: adminStreamToken,
      eventName: 'orders_changed',
      timeoutMs: 15000,
      predicate: (data) =>
        String(data?.source || '').toLowerCase() === 'lalamove_webhook' &&
        String(data?.orderId || '') === String(artifacts.lalamoveOrderId)
    });

    const lRes = await fetch(`${APP_BASE}/api/webhooks/lalamove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lPayload)
    });
    const lJson = await lRes.json().catch(() => ({}));
    if (!lRes.ok) throw new Error(`lalamove webhook failed: ${lRes.status} ${JSON.stringify(lJson)}`);

    const [lRows] = await pool.query(
      `SELECT id, status, lalamove_status, driver_id, DATE_FORMAT(lalamove_ongoing_at, '%Y-%m-%dT%H:%i:%sZ') AS ongoing_at_utc
       FROM orders WHERE id = ? LIMIT 1`,
      [artifacts.lalamoveOrderId]
    );
    if (!lRows[0]) throw new Error('lalamove order row missing after webhook');
    const lalamoveSseEvent = await lalamoveSsePromise;

    output.lalamove = {
      webhookResponse: lJson,
      orderRow: {
        id: String(lRows[0].id),
        status: String(lRows[0].status || ''),
        lalamoveStatus: String(lRows[0].lalamove_status || ''),
        driverId: String(lRows[0].driver_id || ''),
        ongoingAtUtc: lRows[0].ongoing_at_utc || null
      },
      sseOrdersChanged: lalamoveSseEvent.data || null
    };

    await cleanupArtifacts();
    await restoreFlags();

    output.cleanup = { done: true };
    console.log('\n=== WEBHOOK SIMULATION RESULT ===');
    console.log(JSON.stringify(output, null, 2));
    process.exitCode = 0;
  } catch (error) {
    try {
      await cleanupArtifacts();
      await restoreFlags();
    } catch (_e) {}
    console.error('\n=== WEBHOOK SIMULATION FAILED ===');
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  } finally {
    try {
      await stopAll();
    } catch (stopErr) {
      console.error('shutdown error:', stopErr?.message || stopErr);
    }
  }
})();
