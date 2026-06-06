const crypto = require('crypto');

const DEFAULT_SANDBOX_URL = 'https://rest.sandbox.lalamove.com';
const DEFAULT_PROD_URL = 'https://rest.lalamove.com';

const REQUIRED_ENV_VARS = [
  'LALAMOVE_API_KEY',
  'LALAMOVE_API_SECRET'
];
const E164_PHONE_REGEX = /^\+[1-9]\d{7,14}$/;
const DEFAULT_STORE_NAME = 'TakCakap KL Sentral';
const DEFAULT_STORE_PHONE = '+60123456789';
const DEFAULT_STORE_ADDRESS = 'Jalan Stesen Sentral 5, Kuala Lumpur, 50470, Malaysia';
const DEFAULT_STORE_LATITUDE = 3.1347;
const DEFAULT_STORE_LONGITUDE = 101.6869;
const LALAMOVE_HTTP_TIMEOUT_MS = Math.max(
  3000,
  Number.parseInt(String(process.env.LALAMOVE_HTTP_TIMEOUT_MS || '12000'), 10) || 12000
);

const normalizePhone = (phone) => {
  const raw = String(phone || '').trim();
  if (!raw) return '';

  // Keep only one optional leading '+' and digits.
  let compact = raw.replace(/[^\d+]/g, '');
  if (compact.startsWith('+')) {
    compact = `+${compact.slice(1).replace(/[^\d]/g, '')}`;
  } else {
    compact = compact.replace(/[^\d]/g, '');
  }

  if (!compact || compact === '+') return '';
  if (compact.startsWith('+')) return compact;
  if (compact.startsWith('60')) return `+${compact}`;
  if (compact.startsWith('0')) return `+60${compact.slice(1)}`;
  return `+60${compact}`;
};

const isValidPhone = (phone) => E164_PHONE_REGEX.test(String(phone || '').trim());

const formatCoordinate = (value, { label, min, max }) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
    throw new Error(`Invalid ${label} coordinate: ${value}`);
  }
  // Lalamove coordinate regex allows max 15 decimal places.
  // Normalize precision and avoid scientific notation.
  return numeric.toFixed(7).replace(/\.?0+$/, '');
};

const getConfig = () => {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing Lalamove config: ${missing.join(', ')}`);
  }

  const apiKey = process.env.LALAMOVE_API_KEY || '';
  const isProd = apiKey.startsWith('pk_prod_');
  const defaultBaseUrl = isProd ? DEFAULT_PROD_URL : DEFAULT_SANDBOX_URL;

  return {
    baseUrl: process.env.LALAMOVE_BASE_URL || defaultBaseUrl,
    apiKey,
    apiSecret: process.env.LALAMOVE_API_SECRET,
    market: process.env.LALAMOVE_MARKET || 'MY',
    serviceType: process.env.LALAMOVE_SERVICE_TYPE || 'MOTORCYCLE',
    language: process.env.LALAMOVE_LANGUAGE || 'en_MY',
    partner: process.env.LALAMOVE_PARTNER || '',
    isRouteOptimized: process.env.LALAMOVE_ROUTE_OPTIMIZED !== 'false'
  };
};

const getStoreConfig = (storeOverride = null) => {
  const source = storeOverride || {
    name: DEFAULT_STORE_NAME,
    phone: DEFAULT_STORE_PHONE,
    address: DEFAULT_STORE_ADDRESS,
    latitude: DEFAULT_STORE_LATITUDE,
    longitude: DEFAULT_STORE_LONGITUDE
  };

  const storeName = String(source?.name || '').trim();
  const storeAddress = String(source?.address || '').trim();
  const rawPhone = String(source?.phone || '').trim();
  const rawLat =
    source?.latitude ??
    source?.lat ??
    source?.coordinates?.lat;
  const rawLng =
    source?.longitude ??
    source?.lng ??
    source?.coordinates?.lng;

  if (!storeName || !storeAddress || !rawPhone || rawLat === undefined || rawLng === undefined) {
    throw new Error('Missing store config. Please configure store details in Admin Manage Shop.');
  }

  const normalizedStorePhone = normalizePhone(rawPhone);
  if (!isValidPhone(normalizedStorePhone)) {
    throw new Error('Invalid store phone. Use E.164 format, for example +60123456789');
  }

  return {
    name: storeName,
    phone: normalizedStorePhone,
    address: storeAddress,
    coordinates: {
      lat: formatCoordinate(rawLat, {
        label: 'store latitude',
        min: -90,
        max: 90
      }),
      lng: formatCoordinate(rawLng, {
        label: 'store longitude',
        min: -180,
        max: 180
      })
    }
  };
};

const buildSignature = ({ timestamp, method, path, body, apiSecret }) => {
  const requestBody = body ? JSON.stringify(body) : '';
  const raw = `${timestamp}\r\n${method}\r\n${path}\r\n\r\n${requestBody}`;
  return crypto.createHmac('sha256', apiSecret).update(raw).digest('hex');
};

const requestLalamove = async ({ method, path, body, market }) => {
  const config = getConfig();
  const timestamp = Date.now().toString();
  const signature = buildSignature({
    timestamp,
    method,
    path,
    body,
    apiSecret: config.apiSecret
  });

  const token = `${config.apiKey}:${timestamp}:${signature}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LALAMOVE_HTTP_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `hmac ${token}`,
        Market: market || config.market,
        'Request-ID': crypto.randomUUID()
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
  } catch (error) {
    const networkError = new Error(
      error?.name === 'AbortError'
        ? `Lalamove API request timed out after ${LALAMOVE_HTTP_TIMEOUT_MS}ms`
        : `Unable to reach Lalamove API: ${error.message}`
    );
    networkError.status = 502;
    networkError.cause = error;
    throw networkError;
  } finally {
    clearTimeout(timeout);
  }

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const firstError = Array.isArray(json?.errors) ? json.errors[0] : null;
    const errorId = String(firstError?.id || '').trim();
    const errorMessage = String(firstError?.message || json?.message || json?.error || '').trim();
    const errorDetail = String(firstError?.detail || '').trim();
    const messageParts = [
      errorId ? `[${errorId}]` : '',
      errorMessage || 'Lalamove request failed',
      errorDetail && errorDetail !== '/data' ? `(${errorDetail})` : ''
    ].filter(Boolean);
    const message = messageParts.join(' ');
    const error = new Error(message);
    error.status = response.status;
    error.payload = json;
    throw error;
  }

  return json;
};

