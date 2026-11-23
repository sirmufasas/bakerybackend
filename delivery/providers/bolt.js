// delivery/providers/bolt.js
// Bolt Send — popular South African same-day parcel & food courier across Gauteng.

const { createRateCardProvider } = require('./rateCardProvider');

const bolt = createRateCardProvider({
  id: 'bolt',
  name: 'Bolt Send',
  category: 'on_demand',
  description: 'Fast same-day parcel & express delivery across Joburg',
  bookingUrl: 'https://bolt.eu/en-za/',
  serviceType: 'on_demand_door_to_door',
  capabilities: ['door_to_door', 'on_demand', 'same_day', 'quote', 'tracking'],
  apiKeyEnv: 'BOLT_DELIVERY_API_KEY',
  zoneFees: { 1: 55, 2: 85, 3: 120, 4: 160, 5: 210, 6: 285 },
  zoneEtas: { 1: [20, 35], 2: [25, 45], 3: [30, 50], 4: [35, 60], 5: [45, 75], 6: [60, 95] }
});

module.exports = bolt;
