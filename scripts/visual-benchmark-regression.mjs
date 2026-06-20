// test:visual-benchmark — pure-Node regression for Visual Benchmark-1 (the authored corridor scene).
//
// Visual Benchmark-1 is ONE compact authored sample world (`visual-benchmark-1`) that composes the
// Relic Overlook → glacial crossing → cache-pedestal corridor as INTENTIONAL data, reusing existing
// systems: glacial terrain/water/fog, authored primitive landmarks, a Procedural Authoring-1
// beacon-trail along the route, an Encounter Editor-0 combat beat on the crossing, and a reference-only
// validated-GLB cache prop. The relic find→carry→cache loop is the runtime's automatic objective
// (deriveSites from spawn) — the landmarks frame that same deterministic axis.
//
// This gate proves the AUTHORED ARTIFACT: a valid, deterministic, registered, budget-bounded scene with
// a readable composition. The live "looks intentional + completes + reload-stable" proof is
// test:visual-benchmark-proof. It does NOT mutate the shipped Frozen Cache / first-playable slice.

import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";

import {
  buildVisualBenchmarkV1,
  visualBenchmarkLayout,
  VISUAL_BENCHMARK_ID,
  BENCHMARK_CACHE_ASSET_ID,
} from "../src/world/samples/visualBenchmarkV1.js";
import { getSampleWorld, listSampleWorlds } from "../src/world/samples/index.js";
import { validateWorldDocument } from "../src/world/WorldValidation.js";
import { deriveSites, isWalkable } from "../src/world/objectives/RelicWeaponObjective.js";
import { ENCOUNTER_TYPE } from "../src/world/encounters/EncounterTypes.js";
import { CONTRACT_BUDGETS } from "../src/perf/PerformanceContract.js";
import { WorldObjectManager } from "../src/world/WorldObjectManager.js";
import { createWorldDocument } from "../src/world/WorldDocument.js";
import { glacialLighting } from "../src/lighting/GlacialAtmosphere.js";
import { createWaterConfig } from "../src/world/water/WaterConfig.js";
import { createAtmosphereConfig } from "../src/world/atmosphere/AtmosphereConfig.js";
import { PARTICLE_KINDS } from "../src/particles/ParticleTypes.js";

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
// Perpendicular distance from point p to the segment a→b (route readability).
function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz || 1;
  let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

// The composition's stable, identity-shaped slices (exclude metadata timestamps from determinism).
const shape = (doc) => ({
  objects: doc.objects,
  authoring: doc.authoring,
  encounters: doc.encounters,
  spawn: doc.player.spawn,
  profile: doc.terrain.profile,
});

// --- 1. valid, registered sample world ---------------------------------------
{
  const doc = buildVisualBenchmarkV1();
  const result = validateWorldDocument(doc);
  assert.ok(result && result.document, "build yields a document that passes validation");
  assert.equal(result.document.version, 2, "WorldDocument v2 (no schema bump)");
  assert.equal(doc.terrain.profile, "alpine", "the benchmark uses the glacial (alpine) valley profile");

  assert.ok(listSampleWorlds().some((s) => s.id === VISUAL_BENCHMARK_ID), "registered in the sample-world list");
  const fromRegistry = getSampleWorld(VISUAL_BENCHMARK_ID);
  assert.ok(fromRegistry, "getSampleWorld returns the benchmark");
  assert.deepEqual(shape(fromRegistry), shape(doc), "the registry builds the same composition");
  ok("scene: valid WorldDocument v2, alpine profile, registered as visual-benchmark-1");
}

// --- 2. determinism (composition is pure; only metadata timestamps vary) ------
{
  assert.deepEqual(shape(buildVisualBenchmarkV1()), shape(buildVisualBenchmarkV1()), "two builds → identical composition");
  // The layout (spawn/relic/cache/encounter + landmark anchors) is the ONE source of truth.
  assert.deepEqual(visualBenchmarkLayout(), visualBenchmarkLayout(), "layout is deterministic");
  ok("determinism: identical composition + layout across builds");
}

// --- 3. spawn is dry walkable + the loop requires carrying --------------------
{
  buildVisualBenchmarkV1(); // activates the alpine profile so sampling matches the runtime
  const layout = visualBenchmarkLayout();
  assert.ok(isWalkable(layout.spawn.x, layout.spawn.z), "spawn (overlook) is on dry walkable ground");
  // The relic loop is the runtime's automatic objective: deriveSites from the same spawn. The benchmark
  // must NOT pre-bake an objectives block (the runtime owns it) — the landmarks frame the derived axis.
  const sites = deriveSites(layout.spawn);
  assert.ok(dist2(layout.relic, sites.relic) < 0.001, "the layout's relic == the runtime-derived relic site");
  assert.ok(dist2(layout.cache, sites.cache) < 0.001, "the layout's cache == the runtime-derived cache site");
  assert.ok(dist2(sites.relic, sites.cache) > 20, "relic and cache are far apart → carrying is required (a real route)");
  assert.equal(buildVisualBenchmarkV1().objectives.items.length, 0, "objectives block is empty — the runtime auto-spawns the relic loop");
  ok("composition: dry-walkable overlook spawn; relic/cache axis matches the runtime objective; carry required");
}

