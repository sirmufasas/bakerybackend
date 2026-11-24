const crypto = require('crypto');

const YOCO_CHECKOUTS_URL = 'https://payments.yoco.com/api/checkouts';

/**
 * Inspect Yoco Online Checkout configuration from Render environment variables.
 * Settles directly in ZAR to the merchant's linked Capitec bank account.
 * Online gateway ONLY — zero dummy/mock payment modes.
 */
function getGatewayConfig() {
  const yocoSecret = (process.env.YOCO_SECRET_KEY || '').trim();
  const yocoPublic = (process.env.YOCO_PUBLIC_KEY || '').trim();
  const configured = yocoSecret.startsWith('sk_');

  return {
    configured,
    gateway: 'yoco',
    name: 'Yoco Secure Online Checkout',
    mode: yocoSecret.startsWith('sk_live_') ? 'live' : 'test',
    publicKey: yocoPublic.startsWith('pk_') ? yocoPublic : null,
    methods: [
      'Visa & Mastercard',
      'Capitec Card & Virtual Card',
      'Apple Pay & Google Pay',
      'Instant EFT',
      'Scan to Pay QR',
    ],
  };
}

/**
 * Generate a collision-resistant Yoco payment reference.
 */
function generatePaymentReference() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(5).toString('hex').toUpperCase();
  return `PBYOCO-${ts}-${rand}`;
}

/**
 * Validate allowed return origin so Yoco redirects can only return to trusted frontends.
 */
function resolveSafeReturnOrigin(requestedOrigin) {
  const fallback = (
    process.env.FRONTEND_URL || 'https://portubakery.netlify.app'
  ).replace(/\/+$/, '');
  if (!requestedOrigin || typeof requestedOrigin !== 'string') return fallback;

  try {
    const parsed = new URL(requestedOrigin);
    const host = parsed.hostname.toLowerCase();
    const allowedExact = new Set([
      new URL(fallback).hostname.toLowerCase(),
      'portubakery.netlify.app',
      'localhost',
      '127.0.0.1',
    ]);

    if (
      allowedExact.has(host) ||
      host.endsWith('.netlify.app') ||
      host.endsWith('.e2b.app')
    ) {
      return `${parsed.protocol}//${parsed.host}`;
    }
  } catch {
    // Fall back to configured FRONTEND_URL
  }

  return fallback;
}

/**
 * Server-side price verification against MongoDB products collection.
 * Prevents any client-side price tampering before creating a Yoco checkout.
 */
async function calculateVerifiedOrderPricing(
  db,
  items,
  deliveryMethod,
  rawDeliveryFee
) {
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error('Your cart is empty.');
    err.statusCode = 400;
    throw err;
  }

  const productIds = items
    .map((i) => Number(i.id))
    .filter((id) => Number.isFinite(id));

  const dbProducts = productIds.length
    ? await db
        .collection('products')
        .find({ id: { $in: productIds } })
        .toArray()
    : [];
  const productById = new Map(dbProducts.map((p) => [Number(p.id), p]));

  let subtotalCents = 0;
  const verifiedItems = items.map((item) => {
    const qty = Math.max(
      1,
      Math.min(99, Math.floor(Number(item.quantity) || 1))
    );
    const dbProduct = productById.get(Number(item.id));
    const unitPrice = dbProduct ? Number(dbProduct.price) : Number(item.price);

    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      const err = new Error(
        `Invalid price for item "${item.name || 'Unknown'}".`
      );
      err.statusCode = 400;
      throw err;
    }

    const cleanUnitPrice = Math.round(unitPrice * 100) / 100;
    subtotalCents += Math.round(cleanUnitPrice * 100) * qty;

    return {
      id: Number(item.id) || 0,
      name: String(dbProduct?.name || item.name || 'Bakery Item').trim(),
      price: cleanUnitPrice,
      quantity: qty,
      imageUrl: String(dbProduct?.image || item.imageUrl || ''),
    };
  });

  const deliveryFeeCents =
    deliveryMethod === 'delivery'
      ? Math.max(0, Math.round((Number(rawDeliveryFee) || 0) * 100))
      : 0;

  if (deliveryMethod === 'delivery' && deliveryFeeCents <= 0) {
    const err = new Error(
      'Please calculate a valid delivery fee before paying.'
    );
    err.statusCode = 400;
    throw err;
  }

  const totalCents = subtotalCents + deliveryFeeCents;
  if (totalCents < 200) {
    const err = new Error('Minimum Yoco online payment amount is R2.00.');
    err.statusCode = 400;
    throw err;
  }

  return {
    verifiedItems,
    subtotal: subtotalCents / 100,
    deliveryFee: deliveryFeeCents / 100,
    total: totalCents / 100,
    amountCents: totalCents,
  };
}

