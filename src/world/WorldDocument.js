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
// Re-exported from a THREE-free leaf so lightweight entries can read it without importing this engine-heavy
// module (the catalog page imports the leaf directly). Value unchanged + single-source.
export { WORLD_STORAGE_KEY } from "./storageKeys.js";

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
    // Enemy actors (Enemy-0) — reactive combat targets the world persists across reload. Each
    // item carries { type, id, position, maxHealth, defeated }. Absent in the shipped world →
    // no enemies there. NOT an encounter system: one stationary type, idle/hit-react/defeated.
    enemies: { version: 1, items: [] },
    // Authored combat encounters (Encounter Editor-0) — placed "combat beat" descriptors. Each item
    // carries { type, id, position, radius, enemyType, enemyCount, completed, persistCompletion }. In
    // play each projects ONE ephemeral Enemy-0 the player defeats; the spawned enemy is NEVER baked into
    // `enemies.items` (the world stores the DESCRIPTOR, not the enemy). Absent in the shipped world.
    encounters: { version: 1, items: [] },
    // Procedural authoring (Procedural Authoring-1) — editable splines/masks and the
    // modifiers that consume them. The modifier VISUALS are re-derived each load (never
    // baked into `objects`); this block is the source of truth. NOT a node graph.
    authoring: { version: 1, splines: [], masks: [], modifiers: [] },
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
