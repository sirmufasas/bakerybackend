// delivery/providers/localCourier.js
// Neighbourhood Local Motorbike Courier — optional local bike rider (toggleable in Admin).

const { createRateCardProvider } = require('./rateCardProvider');

const localCourier = createRateCardProvider({
  id: 'local_courier',
  name: 'Local Motorbike Courier',
  category: 'on_demand',
  description: 'Direct neighbourhood bike courier for Johannesburg South & nearby suburbs',
  bookingUrl: null,
  serviceType: 'on_demand_door_to_door',
  capabilities: ['on_demand', 'same_day', 'door_to_door', 'manual_dispatch', 'quote'],
  maxZone: 3,
  enabledByDefault: false,
  zoneFees: { 1: 60, 2: 90, 3: 130, 4: 130, 5: 130, 6: 130 },
  zoneEtas: { 1: [25, 45], 2: [35, 55], 3: [45, 70], 4: [45, 70], 5: [45, 70], 6: [45, 70] }
});

module.exports = localCourier;
