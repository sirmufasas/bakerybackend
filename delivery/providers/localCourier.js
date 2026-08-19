// delivery/providers/localCourier.js
//
// Architecture-only stub for a future local Johannesburg motorbike courier.
// No provider has been selected yet, so this never fabricates an
// integration. Disabled by default (see delivery_settings in the DB).
// Once a real provider/API is chosen, either wire up their API here the
// same way uberDirect.js does, or implement the "manual dispatch" flow:
// staff click REQUEST LOCAL COURIER and the system records a delivery
// request with the order's details for a human to action by phone/app.

const localCourier = {
  id: 'local_courier',
  name: 'Local Motorbike Courier',
  serviceType: 'on_demand_door_to_door',
  capabilities: ['on_demand', 'same_day', 'door_to_door', 'manual_dispatch'],

  isConfigured() {
    // Manual dispatch doesn't need API credentials, but the provider must
    // still be explicitly enabled in delivery settings before it's offered.
    return false;
  },

  async checkAvailability() {
    return { available: false, reason: 'No local courier provider selected yet.' };
  },

  async getQuote() {
    return null;
  },

  // Manual-dispatch flow: record the request, no external API call.
  async createDelivery(order) {
    return {
      providerDeliveryId: null,
      trackingUrl: null,
      status: 'courier_requested',
      raw: { note: `Manual dispatch requested for order ${order.orderNumber} - contact local courier directly.` }
    };
  },

  async cancelDelivery() {
    return { cancelled: true };
  },

  async getDeliveryStatus() {
    return { status: 'unknown', note: 'Local courier has no API tracking - update status manually.' };
  }
};

module.exports = localCourier;
