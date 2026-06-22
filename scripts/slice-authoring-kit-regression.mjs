// test:slice-authoring-kit — pure-Node regression for Slice Authoring Kit-1.
//
// The kit extracts the repeatable authored-slice pattern (proven twice: visual-benchmark-1 "Relic Overlook" +
// ice-chapel-1 "The Ice Chapel") into a pure, byte-compatible factory layer + a seed probe + composition
// validators. This gate proves: (1) the factories reproduce BOTH existing slices' blocks BYTE-FOR-BYTE (so a
// future migration is safe and Slice-2 can assemble from the kit); (2) the seed probe is deterministic and
// reports walkability/carry/distinctness correctly; (3) the validators ACCEPT both real slices and REJECT
// malformed ones with precise reasons; (4) the kit modules are pure; (5) the frozen-slice default is unchanged.
// It is non-invasive — the two slice builders and their gates are untouched.

import assert from "node:assert/strict";
import fs from "node:fs";

import {
  unit,
  offset,
  groundedPrimitive,
  sliceLayout,
  routeRadius,
  sliceIdentity,
  encounterBeat,
  generatedWeaponReward,
  beaconTrail,
  mergeGlacialLighting,
} from "../src/world/slice/SliceKit.js";
import { probeSliceSeed, probeSliceSeeds } from "../src/world/slice/SliceSeedProbe.js";
import { validateSliceComposition, onRoute } from "../src/world/slice/SliceComposition.js";
import { resolveSliceIdentity } from "../src/world/slice/SliceIdentity.js";
import { buildVisualBenchmarkV1, visualBenchmarkLayout } from "../src/world/samples/visualBenchmarkV1.js";
import { buildIceChapelV1, iceChapelLayout } from "../src/world/samples/iceChapelV1.js";

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};
const clone = (o) => JSON.parse(JSON.stringify(o));

// --- 1. factory byte-equality: the kit reproduces BOTH slices' building blocks --------------------
// Round-trips factory(parts-of-built-block) === built-block, so no constant is hand-copied except the reward
// seed + the lighting deltas (each slice's own authored values). Run for BOTH slices: the factory genuinely
// parameterizes (a wrong default / mutated shared object / mis-handled key would fail one slice or the other).
// getHeight is profile-dependent, so each slice's blocks are reconstructed while ITS seed is active (the
// build activates it) — never reorder a build between a build and its reconstruction.
function assertBlocksReproduced(label, doc, { signId, rewardSeed, prefix, lightingDeltas }) {
  // groundedPrimitive via the orientation sign (a full round-trip incl. interaction + grounding).
  const sign = doc.objects.find((o) => o.id === signId);
  const rebuiltSign = groundedPrimitive(sign.id, sign.name, sign.primitive, { x: sign.transform.position.x, z: sign.transform.position.z }, sign.transform.scale, {
    rotationY: sign.transform.rotation.y,
    colliderType: sign.collider.type,
    particles: sign.particles,
    interaction: sign.interaction,
  });
  assert.deepEqual(rebuiltSign, sign, `${label}: groundedPrimitive reproduces the orientation sign`);

  // sliceIdentity.
  assert.deepEqual(sliceIdentity(doc.slice), doc.slice, `${label}: sliceIdentity reproduces the identity block`);

  // encounterBeat for EVERY beat (patrol beats keep patrol; stationary beats OMIT it).
  for (const beat of doc.encounters.items) {
    const rb = encounterBeat({ id: beat.id, position: beat.position, radius: beat.radius, enemyType: beat.enemyType, label: beat.label, patrol: beat.patrol ?? null, enemyCount: beat.enemyCount });
    assert.deepEqual(rb, beat, `${label}: encounterBeat reproduces ${beat.id}`);
  }

  // generatedWeaponReward (deterministic recipe from the slice's seed).
  const reward = doc.runtimeAssets.items[0];
  const rr = generatedWeaponReward({ id: reward.id, seed: rewardSeed, type: "exotic", position: { x: reward.transform.position.x, z: reward.transform.position.z }, rotationY: reward.transform.rotation.y });
  assert.deepEqual(rr, reward, `${label}: generatedWeaponReward reproduces the shrine reward`);

  // beaconTrail + routeRadius (round-trip from the block's own parts).
  const a = doc.authoring;
  const bt = beaconTrail({ prefix, splineName: a.splines[0].name, maskName: a.masks[0].name, modName: a.modifiers[0].name, points: a.splines[0].points, center: a.masks[0].center, radius: a.masks[0].radius });
  assert.deepEqual(bt, a, `${label}: beaconTrail reproduces the beacon-trail block`);

  // mergeGlacialLighting (the slice's authored deltas).
  assert.deepEqual(mergeGlacialLighting(lightingDeltas), doc.lighting, `${label}: mergeGlacialLighting reproduces the per-scene lighting`);
}
{
  // The seed-driven layout reproduces each slice's layout exactly (proves unit + sliceLayout + the seed).
  assert.deepEqual(sliceLayout({ seed: 0 }), visualBenchmarkLayout(), "sliceLayout(seed 0) == the benchmark layout");
  assert.deepEqual(sliceLayout({ seed: 137 }), iceChapelLayout(), "sliceLayout(seed 137) == the Ice Chapel layout");

  // offset is a pure vector op (proven directly; the sign round-trips above exercise it in situ).
  assert.deepEqual(offset({ x: 0, z: 0 }, { x: 0, z: -1 }, 3, { x: 1, z: 0 }), { x: 1, z: -3 }, "offset is the expected perp+along sum");
  assert.deepEqual(unit(0, -2), { x: 0, z: -1 }, "unit normalizes");

  // The Ice Chapel (build activates seed 137; reconstruct immediately).
  const chapel = buildIceChapelV1();
  assert.ok(Math.abs(routeRadius(iceChapelLayout().spawn, iceChapelLayout().cache) - chapel.authoring.masks[0].radius) < 1e-9, "routeRadius reproduces the chapel mask radius");
  const chapelDoc = buildIceChapelV1(); // re-activate seed 137 after the iceChapelLayout() calls above
  assertBlocksReproduced("Ice Chapel", chapelDoc, {
    signId: "ic-orientation-sign",
    rewardSeed: "ic-shrine-relic",
    prefix: "ic",
    lightingDeltas: { sun: { color: "#d6e2f2", intensity: 1.95, azimuth: 312, elevation: 24 }, hemisphere: { skyColor: "#c2d6ea", intensity: 1.05 }, fog: { color: "#b3c8d8", near: 64, far: 250 } },
  });

  // The Relic Overlook benchmark (build activates seed 0; reconstruct immediately).
  const bench = buildVisualBenchmarkV1();
  assertBlocksReproduced("Relic Overlook", bench, {
    signId: "vb-orientation-sign",
    rewardSeed: "vb-shrine-relic",
    prefix: "vb",
    lightingDeltas: { sun: { color: "#f1f5fb", intensity: 2.55, azimuth: 48, elevation: 36 }, hemisphere: { intensity: 0.82 }, fog: { near: 112, far: 380 } },
  });

  ok("factory byte-equality: the kit reproduces BOTH slices' layout + blocks (migration-safe)");
}