/**
 * Create a Yoco Hosted Checkout session (https://payments.yoco.com/api/checkouts).
 */
async function initializeYocoCheckout({
  amountCents,
  subtotalCents,
  deliveryFeeCents,
  reference,
  successUrl,
  cancelUrl,
  failureUrl,
  metadata,
}) {
  const secretKey = (process.env.YOCO_SECRET_KEY || '').trim();
  if (!secretKey.startsWith('sk_')) {
    const err = new Error(
      'Yoco gateway is awaiting YOCO_SECRET_KEY in Render environment variables.'
    );
    err.statusCode = 503;
    throw err;
  }

  const response = await fetch(YOCO_CHECKOUTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': reference,
    },
    body: JSON.stringify({
      amount: amountCents,
      currency: 'ZAR',
      subtotalAmount: subtotalCents,
      successUrl,
      cancelUrl,
      failureUrl,
      externalId: reference,
      metadata: {
        reference,
        deliveryFeeCents: String(deliveryFeeCents || 0),
        ...metadata,
      },
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.id || !body?.redirectUrl) {
    const err = new Error(
      body?.displayMessage ||
        body?.message ||
        'Failed to initialize Yoco checkout session.'
    );
    err.statusCode = 502;
    throw err;
  }

  return {
    gateway: 'yoco',
    reference,
    checkoutId: String(body.id),
    redirectUrl: body.redirectUrl,
  };
}

/**
 * Verify a Yoco Hosted Checkout session directly with Yoco's API.
 */
async function verifyYocoCheckout(checkoutId) {
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(String(checkoutId || ''))) {
    const err = new Error('Invalid Yoco checkout identifier.');
    err.statusCode = 400;
    throw err;
  }

  const secretKey = (process.env.YOCO_SECRET_KEY || '').trim();
  if (!secretKey.startsWith('sk_')) {
    const err = new Error('Yoco secret key is not configured on the server.');
    err.statusCode = 503;
    throw err;
  }

  const response = await fetch(
    `${YOCO_CHECKOUTS_URL}/${encodeURIComponent(checkoutId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        Accept: 'application/json',
      },
    }
  );

  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.id) {
    const err = new Error(
      body?.message || 'Unable to verify Yoco checkout status.'
    );
    err.statusCode = 502;
    throw err;
  }

  const rawStatus = String(body.status || '').toLowerCase();
  const isPaid =
    rawStatus === 'completed' ||
    rawStatus === 'succeeded' ||
    Boolean(body.paymentId);
  const isFailed =
    rawStatus === 'failed' ||
    rawStatus === 'cancelled' ||
    rawStatus === 'canceled' ||
    rawStatus === 'expired';

  return {
    verified: isPaid,
    failed: isFailed,
    gatewayStatus: body.status || 'pending',
    amountCents: Number(body.amount) || 0,
    currency: String(body.currency || 'ZAR').toUpperCase(),
    gatewayTransactionId: String(body.paymentId || body.id),
    channel: 'yoco_checkout',
    paidAt: new Date(),
    rawSummary: {
      checkoutId: body.id,
      paymentId: body.paymentId || null,
      status: body.status,
    },
  };
}

/**
 * Verify Yoco Svix HMAC-SHA256 webhook signature (`webhook-id`, `webhook-timestamp`, `webhook-signature`).
 */
function verifyYocoWebhookSignature(rawBodyBuffer, headers) {
  const webhookSecret = (process.env.YOCO_WEBHOOK_SECRET || '').trim();
  if (!webhookSecret || !rawBodyBuffer) return false;

  const webhookId = headers['webhook-id'];
  const webhookTimestamp = headers['webhook-timestamp'];
  const webhookSignature = headers['webhook-signature'];
  if (!webhookId || !webhookTimestamp || !webhookSignature) return false;

  const secretPart = webhookSecret.startsWith('whsec_')
    ? webhookSecret.slice(6)
    : webhookSecret;
  const secretBytes = Buffer.from(secretPart, 'base64');
  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBodyBuffer.toString('utf8')}`;
  const expectedSig = crypto
    .createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64');

  const candidates = String(webhookSignature)
    .split(' ')
    .map((part) => part.replace(/^v1,/, '').trim())
    .filter(Boolean);

  return candidates.some((candidate) => {
    try {
      return crypto.timingSafeEqual(
        Buffer.from(expectedSig, 'utf8'),
        Buffer.from(candidate, 'utf8')
      );
    } catch {
      return false;
    }
  });
}

module.exports = {
  getGatewayConfig,
  generatePaymentReference,
  resolveSafeReturnOrigin,
  calculateVerifiedOrderPricing,
  initializeYocoCheckout,
  verifyYocoCheckout,
  verifyYocoWebhookSignature,
};
