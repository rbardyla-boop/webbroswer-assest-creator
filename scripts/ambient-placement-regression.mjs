// test:ambient — streamed firefly motes (Ambient-0, the THIRD RegionStreamer consumer).
// Pure Node (the math is THREE-free): placement is deterministic from (seed, region,
// profile); density is biome-aware (concentrates in wet meadow / waterside via getWetness +
// meadow, never above the snowline); the hover solver keeps a mote ABOVE terrain AND water;
// drift stays bounded + finite + tethered under hostile config. Also asserts the streamer is
// REUSED, not re-implemented, and the modules use no Math.random/Date.now.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createTerrainProfile } from "../src/terrain/profiles/index.js";
import {
  setTerrainProfile,
  getHeight,
  getWaterLevel,
  getWetness,
  getActiveTerrainProfile,
} from "../src/terrain/terrainSampling.js";
import { createAmbientConfig } from "../src/world/ambient/AmbientConfig.js";
import { placeRegion, habitatOK, densityAt } from "../src/world/ambient/AmbientPlacement.js";
import { spawnMote, updateMote, solveHoverY } from "../src/world/ambient/AmbientRuntime.js";
import { speciesById, AMBIENT_SPECIES } from "../src/world/ambient/AmbientSpecies.js";
import { mulberry32, hash2i } from "../src/utils/random.js";

const SEED = 5150;
const EPS = 1e-6;
const MOTES = speciesById("alpine_motes");

// --- row invariants -------------------------------------------------------------
assert.ok(MOTES.minClearance > 0, "minClearance positive (structural hover floor)");
assert.ok(MOTES.hoverBand[0] <= MOTES.hoverBand[1], "hover band ordered");
assert.ok(MOTES.twinkle.amp < 1, "twinkle amp < 1 (scale factor never collapses to 0)");
assert.ok(MOTES.tetherRadius > 0 && MOTES.maxSpeed > 0, "tether + maxSpeed positive");

// =================================================================================
// ALPINE
// =================================================================================
setTerrainProfile(createTerrainProfile({})); // alpine glacial valley
const cfg = createAmbientConfig({ density: 2 }); // dense so regions reliably populate

// --- determinism -----------------------------------------------------------------
for (const [rx, rz] of [[0, 0], [1, -1], [-2, 1], [2, 2]]) {
  assert.deepEqual(placeRegion(rx, rz, cfg, SEED), placeRegion(rx, rz, cfg, SEED), `placeRegion deterministic @ ${rx},${rz}`);
}

// --- placement legality + bounded + biome-aware ----------------------------------
let total = 0;
let withWetness = 0;
let placedDensitySum = 0;
const profile = getActiveTerrainProfile();
for (let rx = -3; rx <= 3; rx++) {
  for (let rz = -3; rz <= 3; rz++) {
    const motes = placeRegion(rx, rz, cfg, SEED);
    assert.ok(motes.length <= MOTES.regionMemberCap, `region ${rx},${rz} within per-region cap (${motes.length})`);
    for (const m of motes) {
      total++;
      assert.equal(m.speciesId, "alpine_motes", "known species");
      assert.ok(Number.isFinite(m.x) && Number.isFinite(m.z) && Number.isFinite(m.hoverOffset), "descriptor finite");
      assert.ok(m.hoverOffset >= MOTES.hoverBand[0] - EPS && m.hoverOffset <= MOTES.hoverBand[1] + EPS, "hoverOffset in band");
      assert.ok(habitatOK(m.x, m.z, MOTES), "mote home in legal habitat");
      assert.ok(densityAt(m.x, m.z, MOTES) > 0, "mote placed only where biome density > 0");
      assert.ok(getHeight(m.x, m.z) <= profile.snowlineAt(m.x, m.z), "mote never spawns above the snowline");
      if (getWetness(m.x, m.z) > 0) withWetness++;
      placedDensitySum += densityAt(m.x, m.z, MOTES);
    }
  }
}
assert.ok(total > 50, `alpine valley hosts motes (${total})`);
assert.ok(withWetness > 0, `some motes concentrate on the wet shoreline (${withWetness} with wetness>0)`);

// biome bias: placed motes sit in higher-density biome than uniform-random valley points
const urng = mulberry32(hash2i(SEED, 777));
let uniformDensitySum = 0;
const UN = 4000;
for (let i = 0; i < UN; i++) {
  const x = (urng() - 0.5) * 300;
  const z = (urng() - 0.5) * 300;
  uniformDensitySum += densityAt(x, z, MOTES);
}
const placedMean = placedDensitySum / total;
const uniformMean = uniformDensitySum / UN;
assert.ok(uniformMean > 0.01, `uniform alpine baseline is non-trivial (${uniformMean.toFixed(3)}) — the bias check isn't vacuous`);
assert.ok(placedMean > uniformMean * 1.1, `motes biased to lush biome (placed mean ${placedMean.toFixed(3)} > uniform ${uniformMean.toFixed(3)})`);

