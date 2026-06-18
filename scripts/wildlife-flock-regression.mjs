// test:flock — aloft snow_finch flocks (Wildlife-1). Proves the sky-life contract in pure
// Node (no THREE needed for the math): placement is deterministic from (seed, region,
// profile); the altitude solver NEVER puts a bird below the terrain or at the water surface
// — on the alpine glacial trough (where the water table sits ABOVE terrain) AND the dry
// rolling profile (where waterLevel/snowline are ±Infinity); and flock cohesion stays
// bounded + non-frozen + regroups over a long relentless chase. No Math.random (the
// wildlife-dir source scan in wildlife-placement-regression covers the new files).

import assert from "node:assert/strict";
import { createTerrainProfile } from "../src/terrain/profiles/index.js";
import {
  setTerrainProfile,
  getHeight,
  getSlope,
  getWaterLevel,
} from "../src/terrain/terrainSampling.js";
import { createWildlifeConfig } from "../src/world/wildlife/WildlifeConfig.js";
import { placeFlockRegion, flockAltitudeAt, flockHabitatOK } from "../src/world/wildlife/FlockPlacement.js";
import { spawnFlock, updateFlock } from "../src/world/wildlife/FlockRuntime.js";
import { speciesById } from "../src/world/wildlife/WildlifeSpecies.js";

const SEED = 4242;
const FINCH = speciesById("snow_finch");
const EPS = 1e-6;

// Solve a member's altitude at its world position (descriptors carry only base offsets).
function memberWorld(flock, m) {
  const x = flock.center.x + Math.cos(m.baseAngle) * m.baseRadius;
  const z = flock.center.z + Math.sin(m.baseAngle) * m.baseRadius;
  return { x, z, y: flockAltitudeAt(x, z, flock.species ?? FINCH, m.altitudeOffset) };
}

// Assert a solved altitude is above BOTH terrain+clearance and the water surface.
function assertAloftLegal(species, x, z, y, ctx) {
  assert.ok(Number.isFinite(y), `solved altitude finite ${ctx}`);
  assert.ok(y >= getHeight(x, z) + species.minClearance - EPS, `bird clears terrain ${ctx} (y=${y.toFixed(2)} g=${getHeight(x, z).toFixed(2)})`);
  assert.ok(y > getWaterLevel(x, z), `bird above the water surface ${ctx}`);
}

// --- row-constant invariants (P0-3: minClearance ≤ altitude band; soft band ordering) ----
assert.equal(FINCH.enabled, true, "snow_finch is a live species");
assert.equal(FINCH.groundContract, "aloft", "snow_finch is aloft");
assert.ok(FINCH.minClearance <= FINCH.altitude[0], "minClearance ≤ altitude floor");
assert.ok(FINCH.altitude[0] <= FINCH.altitude[1], "altitude band ordered");
assert.ok(FINCH.minY <= FINCH.maxY, "minY ≤ maxY");
assert.ok(FINCH.maxSpread > 0 && FINCH.maxTetherRadius > 0, "spread + leash positive");

// =========================================================================================
// ALPINE
// =========================================================================================
setTerrainProfile(createTerrainProfile({})); // alpine glacial valley
const cfg = createWildlifeConfig({ density: 3 }); // dense so flocks reliably populate

// --- determinism: same seed+region+profile → identical descriptors -----------------------
for (const [rx, rz] of [[0, 0], [1, -1], [-2, 2], [3, 1]]) {
  assert.deepEqual(
    placeFlockRegion(rx, rz, cfg, SEED),
    placeFlockRegion(rx, rz, cfg, SEED),
    `placeFlockRegion deterministic @ ${rx},${rz}`
  );
}