// --- 2. seed probe: deterministic report of spawn/sites/walkability/carry/distinctness -------------
{
  const benchSpawn = sliceLayout({ seed: 0 }).spawn; // the benchmark's spawn (baseline)
  const p137 = probeSliceSeed(137, { baselineSpawns: [benchSpawn] });
  assert.deepEqual(probeSliceSeed(137, { baselineSpawns: [benchSpawn] }), p137, "probeSliceSeed is deterministic");
  assert.ok(p137.walkable, "seed 137 yields walkable spawn/relic/cache");
  assert.ok(p137.carry > 20, "seed 137 yields a real carry (>20m)");
  assert.ok(p137.distinct && p137.minSeparation > 20, `seed 137 is a distinct place (${p137.minSeparation.toFixed(0)}m from the benchmark)`);
  assert.ok(p137.usable, "seed 137 is usable");

  const p0 = probeSliceSeed(0);
  assert.ok(Math.hypot(p0.spawn.x - benchSpawn.x, p0.spawn.z - benchSpawn.z) < 1e-9, "probeSliceSeed(0) reports the benchmark spawn");

  // A bad candidate: seed 42 does NOT move the spawn off the benchmark (findGoodSpawn snaps to a 10-unit grid),
  // so vs the benchmark baseline it is NOT distinct → not usable. The probe catches this before authoring.
  const pBad = probeSliceSeed(42, { baselineSpawns: [benchSpawn] });
  assert.ok(!pBad.distinct && !pBad.usable, "seed 42 is reported NOT distinct (same place as the benchmark)");

  const { recommended } = probeSliceSeeds([42, 137], { baselineSpawns: [benchSpawn] });
  assert.equal(recommended.seed, 137, "probeSliceSeeds recommends the first usable seed (137, not the non-distinct 42)");
  ok("seed probe: deterministic; reports walkability/carry/distinctness; rejects a non-distinct seed");
}

