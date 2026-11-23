// delivery/providers/inDrive.js
// inDrive Couriers — budget-friendly on-demand door-to-door courier in South Africa.

const { createRateCardProvider } = require('./rateCardProvider');

const inDrive = createRateCardProvider({
  id: 'indrive',
  name: 'inDrive Couriers',
  category: 'on_demand',
  description: 'Affordable on-demand door-to-door courier across Gauteng',
  bookingUrl: 'https://delivery.indrive.com/',
  serviceType: 'on_demand_door_to_door',
  capabilities: ['door_to_door', 'on_demand', 'same_day', 'quote', 'tracking'],
  apiKeyEnv: 'INDRIVE_API_KEY',
  zoneFees: { 1: 50, 2: 78, 3: 110, 4: 145, 5: 195, 6: 260 },
  zoneEtas: { 1: [25, 45], 2: [30, 50], 3: [35, 55], 4: [40, 65], 5: [50, 80], 6: [65, 100] }
});

module.exports = inDrive;
