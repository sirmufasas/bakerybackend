// delivery/providers/yassir.js
// Yassir Express — on-demand ride & parcel delivery in South Africa.

const { createRateCardProvider } = require('./rateCardProvider');

const yassir = createRateCardProvider({
  id: 'yassir',
  name: 'Yassir Delivery',
  category: 'on_demand',
  description: 'Express on-demand courier straight to your door',
  bookingUrl: 'https://yassir.com/',
  serviceType: 'on_demand_door_to_door',
  capabilities: ['door_to_door', 'on_demand', 'same_day', 'quote', 'tracking'],
  apiKeyEnv: 'YASSIR_API_KEY',
  zoneFees: { 1: 58, 2: 88, 3: 125, 4: 165, 5: 215, 6: 290 },
  zoneEtas: { 1: [25, 40], 2: [30, 45], 3: [35, 55], 4: [40, 65], 5: [50, 80], 6: [60, 95] }
});

module.exports = yassir;
