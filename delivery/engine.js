// delivery/engine.js
//
// The rest of the application talks to THIS module, never to individual
// provider adapters directly. This is what lets Portugal Bakery add/remove/
// swap courier providers later without touching checkout or admin code.

const ownDelivery = require('./providers/ownDelivery');
const uberDirect = require('./providers/uberDirect');
const courierGuy = require('./providers/courierGuy');
const pargo = require('./providers/pargo');
const pudo = require('./providers/pudo');
const localCourier = require('./providers/localCourier');

const PROVIDERS = {
  own_delivery: ownDelivery,
  uber_direct: uberDirect,
  courier_guy: courierGuy,
  pargo: pargo,
  pudo: pudo,
  local_courier: localCourier
};

const DEFAULT_ENABLED = ['own_delivery', 'uber_direct', 'courier_guy', 'pargo', 'pudo'];

async function getDeliverySettings(db) {
  const settings = await db.collection('delivery_settings').findOne({ _id: 'default' });
  if (settings) return settings;
  return {
    _id: 'default',
    enabledProviders: DEFAULT_ENABLED,
    freeDeliveryThreshold: null, // e.g. 500 = free delivery above R500, null = disabled
    minimumOrderForDelivery: null
  };
}

function getProvider(providerId) {
  const provider = PROVIDERS[providerId];
  if (!provider) throw new Error(`Unknown delivery provider: ${providerId}`);
  return provider;
}

function listAllProviders() {
  return Object.values(PROVIDERS).map(p => ({
    id: p.id,
    name: p.name,
    serviceType: p.serviceType,
    capabilities: p.capabilities,
    configured: p.isConfigured()
  }));
}

// Does this order's items allow this provider, based on optional per-product
// deliveryEligibility (an array of required capabilities). Products with no
// deliveryEligibility field are eligible for every provider.
function isProviderEligibleForItems(provider, items = []) {
  for (const item of items) {
    const required = item.deliveryEligibility;
    if (!Array.isArray(required) || required.length === 0) continue;
    const meetsAll = required.every(cap => provider.capabilities.includes(cap));
    if (!meetsAll) return false;
  }
  return true;
}

// context: { db, address, latitude, longitude, subtotal, items }
// Returns quotes only from providers that are: enabled in settings,
// configured (or own_delivery, which is always configured), available for
// this context, and eligible for the items in the cart.
async function getQuotes(context) {
  const { db, items = [] } = context;
  const settings = await getDeliverySettings(db);
  const enabledIds = settings.enabledProviders || DEFAULT_ENABLED;

  const results = [];
  for (const id of enabledIds) {
    const provider = PROVIDERS[id];
    if (!provider) continue;
    if (!provider.isConfigured()) continue;
    if (!isProviderEligibleForItems(provider, items)) continue;

    const availability = await provider.checkAvailability(context).catch(() => ({ available: false }));
    if (!availability.available) continue;

    try {
      const quote = await provider.getQuote(context);
      if (quote) results.push(quote);
    } catch (err) {
      console.error(`Quote failed for provider ${id}:`, err.message);
      // Skip this provider rather than failing the whole comparison.
    }
  }

  // Apply free-delivery threshold if configured.
  if (settings.freeDeliveryThreshold && context.subtotal >= settings.freeDeliveryThreshold) {
    results.forEach(q => { q.originalFee = q.fee; q.fee = 0; q.freeDelivery = true; });
  }

  // Dynamic labels - computed from what's actually being compared, never
  // hard-coded or asserted without checking the alternatives.
  if (results.length > 0) {
    const cheapest = results.reduce((a, b) => (b.fee < a.fee ? b : a));
    const fastest = results.reduce((a, b) => {
      const aTime = a.etaMinutesMax ?? Infinity;
      const bTime = b.etaMinutesMax ?? Infinity;
      return bTime < aTime ? b : a;
    });
    results.forEach(q => {
      q.labels = [];
      if (q.providerId === cheapest.providerId) q.labels.push('CHEAPEST');
      if (q.providerId === fastest.providerId) q.labels.push('FASTEST');
      if (q.serviceType === 'pickup_point') q.labels.push('PICKUP POINT');
      if (q.serviceType === 'standard_parcel') q.labels.push('STANDARD');
    });
  }

  return results;
}

// Verifies preconditions and dispatches the selected provider. Duplicate
// protection is enforced by the caller using an atomic findOneAndUpdate
// condition (see server.js) - this function assumes that guard already
// passed and just talks to the provider.
async function requestCourier(providerId, order) {
  const provider = getProvider(providerId);
  if (!provider.isConfigured()) {
    throw new Error(`${provider.name} is not configured - missing credentials.`);
  }
  return provider.createDelivery(order);
}

async function cancelCourier(providerId, providerDeliveryId) {
  const provider = getProvider(providerId);
  return provider.cancelDelivery(providerDeliveryId);
}

async function getCourierStatus(providerId, providerDeliveryId) {
  const provider = getProvider(providerId);
  return provider.getDeliveryStatus(providerDeliveryId);
}

module.exports = {
  PROVIDERS,
  getProvider,
  listAllProviders,
  getDeliverySettings,
  getQuotes,
  requestCourier,
  cancelCourier,
  getCourierStatus
};
