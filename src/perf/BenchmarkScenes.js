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

/** All four canonical scenes, in gate order. */
export function allBenchmarkScenes() {
  return [emptyScene(), frozenCacheScene(), denseAuthoredScene(), streamingBorderScene()];
}
