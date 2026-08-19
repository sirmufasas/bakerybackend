// delivery/providers/uberDirect.js
//
// Real Uber Direct integration, based on Uber's current published API:
//   Auth:    POST https://auth.uber.com/oauth/v2/token   (client_credentials, scope=eats.deliveries)
//   Quote:   POST https://api.uber.com/v1/customers/{customer_id}/delivery_quotes
//   Deliver: POST https://api.uber.com/v1/customers/{customer_id}/deliveries
//   Cancel:  POST https://api.uber.com/v1/customers/{customer_id}/deliveries/{delivery_id}/cancel
//   Status:  GET  https://api.uber.com/v1/customers/{customer_id}/deliveries/{delivery_id}
//   Webhook: header `x-uber-signature` = hex HMAC-SHA256(body, signing_key)
//
// This adapter is INERT (isConfigured() === false) unless the following
// environment variables are set on the backend:
//   UBER_DIRECT_CLIENT_ID
//   UBER_DIRECT_CLIENT_SECRET
//   UBER_DIRECT_CUSTOMER_ID
//   UBER_DIRECT_WEBHOOK_SIGNING_KEY   (only required to receive webhooks)
//   PORTUGAL_BAKERY_PICKUP_ADDRESS_JSON  e.g. {"street_address":["123 Main Rd"],"city":"Johannesburg","state":"GT","zip_code":"2190","country":"ZA"}
//   PORTUGAL_BAKERY_PICKUP_LAT / PORTUGAL_BAKERY_PICKUP_LNG
//   PORTUGAL_BAKERY_PICKUP_PHONE
//
// Nothing here fabricates a quote, delivery, or tracking info - if the
// credentials are missing or Uber's API errors, callers get a clear error,
// never fake data.

const AUTH_URL = 'https://auth.uber.com/oauth/v2/token';
const API_BASE = 'https://api.uber.com/v1';

let cachedToken = null; // { access_token, expiresAt }

