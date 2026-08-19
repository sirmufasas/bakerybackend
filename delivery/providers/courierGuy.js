// delivery/providers/courierGuy.js
//
// Architecture-only stub. The Courier Guy's current API/integration
// requirements have not been reviewed and no credentials are configured, so
// this adapter never makes a live API call or fabricates a quote/status.
// Wire this up for real once TCG_API_KEY (or whatever their docs specify)
// is available and their current endpoint/auth scheme has been confirmed.

const courierGuy = {
  id: 'courier_guy',
  name: 'The Courier Guy',
  serviceType: 'same_day_door_to_door',
  capabilities: ['same_day', 'door_to_door', 'tracking', 'quote'],

  isConfigured() {
    return Boolean(process.env.COURIER_GUY_API_KEY);
  },

  async checkAvailability() {
    return { available: false, reason: 'Provider integration configured but awaiting credentials.' };
  },

  async getQuote() {
    return null; // never fabricate a quote
  },

  async createDelivery() {
    throw new Error('The Courier Guy is not configured - missing credentials/API access.');
  },

  async cancelDelivery() {
    throw new Error('The Courier Guy is not configured.');
  },

  async getDeliveryStatus() {
    throw new Error('The Courier Guy is not configured.');
  }
};

module.exports = courierGuy;
