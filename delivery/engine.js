// delivery/engine.js
//
// Central South African multi-provider delivery engine for Portugal Bakery.
// Coordinates quotes, eligibility, business rules, and dispatch across
// in-house, on-demand ride/express, parcel courier, and pickup-locker networks.

const ownDelivery = require('./providers/ownDelivery');
const uberDirect = require('./providers/uberDirect');
const bolt = require('./providers/bolt');
const inDrive = require('./providers/inDrive');
const yassir = require('./providers/yassir');
const mrD = require('./providers/mrD');
const droppa = require('./providers/droppa');
const courierGuy = require('./providers/courierGuy');
const ram = require('./providers/ram');
const fastway = require('./providers/fastway');
const aramex = require('./providers/aramex');
const pudo = require('./providers/pudo');
const pargo = require('./providers/pargo');
const localCourier = require('./providers/localCourier');

const PROVIDERS = {
  own_delivery: ownDelivery,
  uber_direct: uberDirect,
  bolt,
  indrive: inDrive,
  yassir,
  mr_d: mrD,
  droppa,
  courier_guy: courierGuy,
  ram,
  fastway,
  aramex,
  pudo,
  pargo,
  local_courier: localCourier
};

const ALL_PROVIDER_IDS = Object.keys(PROVIDERS);

const DEFAULT_ENABLED = [
  'own_delivery',
  'uber_direct',
  'bolt',
  'indrive',
  'yassir',
  'mr_d',
  'droppa',
  'courier_guy',
  'ram',
  'fastway',
  'aramex',
  'pudo',
  'pargo'
];

async function getDeliverySettings(db) {
  const settings = await db.collection('delivery_settings').findOne({ _id: 'default' });
  if (!settings) {
    return {
      _id: 'default',
      enabledProviders: [...DEFAULT_ENABLED],
      knownProviders: [...ALL_PROVIDER_IDS],
      freeDeliveryThreshold: null,
      minimumOrderForDelivery: null
    };
  }

  // Auto-enable newly introduced default SA providers if the existing DB
  // settings document predates them, while preserving any provider the admin
  // already knew about and explicitly toggled off.
  const known = new Set(Array.isArray(settings.knownProviders) ? settings.knownProviders : []);
  const enabled = new Set(Array.isArray(settings.enabledProviders) ? settings.enabledProviders : DEFAULT_ENABLED);

  for (const id of DEFAULT_ENABLED) {
    if (!known.has(id)) {
      enabled.add(id);
    }
  }

  return {
    ...settings,
    enabledProviders: Array.from(enabled),
    knownProviders: [...ALL_PROVIDER_IDS]
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
    category: p.category || 'courier',
    description: p.description || '',
    bookingUrl: p.bookingUrl || null,
    serviceType: p.serviceType,
    capabilities: p.capabilities,
    configured: p.isConfigured(),
    dispatchMode: typeof p.getDispatchMode === 'function' ? p.getDispatchMode() : 'managed_dispatch'
  }));
}

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
    }
  }

  // Apply free-delivery threshold if configured.
  if (settings.freeDeliveryThreshold && context.subtotal >= settings.freeDeliveryThreshold) {
    results.forEach(q => {
      q.originalFee = q.fee;
      q.fee = 0;
      q.freeDelivery = true;
    });
  }

  // Dynamic comparison labels computed across actual returned quotes.
  if (results.length > 0) {
    const doorToDoor = results.filter(q => q.serviceType !== 'pickup_point');
    const cheapestPool = doorToDoor.length > 0 ? doorToDoor : results;
    const minFee = Math.min(...cheapestPool.map(q => q.fee));
    const minEta = Math.min(...results.map(q => q.etaMinutesMax ?? Infinity));

    results.forEach(q => {
      q.labels = [];
      if (q.fee === minFee && q.serviceType !== 'pickup_point') q.labels.push('CHEAPEST');
      if (q.serviceType === 'pickup_point' && q.fee <= minFee) q.labels.push('LOWEST LOCKER FEE');
      if ((q.etaMinutesMax ?? Infinity) === minEta) q.labels.push('FASTEST');
      if (q.providerId === 'own_delivery' || q.providerId === 'droppa') q.labels.push('BEST FOR CAKES');
      if (q.serviceType === 'pickup_point') q.labels.push('PICKUP POINT');
      if (q.serviceType === 'same_day_door_to_door') q.labels.push('SAME DAY');
    });
  }

  return results;
}

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
  ALL_PROVIDER_IDS,
  DEFAULT_ENABLED,
  getProvider,
  listAllProviders,
  getDeliverySettings,
  getQuotes,
  requestCourier,
  cancelCourier,
  getCourierStatus
};
