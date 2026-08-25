// delivery/providers/inDrive.js
//
// Architecture-only stub. inDrive runs a real delivery/freight service in
// South Africa (inDrive.Freight, same-day on-demand, door-to-door) with a
// B2B storefront integration offering at delivery.indrive.com. However,
// unlike Uber Direct, inDrive does not publish a fully public self-serve
// developer API - the B2B integration is a business partnership you apply
// for through their delivery team. No live API calls are made until
// INDRIVE_API_KEY (or whatever their business integration team specifies
// once the partnership is set up) is configured and their actual current
// integration requirements have been reviewed.

const inDrive = {
  id: 'indrive',
  name: 'inDrive',
  serviceType: 'on_demand_door_to_door',
  capabilities: ['door_to_door', 'on_demand', 'same_day', 'quote', 'tracking'],

  isConfigured() {
    return Boolean(process.env.INDRIVE_API_KEY);
  },

  async checkAvailability() {
    return { available: false, reason: 'Provider integration configured but awaiting credentials - requires a business partnership application via delivery.indrive.com.' };
  },

  async getQuote() {
    return null;
  },

  async createDelivery() {
    throw new Error('inDrive is not configured - missing credentials/business API access.');
  },

  async cancelDelivery() {
    throw new Error('inDrive is not configured.');
  },

  async getDeliveryStatus() {
    throw new Error('inDrive is not configured.');
  }
};

module.exports = inDrive;