// --- placement: flocks exist, centres legal, members bounded + aloft-legal ---------------
let flockCount = 0;
let birdCount = 0;
const perHerdCap = FINCH.regionMemberCap;
const maxHerdsPerRegion = Math.round(FINCH.herdsPerRegion * cfg.density);
for (let rx = -3; rx <= 3; rx++) {
  for (let rz = -3; rz <= 3; rz++) {
    const flocks = placeFlockRegion(rx, rz, cfg, SEED);
    assert.ok(flocks.length <= maxHerdsPerRegion, `region ${rx},${rz} herd count bounded (${flocks.length})`);
    let regionBirds = 0;
    for (const f of flocks) {
      flockCount++;
      assert.ok(flockHabitatOK(f.center.x, f.center.z, FINCH), "flock centre in legal aloft habitat");
      assert.ok(f.members.length >= FINCH.members[0] && f.members.length <= perHerdCap, `flock size bounded (${f.members.length})`);
      regionBirds += f.members.length;
      birdCount += f.members.length;
      for (const m of f.members) {
        assert.ok(m.baseRadius <= FINCH.maxSpread + EPS, "member offset within maxSpread");
        const w = memberWorld({ ...f, species: FINCH }, m);
        assertAloftLegal(FINCH, w.x, w.z, w.y, "@ placement");
      }
    }
    assert.ok(regionBirds <= maxHerdsPerRegion * perHerdCap, `region birds bounded (${regionBirds})`);
  }
}
assert.ok(flockCount > 5, `alpine valley hosts flocks (${flockCount} flocks, ${birdCount} birds)`);

// --- altitude solver legality across the whole valley incl. trough + ridge ---------------
let trough = { h: Infinity, x: 0, z: 0 };
let ridge = { s: -Infinity, x: 0, z: 0 };
for (let z = -200; z <= 200; z += 8) {
  for (let x = -200; x <= 200; x += 8) {
    const h = getHeight(x, z);
    if (h < trough.h) trough = { h, x, z };
    const s = getSlope(x, z);
    if (s > ridge.s) ridge = { s, x, z };
    // a band of offsets at every point — solver must always clear terrain + water
    for (const off of [FINCH.altitude[0], (FINCH.altitude[0] + FINCH.altitude[1]) / 2, FINCH.altitude[1]]) {
      assertAloftLegal(FINCH, x, z, flockAltitudeAt(x, z, FINCH, off), `grid @ ${x},${z}`);
    }
  }
}
// the deepest trough (water table highest relative to floor) + the steepest ridge explicitly
assertAloftLegal(FINCH, trough.x, trough.z, flockAltitudeAt(trough.x, trough.z, FINCH, FINCH.altitude[0]), `deepest trough (h=${trough.h.toFixed(2)})`);
assertAloftLegal(FINCH, ridge.x, ridge.z, flockAltitudeAt(ridge.x, ridge.z, FINCH, FINCH.altitude[1]), `steepest ridge (slope=${ridge.s.toFixed(2)})`);

// --- the WATER term, not minY, is what protects (lower minY below the water table) -------
const sinkFinch = { ...FINCH, minY: -50, maxY: 200 };
const sy = flockAltitudeAt(trough.x, trough.z, sinkFinch, sinkFinch.altitude[0]);
assert.ok(sy > getWaterLevel(trough.x, trough.z), "water-term protects even when minY is below the water table");
assert.ok(sy >= getHeight(trough.x, trough.z) + sinkFinch.minClearance - EPS, "clearance holds with a hostile minY");

// --- bounded cohesion + non-freeze + regroup over a relentless chase ---------------------
// Take a real placed flock and chase it from a sweeping angle for thousands of steps.
let target = null;
for (let rx = -3; rx <= 3 && !target; rx++) {
  for (let rz = -3; rz <= 3 && !target; rz++) {
    const flocks = placeFlockRegion(rx, rz, cfg, SEED);
    if (flocks.length) target = flocks[0];
  }
}
assert.ok(target, "found a flock to chase");
const flock = spawnFlock(target);
assert.ok(flock, "spawnFlock accepts a valid descriptor");

