import { TERRAIN } from "../terrain/terrainSampling.js";
import { DEFAULT_TERRAIN_MATERIAL } from "../terrain/Terrain.js";
import { createGrassConfig } from "../grass/GrassConfig.js";
import { createTreeConfig } from "../trees/TreeConfig.js";
import { createBushConfig } from "../bushes/BushConfig.js";
import { glacialLighting } from "../lighting/GlacialAtmosphere.js";
import { createWaterConfig } from "./water/WaterConfig.js";
import { createAtmosphereConfig } from "./atmosphere/AtmosphereConfig.js";
import { createWildlifeConfig } from "./wildlife/WildlifeConfig.js";
import { createAmbientConfig } from "./ambient/AmbientConfig.js";
import { createVisibilityConfig } from "../visibility/VisibilityConfig.js";

export const WORLD_DOCUMENT_VERSION = 2;
export const WORLD_DOCUMENT_FORMAT = "world-builder-v2";
export const WORLD_STORAGE_KEY = "grass-world-builder-save";

export function createWorldDocument(overrides = {}) {
  const now = new Date().toISOString();
  const grass = createGrassConfig();
  const trees = createTreeConfig();
  const bushes = createBushConfig();

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
      // Terrain identity. Alpine (glacial valley) is the default everywhere; "rolling"
      // selects the legacy hills. Drives the profile that owns getHeight + colors.
      profile: "alpine",
      // Material v2 (macro noise + height/slope layering over the vertex colors).
      material: { ...DEFAULT_TERRAIN_MATERIAL },
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
      // Vegetation v2 (clumping + view/distance tint).
      clumpStrength: grass.clumpStrength,
      clumpScale: grass.clumpScale,
      distanceTint: grass.distanceTint,
      fresnelIntensity: grass.fresnelIntensity,
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
    bushes: {
      enabled: bushes.enabled,
      density: bushes.density,
      patchSize: bushes.patchSize,
      visibleDistance: bushes.visibleDistance,
      keepDistance: bushes.keepDistance,
      seed: bushes.seed,
      respectExclusions: bushes.respectExclusions,
      slopeLimit: bushes.slopeLimit,
      clumpStrength: bushes.clumpStrength,
      clumpScale: bushes.clumpScale,
      minHeight: bushes.minHeight,
      maxHeight: bushes.maxHeight,
    },
    player: {
      spawn: { x: 0, y: 0, z: 0 },
      cameraMode: "third",
    },
    // Global lighting rig (sun + hemisphere fill + distance fog).
    lighting: glacialLighting(),
    // Glacial water RENDER config (Visual-1) — colors/flow/foam only. The water LEVEL
    // is terrain authority (the profile owns it), so it is intentionally NOT stored here.
    water: createWaterConfig(),
    // Valley atmosphere (Visual-1) — how the global fog is modulated by camera position
    // (thicker in the basin, cold mist near water/snowline). Base fog stays in `lighting`.
    atmosphere: createAtmosphereConfig(),
    // Ambient wildlife (Wildlife-0) — seed + species toggles + streaming distances. The
    // herds re-derive deterministically from seed+region+profile; no per-animal persist.
    wildlife: createWildlifeConfig(),
    // Streamed environmental micro-actors (Ambient-0) — firefly-like motes; re-derive
    // deterministically from seed+region+profile (third RegionStreamer consumer).
    ambient: createAmbientConfig(),
    // Guard-banded visibility/streaming policy (Stage 17A).
    visibility: createVisibilityConfig(),
    // Procedural generator instances (Stage 17C) — authoring intent (seed/config);
    // the objects they emit live in `objects` like any other placed object.
    generators: { instances: [] },
    // Runtime assets (Stage 21B / Arsenal v2) — things rebuilt from a RECIPE on every
    // load (never baked geometry): currently generated weapons. Each item carries
    // { kind, id, recipe, transform, runtime }.
    runtimeAssets: { version: 1, items: [] },
    // Gameplay objectives (FP-1) — a single purpose-built goal the world persists across
    // reload (currently the relic-weapon retrieval). Each item carries
    // { kind, id, relicId, cache, radius, completed }. NOT a quest engine.
    objectives: { version: 1, items: [] },
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
