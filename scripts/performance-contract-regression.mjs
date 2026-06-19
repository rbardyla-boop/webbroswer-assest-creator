// test:performance-contract — pure-Node regression for the Performance Contract-1
// gate logic + the structural invariants that don't need a browser:
//   - the contract evaluator/asserter (reuses the Stage 20A classifier),
//   - benchmark-scene determinism (same call → same document; documented counts),
//   - headless load/unload stability (object + geometry counts return to baseline),
//   - save/load round-trip no-growth (no object duplication at the document layer).
// The live draw-call/triangle/frame budgets are captured by test:performance-contract-proof.

import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import {
  CONTRACT_BUDGETS,
  assertWithinBudget,
  collectBreaches,
  evaluateContract,
  extractMetrics,
} from "../src/perf/PerformanceContract.js";
import {
  allBenchmarkScenes,
  denseAuthoredScene,
  emptyScene,
  frozenCacheScene,
  streamingBorderScene,
} from "../src/perf/BenchmarkScenes.js";
import { WorldObjectManager } from "../src/world/WorldObjectManager.js";
import { WorldSerializer } from "../src/world/WorldSerializer.js";

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

// --- 1. contract evaluator + hard gate ---------------------------------------
{
  // evaluateContract classifies each metric and reports the worst overall.
  const green = evaluateContract({ drawCalls: 10, triangles: 100_000, objects: 50, instancedBatches: 2 });
  assert.equal(green.perMetric.drawCalls.status, "green", "low draw calls are green");
  assert.equal(green.overall, "green", "an all-low scene is overall green");

  const red = evaluateContract({ drawCalls: 999, triangles: 5_000_000, objects: 9000 });
  assert.equal(red.perMetric.drawCalls.status, "red", "999 draw calls is red");
  assert.equal(red.overall, "red", "overall is worst-of");

  // A missing metric is "unknown" and never worsens overall.
  const partial = evaluateContract({ drawCalls: 10 });
  assert.equal(partial.perMetric.heapMB.status, "unknown", "absent heap is unknown");
  assert.equal(partial.overall, "green", "unknown never worsens overall");
  ok("PerformanceContract: evaluateContract status + worst-of overall");

  // assertWithinBudget passes under ceilings, throws over a per-scene ceiling.
  assert.doesNotThrow(() => assertWithinBudget("s", { drawCalls: 50 }, { drawCalls: 80 }), "under ceiling passes");
  assert.throws(
    () => assertWithinBudget("s", { drawCalls: 120 }, { drawCalls: 80 }),
    /drawCalls=120 > scene ceiling 80/,
    "over the per-scene ceiling throws with a precise message"
  );
  // …and throws over the global RED design ceiling even with no per-scene ceiling.
  assert.throws(
    () => assertWithinBudget("s", { triangles: CONTRACT_BUDGETS.triangles.red + 1 }, {}),
    /exceeds RED design ceiling/,
    "over the global red ceiling throws"
  );
  // Yellow is a warning, never a failure (vegetation legitimately runs yellow).
  assert.doesNotThrow(
    () => assertWithinBudget("veg", { triangles: CONTRACT_BUDGETS.triangles.yellow }, {}),
    "yellow does not fail the gate"
  );
  ok("PerformanceContract: assertWithinBudget gates on per-scene ceiling + global red, not yellow");

  // collectBreaches enumerates every offender without throwing.
  const breaches = collectBreaches("dense", { drawCalls: 300, objects: 9000 }, { drawCalls: 120 });
  assert.ok(breaches.some((b) => b.includes("drawCalls")), "draw-call breach listed");
  assert.ok(breaches.some((b) => b.includes("objects")), "object red-ceiling breach listed");
  ok("PerformanceContract: collectBreaches enumerates offenders");

  // extractMetrics prefers __BUDGET__ metrics, falls back to __PERF__ snapshot.
  const metrics = extractMetrics({
    budget: { metrics: { drawCalls: 42, triangles: 200_000 }, rigs: 3 },
    perf: { objects: 77, draw: { calls: 999 }, instancing: { batches: 5 }, memory: { geometries: 30, textures: 4 }, arsenal: { count: 2 } },
  });
  assert.equal(metrics.drawCalls, 42, "prefers __BUDGET__ draw calls");
  assert.equal(metrics.instancedBatches, 5, "falls back to __PERF__ instancing batches");
  assert.equal(metrics.objects, 77, "objects from __PERF__");
  assert.equal(metrics.runtimeAssets, 2, "runtime assets from __PERF__ arsenal");
  assert.equal(metrics.memGeometries, 30, "geometry proxy from __PERF__");
  ok("PerformanceContract: extractMetrics merges __BUDGET__ + __PERF__");
}

