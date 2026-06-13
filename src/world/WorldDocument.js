import { TERRAIN } from "../terrain/terrainSampling.js";
import { createGrassConfig } from "../grass/GrassConfig.js";
import { createTreeConfig } from "../trees/TreeConfig.js";

export const WORLD_DOCUMENT_VERSION = 2;
export const WORLD_DOCUMENT_FORMAT = "world-builder-v2";
export const WORLD_STORAGE_KEY = "grass-world-builder-save";

export function createWorldDocument(overrides = {}) {
  const now = new Date().toISOString();
  const grass = createGrassConfig();
  const trees = createTreeConfig();

  return mergeWorldDocument({
    version: WORLD_DOCUMENT_VERSION,
    metadata: {
      name: "Untitled World",
      createdAt: now,
      updatedAt: now,
      generator: "Grass World Builder",
      format: WORLD_DOCUMENT_FORMAT,
    },
    terrain: {
      seed: 0,
      size: 700,
      segments: 240,
      heightAmplitude: TERRAIN.heightAmplitude,
      featureScale: TERRAIN.featureScale,
      detailScale: TERRAIN.detailScale,
      detailAmount: TERRAIN.detailAmount,
    },
    grass: {
      enabled: true,
      density: grass.density,
      patchSize: grass.patchSize,
      visibleDistance: grass.visibleDistance,
      keepDistance: grass.keepDistance,
      lodDistances: [...grass.lodDistances],
      wind: serializeWind(grass.wind),
      seed: 0,
    },
    trees: {
      enabled: trees.enabled,
      density: trees.density,
      patchSize: trees.patchSize,
      visibleDistance: trees.visibleDistance,
      keepDistance: trees.keepDistance,
      seed: trees.seed,
      respectExclusions: trees.respectExclusions,
    },
    player: {
      spawn: { x: 0, y: 0, z: 0 },
      cameraMode: "third",
    },
    objects: [],
    assets: {
      version: 1,
      embedded: [],
      localIndexedDB: false,
      warning: null,
      items: [],
      reliefs: [],
      images: [],
      imported: [],
    },
    // Optional prefab manifest (metadata only — no binary asset blobs). Placed
    // prefab instances live in `objects` as normal objects carrying prefabRef.
    prefabs: {
      version: 1,
      items: [],
    },
  }, overrides);
}

export function mergeWorldDocument(base, overrides = {}) {
  const out = structuredCloneSafe(base);
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && out[key] && typeof out[key] === "object") {
      out[key] = mergeWorldDocument(out[key], value);
    } else {
      out[key] = structuredCloneSafe(value);
    }
  }
  return out;
}

export function structuredCloneSafe(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function serializeWind(wind = {}) {
  return {
    direction: {
      x: wind.direction?.x ?? 1,
      y: wind.direction?.y ?? 0.45,
    },
    strength: wind.strength ?? 0.32,
    frequency: wind.frequency ?? 1.7,
    scale: wind.scale ?? 0.06,
    gustiness: wind.gustiness ?? 0.55,
  };
}