// --- hover solver: never below terrain or at the water surface, across the valley -
let trough = { h: Infinity, x: 0, z: 0 };
for (let z = -180; z <= 180; z += 10) {
  for (let x = -180; x <= 180; x += 10) {
    if (getHeight(x, z) < trough.h) trough = { h: getHeight(x, z), x, z };
    const y = solveHoverY(x, z, MOTES, MOTES.hoverBand[0]);
    assert.ok(Number.isFinite(y), `hover Y finite @ ${x},${z}`);
    assert.ok(y >= getHeight(x, z) + MOTES.minClearance - EPS, `mote clears terrain @ ${x},${z}`);
    assert.ok(y > getWaterLevel(x, z), `mote above water surface @ ${x},${z}`);
  }
}
// explicitly the deepest trough (where the alpine water table sits highest vs terrain)
{
  const y = solveHoverY(trough.x, trough.z, MOTES, MOTES.hoverBand[0]);
  assert.ok(y >= getHeight(trough.x, trough.z) + MOTES.minClearance - EPS && y > getWaterLevel(trough.x, trough.z), "deepest trough hover legal");
}

// --- bounded drift over a relentless hostile sim ---------------------------------
let target = null;
for (let rx = -3; rx <= 3 && !target; rx++) {
  for (let rz = -3; rz <= 3 && !target; rz++) {
    const motes = placeRegion(rx, rz, cfg, SEED);
    if (motes.length) target = motes[0];
  }
}
assert.ok(target, "found a mote to drive");
const mote = spawnMote(target);
assert.ok(mote, "spawnMote accepts a valid descriptor");
let pathLen = 0;
let prev = { x: mote.x, z: mote.z };
for (let step = 0; step < 5000; step++) {
  const hostileWind = { x: Math.cos(step * 0.1) * 1e6, z: Math.sin(step * 0.1) * 1e6 }; // absurd gusts
  const dt = step === 2500 ? 1e6 : 0.05; // a single monstrous frame mid-run
  const threatX = step % 7 === 0 ? NaN : mote.x - 3; // NaN threat sometimes; close chase otherwise
  updateMote(mote, dt, hostileWind, threatX, mote.z - 3);
  assert.ok(Number.isFinite(mote.x) && Number.isFinite(mote.y) && Number.isFinite(mote.z), `mote finite (step ${step})`);
  assert.ok(mote.scale > 0, `mote scale positive (step ${step})`);
  assert.ok(Math.hypot(mote.x - mote.home.x, mote.z - mote.home.z) <= MOTES.tetherRadius + EPS, `mote tethered (step ${step})`);
  assert.ok(mote.y >= getHeight(mote.x, mote.z) + MOTES.minClearance - EPS, `mote clears terrain (step ${step})`);
  assert.ok(mote.y > getWaterLevel(mote.x, mote.z), `mote above water (step ${step})`);
  pathLen += Math.hypot(mote.x - prev.x, mote.z - prev.z);
  prev = { x: mote.x, z: mote.z };
}
assert.ok(pathLen > 1, `mote keeps drifting under hostile config (path ${pathLen.toFixed(1)})`);

// =================================================================================
// ROLLING (dry: wetness 0, snowline +Infinity) — degrade, not break
// =================================================================================
setTerrainProfile(createTerrainProfile({ profile: "rolling" }));
for (const [rx, rz] of [[0, 0], [1, 1]]) {
  assert.deepEqual(placeRegion(rx, rz, cfg, SEED), placeRegion(rx, rz, cfg, SEED), "rolling deterministic");
}
let rtotal = 0;
for (let rx = -2; rx <= 2; rx++) {
  for (let rz = -2; rz <= 2; rz++) {
    for (const m of placeRegion(rx, rz, cfg, SEED)) {
      rtotal++;
      const y = solveHoverY(m.x, m.z, MOTES, m.hoverOffset);
      assert.ok(Number.isFinite(y) && y >= getHeight(m.x, m.z) + MOTES.minClearance - EPS, "rolling mote clears terrain");
    }
  }
}
assert.ok(rtotal > 0, `rolling world still hosts motes (meadow-only, ${rtotal})`);
setTerrainProfile(createTerrainProfile({})); // restore alpine

// =================================================================================
// The streamer is REUSED, not re-implemented; and no Math.random / Date.now
// =================================================================================
const ambientDir = path.join(process.cwd(), "src", "world", "ambient");
let sawStreamerImport = false;
for (const file of readdirSync(ambientDir)) {
  if (!file.endsWith(".js")) continue;
  const src = readFileSync(path.join(ambientDir, file), "utf8");
  assert.ok(!/Math\.random\s*\(|Date\.now\s*\(|performance\.now\s*\(/.test(src), `${file} calls no nondeterministic time/random`);
  // No region-streaming math may be re-implemented in the ambient modules.
  assert.ok(!/0\.7072|nearestCornerDistance|halfDiag/.test(src), `${file} re-implements no region-streaming math`);
  if (file === "AmbientSystem.js") sawStreamerImport = /RegionStreamer/.test(src);
}
assert.ok(sawStreamerImport, "AmbientSystem reuses the shared RegionStreamer");

console.log(`ambient placement regression passed (${total} alpine motes, ${withWetness} on wet ground; deterministic; biome-biased; hover above terrain+water; bounded under hostile config; rolling-safe; streamer reused)`);
