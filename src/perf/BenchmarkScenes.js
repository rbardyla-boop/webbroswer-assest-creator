// Canonical performance benchmark scenes (Performance Contract-1).
//
// One deterministic, reusable definition of the scenes the performance contract
// gates on — so the Node gate, the browser proof, and (later) perf-report can share
// ONE source instead of duplicated inline strings. Each scene returns a plain
// WorldDocument (JSON-serializable) plus a `gated` ceiling map the proof asserts
// against. PURE + deterministic: no THREE, no RNG, no wall-clock — the same call
// always yields the same document (the contract depends on this; the regression
// statically forbids those nondeterministic sources here).
//
// `gated` ceilings are the per-scene regression guard = measured baseline + tolerance
// (see docs/PROJECT_CHARTER.md "Performance Contract"). They catch a regression that
// is still under the global red design ceiling in PerformanceContract.CONTRACT_BUDGETS.

import { createWorldDocument } from "../world/WorldDocument.js";
import { generateCityLayout } from "../generators/CityLayout.js";
import { cityLayoutToWorldObjects } from "../generators/cityEmitter.js";
import { createCityConfig } from "../generators/GeneratorConfig.js";

const DENSE_SPACING = 3; // metres between authored cubes
const DENSE_DEFAULT = 500;

// A single primitive-cube descriptor (no asset library needed — assetFromWorldObject
// builds the primitive from `primitive`). Matches the shape the editor serializes.
function cube(index, x, z) {
  return {
    id: `obj-${index}`,
    name: `Cube ${index}`,
    type: "primitive",
    primitive: "cube",
    assetRef: null,
    asset: null,
    transform: { position: { x, y: 0, z }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    collider: { type: "box", enabled: true },
    exclusion: { grass: true, trees: true },
  };
}

function scene(id, label, overrides, gated) {
  return { id, label, document: createWorldDocument(overrides), gated };
}

/**
 * Empty fresh-editor world: default terrain + default vegetation, no objects. The
 * idle floor — its ceiling catches a regression that adds cost to nothing.
 */
export function emptyScene() {
  // Ceilings = measured baseline + headroom (draws 110, tris 516k, veg 62; default
  // grass dominates triangles — the documented finding). Catches a real regression,
  // tolerates streaming/camera noise, stays under the global red backstop.
  return scene("empty", "Empty fresh editor (no objects)", { metadata: { name: "Empty" }, objects: [] }, {
    drawCalls: 160,
    triangles: 700_000,
    objects: 4,
    instancedBatches: 8,
    visibleVegetationPatches: 120,
  });
}

/**
 * The base document the Frozen Cache slice loads onto. The slice's landmarks +
 * tutorial weapon are runtime-built (not serialized), so this is an empty doc — the
 * runtime adds the slice. Mirrors scripts/browser-frozen-cache-proof.mjs.
 */
export function frozenCacheScene() {
  // Baseline draws 89, tris 504k, rtAssets 2 (relic + tutorial weapon spawn in runtime).
  return scene("frozen-cache", "Frozen Cache slice", { metadata: { name: "Frozen Cache" }, objects: [] }, {
    drawCalls: 160,
    triangles: 700_000,
    objects: 8,
    instancedBatches: 8,
    visibleVegetationPatches: 120,
    runtimeAssets: 12,
  });
}

/**
 * A dense authored scene: `count` primitive cubes on a square grid. The "how big
 * before it breaks" knob — repeated primitives should collapse into a few instanced
 * batches, keeping draw calls flat while the object count grows.
 * @param {number} [count]
 */
export function denseAuthoredScene(count = DENSE_DEFAULT) {
  const n = Math.max(0, Math.floor(count));
  const side = Math.max(1, Math.ceil(Math.sqrt(n)));
  const half = (side * DENSE_SPACING) / 2;
  const objects = [];
  for (let i = 0; i < n; i++) {
    const x = (i % side) * DENSE_SPACING - half;
    const z = Math.floor(i / side) * DENSE_SPACING - half;
    objects.push(cube(i, x, z));
  }
  // Baseline (500 cubes): draws 111, tris 381k, objects 500, batches 1 — repeated
  // primitives collapse to a single instanced batch, keeping draws flat. The objects
  // ceiling (n+10) is the regression guard; the batches ceiling catches instancing
  // breaking (500 cubes → 500 batches would blow far past 12).
  // Lower grass density (3) isolates the object-instancing path under load — this
  // scene stresses N placed cubes, not vegetation (the empty/frozen-cache scenes
  // already gate default-density vegetation cost).
  return scene("dense-authored", `Dense authored (${n} cubes)`, { metadata: { name: "Dense Authored" }, grass: { density: 3 }, objects }, {
    drawCalls: 160,
    triangles: 560_000,
    objects: n + 10,
    instancedBatches: 12,
  });
}

/**
 * A generator batch (a grid city) with the player spawn placed out near the city so
 * streaming systems (grass/wildlife/ambient region streamers) are exercised at a
 * populated border rather than over empty ground.
 */
export function streamingBorderScene() {
  const objects = cityLayoutToWorldObjects(
    generateCityLayout(createCityConfig({ seed: "perf-border", style: "grid", blocks: 5, density: 0.9 })),
    "gen-city"
  );
  // DEFAULT grass density (no override) so the streaming gate measures the real
  // player-facing cost at a populated border — a regression that only appears at
  // default density would be missed by a sub-default benchmark.
  return scene(
    "streaming-border",
    "Streaming border (generated city, spawn at edge)",
    { metadata: { name: "Streaming Border" }, objects, player: { spawn: { x: 48, y: 0, z: 48 } } },
    // Baseline: draws 113, tris 428k, ~114 generated objects → 3 instanced batches.
    {
      drawCalls: 160,
      triangles: 620_000,
      generatedObjects: 220,
      instancedBatches: 16,
      visibleVegetationPatches: 120,
    }
  );
}

/**
 * A procedurally-authored scene (Procedural Authoring-1): one beacon-trail modifier over
 * a 5-point spline gated by a circle mask. The modifier VISUALS are derived at load (not
 * baked into `objects`), so this gates the derived-geometry path — triangles / drawCalls /
 * instancedBatches — while `objects` stays at the empty baseline. Default grass density so
 * the gate measures real player-facing cost.
 */
export function authoredProceduralScene() {
  const authoring = {
    version: 1,
    splines: [
      {
        id: "trail-path",
        name: "Trail",
        enabled: true,
        locked: false,
        points: [
          { x: -24, y: 0, z: -8 },
          { x: -10, y: 0, z: 4 },
          { x: 2, y: 0, z: -2 },
          { x: 16, y: 0, z: 6 },
          { x: 28, y: 0, z: -4 },
        ],
        tension: 0.5,
        closed: false,
      },
    ],
    masks: [{ id: "trail-area", name: "Area", enabled: true, locked: false, shape: "circle", center: { x: 2, y: 0, z: 0 }, radius: 40, half: { x: 40, z: 40 }, falloff: 0.4 }],
    modifiers: [{ id: "trail-1", name: "Beacon trail", enabled: true, type: "beacon-trail", splineId: "trail-path", maskId: "trail-area", seed: "trail-1", markerCount: 24, markerScale: 1, ring: true }],
  };
  // Baseline (captured then locked, SwiftShader): draws 112, tris 516k, objs 0, batches 0,
  // vegPatch 62 → overall yellow (default grass dominates triangles, like the empty floor).
  // drawCalls/triangles/visibleVegetationPatches ceilings = baseline + ~35-45% headroom
  // (the gate FAILED during calibration when set below the real number). objects (4) and
  // instancedBatches (4) have a measured baseline of 0 — the derived trail is NOT a placed
  // object and does NOT route through the WorldObject instancer — so they are small ABSOLUTE
  // guards: a regression that baked the trail into `objects`/instancing would breach them.
  return scene("authored-procedural", "Authored procedural (beacon trail)", { metadata: { name: "Authored Procedural" }, authoring, objects: [] }, {
    drawCalls: 160,
    triangles: 700_000,
    objects: 4,
    instancedBatches: 4,
    visibleVegetationPatches: 120,
  });
}

const ASSET_INSTANCE_SPACING = 4; // metres between placed asset instances

/**
 * A scene of imported-asset instances (Asset Pipeline-1): `count` GLB instances on a
 * grid, each REFERENCING `assetId` (never embedding the binary — the core rule). The
 * placed-asset cost flows into the contract's gated metrics (objects / draws / triangles
 * / memGeometries). Because an asset-instance resolves a live IndexedDB blob, this scene
 * is exercised by the browser proof (which imports a fixture to supply a real assetId),
 * NOT by the Node `allBenchmarkScenes()` determinism enumeration. Low grass density
 * isolates the asset path under load.
 * @param {{ assetId?: string, count?: number }} [opts]
 */
export function assetInstancesScene({ assetId = "gltf-fixture", count = 24 } = {}) {
  const n = Math.max(0, Math.floor(count));
  const side = Math.max(1, Math.ceil(Math.sqrt(n)));
  const half = (side * ASSET_INSTANCE_SPACING) / 2;
  const objects = [];
  for (let i = 0; i < n; i++) {
    const x = (i % side) * ASSET_INSTANCE_SPACING - half;
    const z = Math.floor(i / side) * ASSET_INSTANCE_SPACING - half;
    objects.push({
      id: `asset-${i}`,
      name: `Asset ${i}`,
      type: "gltf",
      assetRef: assetId,
      primitive: null,
      asset: null,
      transform: { position: { x, y: 0, z }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      collider: { type: "box", enabled: true },
      exclusion: { grass: true, trees: true },
    });
  }
  // Baseline (24 × the clean box fixture, captured then locked, SwiftShader): draws 110,
  // tris 379k, objs 24, batches 0, memGeo 91 → overall green. Ceilings = baseline +
  // ~40-45% headroom. `objects` (n+10) guards that instances stay REFERENCED placed
  // objects; `memGeometries` guards against per-instance geometry duplication (cloned
  // GLB instances SHARE geometry — a regression that stopped sharing would spike it);
  // `instancedBatches` is a small absolute guard (GLB instances are not primitive-batched
  // → baseline 0).
  return scene("asset-instances", `Asset instances (${n} × ${assetId})`, { metadata: { name: "Asset Instances" }, grass: { density: 3 }, objects }, {
    drawCalls: 160,
    triangles: 560_000,
    objects: n + 10,
    instancedBatches: 4,
    memGeometries: 200,
  });
}

/** All canonical scenes, in gate order. */
export function allBenchmarkScenes() {
  return [emptyScene(), frozenCacheScene(), denseAuthoredScene(), streamingBorderScene(), authoredProceduralScene()];
}
