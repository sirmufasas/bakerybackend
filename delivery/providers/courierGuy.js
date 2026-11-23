// delivery/providers/courierGuy.js
// The Courier Guy — South Africa's leading door-to-door same-day & express parcel courier.

const { createRateCardProvider } = require('./rateCardProvider');

const courierGuy = createRateCardProvider({
  id: 'courier_guy',
  name: 'The Courier Guy',
  category: 'courier',
  description: 'Same-day Gauteng door-to-door courier • Waybill live tracking',
  bookingUrl: 'https://portal.thecourierguy.co.za/',
  serviceType: 'same_day_door_to_door',
  capabilities: ['same_day', 'door_to_door', 'tracking', 'quote'],
  apiKeyEnv: 'COURIER_GUY_API_KEY',
  zoneFees: { 1: 95, 2: 95, 3: 95, 4: 115, 5: 115, 6: 140 },
  zoneEtas: { 1: [120, 240], 2: [120, 240], 3: [120, 240], 4: [150, 300], 5: [150, 300], 6: [180, 360] }
});

module.exports = courierGuy;