// --- 4. authored landmark composition frames a readable route ----------------
{
  const doc = buildVisualBenchmarkV1();
  const layout = visualBenchmarkLayout();
  const landmarks = doc.objects.filter((o) => typeof o.id === "string" && o.id.startsWith("vb-"));
  assert.ok(landmarks.length >= 6, `authored landmarks present (${landmarks.length})`);
  // Environment Polish-1: the route-framing additions (waypoint cairns + crossing gateway) exist.
  const lmIds = new Set(landmarks.map((l) => l.id));
  for (const req of ["vb-route-cairn-a", "vb-route-cairn-b", "vb-crossing-post-l", "vb-crossing-post-r"]) {
    assert.ok(lmIds.has(req), `polish landmark ${req} present`);
  }
  // Every landmark sits near the spawn→relic→cache route (it frames the corridor, not scattered).
  const onRoute = (p) => Math.min(distToSegment(p, layout.spawn, layout.relic), distToSegment(p, layout.relic, layout.cache), distToSegment(p, layout.spawn, layout.cache));
  for (const lm of landmarks) {
    const p = lm.transform.position;
    assert.ok(onRoute(p) <= 14, `${lm.id} frames the route (perp dist ${onRoute(p).toFixed(1)} <= 14)`);
  }
  // …but the direct carry centerline (spawn→cache) stays UNOBSTRUCTED at its midpoint (route readable,
  // no landmark blocking the path).
  const mid = { x: (layout.spawn.x + layout.cache.x) / 2, z: (layout.spawn.z + layout.cache.z) / 2 };
  const nearestToMid = Math.min(...landmarks.map((lm) => dist2(lm.transform.position, mid)));
  assert.ok(nearestToMid >= 2.5, `the carry centerline midpoint is unobstructed (nearest landmark ${nearestToMid.toFixed(1)}m)`);
  ok(`composition: ${landmarks.length} landmarks frame the route; carry centerline readable/unobstructed`);
}

// --- 5. a reference-only validated-GLB cache prop ----------------------------
{
  const doc = buildVisualBenchmarkV1();
  const gltf = doc.objects.filter((o) => o.type === "gltf");
  assert.equal(gltf.length, 1, "exactly one GLB cache prop authored");
  assert.equal(gltf[0].assetRef, BENCHMARK_CACHE_ASSET_ID, "the cache prop references the benchmark cache asset id");
  assert.equal(gltf[0].asset, null, "the cache prop is REFERENCE-ONLY (no embedded binary — GLB lives in IndexedDB)");
  const layout = visualBenchmarkLayout();
  assert.ok(dist2(gltf[0].transform.position, layout.cache) < 6, "the GLB cache prop sits at the cache pedestal");
  ok("assets: one reference-only validated-GLB cache prop at the pedestal");
}

// --- 6. authored procedural beacon-trail along the route ---------------------
{
  const a = buildVisualBenchmarkV1().authoring;
  assert.equal(a.splines.length, 1, "one authored spline");
  assert.ok(a.splines[0].points.length >= 3, "the spline traces the route (>=3 control points)");
  assert.equal(a.masks.length, 1, "one authored mask");
  assert.equal(a.modifiers.length, 1, "one authored modifier");
  assert.equal(a.modifiers[0].type, "beacon-trail", "the modifier is a beacon-trail");
  assert.equal(a.modifiers[0].splineId, a.splines[0].id, "the modifier consumes the authored spline");
  assert.equal(a.modifiers[0].maskId, a.masks[0].id, "the modifier consumes the authored mask");
  ok("authoring: one beacon-trail modifier over a route spline + mask");
}

// --- 7. one Encounter-0 combat beat on the crossing --------------------------
{
  const enc = buildVisualBenchmarkV1().encounters;
  assert.equal(enc.items.length, 1, "exactly one authored combat beat (no waves)");
  const beat = enc.items[0];
  assert.equal(beat.type, ENCOUNTER_TYPE, "it is a combat-beat.v0");
  assert.equal(beat.enemyType, "glacial_sentinel", "it names the Enemy-0 type");
  assert.equal(beat.enemyCount, 1, "exactly one enemy");
  const layout = visualBenchmarkLayout();
  assert.ok(["x", "y", "z"].every((k) => Number.isFinite(beat.position[k])), "finite beat position");
  assert.ok(distToSegment(beat.position, layout.spawn, layout.cache) <= 12, "the beat sits on the carry crossing");
  ok("encounter: one combat-beat on the carry crossing (glacial_sentinel, count 1)");
}

