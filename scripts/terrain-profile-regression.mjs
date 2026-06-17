// test:terrain-profile — the terrain PROFILES are deterministic, the rolling profile
// reproduces the original terrain math exactly, and the alpine profile produces a
// distinct, sane glacial field (valley floor below ridge walls, a finite snowline,
// in-range masks + colors). Pure Node — no browser, no THREE needed for the math.

import assert from "node:assert/strict";
import { createTerrainProfile, PROFILE_IDS } from "../src/terrain/profiles/index.js";
import { fbm2D } from "../src/utils/random.js";

const SAMPLES = [
  [0, 0], [30, -12], [120, 80], [-200, 50], [240, -240], [-75, 175], [12.5, 333.3],
];

// --- The original rolling-hills math, transcribed from the pre-Visual-0 getHeight.
// The rolling profile must reproduce this height-for-height (provable preservation).
function legacyHeight(x, z) {
  const base = fbm2D(x * 0.012, z * 0.012, 5);
  const shaped = Math.sign(base) * Math.pow(Math.abs(base), 1.15);
  const detail = fbm2D(x * 0.06, z * 0.06, 3) * 1.6;
  return shaped * 14 + detail;
}
function legacyGrass(x, z) {
  const meadow = fbm2D(x * 0.02 + 100, z * 0.02 - 70, 3);
  const mask = Math.max(0, Math.min(1, (meadow - -0.3) / 0.8));
  const s = mask * mask * (3 - 2 * mask);
  return Math.max(0, Math.min(1, 0.4 + 0.6 * s));
}

// --- index + ids -----------------------------------------------------------------
assert.deepEqual([...PROFILE_IDS], ["alpine", "rolling"], "known profiles");
assert.equal(createTerrainProfile({}).id, "alpine", "default profile is alpine");
assert.equal(createTerrainProfile({ profile: "rolling" }).id, "rolling");
assert.equal(createTerrainProfile({ profile: "bogus" }).id, "alpine", "unknown → alpine");

// --- rolling faithfulness --------------------------------------------------------
const rolling = createTerrainProfile({ profile: "rolling" });
for (const [x, z] of SAMPLES) {
  assert.ok(Math.abs(rolling.height(x, z) - legacyHeight(x, z)) < 1e-9, `rolling height parity @ ${x},${z}`);
  assert.ok(Math.abs(rolling.grassDensity(x, z) - legacyGrass(x, z)) < 1e-9, `rolling grass parity @ ${x},${z}`);
}
assert.equal(rolling.snowlineAt(0, 0), Infinity, "rolling has no snowline");

// --- determinism (same config → identical field) ---------------------------------
const a1 = createTerrainProfile({ seed: 7 });
const a2 = createTerrainProfile({ seed: 7 });
for (const [x, z] of SAMPLES) {
  assert.equal(a1.height(x, z), a2.height(x, z), `alpine deterministic height @ ${x},${z}`);
  assert.equal(a1.grassDensity(x, z), a2.grassDensity(x, z), `alpine deterministic grass @ ${x},${z}`);
  assert.equal(a1.snowlineAt(x, z), a2.snowlineAt(x, z), `alpine deterministic snowline @ ${x},${z}`);
}
// A different seed perturbs the field (seed is actually wired).
const aSeed = createTerrainProfile({ seed: 99 });
assert.ok(SAMPLES.some(([x, z]) => Math.abs(a1.height(x, z) - aSeed.height(x, z)) > 1e-6), "alpine seed affects the field");

// --- alpine differs from rolling + is finite -------------------------------------
const alpine = createTerrainProfile({});
assert.ok(SAMPLES.some(([x, z]) => Math.abs(alpine.height(x, z) - rolling.height(x, z)) > 1), "alpine differs from rolling");
for (const [x, z] of SAMPLES) assert.ok(Number.isFinite(alpine.height(x, z)), `alpine finite @ ${x},${z}`);

// --- glacial shape: valley floor sits below the ridge walls -----------------------
const floorY = alpine.height(0, 0);
const wallY = alpine.height(260, 0);
assert.ok(floorY < wallY - 20, `valley floor (${floorY.toFixed(1)}) well below wall (${wallY.toFixed(1)})`);

// --- masks + colors in range -----------------------------------------------------
assert.ok(alpine.grassSlopeLimit > 0 && alpine.grassSlopeLimit <= 1, "grassSlopeLimit in (0,1]");
const out = [0, 0, 0];
for (const [x, z] of SAMPLES) {
  const d = alpine.grassDensity(x, z);
  assert.ok(d >= 0 && d <= 1, `grassDensity in [0,1] @ ${x},${z}`);
  const sn = alpine.snowlineAt(x, z);
  assert.ok(Number.isFinite(sn) && sn > 0, `snowline finite+positive @ ${x},${z}`);
  alpine.colorAt(x, z, alpine.height(x, z), 0.2, out);
  assert.ok(out.every((c) => c >= 0 && c <= 1), `colorAt rgb in [0,1] @ ${x},${z}`);
}
// Meadow clusters on the valley floor, not up the walls.
assert.ok(alpine.grassDensity(0, 0) > alpine.grassDensity(300, 0), "meadow favors the valley floor");

// --- visual config for the material shader is well-formed ------------------------
const v = alpine.visual;
for (const key of ["snowColor", "screeColor", "rockColor"]) assert.equal(typeof v[key], "number", `${key} is a hex int`);
assert.ok(Number.isFinite(v.snowlineY) && v.snowlineY > 0, "visual snowlineY finite+positive");
assert.equal(v.screeSlope.length, 2);
assert.equal(v.screeY.length, 2);

console.log(`terrain profile regression passed (${SAMPLES.length} sample points; rolling parity + alpine determinism + masks)`);
