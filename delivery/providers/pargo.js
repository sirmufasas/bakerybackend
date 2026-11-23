// delivery/providers/pargo.js
// Pargo Click & Collect — pickup points at Clicks, Spar, Caltex & Lewis stores across SA.

const { createRateCardProvider } = require('./rateCardProvider');

const pargo = createRateCardProvider({
  id: 'pargo',
  name: 'Pargo Pickup Point',
  category: 'pickup_point',
  description: 'Click & Collect at Clicks, Spar, Caltex & partner stores nationwide',
  bookingUrl: 'https://pargo.co.za/',
  serviceType: 'pickup_point',
  capabilities: ['standard', 'pickup_point', 'click_and_collect', 'tracking', 'quote'],
  apiKeyEnv: 'PARGO_API_KEY',
  zoneFees: { 1: 69, 2: 69, 3: 69, 4: 69, 5: 85, 6: 85 },
  zoneEtas: { 1: [180, 420], 2: [180, 420], 3: [180, 420], 4: [180, 420], 5: [240, 480], 6: [240, 480] }
});

module.exports = pargo;
