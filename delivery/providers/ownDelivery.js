// delivery/providers/ownDelivery.js
// Portugal Bakery's own in-house zone-based delivery van/driver.
// Safest option for multi-tier cakes, fragile pastries & large catering orders.

const { createRateCardProvider } = require('./rateCardProvider');

const ownDelivery = createRateCardProvider({
  id: 'own_delivery',
  name: 'Portugal Bakery Delivery',
  category: 'in_house',
  description: 'In-house bakery van • Careful handling for cakes & large orders',
  bookingUrl: null,
  serviceType: 'standard',
  capabilities: ['door_to_door', 'standard', 'fragile_cakes', 'bulk_orders', 'tracking_manual'],
  zoneFees: { 1: 150, 2: 200, 3: 350, 4: 400, 5: 450, 6: 500 },
  zoneEtas: { 1: [45, 90], 2: [60, 120], 3: [75, 140], 4: [90, 160], 5: [100, 180], 6: [120, 210] }
});

module.exports = ownDelivery;
