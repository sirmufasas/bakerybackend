// delivery/providers/fastway.js
// Fastway Couriers South Africa — affordable regional Gauteng courier.

const { createRateCardProvider } = require('./rateCardProvider');

const fastway = createRateCardProvider({
  id: 'fastway',
  name: 'Fastway Couriers SA',
  category: 'courier',
  description: 'Value regional parcel delivery across Gauteng (rusks, biscuits & hampers)',
  bookingUrl: 'https://www.fastway.co.za/',
  serviceType: 'standard_parcel',
  capabilities: ['standard', 'door_to_door', 'tracking', 'quote'],
  apiKeyEnv: 'FASTWAY_API_KEY',
  zoneFees: { 1: 80, 2: 80, 3: 80, 4: 95, 5: 95, 6: 115 },
  zoneEtas: { 1: [180, 360], 2: [180, 360], 3: [180, 360], 4: [180, 360], 5: [180, 360], 6: [240, 420] }
});

module.exports = fastway;
