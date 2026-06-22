// test:slice-1 — pure-Node regression for Slice-1: "The Ice Chapel" (the SECOND authored playable slice).
//
// The Ice Chapel is a NEW sample world (`ice-chapel-1`) that proves repeatability — the stack composes another
// distinct 5–10 minute run from the SAME shipped systems (slice identity, the auto-derived objective loop,
// Encounter Editor-0 beats, the sentinel/wisp archetypes, non-lethal threat, authored signs, particles, an
// optional reward, per-scene readability) — NOT a mutation of `visual-benchmark-1`. A seeded alpine field
// (`terrain.seed = 137`) relocates the whole run to the OPPOSITE valley wall: spawn high on a broken stair,
// bear the relic DOWN the descent to a chapel seal on the trough floor.
//
// This gate proves the AUTHORED ARTIFACT: a valid, deterministic, registered, budget-bounded, DISTINCT scene
// with a readable composition — and that authoring it leaves the global defaults + the benchmark byte-stable.
// The live "runs + completes + reload-stable" proof is test:slice-1-proof.

import assert from "node:assert/strict";
import fs from "node:fs";

import { buildIceChapelV1, iceChapelLayout, ICE_CHAPEL_ID } from "../src/world/samples/iceChapelV1.js";
import { buildVisualBenchmarkV1, visualBenchmarkLayout } from "../src/world/samples/visualBenchmarkV1.js";
import { getSampleWorld, listSampleWorlds } from "../src/world/samples/index.js";
import { validateWorldDocument } from "../src/world/WorldValidation.js";
import { createWorldDocument } from "../src/world/WorldDocument.js";
import { deriveSites, isWalkable } from "../src/world/objectives/RelicWeaponObjective.js";
import { ENCOUNTER_TYPE } from "../src/world/encounters/EncounterTypes.js";
import { SENTINEL_TYPE, WISP_TYPE } from "../src/world/enemies/EnemyTypes.js";
import { resolveSliceIdentity } from "../src/world/slice/SliceIdentity.js";
import { CONTRACT_BUDGETS } from "../src/perf/PerformanceContract.js";
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
  slice: doc.slice,
  spawn: doc.player.spawn,
  seed: doc.terrain.seed,
  profile: doc.terrain.profile,
});

// --- 1. valid, registered sample world; seed 137; alpine ---------------------
{
  const doc = buildIceChapelV1();
  const result = validateWorldDocument(doc);
  assert.ok(result && result.document, "build yields a document that passes validation");
  assert.equal(result.document.version, 2, "WorldDocument v2 (no schema bump)");
  assert.equal(doc.terrain.profile, "alpine", "the chapel uses the glacial (alpine) valley profile");
  assert.equal(doc.terrain.seed, 137, "the chapel uses the seed that relocates it to the opposite wall");

  assert.ok(listSampleWorlds().some((s) => s.id === ICE_CHAPEL_ID), "registered in the sample-world list");
  const fromRegistry = getSampleWorld(ICE_CHAPEL_ID);
  assert.ok(fromRegistry, "getSampleWorld returns the chapel");
  assert.deepEqual(shape(fromRegistry), shape(doc), "the registry builds the same composition");
  ok("scene: valid WorldDocument v2, alpine profile, seed 137, registered as ice-chapel-1");
}

// --- 2. determinism (composition is pure; only metadata timestamps vary) ------
{
  assert.deepEqual(shape(buildIceChapelV1()), shape(buildIceChapelV1()), "two builds → identical composition");
  assert.deepEqual(iceChapelLayout(), iceChapelLayout(), "layout is deterministic");
  ok("determinism: identical composition + layout across builds");
}

