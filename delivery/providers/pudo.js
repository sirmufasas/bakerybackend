// delivery/providers/pudo.js
//
// Architecture-only stub. PUDO is a pickup/drop-off point network, NOT an
// Uber-style on-demand courier - the frontend must use a different flow for
// this provider (customer picks a nearby locker/point rather than getting a
// door-to-door ETA). No live API calls are made until PUDO_API_KEY (or
// whatever PUDO's current docs specify) is configured and reviewed.
//
// getNearbyPickupPoints() is intentionally separate from getQuote() because
// PUDO's customer experience requires selecting a point BEFORE a price/ETA
// is meaningful - never call this expecting door-to-door behaviour.

const pudo = {
  id: 'pudo',
  name: 'PUDO',
  serviceType: 'pickup_point',
  capabilities: ['pickup_point', 'standard', 'tracking'],

  isConfigured() {
    return Boolean(process.env.PUDO_API_KEY);
  },

  async checkAvailability() {
    return { available: false, reason: 'Provider integration configured but awaiting credentials.' };
  },

  // Would return nearby PUDO locker/kiosk locations for the customer to
  // choose from. Never fabricate locations - return [] / throw until real
  // API access exists.
  async getNearbyPickupPoints(/* address */) {
    if (!this.isConfigured()) {
      return { points: [], reason: 'Provider integration configured but awaiting credentials.' };
    }
    throw new Error('PUDO nearby-points lookup not yet implemented.');
  },

  async getQuote() {
    return null;
  },

  async createDelivery() {
    throw new Error('PUDO is not configured - missing credentials/API access.');
  },

  async cancelDelivery() {
    throw new Error('PUDO is not configured.');
  },

  async getDeliveryStatus() {
    throw new Error('PUDO is not configured.');
  }
};

module.exports = pudo;