// --- 2. benchmark-scene determinism ------------------------------------------
{
  // Same call → identical authored objects (the contract depends on determinism).
  assert.deepEqual(denseAuthoredScene(500).document.objects, denseAuthoredScene(500).document.objects, "dense scene is deterministic");
  assert.deepEqual(streamingBorderScene().document.objects, streamingBorderScene().document.objects, "streaming scene is deterministic");
  assert.equal(denseAuthoredScene(500).document.objects.length, 500, "denseAuthoredScene(500) yields exactly 500 objects");
  assert.equal(emptyScene().document.objects.length, 0, "empty scene has no objects");
  assert.ok(streamingBorderScene().document.objects.length > 0, "streaming-border scene emits a generated city");

  const all = allBenchmarkScenes();
  assert.equal(all.length, 4, "four canonical scenes");
  assert.deepEqual(all.map((s) => s.id), ["empty", "frozen-cache", "dense-authored", "streaming-border"], "scene ids + order");
  for (const s of all) {
    assert.ok(s.document && Array.isArray(s.document.objects), `${s.id} has a document`);
    assert.ok(s.gated && Object.keys(s.gated).length > 0, `${s.id} declares gated ceilings`);
  }
  ok("BenchmarkScenes: deterministic, four scenes, documented counts");

  // No nondeterministic sources in the benchmark module (would break reproducibility).
  const src = fs.readFileSync(new URL("../src/perf/BenchmarkScenes.js", import.meta.url), "utf8");
  assert.equal(/Math\.random|Date\.now|new Date\(/.test(src), false, "BenchmarkScenes has no Math.random/Date");
  ok("BenchmarkScenes: no nondeterministic sources");
}

// --- 3. headless load/unload stability (object + geometry counts) ------------
{
  // THREE + WorldObjectManager run without a GL context (the layout-gates pattern).
  // A repeated load→clear→reload must return to the same live counts (no leak/growth).
  const doc = denseAuthoredScene(200).document;
  const scene = new THREE.Scene();
  const manager = new WorldObjectManager(scene, {});

  const liveCounts = () => {
    let meshes = 0;
    const geometries = new Set();
    manager.root.traverse((node) => {
      if (node.isMesh) {
        meshes++;
        if (node.geometry) geometries.add(node.geometry.uuid);
      }
    });
    return { objects: manager.objects.size, meshes, geometries: geometries.size };
  };

  let baseline = null;
  for (let cycle = 0; cycle < 5; cycle++) {
    await manager.loadWorldObjects(doc.objects); // clears then rebuilds
    const counts = liveCounts();
    assert.equal(counts.objects, 200, `cycle ${cycle}: object count stable at 200`);
    if (baseline === null) baseline = counts;
    else assert.deepEqual(counts, baseline, `cycle ${cycle}: live counts return to baseline (no accumulation)`);
  }
  manager.clear();
  assert.equal(manager.objects.size, 0, "clear() empties the manager");
  ok(`headless load/unload: object + geometry counts stable across 5 reloads (baseline ${baseline.objects} objs / ${baseline.geometries} geo)`);
}

// --- 4. save/load round-trip: no object duplication --------------------------
{
  // Shim localStorage so the real WorldSerializer save/load path runs headless.
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };

  const serializer = new WorldSerializer();
  let doc = denseAuthoredScene(120).document;
  const start = doc.objects.length;
  let prev = null;
  for (let i = 0; i < 4; i++) {
    serializer.save(doc);
    const loaded = serializer.load();
    assert.ok(loaded?.document, `round-trip ${i}: loads a document`);
    const count = loaded.document.objects.length;
    if (prev !== null) assert.equal(count, prev, `round-trip ${i}: object count stable (no duplication)`);
    prev = count;
    doc = loaded.document; // feed the loaded doc back in (true round-trip)
  }
  assert.equal(prev, start, "object count survives the round-trip unchanged");
  ok(`save/load round-trip: ${start} objects stable across 4 cycles (no growth)`);

  delete globalThis.localStorage;
}

console.log(`\nperformance-contract regression: ${passed} checks passed`);
