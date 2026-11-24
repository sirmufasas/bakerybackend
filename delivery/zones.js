// delivery/zones.js
// Server-side mirror of src/utils/deliveryZones.ts on the frontend.
// Single source of truth for distance/zone tiers around Portugal Bakery
// (245 Johannesburg Rd, La Rochelle, Johannesburg South, 2190).

const BAKERY_OFFICIAL_ADDRESS = "245 Johannesburg Rd, La Rochelle, Johannesburg South, 2190";
const BAKERY_COORDS = { lat: -26.24144, lng: 28.05526 };

const DELIVERY_ZONES = [
  {
    zoneNumber: 1,
    name: "Zone 1 - Local (0-5km)",
    maxKm: 5,
    fee: 150,
    suburbs: [
      "rosettenville", "la rochelle", "turffontein", "malvern", "denver",
      "johannesburg south", "booysens", "ophirton", "regents park", "the hill",
      "moffat view", "townsview", "robertsham", "reuven", "selby", "wemmer",
      "village main", "springfield", "stafford", "linmeyer", "oakdene"
    ]
  },
  {
    zoneNumber: 2,
    name: "Zone 2 - Near (5-10km)",
    maxKm: 10,
    fee: 200,
    suburbs: [
      "alberton", "meyerton", "germiston", "city deep", "kensington",
      "troyeville", "bertrams", "doornfontein", "jeppestown", "fordsburg",
      "mayfair", "crown mines", "ormonde", "riverlea", "mondeor", "bassonia",
      "gleneagles", "three rivers", "klipriviersberg", "mulbarton", "glenvista",
      "winchester hills", "ridgeway", "suideroord", "southgate", "aeroton",
      "nasrec", "johannesburg cbd", "maboneng", "eloff"
    ]
  },
  {
    zoneNumber: 3,
    name: "Zone 3 - Medium (10-15km)",
    maxKm: 15,
    fee: 350,
    suburbs: [
      "benoni", "boksburg", "brakpan", "springs", "edenvale", "bedfordview",
      "observatory", "yeoville", "berea", "hillbrow", "braamfontein", "newtown",
      "marshalltown", "ferreirasdorp", "pageview", "vrededorp", "westdene",
      "brixton", "crosby", "mayfair west", "bosmont", "newclare", "westbury",
      "coronationville", "langlaagte", "melville", "auckland park", "parktown",
      "houghton", "parkwood", "norwood", "orange grove", "cyrildene", "bellevue",
      "bellevue east", "sydenham", "highlands north", "glenhazel", "lyndhurst",
      "oaklands", "cheltondale", "south hills", "kenilworth", "kibler park",
      "meredale", "rosettenville ext", "eikenhof", "diepkloof", "orlando",
      "soweto", "baragwanath", "pimville"
    ]
  },
  {
    zoneNumber: 4,
    name: "Zone 4 - Far (15-20km)",
    maxKm: 20,
    fee: 400,
    suburbs: [
      "sandton", "randburg", "rosebank", "hyde park", "dunkeld", "illovo",
      "craighall", "parkhurst", "greenside", "emmarentia", "linden", "northcliff",
      "fairland", "roosevelt park", "bordeaux", "blackheath", "ferndale",
      "northgate", "weltevreden park", "roodepoort", "florida", "constantia kloof",
      "wilgeheuwel", "ruimsig", "helderkruin", "honeydew", "randpark ridge",
      "sundowner", "bromhof", "kya sand", "fourways", "sunninghill", "bryanston",
      "morningside", "rivonia", "wendywood", "sandown", "gallo manor", "woodmead",
      "kelvin", "marlboro", "alexandra", "wynberg", "sandton cbd", "meadowlands",
      "dobsonville", "jabulani", "protea glen"
    ]
  },
  {
    zoneNumber: 5,
    name: "Zone 5 - Extended (20-30km)",
    maxKm: 30,
    fee: 450,
    suburbs: [
      "midrand", "kempton park", "isando", "rhodesfield", "bardene", "birchleigh",
      "bonaero park", "chloorkop", "elandsfontein", "spartan", "modderfontein",
      "rabie ridge", "tembisa", "olifantsfontein", "clayville", "witfield",
      "bakerton", "brentwood park", "dawn park", "greenfields", "primrose",
      "zuurbekom", "lenasia", "ennerdale", "orange farm", "walkerville",
      "alberton north", "alrode", "meyersdal", "randhart", "brackenhurst", "kew",
      "eden glen", "norkem park", "greenstone", "founders hill", "linbro park",
      "glen austin", "waterfall", "kyalami", "halfway house", "blue hills",
      "vorna valley", "grand central", "erand"
    ]
  },
  {
    zoneNumber: 6,
    name: "Zone 6 - Very Far (30km+)",
    maxKm: Infinity,
    fee: 500,
    suburbs: [
      "pretoria", "centurion", "krugersdorp", "randfontein", "westonaria",
      "carletonville", "vereeniging", "vanderbijlpark", "sasolburg", "heidelberg",
      "nigel", "soweto outer", "diepsloot", "cosmo city", "chartwell",
      "muldersdrift", "lanseria", "randburg far", "northriding", "olivedale",
      "douglasdale", "paulshof", "dainfern", "cedar lakes", "broadacres",
      "lonehill", "carlswald", "crowthorne", "buccleuch", "bruma",
      "bedford gardens", "bagleyston", "duncanville"
    ]
  }
];

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

function normalize(str) {
  return String(str || "")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

function findAllMatchingZones(address) {
  const normalizedAddress = normalize(address);
  const matches = [];
  for (const zone of DELIVERY_ZONES) {
    for (const suburb of zone.suburbs) {
      if (normalizedAddress.includes(normalize(suburb))) {
        matches.push(zone);
        break;
      }
    }
  }
  return matches;
}

function calculateZoneDetails(address, latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat < -22 &&
    lat > -35 &&
    lng > 16 &&
    lng < 33
  ) {
    // Estimate road distance from straight-line distance (~1.24x urban road factor)
    const estRoadKm = haversineKm(BAKERY_COORDS.lat, BAKERY_COORDS.lng, lat, lng) * 1.24;
    const matchedZone =
      DELIVERY_ZONES.find((z) => estRoadKm <= z.maxKm) || DELIVERY_ZONES[DELIVERY_ZONES.length - 1];
    return {
      fee: matchedZone.fee,
      zone: matchedZone.name,
      found: true,
      zoneNumber: matchedZone.zoneNumber
    };
  }

  const matches = findAllMatchingZones(address);
  if (matches.length === 0) {
    return {
      fee: 500,
      zone: "Zone 6 - Greater Gauteng (Standard Rate)",
      found: false,
      zoneNumber: 6
    };
  }
  const closest = matches[0];
  return {
    fee: closest.fee,
    zone: closest.name,
    found: true,
    zoneNumber: closest.zoneNumber
  };
}

// Returns { fee, zone, found } — backwards-compatible helper.
function calculateZoneFee(address, latitude, longitude) {
  const { fee, zone, found } = calculateZoneDetails(address, latitude, longitude);
  return { fee, zone, found };
}

module.exports = { DELIVERY_ZONES, calculateZoneFee, calculateZoneDetails };