// --- 3. dry-walkable spawn; auto-derived axis; carry required; DISTINCT scene -
{
  buildIceChapelV1(); // activates the seed-137 profile so sampling matches the runtime
  const layout = iceChapelLayout();
  assert.ok(isWalkable(layout.spawn.x, layout.spawn.z), "spawn (broken stair) is on dry walkable ground");
  // The relic loop is the runtime's automatic objective: deriveSites from the same spawn. The chapel must NOT
  // pre-bake an objectives block (the runtime owns it) — the landmarks frame the derived axis.
  const sites = deriveSites(layout.spawn);
  assert.ok(dist2(layout.relic, sites.relic) < 0.001, "the layout's relic == the runtime-derived relic site");
  assert.ok(dist2(layout.cache, sites.cache) < 0.001, "the layout's cache == the runtime-derived cache (the seal)");
  assert.ok(dist2(sites.relic, sites.cache) > 20, "relic and seal are far apart → carrying is required (a real route)");
  assert.equal(buildIceChapelV1().objectives.items.length, 0, "objectives block is empty — the runtime auto-spawns the relic loop");

  // DISTINCT FROM THE BENCHMARK (a new place, not a mutation): the chapel re-activates seed 0 for the
  // benchmark layout, so compare the two on their own fields. The spawn AND the seal must be far apart.
  const benchLayout = visualBenchmarkLayout();
  buildIceChapelV1(); // re-activate the chapel profile (benchmarkLayout flipped it back to seed 0)
  const chapelLayout = iceChapelLayout();
  assert.ok(dist2(chapelLayout.spawn, benchLayout.spawn) > 50, `chapel spawn is a different place (${dist2(chapelLayout.spawn, benchLayout.spawn).toFixed(0)}m from the benchmark overlook)`);
  assert.ok(dist2(chapelLayout.cache, benchLayout.cache) > 50, `chapel seal is a different place (${dist2(chapelLayout.cache, benchLayout.cache).toFixed(0)}m from the benchmark cache)`);
  ok("composition: dry-walkable broken-stair spawn; auto-derived axis; carry required; a DISTINCT place from the benchmark");
}

// --- 4. authored chapel landmarks frame the route; carry centerline clear -----
{
  const doc = buildIceChapelV1();
  const layout = iceChapelLayout();
  const landmarks = doc.objects.filter((o) => typeof o.id === "string" && o.id.startsWith("ic-"));
  assert.ok(landmarks.length >= 6, `authored landmarks present (${landmarks.length})`);
  const lmIds = new Set(landmarks.map((l) => l.id));
  for (const req of ["ic-stair-0", "ic-orientation-sign", "ic-relic-shard", "ic-seal-pedestal", "ic-descent-post-l", "ic-descent-post-r"]) {
    assert.ok(lmIds.has(req), `chapel landmark ${req} present`);
  }
  const onRoute = (p) => Math.min(distToSegment(p, layout.spawn, layout.relic), distToSegment(p, layout.relic, layout.cache), distToSegment(p, layout.spawn, layout.cache));
  for (const lm of landmarks) {
    assert.ok(onRoute(lm.transform.position) <= 14, `${lm.id} frames the route (perp dist ${onRoute(lm.transform.position).toFixed(1)} <= 14)`);
  }
  // …but the direct carry centerline (spawn→cache) stays UNOBSTRUCTED at its midpoint.
  const mid = { x: (layout.spawn.x + layout.cache.x) / 2, z: (layout.spawn.z + layout.cache.z) / 2 };
  const nearestToMid = Math.min(...landmarks.map((lm) => dist2(lm.transform.position, mid)));
  assert.ok(nearestToMid >= 2.5, `the carry centerline midpoint is unobstructed (nearest landmark ${nearestToMid.toFixed(1)}m)`);
  ok(`composition: ${landmarks.length} landmarks frame the descent; carry centerline readable/unobstructed`);
}

// --- 5. the optional shrine reward weapon (recipe-rebuilt, off-route) ---------
{
  const doc = buildIceChapelV1();
  const ra = doc.runtimeAssets;
  assert.ok(ra && Array.isArray(ra.items) && ra.items.length === 1, "exactly one runtime asset (the reward)");
  const reward = ra.items[0];
  assert.equal(reward.kind, "generated.weapon", "the reward is a generated weapon");
  assert.equal(reward.id, "ic-shrine-relic-weapon", "the reward has a stable id (separate from the objective relic)");
  assert.ok(reward.recipe && typeof reward.recipe === "object", "the reward carries a recipe (rebuilt on load, never baked)");
  // The reward sits off the carry centerline (an optional discovery, not on the direct path).
  const layout = iceChapelLayout();
  assert.ok(distToSegment(reward.transform.position, layout.spawn, layout.cache) > 4, "the reward is off the direct carry line (optional)");
  ok("reward: one recipe-rebuilt shrine weapon, off-route (claim or ignore)");
}

