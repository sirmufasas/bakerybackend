// delivery/providers/ram.js
// RAM Hand-to-Hand Couriers — trusted South African same-day & express courier.

const { createRateCardProvider } = require('./rateCardProvider');

const ram = createRateCardProvider({
  id: 'ram',
  name: 'RAM Hand-to-Hand Couriers',
  category: 'courier',
  description: 'Hand-to-hand signed delivery across Johannesburg & Pretoria',
  bookingUrl: 'https://www.ram.co.za/',
  serviceType: 'same_day_door_to_door',
  capabilities: ['same_day', 'door_to_door', 'tracking', 'quote'],
  apiKeyEnv: 'RAM_API_KEY',
  zoneFees: { 1: 105, 2: 105, 3: 105, 4: 125, 5: 125, 6: 155 },
  zoneEtas: { 1: [120, 240], 2: [120, 240], 3: [120, 240], 4: [150, 300], 5: [150, 300], 6: [180, 360] }
});

module.exports = ram;