const createQuotation = async ({
  dropoffAddress,
  dropoffLat,
  dropoffLng,
  dropoffNote,
  scheduleAt,
  store
}) => {
  const config = getConfig();
  const resolvedStore = getStoreConfig(store);
  const payload = {
    data: {
      serviceType: config.serviceType,
      language: config.language,
      isRouteOptimized: config.isRouteOptimized,
      stops: [
        {
          coordinates: resolvedStore.coordinates,
          address: resolvedStore.address
        },
        {
          coordinates: {
            lat: formatCoordinate(dropoffLat, {
              label: 'dropoff latitude',
              min: -90,
              max: 90
            }),
            lng: formatCoordinate(dropoffLng, {
              label: 'dropoff longitude',
              min: -180,
              max: 180
            })
          },
          address: dropoffAddress
        }
      ],
      item: {
        quantity: '1',
        categories: ['FOOD_DELIVERY'],
        handlingInstructions: dropoffNote ? ['KEEP_UPRIGHT'] : []
      }
    }
  };
  if (scheduleAt) {
    payload.data.scheduleAt = scheduleAt;
  }

  const response = await requestLalamove({
    method: 'POST',
    path: '/v3/quotations',
    body: payload,
    market: config.market
  });
  return response.data;
};

const createOrder = async ({
  quotationId,
  senderStopId,
  recipientStopId,
  recipientName,
  recipientPhone,
  recipientRemarks,
  metadata,
  store
}) => {
  const config = getConfig();
  const resolvedStore = getStoreConfig(store);
  const normalizedRecipientPhone = normalizePhone(recipientPhone);
  if (!isValidPhone(normalizedRecipientPhone)) {
    throw new Error('Recipient phone is required and must be valid (E.164), for example +60123456789');
  }

  const payload = {
    data: {
      quotationId,
      sender: {
        stopId: senderStopId,
        name: resolvedStore.name,
        phone: resolvedStore.phone
      },
      recipients: [
        {
          stopId: recipientStopId,
          name: recipientName || 'Customer',
          phone: normalizedRecipientPhone,
          remarks: recipientRemarks || ''
        }
      ],
      remarks: recipientRemarks || '',
      isPODEnabled: true,
      metadata: metadata || {}
    }
  };

  if (config.partner) {
    payload.data.partner = config.partner;
  }

  const response = await requestLalamove({
    method: 'POST',
    path: '/v3/orders',
    body: payload,
    market: config.market
  });
  return response.data;
};

const cancelOrder = async (orderId) => {
  const config = getConfig();
  const normalizedOrderId = String(orderId || '').trim();
  if (!normalizedOrderId) {
    throw new Error('Lalamove orderId is required for cancellation');
  }

  await requestLalamove({
    method: 'DELETE',
    path: `/v3/orders/${normalizedOrderId}`,
    market: config.market
  });
  return { success: true };
};

module.exports = {
  createQuotation,
  createOrder,
  cancelOrder,
  normalizePhone,
  isValidPhone
};
