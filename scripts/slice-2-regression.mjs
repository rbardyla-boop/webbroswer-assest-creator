// test:slice-2 — pure-Node regression for Slice-2: "The Frost Causeway" (the THIRD authored playable slice, and
// the FIRST assembled FROM the Slice Authoring Kit instead of hand-rolled).
//
// The Frost Causeway is a NEW sample world (`frost-causeway-1`) on a seeded alpine field (`terrain.seed = 251`)
// that relocates the run to the far south of the EAST wall (≈130 m from both prior slices): spawn on a broken
// ridge, climb to the relic on the crown, bear it DOWN across the causeway to a seal low on the basin floor.
//
// Slice-2's distinct VALUE over Slice-1 is the production delta: this slice is authored THROUGH SliceKit (no
// local copies of unit/groundedPrimitive/offset/activateProfile), validated by SliceComposition, and seed-chosen
// by SliceSeedProbe. So this gate proves BOTH the authored artifact (valid, deterministic, registered, coherent,
// DISTINCT, budget-bounded, byte-stable wrt the prior slices) AND that the kit actually built it (every
// structural block is byte-equal to the kit's factory output). The live runs+completes+reload proof is
// test:slice-2-proof.

import assert from "node:assert/strict";
import fs from "node:fs";

import { buildFrostCausewayV1, frostCausewayLayout, FROST_CAUSEWAY_ID, WHITEOUT_LIGHTING } from "../src/world/samples/frostCausewayV1.js";
import { buildVisualBenchmarkV1, visualBenchmarkLayout } from "../src/world/samples/visualBenchmarkV1.js";
import { buildIceChapelV1, iceChapelLayout } from "../src/world/samples/iceChapelV1.js";
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
import { probeSliceSeed } from "../src/world/slice/SliceSeedProbe.js";
import { validateSliceComposition } from "../src/world/slice/SliceComposition.js";
import {
  sliceIdentity,
  encounterBeat,
  generatedWeaponReward,
  beaconTrail,
  mergeGlacialLighting,
  groundedPrimitive,
} from "../src/world/slice/SliceKit.js";

const CAUSEWAY_SEED = 251;
const BASELINE_SPAWNS = [{ x: -80, z: 40 }, { x: 80, z: 60 }]; // the Relic Overlook (seed 0) + Ice Chapel (seed 137) spawns

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

// --- 1. valid, registered sample world; seed 251; alpine ---------------------
{
  const doc = buildFrostCausewayV1();
  const result = validateWorldDocument(doc);
  assert.ok(result && result.document, "build yields a document that passes validation");
  assert.equal(result.document.version, 2, "WorldDocument v2 (no schema bump)");
  assert.equal(doc.terrain.profile, "alpine", "the causeway uses the glacial (alpine) valley profile");
  assert.equal(doc.terrain.seed, CAUSEWAY_SEED, "the causeway uses the seed that relocates it to the far south of the east wall");

  assert.ok(listSampleWorlds().some((s) => s.id === FROST_CAUSEWAY_ID), "registered in the sample-world list");
  const fromRegistry = getSampleWorld(FROST_CAUSEWAY_ID);
  assert.ok(fromRegistry, "getSampleWorld returns the causeway");
  assert.deepEqual(shape(fromRegistry), shape(doc), "the registry builds the same composition");
  ok("scene: valid WorldDocument v2, alpine profile, seed 251, registered as frost-causeway-1");
}

