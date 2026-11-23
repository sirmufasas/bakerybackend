// delivery/providers/uberDirect.js
//
// Dual-mode Uber Package / Uber Direct integration:
//  - When UBER_DIRECT_CLIENT_ID + UBER_DIRECT_CLIENT_SECRET + UBER_DIRECT_CUSTOMER_ID
//    are configured on the server, uses Uber's live OAuth + Delivery Quotes +
//    Deliveries REST API + HMAC-verified webhooks.
//  - Otherwise, runs immediately in Gauteng Uber Package rate-card + staff
//    dispatch mode so customers can select Uber at checkout today and staff
//    can dispatch via Uber Package / Uber Direct dashboard and attach the
//    live trip tracking link.

const { createRateCardProvider } = require('./rateCardProvider');

const AUTH_URL = 'https://auth.uber.com/oauth/v2/token';
const API_BASE = 'https://api.uber.com/v1';

let cachedToken = null;

function hasLiveCredentials() {
  return Boolean(
    process.env.UBER_DIRECT_CLIENT_ID &&
    process.env.UBER_DIRECT_CLIENT_SECRET &&
    process.env.UBER_DIRECT_CUSTOMER_ID &&
    process.env.PORTUGAL_BAKERY_PICKUP_ADDRESS_JSON
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

const fallbackAdapter = createRateCardProvider({
  id: 'uber_direct',
  name: 'Uber Package (Uber Direct)',
  category: 'on_demand',
  description: 'Fast on-demand motorbike/car delivery across Johannesburg',
  bookingUrl: 'https://m.uber.com/',
  serviceType: 'on_demand_door_to_door',
  capabilities: ['door_to_door', 'on_demand', 'same_day', 'quote', 'tracking', 'driver_info', 'webhooks'],
  apiKeyEnv: ['UBER_DIRECT_CLIENT_ID', 'UBER_DIRECT_CLIENT_SECRET', 'UBER_DIRECT_CUSTOMER_ID'],
  zoneFees: { 1: 65, 2: 95, 3: 135, 4: 175, 5: 230, 6: 310 },
  zoneEtas: { 1: [20, 35], 2: [25, 45], 3: [30, 50], 4: [35, 60], 5: [45, 75], 6: [60, 95] }
});

const uberDirect = {
  ...fallbackAdapter,

  hasLiveApiCredentials: hasLiveCredentials,

  getDispatchMode() {
    return hasLiveCredentials() ? 'live_api' : 'managed_dispatch';
  },

  isConfigured() {
    return true;
  },

  async checkAvailability(context) {
    return fallbackAdapter.checkAvailability(context);
  },

  async getQuote(context) {
    if (!hasLiveCredentials()) {
      return fallbackAdapter.getQuote(context);
    }

    try {
      const customerId = process.env.UBER_DIRECT_CUSTOMER_ID;
      const dropoffAddress = JSON.stringify({
        street_address: [context.address],
        city: context.city || 'Johannesburg',
        state: context.state || 'GT',
        zip_code: context.zipCode || '',
        country: 'ZA'
      });

      const body = {
        pickup_address: process.env.PORTUGAL_BAKERY_PICKUP_ADDRESS_JSON,
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
        category: this.category,
        description: this.description,
        bookingUrl: this.bookingUrl,
        dispatchMode: 'live_api',
        fee: quote.fee / 100,
        currency: quote.currency_type || 'ZAR',
        etaMinutesMin: quote.duration,
        etaMinutesMax: quote.duration,
        quoteId: quote.id,
        quoteExpiresAt: quote.expires,
        serviceType: this.serviceType,
        raw: quote
      };
    } catch (err) {
      console.warn('Uber Direct live quote failed, falling back to Gauteng rate card:', err.message);
      return fallbackAdapter.getQuote(context);
    }
  },

  async createDelivery(order) {
    if (!hasLiveCredentials() || !order.deliveryQuoteId || String(order.deliveryQuoteId).startsWith('uber_direct_z')) {
      return fallbackAdapter.createDelivery(order);
    }

    const customerId = process.env.UBER_DIRECT_CUSTOMER_ID;
    const dropoffAddress = JSON.stringify({
      street_address: [order.address],
      city: order.city || 'Johannesburg',
      state: order.state || 'GT',
      zip_code: order.zipCode || '',
      country: 'ZA'
    });

    const body = {
      quote_id: order.deliveryQuoteId,
      pickup_address: process.env.PORTUGAL_BAKERY_PICKUP_ADDRESS_JSON,
      pickup_name: 'Portugal Bakery',
      pickup_phone_number: process.env.PORTUGAL_BAKERY_PICKUP_PHONE || '+27114362396',
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
    if (!hasLiveCredentials() || !providerDeliveryId || String(providerDeliveryId).startsWith('UBER_DIRECT-')) {
      return fallbackAdapter.cancelDelivery(providerDeliveryId);
    }
    const customerId = process.env.UBER_DIRECT_CUSTOMER_ID;
    await uberFetch(`/customers/${customerId}/deliveries/${providerDeliveryId}/cancel`, { method: 'POST' });
    return { cancelled: true };
  },

  async getDeliveryStatus(providerDeliveryId) {
    if (!hasLiveCredentials() || !providerDeliveryId || String(providerDeliveryId).startsWith('UBER_DIRECT-')) {
      return fallbackAdapter.getDeliveryStatus(providerDeliveryId);
    }
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

  verifyWebhook(rawBody, signatureHeader) {
    const signingKey = process.env.UBER_DIRECT_WEBHOOK_SIGNING_KEY;
    if (!signingKey || !signatureHeader) return false;
    const crypto = require('crypto');
    const digest = crypto.createHmac('sha256', signingKey).update(rawBody).digest('hex');
    const a = Buffer.from(digest);
    const b = Buffer.from(signatureHeader);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  },

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