const CHASE_GAP = 8; // < panicDistance (22) → always panicked, always scattering
let pathLen = 0;
let prev = { x: flock.center.x, z: flock.center.z };
for (let step = 0; step < 5000; step++) {
  const ang = step * 0.03; // sweep the threat around the flock
  const tx = flock.center.x - Math.cos(ang) * CHASE_GAP;
  const tz = flock.center.z - Math.sin(ang) * CHASE_GAP;
  updateFlock(flock, 0.05, tx, tz);
  // centre leashed to home
  assert.ok(Math.hypot(flock.center.x - flock.home.x, flock.center.z - flock.home.z) <= FINCH.maxTetherRadius + EPS, `centre leashed (step ${step})`);
  // members cohered + aloft-legal
  for (const m of flock.members) {
    assert.ok(Math.hypot(m.x - flock.center.x, m.z - flock.center.z) <= FINCH.maxSpread + EPS, `member cohered (step ${step})`);
    assertAloftLegal(FINCH, m.x, m.z, m.y, `chased member (step ${step})`);
  }
  pathLen += Math.hypot(flock.center.x - prev.x, flock.center.z - prev.z);
  prev = { x: flock.center.x, z: flock.center.z };
}
assert.ok(pathLen > 10, `chased flock keeps moving — never freezes (path ${pathLen.toFixed(1)})`);

// threat leaves → the flock must deterministically leave the scatter state and re-cohere
for (let step = 0; step < 400; step++) updateFlock(flock, 0.05, 100000, 100000);
assert.notEqual(flock.state, "scatter", "flock leaves scatter once the threat is gone");
assert.ok(flock.scatterScale < 1.1, "flock spread eases back toward cohesion");

// --- hostile dt cannot teleport or NaN the flock -----------------------------------------
updateFlock(flock, 1e6, 0, 0);
assert.ok(Number.isFinite(flock.center.x) && Number.isFinite(flock.center.z), "hostile dt stays finite");
assert.ok(Math.hypot(flock.center.x - flock.home.x, flock.center.z - flock.home.z) <= FINCH.maxTetherRadius + EPS, "hostile dt stays leashed");

// =========================================================================================
// ROLLING (dry: waterLevel -Infinity, snowline +Infinity) — solver must degrade, not NaN
// =========================================================================================
setTerrainProfile(createTerrainProfile({ profile: "rolling" }));
for (const [rx, rz] of [[0, 0], [2, -1]]) {
  assert.deepEqual(placeFlockRegion(rx, rz, cfg, SEED), placeFlockRegion(rx, rz, cfg, SEED), "rolling deterministic");
}
for (let z = -120; z <= 120; z += 12) {
  for (let x = -120; x <= 120; x += 12) {
    const y = flockAltitudeAt(x, z, FINCH, FINCH.altitude[0]);
    assert.ok(Number.isFinite(y), `rolling solver finite @ ${x},${z}`);
    assert.ok(y >= getHeight(x, z) + FINCH.minClearance - EPS, `rolling bird clears terrain @ ${x},${z}`);
  }
}
// a short rolling sim stays finite (no ±Infinity poisoning)
let rflock = null;
for (let rx = 0; rx <= 4 && !rflock; rx++) {
  const flocks = placeFlockRegion(rx, 0, cfg, SEED);
  if (flocks.length) rflock = spawnFlock(flocks[0]);
}
if (rflock) {
  for (let step = 0; step < 300; step++) {
    updateFlock(rflock, 0.05, rflock.center.x - 5, rflock.center.z - 5);
    for (const m of rflock.members) assert.ok(Number.isFinite(m.y), `rolling member finite (step ${step})`);
  }
}

setTerrainProfile(createTerrainProfile({})); // restore alpine

console.log(`wildlife flock regression passed (${flockCount} alpine flocks / ${birdCount} birds; deterministic; aloft-legal on trough+ridge+rolling; chase path ${pathLen.toFixed(0)}; bounded + regroups)`);
