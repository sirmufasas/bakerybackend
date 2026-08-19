// delivery/providers/pargo.js
//
// Architecture-only stub. Pargo is a standard/home-delivery and
// pickup-point network, not an on-demand courier - it is intentionally NOT
// given the "on_demand" or "same_day" capability so the engine never
// presents it for fast/fresh-bakery-item deliveries. No live API calls are
// made until PARGO_API_KEY (or whatever their current docs specify) is
// configured and their integration requirements have been reviewed.

const pargo = {
  id: 'pargo',
  name: 'Pargo',
  serviceType: 'standard_parcel',
  capabilities: ['standard', 'home_delivery', 'pickup_point', 'click_and_collect', 'tracking'],

  isConfigured() {
    return Boolean(process.env.PARGO_API_KEY);
  },

  async checkAvailability() {
    return { available: false, reason: 'Provider integration configured but awaiting credentials.' };
  },

  async getQuote() {
    return null;
  },

  async createDelivery() {
    throw new Error('Pargo is not configured - missing credentials/API access.');
  },

  async cancelDelivery() {
    throw new Error('Pargo is not configured.');
  },

  async getDeliveryStatus() {
    throw new Error('Pargo is not configured.');
  }
};

module.exports = pargo;
