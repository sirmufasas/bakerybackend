// delivery/providers/mrD.js
// Mr D Express (Takealot Group) — South Africa's local express delivery network (Zones 1–4, <=20km).

const { createRateCardProvider } = require('./rateCardProvider');

const mrD = createRateCardProvider({
  id: 'mr_d',
  name: 'Mr D Express',
  category: 'on_demand',
  description: "SA's local express bike delivery (up to 20km radius)",
  bookingUrl: 'https://www.mrdfood.com/',
  serviceType: 'on_demand_door_to_door',
  capabilities: ['door_to_door', 'on_demand', 'same_day', 'quote', 'tracking'],
  apiKeyEnv: 'MR_D_API_KEY',
  maxZone: 4,
  zoneFees: { 1: 45, 2: 65, 3: 95, 4: 130, 5: 130, 6: 130 },
  zoneEtas: { 1: [25, 40], 2: [30, 45], 3: [35, 55], 4: [45, 65], 5: [45, 65], 6: [45, 65] }
});

module.exports = mrD;