// --- 2. KIT-AUTHORED: the builder is assembled FROM SliceKit, not hand-rolled (the production-delta proof) ---
{
  const src = fs.readFileSync(new URL("../src/world/samples/frostCausewayV1.js", import.meta.url), "utf8");
  // (a) it imports the kit factory layer
  assert.match(src, /from\s+["']\.\.\/slice\/SliceKit\.js["']/, "the builder imports from SliceKit");
  for (const fn of ["sliceLayout", "routeRadius", "groundedPrimitive", "offset", "sliceIdentity", "encounterBeat", "generatedWeaponReward", "beaconTrail", "mergeGlacialLighting"]) {
    assert.ok(src.includes(fn), `the builder uses the kit factory ${fn}`);
  }
  // (b) it does NOT hand-roll local copies of the helpers the kit replaced (this is what makes it KIT-built, not
  // bespoke — Slice-1 defined these locally; Slice-2 must not).
  for (const local of [/function\s+groundedPrimitive\s*\(/, /function\s+offset\s*\(/, /function\s+unit\s*\(/, /function\s+activateProfile\s*\(/]) {
    assert.equal(local.test(src), false, `the builder hand-rolls no local copy matching ${local}`);
  }
  ok("kit-authored: imports the SliceKit factories and hand-rolls no local helper copies");
}

// --- 3. KIT-AUTHORED: every structural block is byte-equal to the kit factory's output ----------------------
// Rebuild each block from its OWN fields via the factory and deepEqual — this pins the block's shape EXACTLY to
// the kit (a hand-authored block with an extra/missing field or a different default would fail). Rebuild against
// a fresh, seed-251-active build so getHeight-derived values reproduce.
{
  const doc = buildFrostCausewayV1();

  // slice identity
  assert.deepEqual(doc.slice, sliceIdentity(doc.slice), "doc.slice == sliceIdentity(...) (exactly title/arrivalTagline/completeBody)");

  // each combat beat
  const reBeat = (b) => encounterBeat({ id: b.id, position: b.position, radius: b.radius, enemyType: b.enemyType, label: b.label, patrol: b.patrol ?? null, enemyCount: b.enemyCount, persistCompletion: b.persistCompletion });
  doc.encounters.items.forEach((b, i) => assert.deepEqual(b, reBeat(b), `doc.encounters.items[${i}] == encounterBeat(...)`));

  // the generated-weapon reward (recipe is a pure fn of the seed; y is getHeight-derived → seed-251 active)
  const r = doc.runtimeAssets.items[0];
  const reReward = generatedWeaponReward({ id: r.id, seed: "fc-reliquary-relic", type: "exotic", position: { x: r.transform.position.x, z: r.transform.position.z }, rotationY: r.transform.rotation.y });
  assert.deepEqual(r, reReward, "doc.runtimeAssets.items[0] == generatedWeaponReward(...)");

  // the beacon-trail authoring block
  const a = doc.authoring;
  const reAuthoring = beaconTrail({ prefix: "fc", splineName: a.splines[0].name, maskName: a.masks[0].name, modName: a.modifiers[0].name, points: a.splines[0].points, center: a.masks[0].center, radius: a.masks[0].radius });
  assert.deepEqual(a, reAuthoring, "doc.authoring == beaconTrail({prefix:'fc', ...})");

  // the per-scene lighting override — pinned to the kit factory applied to the AUTHORED whiteout deltas (so this
  // catches a tampered sun/hemisphere/fog VALUE, not just a shape change — the whiteout look is byte-exact).
  assert.deepEqual(doc.lighting, mergeGlacialLighting(WHITEOUT_LIGHTING), "doc.lighting == mergeGlacialLighting(WHITEOUT_LIGHTING) (the whiteout values are byte-exact the kit output)");

  // a representative authored landmark (the orientation sign) — built via the kit's groundedPrimitive
  const sign = doc.objects.find((o) => o.id === "fc-orientation-sign");
  const reSign = groundedPrimitive(sign.id, sign.name, sign.primitive, { x: sign.transform.position.x, z: sign.transform.position.z }, sign.transform.scale, { rotationY: sign.transform.rotation.y, colliderType: sign.collider.type, interaction: sign.interaction });
  assert.deepEqual(sign, reSign, "a landmark == groundedPrimitive(...) (the kit's grounded helper)");
  ok("kit-authored: slice/beats/reward/authoring/lighting/landmark each byte-equal the kit factory output");
}

// --- 4. SEED PROBE: seed 251 is probe-confirmed usable + distinct (the kit's seed-selection deliverable) ----
{
  const probe = probeSliceSeed(CAUSEWAY_SEED, { baselineSpawns: BASELINE_SPAWNS });
  assert.equal(probe.usable, true, "seed 251 is USABLE (all sites walkable, real carry, distinct)");
  assert.equal(probe.distinct, true, "seed 251 is distinct from both prior slices");
  assert.ok(probe.minSeparation > 100, `seed 251 is far from the nearest prior spawn (${probe.minSeparation}m)`);
  assert.ok(probe.carry > 20, `seed 251 has a real carry (${probe.carry.toFixed(0)}m)`);
  ok(`seed-probe: 251 usable + distinct (${probe.minSeparation}m sep, ${probe.carry.toFixed(0)}m carry)`);
}

// --- 5. COMPOSITION: SliceComposition accepts this slice (3 beats) — and the validator is non-vacuous here --
{
  assert.equal(validateSliceComposition(buildFrostCausewayV1(), { expectBeats: 3 }).ok, true, "SliceComposition accepts the causeway (3 beats)");

  // Non-vacuous: a targeted mutation of THIS slice flips the validator to !ok with the precise issue.
  const noSign = buildFrostCausewayV1();
  noSign.objects = noSign.objects.filter((o) => !(o.interaction && o.interaction.role === "sign"));
  const r1 = validateSliceComposition(noSign, { expectBeats: 3 });
  assert.equal(r1.ok, false, "dropping every sign fails composition");
  assert.ok(r1.issues.some((i) => /orientation sign/i.test(i)), `…with the orientation-sign issue (${JSON.stringify(r1.issues)})`);

  const wrongBeats = buildFrostCausewayV1();
  const r2 = validateSliceComposition(wrongBeats, { expectBeats: 2 });
  assert.equal(r2.ok, false, "an expected-beat-count mismatch fails composition");
  assert.ok(r2.issues.some((i) => /expected 2 combat beats/i.test(i)), `…with the beat-count issue (${JSON.stringify(r2.issues)})`);

  const blocker = buildFrostCausewayV1();
  const layoutB = frostCausewayLayout();
  const mid = { x: (layoutB.spawn.x + layoutB.cache.x) / 2, z: (layoutB.spawn.z + layoutB.cache.z) / 2 };
  blocker.objects[0] = { ...blocker.objects[0], transform: { ...blocker.objects[0].transform, position: { x: mid.x, y: 1, z: mid.z } } };
  const r3 = validateSliceComposition(blocker, { expectBeats: 3 });
  assert.equal(r3.ok, false, "a landmark dropped on the carry-centerline midpoint fails composition");
  assert.ok(r3.issues.some((i) => /centerline midpoint blocked/i.test(i)), `…with the blocked-centerline issue (${JSON.stringify(r3.issues)})`);
  ok("composition: accepts the causeway (3 beats); rejects no-sign / wrong-count / blocked-centerline mutations");
}

// --- 6. dry-walkable spawn; auto-derived axis; carry required; DISTINCT scene -
{
  buildFrostCausewayV1(); // activates the seed-251 profile so sampling matches the runtime
  const layout = frostCausewayLayout();
  assert.ok(isWalkable(layout.spawn.x, layout.spawn.z), "spawn (broken ridge) is on dry walkable ground");
  const sites = deriveSites(layout.spawn);
  assert.ok(dist2(layout.relic, sites.relic) < 0.001, "the layout's relic == the runtime-derived relic site");
  assert.ok(dist2(layout.cache, sites.cache) < 0.001, "the layout's cache == the runtime-derived cache (the seal)");
  assert.ok(dist2(sites.relic, sites.cache) > 20, "relic and seal are far apart → carrying is required (a real route)");
  assert.equal(buildFrostCausewayV1().objectives.items.length, 0, "objectives block is empty — the runtime auto-spawns the relic loop");

  // DISTINCT FROM BOTH PRIOR SLICES (a new place): re-activate each prior slice's profile to read its layout.
  const benchLayout = visualBenchmarkLayout();
  const chapelLayout = iceChapelLayout();
  buildFrostCausewayV1(); // re-activate the causeway profile (the prior layouts flipped it away)
  const cwLayout = frostCausewayLayout();
  assert.ok(dist2(cwLayout.spawn, benchLayout.spawn) > 50, `causeway spawn is a different place (${dist2(cwLayout.spawn, benchLayout.spawn).toFixed(0)}m from the benchmark)`);
  assert.ok(dist2(cwLayout.spawn, chapelLayout.spawn) > 50, `causeway spawn is a different place (${dist2(cwLayout.spawn, chapelLayout.spawn).toFixed(0)}m from the chapel)`);
  ok("composition: dry-walkable ridge spawn; auto-derived axis; carry required; a DISTINCT place from both prior slices");
}

// --- 7. authored causeway landmarks frame the route; carry centerline clear ---
{
  const doc = buildFrostCausewayV1();
  const layout = frostCausewayLayout();
  const landmarks = doc.objects.filter((o) => typeof o.id === "string" && o.id.startsWith("fc-"));
  assert.ok(landmarks.length >= 6, `authored landmarks present (${landmarks.length})`);
  const lmIds = new Set(landmarks.map((l) => l.id));
  for (const req of ["fc-ridge-0", "fc-orientation-sign", "fc-relic-shard", "fc-seal-pedestal", "fc-causeway-post-l", "fc-causeway-post-r"]) {
    assert.ok(lmIds.has(req), `causeway landmark ${req} present`);
  }
  const onRoute = (p) => Math.min(distToSegment(p, layout.spawn, layout.relic), distToSegment(p, layout.relic, layout.cache), distToSegment(p, layout.spawn, layout.cache));
  for (const lm of landmarks) {
    assert.ok(onRoute(lm.transform.position) <= 14, `${lm.id} frames the route (perp dist ${onRoute(lm.transform.position).toFixed(1)} <= 14)`);
  }
  const mid = { x: (layout.spawn.x + layout.cache.x) / 2, z: (layout.spawn.z + layout.cache.z) / 2 };
  const nearestToMid = Math.min(...landmarks.map((lm) => dist2(lm.transform.position, mid)));
  assert.ok(nearestToMid >= 2.5, `the carry centerline midpoint is unobstructed (nearest landmark ${nearestToMid.toFixed(1)}m)`);
  ok(`composition: ${landmarks.length} landmarks frame the causeway; carry centerline readable/unobstructed`);
}

// --- 8. THREE combat beats: a moving causeway patrol + a mixed cache fight (sentinel + wisp) ---------------
{
  const enc = buildFrostCausewayV1().encounters;
  assert.equal(enc.items.length, 3, "three authored combat beats (the causeway patrol + the cache sentinel + the seal wisp)");
  const [causeway, cacheSentinel, sealWisp] = enc.items;
  for (const beat of enc.items) {
    assert.equal(beat.type, ENCOUNTER_TYPE, "each beat is a combat-beat.v0");
    assert.equal(beat.enemyCount, 1, "each projects exactly one enemy (no waves, per beat)");
    assert.ok(["x", "y", "z"].every((k) => Number.isFinite(beat.position[k])), "finite beat position");
    assert.equal(beat.completed, false, "each beat starts uncompleted (it completes in play)");
    assert.equal(beat.persistCompletion, true, "each beat persists its completion");
  }
  assert.equal(causeway.id, "fc-causeway-sentinel", "beat[0] is the causeway sentinel");
  assert.equal(causeway.enemyType, SENTINEL_TYPE, "the causeway beat is a glacial_sentinel");
  assert.ok(causeway.patrol && causeway.patrol.enabled === true, "the causeway sentinel MOVES (patrol enabled)");
  assert.equal(causeway.patrol.alert, "halt", "the causeway patrol telegraphs with a halt alert");
  assert.equal(cacheSentinel.id, "fc-cache-sentinel", "beat[1] is the cache sentinel");
  assert.equal(cacheSentinel.enemyType, SENTINEL_TYPE, "the cache-mouth beat is a glacial_sentinel");
  assert.ok(!cacheSentinel.patrol || cacheSentinel.patrol.enabled !== true, "the cache sentinel does NOT patrol (a stationary guardian)");
  assert.equal(sealWisp.id, "fc-cache-wisp", "beat[2] is the seal wisp");
  assert.equal(sealWisp.enemyType, WISP_TYPE, "the seal beat is a frost_wisp guardian");
  assert.equal(new Set(enc.items.map((b) => b.id)).size, 3, "the three beats have distinct ids");
  assert.equal(new Set(enc.items.map((b) => b.label)).size, 3, "the three beats have distinct banner labels");
  // The mixed cache fight: both the cache sentinel + the seal wisp zones OVERLAP the cache (a co-located fight).
  const layout = frostCausewayLayout();
  assert.ok(dist2(cacheSentinel.position, layout.cache) < cacheSentinel.radius, "the cache sentinel's zone overlaps the cache (guards the mouth)");
  assert.ok(dist2(sealWisp.position, layout.cache) < sealWisp.radius, "the seal wisp's zone overlaps the cache (approaching the seal telegraphs it)");
  ok("encounters: three beats — a moving causeway patrol + a mixed cache fight (sentinel + wisp); no waves");
}

// --- 9. the optional reliquary reward weapon (recipe-rebuilt, off-route) ------
{
  const doc = buildFrostCausewayV1();
  const ra = doc.runtimeAssets;
  assert.ok(ra && Array.isArray(ra.items) && ra.items.length === 1, "exactly one runtime asset (the reward)");
  const reward = ra.items[0];
  assert.equal(reward.kind, "generated.weapon", "the reward is a generated weapon");
  assert.equal(reward.id, "fc-reliquary-relic-weapon", "the reward has a stable id (separate from the objective relic)");
  assert.ok(reward.recipe && typeof reward.recipe === "object", "the reward carries a recipe (rebuilt on load, never baked)");
  const layout = frostCausewayLayout();
  assert.ok(distToSegment(reward.transform.position, layout.spawn, layout.cache) > 4, "the reward is off the direct carry line (optional)");
  ok("reward: one recipe-rebuilt reliquary weapon, off-route (claim or ignore)");
}

// --- 10. budget; determinism; static determinism -----------------------------
{
  const doc = buildFrostCausewayV1();
  assert.ok(doc.objects.length <= 60, `compact scene: ${doc.objects.length} authored objects (a causeway, not whole-world polish)`);
  assert.ok(doc.objects.length <= CONTRACT_BUDGETS.objects.green, `object count within the green object budget (${doc.objects.length} <= ${CONTRACT_BUDGETS.objects.green})`);
  assert.deepEqual(shape(buildFrostCausewayV1()), shape(buildFrostCausewayV1()), "two builds → identical composition");
  assert.deepEqual(frostCausewayLayout(), frostCausewayLayout(), "layout is deterministic");
  const src = fs.readFileSync(new URL("../src/world/samples/frostCausewayV1.js", import.meta.url), "utf8");
  assert.equal(/Math\.random|Date\.now|new Date\(|performance\.now/.test(src), false, "the sample module has no Math.random/Date/performance.now");
  ok(`budget+determinism: ${doc.objects.length} authored objects, pure composition, no RNG/wall-clock`);
}

// --- 11. per-scene readability overrides differ; global default UNCHANGED -----
{
  const doc = buildFrostCausewayV1();
  assert.ok(doc.lighting && doc.water && doc.atmosphere, "causeway authors per-scene lighting/water/atmosphere blocks");
  assert.notDeepEqual(doc.lighting, glacialLighting(), "causeway lighting (whiteout) differs from the global default");
  assert.notDeepEqual(doc.water, createWaterConfig(), "causeway water differs from the global default");
  assert.notDeepEqual(doc.atmosphere, createAtmosphereConfig(), "causeway atmosphere differs from the global default");
  // …and distinct from BOTH prior slices' looks (its own third identity).
  assert.notDeepEqual(doc.lighting, buildVisualBenchmarkV1().lighting, "causeway lighting differs from the benchmark's");
  buildFrostCausewayV1(); // re-activate (the prior build flipped the profile)
  assert.notDeepEqual(buildFrostCausewayV1().lighting, buildIceChapelV1().lighting, "causeway lighting differs from the chapel's");
  // The overrides survive validation.
  const res = validateWorldDocument(buildFrostCausewayV1());
  assert.equal(res.document.lighting.fog.near, 48, "lighting fog override survives validation");
  assert.equal(res.document.water.flowSpeed, 0.12, "water flowSpeed override survives validation");
  // CRITICAL: authoring the causeway does NOT change the global default a vanilla world receives.
  const vanilla = createWorldDocument({ metadata: { name: "Vanilla" } });
  assert.deepEqual(vanilla.lighting, glacialLighting(), "global lighting default unchanged (frozen slices safe)");
  assert.deepEqual(vanilla.water, createWaterConfig(), "global water default unchanged");
  assert.deepEqual(vanilla.atmosphere, createAtmosphereConfig(), "global atmosphere default unchanged");
  ok("readability: a distinct 'whiteout' look (vs both prior slices); global default unchanged");
}

// --- 12. slice identity authored + survives a save→load round-trip; default UNCHANGED ----------------------
{
  const doc = buildFrostCausewayV1();
  assert.equal(doc.slice.title, "The Frost Causeway", "the causeway authors its own slice identity");
  const resolved = resolveSliceIdentity(doc);
  assert.equal(resolved.title, "The Frost Causeway", "resolveSliceIdentity reads the causeway's title");
  assert.equal(resolved.arrivalTagline, doc.slice.arrivalTagline, "resolveSliceIdentity reads the causeway's tagline");
  // Survives validation + a save→load round-trip (persistence path), preserving identity + beats + reward.
  const validated = validateWorldDocument(doc).document;
  const roundTrip = validateWorldDocument(JSON.parse(JSON.stringify(validated))).document;
  assert.equal(resolveSliceIdentity(roundTrip).title, "The Frost Causeway", "the slice identity survives a save→load round-trip");
  assert.equal(roundTrip.encounters.items.length, 3, "the three beats survive the round-trip");
  assert.equal(roundTrip.runtimeAssets.items.length, 1, "the reward survives the round-trip");
  // Byte-stability guard: the global default identity is the frozen cache (untouched).
  assert.equal(resolveSliceIdentity({}).title, "The Frozen Cache", "the default slice identity is still The Frozen Cache (frozen slices safe)");
  ok('identity: "The Frost Causeway" authored, resolved, persistence-safe; default still "The Frozen Cache"');
}

// --- 13. ambient particle emitters stage the relic/seal/causeway --------------
{
  const doc = buildFrostCausewayV1();
  const emitters = doc.objects.filter((o) => o.particles);
  assert.ok(emitters.length >= 3, `ambient particle emitters present (${emitters.length})`);
  for (const e of emitters) assert.ok(PARTICLE_KINDS.includes(e.particles.kind), `emitter ${e.id} has a valid kind (${e.particles.kind})`);
  assert.ok(doc.objects.find((o) => o.id === "fc-relic-shard")?.particles, "the relic shard emits (staged as the goal)");
  assert.ok(doc.objects.find((o) => o.id === "fc-seal-pedestal")?.particles, "the seal pedestal emits (staged as the destination)");
  ok(`feedback: ${emitters.length} ambient particle emitters stage the relic/seal/causeway`);
}

console.log(`\nslice-2 (The Frost Causeway) regression: ${passed} checks passed`);
