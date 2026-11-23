// delivery/providers/droppa.js
// Droppa — South African on-demand motorbike, car & van courier (ideal for larger bakery/catering boxes).

const { createRateCardProvider } = require('./rateCardProvider');

const droppa = createRateCardProvider({
  id: 'droppa',
  name: 'Droppa Express',
  category: 'on_demand',
  description: 'SA on-demand car & van delivery • Great for cakes & catering trays',
  bookingUrl: 'https://www.droppa.co.za/',
  serviceType: 'on_demand_door_to_door',
  capabilities: ['door_to_door', 'on_demand', 'same_day', 'fragile_cakes', 'bulk_orders', 'quote', 'tracking'],
  apiKeyEnv: 'DROPPA_API_KEY',
  zoneFees: { 1: 85, 2: 115, 3: 155, 4: 195, 5: 250, 6: 330 },
  zoneEtas: { 1: [35, 55], 2: [40, 65], 3: [45, 75], 4: [55, 85], 5: [65, 95], 6: [75, 120] }
});

module.exports = droppa;