function isConfigured() {
  return Boolean(
    process.env.UBER_DIRECT_CLIENT_ID &&
    process.env.UBER_DIRECT_CLIENT_SECRET &&
    process.env.UBER_DIRECT_CUSTOMER_ID
  );
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.access_token;
  }

  const params = new URLSearchParams({
    client_id: process.env.UBER_DIRECT_CLIENT_ID,
    client_secret: process.env.UBER_DIRECT_CLIENT_SECRET,
    grant_type: 'client_credentials',
    scope: 'eats.deliveries'
  });

  const resp = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Uber Direct auth failed (${resp.status}): ${text}`);
  }

  const data = await resp.json();
  cachedToken = {
    access_token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 0) * 1000
  };
  return cachedToken.access_token;
}

async function uberFetch(path, options = {}) {
  const token = await getAccessToken();
  const resp = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  const raw = await resp.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }

  if (!resp.ok) {
    const err = new Error(`Uber Direct API error (${resp.status}): ${data.message || raw}`);
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data;
}

function getPickupAddress() {
  const json = process.env.PORTUGAL_BAKERY_PICKUP_ADDRESS_JSON;
  if (!json) throw new Error('PORTUGAL_BAKERY_PICKUP_ADDRESS_JSON is not configured');
  return json; // already a JSON string, as Uber's API expects
}

const uberDirect = {
  id: 'uber_direct',
  name: 'Uber Direct',
  serviceType: 'on_demand_door_to_door',
  capabilities: ['door_to_door', 'on_demand', 'same_day', 'quote', 'tracking', 'driver_info', 'webhooks'],

  isConfigured,

  async checkAvailability() {
    if (!isConfigured()) {
      return { available: false, reason: 'Provider integration configured but awaiting credentials.' };
    }
    return { available: true };
  },

  // context: { address, latitude, longitude, subtotal }
  async getQuote(context) {
    if (!isConfigured()) return null;

    const customerId = process.env.UBER_DIRECT_CUSTOMER_ID;
    const dropoffAddress = JSON.stringify({
      street_address: [context.address],
      city: context.city || '',
      state: context.state || 'GT',
      zip_code: context.zipCode || '',
      country: 'ZA'
    });

    const body = {
      pickup_address: getPickupAddress(),
      dropoff_address: dropoffAddress
    };
    if (context.latitude && context.longitude) {
      body.dropoff_latitude = context.latitude;
      body.dropoff_longitude = context.longitude;
    }
    if (process.env.PORTUGAL_BAKERY_PICKUP_LAT && process.env.PORTUGAL_BAKERY_PICKUP_LNG) {
      body.pickup_latitude = Number(process.env.PORTUGAL_BAKERY_PICKUP_LAT);
      body.pickup_longitude = Number(process.env.PORTUGAL_BAKERY_PICKUP_LNG);
    }

    const quote = await uberFetch(`/customers/${customerId}/delivery_quotes`, {
      method: 'POST',
      body: JSON.stringify(body)
    });

    return {
      providerId: this.id,
      providerName: this.name,
      fee: quote.fee / 100, // Uber returns fee in cents
      currency: (quote.currency_type || 'ZAR'),
      etaMinutesMin: quote.duration,
      etaMinutesMax: quote.duration,
      quoteId: quote.id,
      quoteExpiresAt: quote.expires,
      serviceType: this.serviceType,
      raw: quote
    };
  },

  // order must include a valid, unexpired quoteId from getQuote(), plus
  // dropoff details.
  async createDelivery(order) {
    if (!isConfigured()) {
      throw new Error('Uber Direct is not configured - missing credentials.');
    }
    if (!order.deliveryQuoteId) {
      throw new Error('No active Uber Direct quote for this order - request a fresh quote before dispatch.');
    }

    const customerId = process.env.UBER_DIRECT_CUSTOMER_ID;
    const dropoffAddress = JSON.stringify({
      street_address: [order.address],
      city: order.city || '',
      state: order.state || 'GT',
      zip_code: order.zipCode || '',
      country: 'ZA'
    });

    const body = {
      quote_id: order.deliveryQuoteId,
      pickup_address: getPickupAddress(),
      pickup_name: 'Portugal Bakery',
      pickup_phone_number: process.env.PORTUGAL_BAKERY_PICKUP_PHONE,
      dropoff_address: dropoffAddress,
      dropoff_name: order.customerName || 'Customer',
      dropoff_phone_number: order.phone,
      manifest_reference: order.orderNumber,
      manifest_total_value: Math.round((order.totalAmount || 0) * 100)
    };

    const delivery = await uberFetch(`/customers/${customerId}/deliveries`, {
      method: 'POST',
      body: JSON.stringify(body)
    });

    return {
      providerDeliveryId: delivery.id,
      trackingUrl: delivery.tracking_url || null,
      status: 'courier_requested',
      raw: delivery
    };
  },

  async cancelDelivery(providerDeliveryId) {
    if (!isConfigured()) throw new Error('Uber Direct is not configured.');
    const customerId = process.env.UBER_DIRECT_CUSTOMER_ID;
    await uberFetch(`/customers/${customerId}/deliveries/${providerDeliveryId}/cancel`, { method: 'POST' });
    return { cancelled: true };
  },

  async getDeliveryStatus(providerDeliveryId) {
    if (!isConfigured()) throw new Error('Uber Direct is not configured.');
    const customerId = process.env.UBER_DIRECT_CUSTOMER_ID;
    const delivery = await uberFetch(`/customers/${customerId}/deliveries/${providerDeliveryId}`);
    return {
      status: delivery.status,
      trackingUrl: delivery.tracking_url || null,
      driver: delivery.courier
        ? {
            name: delivery.courier.name || null,
            phone: delivery.courier.phone_number || null,
            vehicle: delivery.courier.vehicle_type || null,
            location: delivery.courier.location || null
          }
        : null,
      raw: delivery
    };
  },

  // Verifies the `x-uber-signature` header: hex HMAC-SHA256 of the raw
  // request body using the webhook signing key. rawBody must be the exact
  // raw bytes/string Uber sent (not a re-serialized JSON.stringify of the
  // parsed body), per Uber's own documented caveat about JS backslash
  // handling.
  verifyWebhook(rawBody, signatureHeader) {
    const signingKey = process.env.UBER_DIRECT_WEBHOOK_SIGNING_KEY;
    if (!signingKey || !signatureHeader) return false;
    const crypto = require('crypto');
    const digest = crypto.createHmac('sha256', signingKey).update(rawBody).digest('hex');
    // constant-time compare
    const a = Buffer.from(digest);
    const b = Buffer.from(signatureHeader);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  },

  // Maps Uber's webhook event payload to our internal shape. Only reads
  // fields Uber actually documents - never fabricates data.
  parseWebhookEvent(payload) {
    return {
      providerDeliveryId: payload.delivery_id || payload?.data?.id || null,
      status: payload.status || payload?.data?.status || null,
      eventType: payload.kind || payload.event_type || null,
      raw: payload
    };
  }
};

module.exports = uberDirect;
