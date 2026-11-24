// delivery/eta.js
// Real-time, traffic-aware South African (Africa/Johannesburg) ETA calculator
// for Portugal Bakery (245 Johannesburg Rd, La Rochelle, Johannesburg South, 2190).

const { BAKERY_COORDS } = require('./zones');

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function getJHBClockParts(date = new Date()) {
  // Africa/Johannesburg is permanently UTC+2 (SAST, no DST)
  const sastMs = date.getTime() + 2 * 3600 * 1000;
  const d = new Date(sastMs);
  return {
    dayOfWeek: d.getUTCDay(), // 0 = Sun, 1 = Mon ... 6 = Sat
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    minutesOfDay: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

function getLiveJhbTraffic(date = new Date()) {
  const { dayOfWeek, minutesOfDay } = getJHBClockParts(date);
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  const isFriday = dayOfWeek === 5;
  const isSaturday = dayOfWeek === 6;

  if (isWeekday && minutesOfDay >= 6 * 60 + 45 && minutesOfDay <= 9 * 60) {
    return { factor: 1.42, label: 'Heavy morning traffic' };
  }
  if (isFriday && minutesOfDay >= 14 * 60 && minutesOfDay <= 18 * 60 + 15) {
    return { factor: 1.54, label: 'Friday peak traffic' };
  }
  if (isWeekday && minutesOfDay >= 15 * 60 && minutesOfDay <= 18 * 60 + 15) {
    return { factor: 1.46, label: 'Peak afternoon traffic' };
  }
  if (isWeekday && minutesOfDay >= 12 * 60 + 30 && minutesOfDay <= 14 * 60 + 15) {
    return { factor: 1.22, label: 'Moderate midday traffic' };
  }
  if (isSaturday && minutesOfDay >= 8 * 60 + 30 && minutesOfDay <= 13 * 60) {
    return { factor: 1.18, label: 'Busy Saturday roads' };
  }
  return { factor: 1.12, label: 'Light traffic' };
}

/**
 * Portugal Bakery Hours (SAST):
 *  - Mon–Fri: 06:45 – 16:00
 *  - Sat:     06:45 – 14:00
 *  - Sun:     Closed
 */
function getBakeryDispatchStart(now = new Date()) {
  const { dayOfWeek, minutesOfDay } = getJHBClockParts(now);
  const openMin = 6 * 60 + 45; // 06:45
  const closeMin = dayOfWeek === 6 ? 14 * 60 : 16 * 60; // Sat 14:00, Mon-Fri 16:00

  if (dayOfWeek !== 0 && minutesOfDay >= openMin && minutesOfDay < closeMin - 15) {
    return { storeOpenNow: true, dispatchBaseDate: now };
  }

  // Advance day-by-day in SAST until next open morning at 06:45
  for (let addDays = 0; addDays <= 3; addDays++) {
    const candidateSastMs = now.getTime() + 2 * 3600 * 1000 + addDays * 86400 * 1000;
    const cand = new Date(candidateSastMs);
    const candDow = cand.getUTCDay();
    if (candDow === 0) continue; // Sunday closed
    if (addDays === 0 && minutesOfDay >= openMin) continue; // Already past today's close

    // Construct 06:45 SAST on that day in UTC
    const openUtcMs =
      Date.UTC(cand.getUTCFullYear(), cand.getUTCMonth(), cand.getUTCDate(), 6, 45, 0) -
      2 * 3600 * 1000;
    return { storeOpenNow: false, dispatchBaseDate: new Date(openUtcMs) };
  }

  return { storeOpenNow: false, dispatchBaseDate: now };
}

const PROVIDER_DISPATCH_PROFILES = {
  uber_direct: { prepMin: 8, prepMax: 11, pickupMin: 5, pickupMax: 9, speedKmh: 38, mode: 'on_demand' },
  bolt: { prepMin: 8, prepMax: 11, pickupMin: 6, pickupMax: 10, speedKmh: 38, mode: 'on_demand' },
  mr_d: { prepMin: 8, prepMax: 12, pickupMin: 6, pickupMax: 11, speedKmh: 35, mode: 'on_demand' },
  indrive: { prepMin: 8, prepMax: 12, pickupMin: 7, pickupMax: 13, speedKmh: 36, mode: 'on_demand' },
  yassir: { prepMin: 8, prepMax: 12, pickupMin: 7, pickupMax: 13, speedKmh: 36, mode: 'on_demand' },
  local_courier: { prepMin: 8, prepMax: 12, pickupMin: 7, pickupMax: 12, speedKmh: 35, mode: 'on_demand' },
  droppa: { prepMin: 10, prepMax: 15, pickupMin: 14, pickupMax: 24, speedKmh: 34, mode: 'van' },
  own_delivery: { prepMin: 10, prepMax: 15, pickupMin: 12, pickupMax: 22, speedKmh: 34, mode: 'van' },
  courier_guy: { prepMin: 12, prepMax: 18, pickupMin: 35, pickupMax: 75, speedKmh: 32, mode: 'same_day_hub' },
  ram: { prepMin: 12, prepMax: 18, pickupMin: 40, pickupMax: 85, speedKmh: 32, mode: 'same_day_hub' },
  aramex: { prepMin: 12, prepMax: 18, pickupMin: 40, pickupMax: 85, speedKmh: 32, mode: 'same_day_hub' },
  fastway: { prepMin: 12, prepMax: 18, pickupMin: 45, pickupMax: 95, speedKmh: 30, mode: 'same_day_hub' },
  pudo: { prepMin: 12, prepMax: 18, pickupMin: 45, pickupMax: 95, speedKmh: 32, mode: 'locker' },
  pargo: { prepMin: 12, prepMax: 18, pickupMin: 50, pickupMax: 105, speedKmh: 32, mode: 'locker' },
};

const ZONE_AVG_ROAD_KM = { 1: 2.8, 2: 7.5, 3: 12.5, 4: 17.5, 5: 24.5, 6: 35.0 };

function computeRealisticProviderEta({
  providerId,
  zoneNumber = 2,
  latitude,
  longitude,
  roadDistanceKm,
  osrmDurationSeconds,
  itemCount = 2,
  now = new Date(),
}) {
  const profile = PROVIDER_DISPATCH_PROFILES[providerId] || PROVIDER_DISPATCH_PROFILES.own_delivery;
  const { storeOpenNow, dispatchBaseDate } = getBakeryDispatchStart(now);
  const traffic = getLiveJhbTraffic(dispatchBaseDate);

  let distKm = Number(roadDistanceKm);
  if (!Number.isFinite(distKm) || distKm <= 0) {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat < -22 && lat > -35) {
      distKm = Math.max(0.4, haversineKm(BAKERY_COORDS.lat, BAKERY_COORDS.lng, lat, lng) * 1.26);
    } else {
      distKm = ZONE_AVG_ROAD_KM[zoneNumber] || 10;
    }
  }

  // Free-flow drive minutes + JHB traffic-light/intersection buffer + gate handover (2.5m)
  let baseDriveMin;
  if (Number.isFinite(osrmDurationSeconds) && osrmDurationSeconds > 0) {
    const intersectionBufferMin = Math.min(8, Math.max(1.2, distKm * 0.35));
    baseDriveMin = osrmDurationSeconds / 60 + intersectionBufferMin;
  } else {
    baseDriveMin = (distKm / profile.speedKmh) * 60 + Math.min(6, distKm * 0.25);
  }

  const trafficDriveMin = Math.max(3, Math.round(baseDriveMin * traffic.factor + 2));
  const extraItemsPrep = Math.min(8, Math.max(0, Math.floor((itemCount - 3) / 3) * 2));
  const prepMin = profile.prepMin + extraItemsPrep;
  const prepMax = profile.prepMax + extraItemsPrep + 2;

  const pickupFactor = profile.mode === 'on_demand' ? Math.max(1, (traffic.factor - 1) * 0.6 + 1) : 1;
  const pickupMin = Math.round(profile.pickupMin * pickupFactor);
  const pickupMax = Math.round(profile.pickupMax * pickupFactor);

  const etaMinutesMin = prepMin + pickupMin + trafficDriveMin;
  const etaMinutesMax = prepMax + pickupMax + Math.round(trafficDriveMin * 1.16) + 2;

  const arrivalStart = new Date(dispatchBaseDate.getTime() + etaMinutesMin * 60000);
  const arrivalEnd = new Date(dispatchBaseDate.getTime() + etaMinutesMax * 60000);

  return {
    etaMinutesMin,
    etaMinutesMax,
    driveMinutes: trafficDriveMin,
    prepMinutes: Math.round((prepMin + prepMax) / 2),
    pickupMinutes: Math.round((pickupMin + pickupMax) / 2),
    trafficFactor: traffic.factor,
    trafficLabel: traffic.label,
    storeOpenNow,
    estimatedArrivalStart: arrivalStart.toISOString(),
    estimatedArrivalEnd: arrivalEnd.toISOString(),
  };
}

module.exports = {
  getLiveJhbTraffic,
  getBakeryDispatchStart,
  computeRealisticProviderEta,
};
