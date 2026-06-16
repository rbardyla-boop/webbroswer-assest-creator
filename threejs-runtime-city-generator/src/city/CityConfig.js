import * as THREE from "three";

export const CITY_DOCUMENT_VERSION = 1;

export const CITY_STYLE_PRESETS = Object.freeze({
  showcase: {
    label: "Showcase Region",
    description: "Compact city core plus village, parks, military outpost, science campus, drilling site, and small airport.",
    origin: { x: 65, z: -45 },
    worldRadius: 260,
    roadStep: 44,
    arterialStep: 88,
    blockJitter: 8,
    density: 1.0,
  },
  urban: {
    label: "Dense Urban",
    description: "Grid-heavy city with more downtown, residential, and industrial fill.",
    origin: { x: 60, z: -50 },
    worldRadius: 240,
    roadStep: 36,
    arterialStep: 72,
    blockJitter: 5,
    density: 1.35,
  },
  outpost: {
    label: "Operational Outpost",
    description: "Military, science, drilling, logistics, and airstrip-first frontier layout.",
    origin: { x: 65, z: -35 },
    worldRadius: 280,
    roadStep: 56,
    arterialStep: 112,
    blockJitter: 10,
    density: 0.78,
  },
  village: {
    label: "Rural Village",
    description: "Village main street, farms, parkland, and low-density rural roads.",
    origin: { x: 55, z: -35 },
    worldRadius: 260,
    roadStep: 62,
    arterialStep: 124,
    blockJitter: 14,
    density: 0.55,
  },
});

export const ZONE_STYLES = Object.freeze({
  downtown: { label: "Downtown", color: 0x6f7f92, buildingColor: 0x9ca7b5, height: [9, 32], footprint: [7, 15], density: 0.72 },
  residential: { label: "Residential", color: 0x527e5a, buildingColor: 0xc9aa75, height: [3, 9], footprint: [6, 12], density: 0.45 },
  industrial: { label: "Industrial", color: 0x6f6658, buildingColor: 0x85786b, height: [5, 15], footprint: [10, 22], density: 0.48 },
  park: { label: "Park", color: 0x3d7d3c, buildingColor: 0x4a8f42, height: [1, 3], footprint: [4, 8], density: 0.08 },
  village: { label: "Village", color: 0x7b6b45, buildingColor: 0xc48a58, height: [2.5, 7], footprint: [5, 11], density: 0.32 },
  rural: { label: "Rural", color: 0x586f39, buildingColor: 0xb0905d, height: [2, 6], footprint: [7, 18], density: 0.16 },
  military: { label: "Military", color: 0x4e5b45, buildingColor: 0x5d6a4c, height: [3, 10], footprint: [8, 18], density: 0.34 },
  science: { label: "Science", color: 0x445f74, buildingColor: 0x8fb6c9, height: [4, 16], footprint: [8, 18], density: 0.38 },
  drilling: { label: "Drilling", color: 0x6f5838, buildingColor: 0xa36d32, height: [4, 14], footprint: [7, 16], density: 0.2 },
  airport: { label: "Small Airport", color: 0x4d5961, buildingColor: 0x9fa6a8, height: [2.5, 7], footprint: [8, 22], density: 0.12 },
});

export function createCityConfig(overrides = {}) {
  const cfg = {
    seed: "showcase-001",
    style: "showcase",
    chunkSize: 96,
    visibleDistance: 430,
    keepDistance: 520,
    roadWidth: 7.5,
    arterialWidth: 11,
    sidewalkWidth: 2.2,
    zonePad: 3,
    maxBuildings: 520,
    maxProps: 360,
    labelDistance: 350,
    lodDistances: [150, 300],
    debug: true,
    animateZonePulse: true,
    storageKey: "threejs-runtime-city-generator.document.v1",
    materials: {
      road: new THREE.Color(0x2c3034),
      sidewalk: new THREE.Color(0xb8b0a3),
      runway: new THREE.Color(0x273038),
      prop: new THREE.Color(0x4b6146),
      accent: new THREE.Color(0x7fdca0),
    },
  };
  return Object.assign(cfg, overrides);
}

export function getCityPreset(style) {
  return CITY_STYLE_PRESETS[style] || CITY_STYLE_PRESETS.showcase;
}

export function getZoneStyle(type) {
  return ZONE_STYLES[type] || ZONE_STYLES.rural;
}
