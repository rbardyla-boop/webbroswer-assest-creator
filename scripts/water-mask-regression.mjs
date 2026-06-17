// test:water — the glacial water masks derive from the active TerrainProfile (the
// terrain authority), are deterministic, and the derived water SURFACE mesh agrees
// with the ground by construction. Proves: rolling has NO water; alpine pools water in
// the trough but NEVER on the walls; the water table is amplitude-stable (the bare
// `floor` fix — a `floor*amp` table would flood/drain the valley); every water vertex
// Y == getWaterLevel and aDepth == getWaterLevel - getHeight; canPlaceGrass rejects
// submerged points. THREE runs in Node (geometry builds without a GL context).

import assert from "node:assert/strict";
import { createTerrainProfile } from "../src/terrain/profiles/index.js";
import {
  getHeight,
  getWaterLevel,
  getWetness,
  canPlaceGrass,
  setTerrainProfile,
  getActiveTerrainProfile,
} from "../src/terrain/terrainSampling.js";
import { GlacialWater } from "../src/world/water/GlacialWater.js";

// --- rolling has no water --------------------------------------------------------
const rolling = createTerrainProfile({ profile: "rolling" });
assert.equal(rolling.hasWater, false, "rolling has no water table");
assert.equal(rolling.waterLevelAt(0, 0), -Infinity, "rolling waterLevelAt is -Infinity");
assert.equal(rolling.wetnessAt(40, -20), 0, "rolling wetness is 0");
assert.equal(rolling.visual.waterlineY, -1e6, "rolling waterlineY is far below terrain");

// --- alpine: amplitude-stable water table (the bare-floor fix) -------------------
// floor(-5) - z*flow + WATER_RISE(-1) → -6 at z=0 for EVERY amplitude. A *amp table
// would return -15 (amp 3) or -2.5 (amp 0.5) and break the valley — this guards it.
for (const amp of [7, 14, 42]) {
  const p = createTerrainProfile({ heightAmplitude: amp });
  assert.ok(Math.abs(p.waterLevelAt(0, 0) - -6) < 1e-9, `alpine table amplitude-stable @ amp ${amp}`);
  assert.equal(p.hasWater, true, `alpine has water @ amp ${amp}`);
}

// --- alpine: water in the trough, dry on the walls -------------------------------
const alpine = createTerrainProfile({});
// Determinism: same config → same field.
const alpine2 = createTerrainProfile({});
for (const [x, z] of [[0, 0], [20, -40], [-30, 120]]) {
  assert.equal(alpine.waterLevelAt(x, z), alpine2.waterLevelAt(x, z), `deterministic waterLevel @ ${x},${z}`);
  assert.equal(alpine.wetnessAt(x, z), alpine2.wetnessAt(x, z), `deterministic wetness @ ${x},${z}`);
}
// Some trough points are submerged (water actually renders), and the ridge walls are dry.
let submerged = 0;
for (let z = -300; z <= 300; z += 10) {
  for (let x = -120; x <= 120; x += 6) {
    if (alpine.height(x, z) < alpine.waterLevelAt(x, z)) submerged++;
  }
}
assert.ok(submerged > 50, `alpine pools visible water in the trough (${submerged} submerged samples)`);
for (let z = -300; z <= 300; z += 30) {
  assert.ok(alpine.height(240, z) > alpine.waterLevelAt(240, z), `wall dry @ x=240,z=${z}`);
}

// --- wetness band: 0 when submerged, >0 just above the waterline, in [0,1] --------
{
  // Find a submerged point and a shoreline point near it.
  let submergedPt = null;
  for (let z = -200; z <= 200 && !submergedPt; z += 4) {
    for (let x = -100; x <= 100; x += 4) {
      if (alpine.height(x, z) < alpine.waterLevelAt(x, z)) { submergedPt = [x, z]; break; }
    }
  }
  assert.ok(submergedPt, "found a submerged sample point");
  assert.equal(alpine.wetnessAt(...submergedPt), 0, "wetness is 0 where submerged (open water)");
  let sawWet = false;
  for (let z = -300; z <= 300; z += 7) {
    for (let x = -120; x <= 120; x += 5) {
      const w = alpine.wetnessAt(x, z);
      assert.ok(w >= 0 && w <= 1, `wetness in [0,1] @ ${x},${z}`);
      if (w > 0.1) sawWet = true;
    }
  }
  assert.ok(sawWet, "a damp shoreline band exists above the waterline");
}

// --- derived water mesh agrees with the ground (single source) -------------------
setTerrainProfile(createTerrainProfile({})); // ensure alpine is the active field
assert.equal(getActiveTerrainProfile().id, "alpine");
const water = new GlacialWater({}, { size: 600, segments: 80 });
const pos = water.mesh.geometry.attributes.position;
const aDepth = water.mesh.geometry.getAttribute("aDepth");
assert.ok(aDepth && aDepth.count === pos.count, "water mesh carries a per-vertex aDepth attribute");
let maxYErr = 0;
let maxDErr = 0;
for (let i = 0; i < pos.count; i++) {
  const x = pos.getX(i);
  const z = pos.getZ(i);
  maxYErr = Math.max(maxYErr, Math.abs(pos.getY(i) - getWaterLevel(x, z)));
  maxDErr = Math.max(maxDErr, Math.abs(aDepth.getX(i) - (getWaterLevel(x, z) - getHeight(x, z))));
}
assert.ok(maxYErr < 1e-3, `water vertex Y == getWaterLevel (max err ${maxYErr.toExponential(2)})`);
assert.ok(maxDErr < 1e-2, `water aDepth == waterLevel - getHeight (max err ${maxDErr.toExponential(2)})`);
water.dispose();

// A second build is identical (deterministic geometry).
const water2 = new GlacialWater({}, { size: 600, segments: 80 });
const aDepth2 = water2.mesh.geometry.getAttribute("aDepth");
for (let i = 0; i < aDepth.count; i++) assert.equal(aDepth.getX(i), aDepth2.getX(i), `deterministic aDepth @ vert ${i}`);
water2.dispose();

// --- canPlaceGrass rejects submerged, accepts dry --------------------------------
{
  let submergedPt = null;
  let dryFloorPt = null;
  for (let z = -150; z <= 150 && (!submergedPt || !dryFloorPt); z += 4) {
    for (let x = -90; x <= 90; x += 4) {
      const sub = getHeight(x, z) < getWaterLevel(x, z);
      if (sub && !submergedPt) submergedPt = [x, z];
      // a dry meadow point: not submerged, gentle, below snow, some grass density
      if (!sub && !dryFloorPt && getActiveTerrainProfile().grassDensity(x, z) > 0.3) dryFloorPt = [x, z];
    }
  }
  assert.ok(submergedPt, "found a submerged point");
  assert.equal(canPlaceGrass(submergedPt[0], submergedPt[1], 0), false, "no grass underwater");
  assert.ok(dryFloorPt, "found a dry meadow point");
  assert.equal(canPlaceGrass(dryFloorPt[0], dryFloorPt[1], 0), true, "grass allowed on the dry meadow floor");
}

// getWetness wrapper delegates to the active profile.
assert.equal(typeof getWetness(0, 0), "number", "getWetness wrapper returns a number");

console.log(`water mask regression passed (${submerged} trough samples submerged; mesh Y==waterLevel & aDepth==level-height; rolling dry; amplitude-stable)`);