// --- 6. authored procedural beacon-trail along the descent --------------------
{
  const a = buildIceChapelV1().authoring;
  assert.equal(a.splines.length, 1, "one authored spline");
  assert.ok(a.splines[0].points.length >= 3, "the spline traces the descent (>=3 control points)");
  assert.equal(a.masks.length, 1, "one authored mask");
  assert.equal(a.modifiers.length, 1, "one authored modifier");
  assert.equal(a.modifiers[0].type, "beacon-trail", "the modifier is a beacon-trail");
  assert.equal(a.modifiers[0].splineId, a.splines[0].id, "the modifier consumes the authored spline");
  assert.equal(a.modifiers[0].maskId, a.masks[0].id, "the modifier consumes the authored mask");
  ok("authoring: one beacon-trail modifier over a descent spline + mask");
}

// --- 7. TWO combat beats: a moving sentinel patrol + a wisp guardian ----------
{
  const enc = buildIceChapelV1().encounters;
  assert.equal(enc.items.length, 2, "two authored combat beats (the descent patrol + the seal guardian)");
  const [descent, seal] = enc.items;
  for (const beat of enc.items) {
    assert.equal(beat.type, ENCOUNTER_TYPE, "each beat is a combat-beat.v0");
    assert.equal(beat.enemyCount, 1, "each projects exactly one enemy (no waves, per beat)");
    assert.ok(["x", "y", "z"].every((k) => Number.isFinite(beat.position[k])), "finite beat position");
    assert.equal(beat.completed, false, "each beat starts uncompleted (it completes in play)");
    assert.equal(beat.persistCompletion, true, "each beat persists its completion");
  }
  assert.equal(descent.id, "ic-descent-sentinel", "beat[0] is the descent sentinel");
  assert.equal(descent.enemyType, SENTINEL_TYPE, "the descent beat is a glacial_sentinel");
  assert.ok(descent.patrol && descent.patrol.enabled === true, "the descent sentinel MOVES (patrol enabled)");
  assert.equal(descent.patrol.alert, "halt", "the descent patrol telegraphs with a halt alert");
  assert.equal(descent.label, "the descent", "the descent beat is labelled");
  assert.equal(seal.id, "ic-seal-wisp", "beat[1] is the seal wisp");
  assert.equal(seal.enemyType, WISP_TYPE, "the seal beat is a frost_wisp guardian");
  assert.ok(!seal.patrol || seal.patrol.enabled !== true, "the seal wisp does NOT patrol (a stationary guardian)");
  assert.equal(seal.label, "the seal", "the seal beat is labelled");
  assert.notEqual(descent.label, seal.label, "the two beats have distinct banner labels");
  assert.equal(new Set(enc.items.map((b) => b.id)).size, 2, "the two beats have distinct ids");
  // The seal wisp's zone OVERLAPS the cache so approaching the seal telegraphs it.
  const layout = iceChapelLayout();
  assert.ok(dist2(seal.position, layout.cache) < seal.radius, "the seal wisp's zone overlaps the cache (approaching the seal telegraphs it)");
  ok("encounters: two beats — a moving sentinel patrol (the descent) + a wisp guardian (the seal); no waves");
}

// --- 8. structural budget: compact, within the contract ----------------------
{
  const doc = buildIceChapelV1();
  assert.ok(doc.objects.length <= 60, `compact scene: ${doc.objects.length} authored objects (a descent, not whole-world polish)`);
  assert.ok(doc.objects.length <= CONTRACT_BUDGETS.objects.green, `object count within the green object budget (${doc.objects.length} <= ${CONTRACT_BUDGETS.objects.green})`);
  ok(`budget: ${doc.objects.length} authored objects (compact, within the contract)`);
}

