// delivery/providers/rateCardProvider.js
//
// Shared operational adapter factory for South African delivery providers.
// Supports dual-mode operation:
//  1. Immediate operational mode (active today): calculates accurate ZAR
//     zone-based quotes for customer checkout and supports staff dispatch
//     (booking via the provider's app/web portal and attaching live trip
//     tracking links + driver/waybill details to the order).
//  2. Direct API mode: automatically reports `dispatchMode: 'live_api'`
//     when provider API credentials are present in environment variables.

const { calculateZoneDetails } = require('../zones');
const { computeRealisticProviderEta } = require('../eta');

function createRateCardProvider(config) {
  const {
    id,
    name,
    category,          // 'in_house' | 'on_demand' | 'courier' | 'pickup_point'
    description,
    bookingUrl,
    serviceType,
    capabilities = [],
    apiKeyEnv,         // optional env var name for direct API credentials
    maxZone = 6,       // e.g. Mr D only covers Zones 1-4 (<=20km)
    zoneFees,          // { 1: number, 2: number, 3: number, 4: number, 5: number, 6: number }
    zoneEtas,          // { 1: [min, max], ... } in minutes
    enabledByDefault = true
  } = config;

  return {
    id,
    name,
    category,
    description,
    bookingUrl: bookingUrl || null,
    serviceType,
    capabilities,
    enabledByDefault,

    hasLiveApiCredentials() {
      if (!apiKeyEnv) return false;
      if (Array.isArray(apiKeyEnv)) {
        return apiKeyEnv.every(envName => Boolean(process.env[envName]));
      }
      return Boolean(process.env[apiKeyEnv]);
    },

    getDispatchMode() {
      if (id === 'own_delivery') return 'in_house';
      return this.hasLiveApiCredentials() ? 'live_api' : 'managed_dispatch';
    },

    // Operational immediately via Gauteng zone rate card + staff/portal dispatch.
    isConfigured() {
      return true;
    },

    async checkAvailability({ address, latitude, longitude }) {
      const { zoneNumber } = calculateZoneDetails(address, latitude, longitude);
      if (zoneNumber > maxZone) {
        return {
          available: false,
          reason: `${name} only delivers within Zones 1–${maxZone} from La Rochelle.`
        };
      }
      return { available: true };
    },

    async getQuote({ address, latitude, longitude, items = [] }) {
      const { zone, found, zoneNumber } = calculateZoneDetails(address, latitude, longitude);
      if (zoneNumber > maxZone) return null;

      const fee = zoneFees[zoneNumber] ?? zoneFees[6];
      const itemCount = Array.isArray(items)
        ? items.reduce((sum, it) => sum + (Number(it?.quantity) || 1), 0)
        : 2;

      const liveEta = computeRealisticProviderEta({
        providerId: this.id,
        zoneNumber,
        latitude,
        longitude,
        itemCount,
      });

      return {
        providerId: this.id,
        providerName: this.name,
        category: this.category,
        description: this.description,
        bookingUrl: this.bookingUrl,
        dispatchMode: this.getDispatchMode(),
        fee,
        currency: 'ZAR',
        etaMinutesMin: liveEta.etaMinutesMin,
        etaMinutesMax: liveEta.etaMinutesMax,
        driveMinutes: liveEta.driveMinutes,
        prepMinutes: liveEta.prepMinutes,
        pickupMinutes: liveEta.pickupMinutes,
        trafficLabel: liveEta.trafficLabel,
        storeOpenNow: liveEta.storeOpenNow,
        estimatedArrivalStart: liveEta.estimatedArrivalStart,
        estimatedArrivalEnd: liveEta.estimatedArrivalEnd,
        zone,
        addressRecognized: found,
        serviceType: this.serviceType,
        quoteId: `${this.id}_z${zoneNumber}_${fee}`
      };
    },

    async createDelivery(order) {
      return {
        providerDeliveryId: `${this.id.toUpperCase()}-${order.orderNumber}`,
        trackingUrl: null,
        status: 'courier_requested',
        raw: {
          provider: this.name,
          dispatchMode: this.getDispatchMode(),
          bookingUrl: this.bookingUrl,
          note: `Dispatch initiated via ${this.name}. Attach live trip link or waybill once driver is assigned.`
        }
      };
    },

    async cancelDelivery() {
      return { cancelled: true };
    },

    async getDeliveryStatus() {
      return {
        status: 'courier_requested',
        note: `Managed via ${this.name} dispatch.`
      };
    }
  };
}

module.exports = { createRateCardProvider };
