// delivery/providers/ownDelivery.js
// Portugal Bakery's own zone-based delivery (the system that already existed
// before this delivery engine was added). Always available - no external
// API/credentials required. Serves as the guaranteed fallback provider.

const { calculateZoneFee } = require('../zones');

const ownDelivery = {
  id: 'own_delivery',
  name: 'Portugal Bakery Delivery',
  serviceType: 'standard',
  capabilities: ['door_to_door', 'standard', 'tracking_manual'],

  isConfigured() {
    return true; // no external credentials needed
  },

  async checkAvailability() {
    return { available: true };
  },

  async getQuote({ address }) {
    const { fee, zone, found } = calculateZoneFee(address);
    return {
      providerId: this.id,
      providerName: this.name,
      fee,
      currency: 'ZAR',
      etaMinutesMin: 60,
      etaMinutesMax: 180,
      zone,
      addressRecognized: found,
      serviceType: this.serviceType,
      quoteId: null // no external quote to expire/redeem
    };
  },

  // No external API call - order stays with own_delivery until staff
  // manually update its status. Returns a shape consistent with the other
  // providers so the calling code doesn't need to special-case this one.
  async createDelivery(order) {
    return {
      providerDeliveryId: null,
      trackingUrl: null,
      status: 'courier_requested',
      raw: { note: 'Own delivery - dispatched manually by bakery staff, no external courier API involved.' }
    };
  },

  async cancelDelivery() {
    return { cancelled: true };
  },

  async getDeliveryStatus() {
    return { status: 'unknown', note: 'Own delivery has no external tracking - update status manually.' };
  }
};

module.exports = ownDelivery;
