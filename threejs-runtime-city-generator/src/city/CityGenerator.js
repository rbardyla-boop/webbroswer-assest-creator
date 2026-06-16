import { createCityConfig, getCityPreset, getZoneStyle } from "./CityConfig.js";
import { createCityDocument } from "./CityDocument.js";
import { clamp, lerp } from "../utils/math.js";

export function stringToSeed(value) {
  let h = 2166136261 >>> 0;
  const s = String(value);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32Local(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function jitter(rng, amount) {
  return (rng() * 2 - 1) * amount;
}

function choice(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function rectContains(rect, x, z, pad = 0) {
  return x >= rect.x - rect.w / 2 + pad && x <= rect.x + rect.w / 2 - pad &&
         z >= rect.z - rect.d / 2 + pad && z <= rect.z + rect.d / 2 - pad;
}

function addZone(zones, type, label, x, z, w, d, yaw = 0) {
  zones.push({ id: `zone-${zones.length}-${type}`, type, label, x: round2(x), z: round2(z), w: round2(w), d: round2(d), yaw: round2(yaw) });
}

function generateZonePlan(style, preset, rng) {
  const ox = preset.origin.x;
  const oz = preset.origin.z;
  const j = preset.blockJitter;
  const zones = [];

  if (style === "urban") {
    addZone(zones, "downtown", "Downtown Core", ox + jitter(rng, j), oz + jitter(rng, j), 104, 82);
    addZone(zones, "residential", "North Residential", ox - 98 + jitter(rng, j), oz - 26 + jitter(rng, j), 86, 112);
    addZone(zones, "residential", "East Residential", ox + 102 + jitter(rng, j), oz - 15 + jitter(rng, j), 86, 106);
    addZone(zones, "industrial", "Industrial Yard", ox - 18 + jitter(rng, j), oz + 105 + jitter(rng, j), 126, 72);
    addZone(zones, "park", "Civic Park", ox + 78 + jitter(rng, j), oz + 88 + jitter(rng, j), 58, 56);
    addZone(zones, "science", "Research Campus", ox - 128 + jitter(rng, j), oz + 102 + jitter(rng, j), 64, 66);
    addZone(zones, "airport", "Municipal Airstrip", ox + 12 + jitter(rng, j), oz + 186 + jitter(rng, j), 172, 44, 0.04 + jitter(rng, 0.05));
    return zones;
  }

  if (style === "outpost") {
    addZone(zones, "military", "Forward Outpost", ox + jitter(rng, j), oz + jitter(rng, j), 118, 88);
    addZone(zones, "science", "Science Camp", ox - 106 + jitter(rng, j), oz + 72 + jitter(rng, j), 76, 68);
    addZone(zones, "drilling", "Drilling Site", ox + 118 + jitter(rng, j), oz + 70 + jitter(rng, j), 82, 70);
    addZone(zones, "airport", "STOL Airstrip", ox + 12 + jitter(rng, j), oz + 160 + jitter(rng, j), 190, 42, jitter(rng, 0.08));
    addZone(zones, "village", "Service Village", ox - 82 + jitter(rng, j), oz - 88 + jitter(rng, j), 84, 64);
    addZone(zones, "rural", "Rural Buffer", ox + 96 + jitter(rng, j), oz - 94 + jitter(rng, j), 92, 82);
    addZone(zones, "park", "Windbreak Park", ox - 150 + jitter(rng, j), oz - 35 + jitter(rng, j), 48, 70);
    return zones;
  }

  if (style === "village") {
    addZone(zones, "village", "Village Main", ox + jitter(rng, j), oz + jitter(rng, j), 108, 72);
    addZone(zones, "rural", "West Farms", ox - 112 + jitter(rng, j), oz + 10 + jitter(rng, j), 92, 116);
    addZone(zones, "rural", "East Farms", ox + 116 + jitter(rng, j), oz + 2 + jitter(rng, j), 96, 116);
    addZone(zones, "park", "Commons", ox + 4 + jitter(rng, j), oz - 88 + jitter(rng, j), 70, 56);
    addZone(zones, "drilling", "Resource Pad", ox + 146 + jitter(rng, j), oz + 118 + jitter(rng, j), 60, 52);
    addZone(zones, "airport", "Grass Airfield", ox - 48 + jitter(rng, j), oz + 142 + jitter(rng, j), 150, 34, jitter(rng, 0.06));
    return zones;
  }

  addZone(zones, "downtown", "City Core", ox + jitter(rng, j), oz + jitter(rng, j), 86, 64);
  addZone(zones, "residential", "Residential", ox - 94 + jitter(rng, j), oz - 18 + jitter(rng, j), 78, 88);
  addZone(zones, "industrial", "Industrial", ox + 94 + jitter(rng, j), oz + 18 + jitter(rng, j), 72, 78);
  addZone(zones, "park", "Central Park", ox - 4 + jitter(rng, j), oz + 76 + jitter(rng, j), 68, 54);
  addZone(zones, "village", "Village Edge", ox - 132 + jitter(rng, j), oz + 106 + jitter(rng, j), 72, 62);
  addZone(zones, "military", "Outpost", ox + 138 + jitter(rng, j), oz - 82 + jitter(rng, j), 76, 64);
  addZone(zones, "science", "Science Campus", ox - 60 + jitter(rng, j), oz - 116 + jitter(rng, j), 70, 62);
  addZone(zones, "drilling", "Drilling Pad", ox + 138 + jitter(rng, j), oz + 104 + jitter(rng, j), 64, 58);
  addZone(zones, "airport", "Small Airport", ox + 12 + jitter(rng, j), oz + 172 + jitter(rng, j), 172, 38, jitter(rng, 0.06));
  return zones;
}

function generateRoads(zones, cfg, preset, rng) {
  const roads = [];
  const sidewalks = [];
  const minX = Math.min(...zones.map((z) => z.x - z.w / 2)) - 16;
  const maxX = Math.max(...zones.map((z) => z.x + z.w / 2)) + 16;
  const minZ = Math.min(...zones.map((z) => z.z - z.d / 2)) - 16;
  const maxZ = Math.max(...zones.map((z) => z.z + z.d / 2)) + 16;

  const addRoad = (x, z, w, d, kind = "local", yaw = 0) => {
    roads.push({ id: `road-${roads.length}`, kind, x: round2(x), z: round2(z), w: round2(w), d: round2(d), yaw: round2(yaw) });
    const side = kind === "arterial" ? cfg.sidewalkWidth * 1.25 : cfg.sidewalkWidth;
    if (w >= d) {
      sidewalks.push({ id: `sidewalk-${sidewalks.length}`, x: round2(x), z: round2(z - d / 2 - side / 2), w: round2(w), d: round2(side), yaw });
      sidewalks.push({ id: `sidewalk-${sidewalks.length}`, x: round2(x), z: round2(z + d / 2 + side / 2), w: round2(w), d: round2(side), yaw });
    } else {
      sidewalks.push({ id: `sidewalk-${sidewalks.length}`, x: round2(x - w / 2 - side / 2), z: round2(z), w: round2(side), d: round2(d), yaw });
      sidewalks.push({ id: `sidewalk-${sidewalks.length}`, x: round2(x + w / 2 + side / 2), z: round2(z), w: round2(side), d: round2(d), yaw });
    }
  };

  const xs = new Set();
  const zs = new Set();
  for (const zone of zones) {
    xs.add(Math.round((zone.x + jitter(rng, preset.blockJitter * 0.5)) / preset.roadStep) * preset.roadStep);
    zs.add(Math.round((zone.z + jitter(rng, preset.blockJitter * 0.5)) / preset.roadStep) * preset.roadStep);
  }
  xs.add(Math.round((preset.origin.x) / preset.arterialStep) * preset.arterialStep);
  zs.add(Math.round((preset.origin.z) / preset.arterialStep) * preset.arterialStep);

  for (const x of [...xs].sort((a, b) => a - b)) {
    const arterial = Math.abs(x - preset.origin.x) < preset.roadStep * 0.6;
    addRoad(x + jitter(rng, 2), (minZ + maxZ) / 2, arterial ? cfg.arterialWidth : cfg.roadWidth, maxZ - minZ, arterial ? "arterial" : "local");
  }
  for (const z of [...zs].sort((a, b) => a - b)) {
    const arterial = Math.abs(z - preset.origin.z) < preset.roadStep * 0.6;
    addRoad((minX + maxX) / 2, z + jitter(rng, 2), maxX - minX, arterial ? cfg.arterialWidth : cfg.roadWidth, arterial ? "arterial" : "local");
  }

  for (const zone of zones) {
    if (zone.type === "airport") {
      roads.push({ id: `road-${roads.length}`, kind: "runway", x: zone.x, z: zone.z, w: zone.w * 0.9, d: Math.min(14, zone.d * 0.42), yaw: zone.yaw || 0 });
    }
  }

  return { roads, sidewalks };
}

function generateBuildingsAndProps(zones, cfg, preset, rng) {
  const buildings = [];
  const props = [];
  const globalDensity = preset.density;
  const addProp = (type, x, z, w, d, h, yaw = 0) => {
    if (props.length < cfg.maxProps) props.push({ id: `prop-${props.length}-${type}`, type, x: round2(x), z: round2(z), w: round2(w), d: round2(d), h: round2(h), yaw: round2(yaw) });
  };

  for (const zone of zones) {
    const style = getZoneStyle(zone.type);
    const density = clamp(style.density * globalDensity, 0.04, 0.9);
    const cell = zone.type === "downtown" ? 16 : zone.type === "rural" ? 26 : 20;
    const cols = Math.max(1, Math.floor(zone.w / cell));
    const rows = Math.max(1, Math.floor(zone.d / cell));

    for (let ix = 0; ix < cols; ix++) {
      for (let iz = 0; iz < rows; iz++) {
        if (rng() > density || buildings.length >= cfg.maxBuildings) continue;
        const px = zone.x - zone.w / 2 + (ix + 0.5) * (zone.w / cols) + jitter(rng, 3.5);
        const pz = zone.z - zone.d / 2 + (iz + 0.5) * (zone.d / rows) + jitter(rng, 3.5);
        if (!rectContains(zone, px, pz, cfg.zonePad + 3)) continue;
        const fw = lerp(style.footprint[0], style.footprint[1], rng());
        const fd = lerp(style.footprint[0], style.footprint[1], rng());
        const h = lerp(style.height[0], style.height[1], Math.pow(rng(), zone.type === "downtown" ? 0.55 : 1.2));
        buildings.push({
          id: `building-${buildings.length}-${zone.type}`,
          zoneId: zone.id,
          type: zone.type,
          x: round2(px),
          z: round2(pz),
          w: round2(fw),
          d: round2(fd),
          h: round2(h),
          yaw: round2((rng() < 0.78 ? 0 : Math.PI / 2) + jitter(rng, 0.08)),
          tint: round2(rng()),
        });
      }
    }

    if (zone.type === "park" || zone.type === "rural" || zone.type === "village") {
      const trees = Math.floor((zone.w * zone.d) / (zone.type === "park" ? 90 : 160));
      for (let i = 0; i < trees; i++) {
        addProp("tree", zone.x + jitter(rng, zone.w * 0.42), zone.z + jitter(rng, zone.d * 0.42), 2.2 + rng() * 1.8, 2.2 + rng() * 1.8, 5 + rng() * 6, rng() * Math.PI * 2);
      }
    }

    if (zone.type === "military") {
      for (let i = 0; i < 7; i++) addProp("barrier", zone.x + jitter(rng, zone.w * 0.45), zone.z + jitter(rng, zone.d * 0.45), 7 + rng() * 9, 1.4, 1.5, rng() * Math.PI);
      addProp("tower", zone.x + zone.w * 0.34, zone.z - zone.d * 0.34, 5, 5, 16, 0);
      addProp("tower", zone.x - zone.w * 0.34, zone.z + zone.d * 0.34, 5, 5, 16, 0);
    }

    if (zone.type === "science") {
      for (let i = 0; i < 5; i++) addProp("dish", zone.x + jitter(rng, zone.w * 0.36), zone.z + jitter(rng, zone.d * 0.36), 5 + rng() * 4, 5 + rng() * 4, 8 + rng() * 5, rng() * Math.PI * 2);
    }

    if (zone.type === "drilling") {
      addProp("derrick", zone.x, zone.z, 10, 10, 24, 0);
      for (let i = 0; i < 4; i++) addProp("tank", zone.x + jitter(rng, zone.w * 0.33), zone.z + jitter(rng, zone.d * 0.33), 7, 7, 8 + rng() * 4, 0);
    }

    if (zone.type === "airport") {
      addProp("hangar", zone.x - zone.w * 0.32, zone.z + zone.d * 0.3, 24, 16, 8, zone.yaw || 0);
      addProp("tower", zone.x + zone.w * 0.34, zone.z + zone.d * 0.24, 7, 7, 18, 0);
      addProp("beacon", zone.x + zone.w * 0.43, zone.z - zone.d * 0.2, 4, 4, 11, 0);
    }
  }
  return { buildings, props };
}

function indexChunks(layout, chunkSize) {
  const chunks = new Map();
  const ensure = (x, z) => {
    const cx = Math.floor(x / chunkSize);
    const cz = Math.floor(z / chunkSize);
    const key = `${cx},${cz}`;
    let chunk = chunks.get(key);
    if (!chunk) {
      chunk = { id: key, cx, cz, center: { x: (cx + 0.5) * chunkSize, z: (cz + 0.5) * chunkSize }, zones: [], roads: [], sidewalks: [], buildings: [], props: [] };
      chunks.set(key, chunk);
    }
    return chunk;
  };
  for (const zone of layout.zones) ensure(zone.x, zone.z).zones.push(zone);
  for (const road of layout.roads) ensure(road.x, road.z).roads.push(road);
  for (const sidewalk of layout.sidewalks) ensure(sidewalk.x, sidewalk.z).sidewalks.push(sidewalk);
  for (const building of layout.buildings) ensure(building.x, building.z).buildings.push(building);
  for (const prop of layout.props) ensure(prop.x, prop.z).props.push(prop);
  return [...chunks.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function generateCityLayout(options = {}) {
  const cfg = createCityConfig(options);
  const preset = getCityPreset(cfg.style);
  const seed = String(cfg.seed || "showcase-001");
  const rng = mulberry32Local(stringToSeed(`${cfg.style}:${seed}`));
  const zones = generateZonePlan(cfg.style, preset, rng);
  const { roads, sidewalks } = generateRoads(zones, cfg, preset, rng);
  const { buildings, props } = generateBuildingsAndProps(zones, cfg, preset, rng);
  const layout = {
    preset: cfg.style,
    presetLabel: preset.label,
    bounds: computeBounds(zones),
    zones,
    roads,
    sidewalks,
    buildings,
    props,
  };
  layout.chunks = indexChunks(layout, cfg.chunkSize);
  layout.stats = {
    zones: zones.length,
    roads: roads.length,
    sidewalks: sidewalks.length,
    buildings: buildings.length,
    props: props.length,
    chunks: layout.chunks.length,
  };
  return layout;
}

export function generateCityDocument(options = {}) {
  const cfg = createCityConfig(options);
  return createCityDocument({
    seed: cfg.seed,
    style: cfg.style,
    layout: generateCityLayout(cfg),
  });
}

export function computeLayoutSignature(layout) {
  const compact = {
    z: layout.zones.map((z) => [z.type, z.x, z.z, z.w, z.d]),
    r: layout.roads.map((r) => [r.kind, r.x, r.z, r.w, r.d]).slice(0, 24),
    b: layout.buildings.map((b) => [b.type, b.x, b.z, b.w, b.d, b.h]).slice(0, 80),
    p: layout.props.map((p) => [p.type, p.x, p.z, p.h]).slice(0, 60),
  };
  return JSON.stringify(compact);
}

export function getZoneAt(layout, x, z) {
  for (const zone of layout.zones) {
    if (rectContains(zone, x, z, 0)) return zone;
  }
  return null;
}

function computeBounds(zones) {
  const minX = Math.min(...zones.map((z) => z.x - z.w / 2));
  const maxX = Math.max(...zones.map((z) => z.x + z.w / 2));
  const minZ = Math.min(...zones.map((z) => z.z - z.d / 2));
  const maxZ = Math.max(...zones.map((z) => z.z + z.d / 2));
  return { minX: round2(minX), maxX: round2(maxX), minZ: round2(minZ), maxZ: round2(maxZ) };
}