// --- 9. static determinism: no nondeterministic sources in the sample module --
{
  const src = fs.readFileSync(new URL("../src/world/samples/iceChapelV1.js", import.meta.url), "utf8");
  assert.equal(/Math\.random|Date\.now|new Date\(|performance\.now/.test(src), false, "the sample module has no Math.random/Date/performance.now");
  ok("static: the chapel composition is deterministic (no RNG / wall-clock)");
}

// --- 10. per-scene readability overrides differ; global default UNCHANGED -----
{
  const doc = buildIceChapelV1();
  assert.ok(doc.lighting && doc.water && doc.atmosphere, "chapel authors per-scene lighting/water/atmosphere blocks");
  // A real readability pass (colder/mistier), not the inherited default.
  assert.notDeepEqual(doc.lighting, glacialLighting(), "chapel lighting differs from the global default");
  assert.notDeepEqual(doc.water, createWaterConfig(), "chapel water differs from the global default");
  assert.notDeepEqual(doc.atmosphere, createAtmosphereConfig(), "chapel atmosphere differs from the global default");
  // The overrides survive validation.
  const res = validateWorldDocument(doc);
  assert.equal(res.document.lighting.fog.near, doc.lighting.fog.near, "lighting fog override survives validation");
  assert.equal(res.document.water.flowSpeed, doc.water.flowSpeed, "water flowSpeed override survives validation");
  assert.equal(res.document.atmosphere.basinFogBoost, doc.atmosphere.basinFogBoost, "atmosphere override survives validation");
  // CRITICAL: authoring the chapel does NOT change the global default a vanilla world receives (frozen slices safe).
  const vanilla = createWorldDocument({ metadata: { name: "Vanilla" } });
  assert.deepEqual(vanilla.lighting, glacialLighting(), "global lighting default unchanged (frozen slices safe)");
  assert.deepEqual(vanilla.water, createWaterConfig(), "global water default unchanged");
  assert.deepEqual(vanilla.atmosphere, createAtmosphereConfig(), "global atmosphere default unchanged");
  ok("readability: per-scene colder/mistier overrides differ from default; global default unchanged");
}

// --- 11. slice identity authored + survives a save→load round-trip -----------
{
  const doc = buildIceChapelV1();
  assert.ok(doc.slice && doc.slice.title === "The Ice Chapel", "the chapel authors its own slice identity");
  const resolved = resolveSliceIdentity(doc);
  assert.equal(resolved.title, "The Ice Chapel", "resolveSliceIdentity reads the chapel's title");
  assert.equal(resolved.arrivalTagline, doc.slice.arrivalTagline, "resolveSliceIdentity reads the chapel's tagline");
  // The slice block survives validation + a save→load round-trip (persistence path), sanitized. save()
  // validates + JSON-stringifies to localStorage; load() JSON-parses + validates — model that round-trip.
  const validated = validateWorldDocument(doc).document;
  assert.equal(validated.slice.title, "The Ice Chapel", "the slice identity survives validation");
  const roundTrip = validateWorldDocument(JSON.parse(JSON.stringify(validated))).document;
  assert.equal(resolveSliceIdentity(roundTrip).title, "The Ice Chapel", "the slice identity survives a save→load round-trip");
  ok('identity: "The Ice Chapel" authored, resolved, and persistence-safe');
}

// --- 12. ambient particle emitters stage the relic/seal/threshold ------------
{
  const doc = buildIceChapelV1();
  const emitters = doc.objects.filter((o) => o.particles);
  assert.ok(emitters.length >= 3, `ambient particle emitters present (${emitters.length})`);
  for (const e of emitters) assert.ok(PARTICLE_KINDS.includes(e.particles.kind), `emitter ${e.id} has a valid kind (${e.particles.kind})`);
  assert.ok(doc.objects.find((o) => o.id === "ic-relic-shard")?.particles, "the relic shard emits (staged as the goal)");
  assert.ok(doc.objects.find((o) => o.id === "ic-seal-pedestal")?.particles, "the seal pedestal emits (staged as the destination)");
  const res = validateWorldDocument(doc);
  assert.ok(res.document.objects.filter((o) => o.particles).length >= 3, "particle emitters survive validation");
  ok(`feedback: ${emitters.length} ambient particle emitters stage the relic/seal/threshold`);
}

console.log(`\nslice-1 (The Ice Chapel) regression: ${passed} checks passed`);
