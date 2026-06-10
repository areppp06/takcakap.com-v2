const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Only load dotenv if credentials are not already in the process environment
if (!process.env.LALAMOVE_API_KEY || !process.env.LALAMOVE_API_SECRET) {
  const envPath = fs.existsSync(path.join(__dirname, '.env'))
    ? path.join(__dirname, '.env')
    : path.join(__dirname, '..', '.env');

  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
  } else {
    console.warn('Warning: .env file not found and environment variables are empty.');
  }
}

const LALAMOVE_API_KEY = process.env.LALAMOVE_API_KEY;
const LALAMOVE_API_SECRET = process.env.LALAMOVE_API_SECRET;

if (!LALAMOVE_API_KEY || !LALAMOVE_API_SECRET) {
  console.error('Error: LALAMOVE_API_KEY or LALAMOVE_API_SECRET is missing from process.env and .env');
  process.exit(1);
}

const orderId = process.argv[2]; // e.g. "3512525610969255996"
const status = process.argv[3];  // e.g. "ON_GOING"

if (!orderId || !status) {
  console.error('Usage: node trigger_lalamove_sim.js <lalamoveOrderId> <status>');
  console.log('Available Statuses: ASSIGNING_DRIVER, ON_GOING, PICKED_UP, COMPLETED, CANCELED');
  process.exit(1);
}

const timestamp = String(Date.now());
const requestPath = '/api/webhooks/lalamove';
const dataPayload = {
  orderId: orderId,
  status: status,
  driverId: 'driver_sim_123'
};

const raw = `${timestamp}\r\nPOST\r\n${requestPath}\r\n\r\n${JSON.stringify(dataPayload)}`;
const signature = crypto.createHmac('sha256', LALAMOVE_API_SECRET).update(raw).digest('hex');

const webhookPayload = {
  eventId: `evt_sim_${Date.now()}`,
  eventType: 'ORDER_STATUS_CHANGED',
  apiKey: LALAMOVE_API_KEY,
  timestamp: timestamp,
  signature: signature,
  data: dataPayload
};

async function trigger() {
  const targetUrl = 'http://127.0.0.1:3001/api/webhooks/lalamove';
  console.log(`Sending simulated webhook to: ${targetUrl}`);
  console.log('Payload:', JSON.stringify(webhookPayload, null, 2));

  const res = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(webhookPayload)
  });

  const text = await res.text();
  console.log(`Response status: ${res.status}`);
  console.log(`Response body: ${text}`);
}

trigger().catch(console.error);
