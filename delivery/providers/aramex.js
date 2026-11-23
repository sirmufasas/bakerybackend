// delivery/providers/aramex.js
// Aramex South Africa — reliable store-to-door & express parcel delivery.

const { createRateCardProvider } = require('./rateCardProvider');

const aramex = createRateCardProvider({
  id: 'aramex',
  name: 'Aramex South Africa',
  category: 'courier',
  description: 'Express store-to-door parcel courier across Gauteng & SA',
  bookingUrl: 'https://www.aramex.co.za/',
  serviceType: 'standard_parcel',
  capabilities: ['standard', 'door_to_door', 'tracking', 'quote'],
  apiKeyEnv: 'ARAMEX_API_KEY',
  zoneFees: { 1: 99, 2: 99, 3: 99, 4: 99, 5: 120, 6: 120 },
  zoneEtas: { 1: [180, 360], 2: [180, 360], 3: [180, 360], 4: [180, 360], 5: [240, 420], 6: [240, 420] }
});

module.exports = aramex;