// --- 8. structural budget: the authored objects load within the contract -----
{
  const doc = buildVisualBenchmarkV1();
  const scene = new THREE.Scene();
  const manager = new WorldObjectManager(scene, {});
  await manager.loadWorldObjects(doc.objects); // gltf assetRef won't resolve headless → primitives load
  const liveObjects = manager.objects.size;
  assert.ok(liveObjects <= CONTRACT_BUDGETS.objects.green, `object count within the green object budget (${liveObjects} <= ${CONTRACT_BUDGETS.objects.green})`);
  assert.ok(doc.objects.length <= 60, `compact scene: ${doc.objects.length} authored objects (a corridor, not whole-world polish)`);
  manager.clear();
  ok(`budget: ${doc.objects.length} authored objects load within the contract (${liveObjects} live)`);
}

// --- 9. static determinism: no nondeterministic sources in the sample module --
{
  const src = fs.readFileSync(new URL("../src/world/samples/visualBenchmarkV1.js", import.meta.url), "utf8");
  assert.equal(/Math\.random|Date\.now|new Date\(|performance\.now/.test(src), false, "the sample module has no Math.random/Date/performance.now");
  ok("static: the benchmark composition is deterministic (no RNG / wall-clock)");
}

// --- 10. Environment Polish-1: per-scene readability overrides ---------------
{
  const doc = buildVisualBenchmarkV1();
  assert.ok(doc.lighting && doc.water && doc.atmosphere, "benchmark authors per-scene lighting/water/atmosphere blocks");
  // They DIFFER from the global default → a real readability pass, not the inherited default.
  assert.notDeepEqual(doc.lighting, glacialLighting(), "benchmark lighting differs from the global default");
  assert.notDeepEqual(doc.water, createWaterConfig(), "benchmark water differs from the global default");
  assert.notDeepEqual(doc.atmosphere, createAtmosphereConfig(), "benchmark atmosphere differs from the global default");
  // The overrides survive validation (still legal blocks, clamped not dropped).
  const res = validateWorldDocument(doc);
  assert.equal(res.document.lighting.fog.far, doc.lighting.fog.far, "lighting fog override survives validation");
  assert.equal(res.document.water.fresnel, doc.water.fresnel, "water fresnel override survives validation");
  assert.equal(res.document.atmosphere.mistStrength, doc.atmosphere.mistStrength, "atmosphere mist override survives validation");
  // CRITICAL: overriding the benchmark does NOT change the global default a vanilla world receives
  // (so the frozen Frozen Cache / first-playable slices, which inherit the default, stay byte-stable).
  const vanilla = createWorldDocument({ metadata: { name: "Vanilla" } });
  assert.deepEqual(vanilla.lighting, glacialLighting(), "global lighting default unchanged (frozen slices safe)");
  assert.deepEqual(vanilla.water, createWaterConfig(), "global water default unchanged");
  assert.deepEqual(vanilla.atmosphere, createAtmosphereConfig(), "global atmosphere default unchanged");
  ok("readability: per-scene lighting/water/atmosphere overrides differ from default; global default unchanged");
}

// --- 11. Environment Polish-1: ambient particle feedback ----------------------
{
  const doc = buildVisualBenchmarkV1();
  const emitters = doc.objects.filter((o) => o.particles);
  assert.ok(emitters.length >= 3, `ambient particle emitters present (${emitters.length})`);
  for (const e of emitters) assert.ok(PARTICLE_KINDS.includes(e.particles.kind), `emitter ${e.id} has a valid kind (${e.particles.kind})`);
  // The relic and the cache are emphasised (the two staged destinations of the carry loop).
  assert.ok(doc.objects.find((o) => o.id === "vb-ruin-shard")?.particles, "the relic shard emits (staged as the goal)");
  assert.ok(doc.objects.find((o) => o.id === "vb-cache-pedestal")?.particles, "the cache pedestal emits (staged as the destination)");
  // Emitters survive validation (sanitized + retained, not dropped).
  const res = validateWorldDocument(doc);
  assert.ok(res.document.objects.filter((o) => o.particles).length >= 3, "particle emitters survive validation");
  ok(`feedback: ${emitters.length} ambient particle emitters stage the relic/cache/crossing`);
}

console.log(`\nvisual-benchmark regression: ${passed} checks passed`);
