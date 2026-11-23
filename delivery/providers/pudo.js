// delivery/providers/pudo.js
// PUDO Locker (by The Courier Guy) — 24/7 smart parcel lockers across South Africa.

const { createRateCardProvider } = require('./rateCardProvider');

const basePudo = createRateCardProvider({
  id: 'pudo',
  name: 'PUDO Smart Locker',
  category: 'pickup_point',
  description: 'Collect 24/7 from your nearest PUDO locker (best for biscuits, rusks & gifts)',
  bookingUrl: 'https://www.pudo.co.za/',
  serviceType: 'pickup_point',
  capabilities: ['pickup_point', 'standard', 'tracking', 'quote'],
  apiKeyEnv: 'PUDO_API_KEY',
  zoneFees: { 1: 60, 2: 60, 3: 60, 4: 60, 5: 75, 6: 75 },
  zoneEtas: { 1: [180, 360], 2: [180, 360], 3: [180, 360], 4: [180, 360], 5: [240, 480], 6: [240, 480] }
});

const pudo = {
  ...basePudo,
  async getNearbyPickupPoints() {
    return {
      points: [],
      reason: 'Customer specifies preferred PUDO locker name or nearest shopping centre at checkout.'
    };
  }
};

module.exports = pudo;