// --- 3. validators ACCEPT both real slices --------------------------------------------------------
{
  const vb = validateSliceComposition(buildVisualBenchmarkV1(), { expectBeats: 3 });
  assert.ok(vb.ok, `the benchmark validates clean (issues: ${vb.issues.join("; ")})`);
  const ic = validateSliceComposition(buildIceChapelV1(), { expectBeats: 2 });
  assert.ok(ic.ok, `the Ice Chapel validates clean (issues: ${ic.issues.join("; ")})`);
  ok("validators accept: both shipped slices validate clean");
}

// --- 4. validators REJECT malformed slices (non-vacuous, with precise reasons) ---------------------
{
  const hasIssue = (res, needle) => res.issues.some((i) => i.includes(needle));

  // (a) bad sites: a spawn high on the wall above the snowline → unwalkable spawn + unwalkable objective sites.
  const badSites = clone(buildIceChapelV1());
  badSites.player.spawn = { x: 250, y: 0, z: 0 };
  const rSites = validateSliceComposition(badSites);
  assert.ok(!rSites.ok && (hasIssue(rSites, "spawn is not on dry walkable ground") || hasIssue(rSites, "site is not walkable")), `bad sites rejected (${rSites.issues.join("; ")})`);

  // (b) overlapping carry blocker: a landmark dropped on the carry-centerline midpoint.
  iceChapelLayout(); // seed 137 active so the midpoint is computed on the chapel field
  const chapel = buildIceChapelV1();
  // the carry midpoint = halfway from the spawn to the cache/seal (the seal pedestal sits at the cache):
  const blocked = clone(chapel);
  const cacheObj = blocked.objects.find((o) => o.id === "ic-seal-pedestal");
  const carryMid = { x: (blocked.player.spawn.x + cacheObj.transform.position.x) / 2, z: (blocked.player.spawn.z + cacheObj.transform.position.z) / 2 };
  blocked.objects.push({ id: "bad-blocker", name: "Bad Blocker", type: "primitive", primitive: "cube", transform: { position: { x: carryMid.x, y: 5, z: carryMid.z }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } });
  const rBlock = validateSliceComposition(blocked);
  assert.ok(!rBlock.ok && hasIssue(rBlock, "carry centerline midpoint blocked"), `overlapping carry blocker rejected (${rBlock.issues.join("; ")})`);

  // (c) missing identity
  const noId = clone(buildIceChapelV1());
  delete noId.slice;
  const rId = validateSliceComposition(noId);
  assert.ok(!rId.ok && hasIssue(rId, "missing authored slice identity"), `missing identity rejected (${rId.issues.join("; ")})`);

  // (d) missing orientation sign
  const noSign = clone(buildIceChapelV1());
  noSign.objects = noSign.objects.filter((o) => !(o.interaction && o.interaction.role === "sign"));
  const rSign = validateSliceComposition(noSign);
  assert.ok(!rSign.ok && hasIssue(rSign, "no orientation sign"), `missing sign rejected (${rSign.issues.join("; ")})`);

  // (e) wrong beat count + an invalid beat (a wave) — objective/encounter coherence
  const badBeats = clone(buildIceChapelV1());
  badBeats.encounters.items[0].enemyCount = 4; // a wave (slices stage single-enemy beats)
  const rBeats = validateSliceComposition(badBeats, { expectBeats: 5 });
  assert.ok(!rBeats.ok && hasIssue(rBeats, "enemyCount") && hasIssue(rBeats, "expected 5 combat beats"), `bad beats rejected (${rBeats.issues.join("; ")})`);

  ok("validators reject: bad sites · carry blocker · missing identity · missing sign · bad beats (each with a precise reason)");
}

// --- 5. purity: the kit modules add no RNG / wall-clock -------------------------------------------
{
  for (const mod of ["SliceKit.js", "SliceSeedProbe.js", "SliceComposition.js"]) {
    const src = fs.readFileSync(new URL(`../src/world/slice/${mod}`, import.meta.url), "utf8");
    assert.equal(/Math\.random|Date\.now|new Date\(|performance\.now/.test(src), false, `${mod} has no Math.random/Date/performance.now`);
  }
  ok("purity: SliceKit / SliceSeedProbe / SliceComposition are deterministic (no RNG / wall-clock)");
}

// --- 6. byte-stability guard: the frozen-slice default identity is unchanged ----------------------
{
  assert.equal(resolveSliceIdentity({}).title, "The Frozen Cache", "the default slice identity is unchanged (frozen slices safe)");
  // The geometry helper the validators expose matches the regressions' inline onRoute (sanity).
  assert.equal(onRoute({ x: 0, z: 0 }, { spawn: { x: 0, z: 0 }, relic: { x: 10, z: 0 }, cache: { x: -10, z: 0 } }), 0, "onRoute is 0 at the spawn");
  ok("byte-stability: the frozen-slice default identity is unchanged");
}

console.log(`\nslice-authoring-kit regression: ${passed} checks passed`);
