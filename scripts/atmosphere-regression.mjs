// test:atmosphere — the valley fog modulation is deterministic, thicker in the basin
// than on the ridge, never inverts (near < far), and the cold mist switches on near the
// water surface / above the snowline. Pure math: computeValleyFog is Node-safe.

import assert from "node:assert/strict";
import { createTerrainProfile } from "../src/terrain/profiles/index.js";
import { computeValleyFog } from "../src/world/atmosphere/ValleyAtmosphere.js";
import { createAtmosphereConfig } from "../src/world/atmosphere/AtmosphereConfig.js";

const profile = createTerrainProfile({}); // alpine
const cfg = createAtmosphereConfig();
const BASE = { near: 90, far: 320 };
const X = 0;
const Z = 0;
const waterY = profile.waterLevelAt(X, Z); // ~ -6
const snowY = profile.snowlineAt(X, Z); // ~ 44

// --- determinism -----------------------------------------------------------------
const cam = { x: X, y: 0, z: Z };
const a = computeValleyFog(cam, profile, BASE, cfg);
const b = computeValleyFog(cam, profile, BASE, cfg);
assert.deepEqual(a, b, "computeValleyFog is deterministic");

// --- basin thicker than ridge ----------------------------------------------------
const lowCam = { x: X, y: waterY + 1, z: Z }; // down on the valley floor
const highCam = { x: X, y: waterY + cfg.ridgeSpan + 10, z: Z }; // up on the ridge
const low = computeValleyFog(lowCam, profile, BASE, cfg);
const high = computeValleyFog(highCam, profile, BASE, cfg);
assert.ok(low.near < high.near, `basin fog thicker than ridge (near ${low.near.toFixed(1)} < ${high.near.toFixed(1)})`);
assert.ok(high.near <= BASE.near + 1e-9, "ridge near never exceeds the base near");

// --- never inverts ---------------------------------------------------------------
for (let y = -20; y <= 120; y += 5) {
  const f = computeValleyFog({ x: X, y, z: Z }, profile, BASE, cfg);
  assert.ok(f.near < f.far, `near < far @ y=${y} (${f.near.toFixed(1)} / ${f.far.toFixed(1)})`);
  assert.ok(f.near > 0, `near positive @ y=${y}`);
  assert.ok(f.mist >= 0 && f.mist <= 1, `mist in [0,1] @ y=${y}`);
}

// --- cold mist switches on near water / above snow, off in the dry mid-band -------
const mistAtWater = computeValleyFog({ x: X, y: waterY + 0.5, z: Z }, profile, BASE, cfg).mist;
const mistAboveSnow = computeValleyFog({ x: X, y: snowY + 6, z: Z }, profile, BASE, cfg).mist;
const mistMid = computeValleyFog({ x: X, y: (waterY + snowY) / 2, z: Z }, profile, BASE, cfg).mist;
assert.ok(mistAtWater > 0, `mist gathers at the water surface (${mistAtWater.toFixed(2)})`);
assert.ok(mistAboveSnow > 0, `mist gathers above the snowline (${mistAboveSnow.toFixed(2)})`);
assert.equal(mistMid, 0, "no mist in the dry mid-slope band");

// --- rolling (no water) still produces sane fog ----------------------------------
const rolling = createTerrainProfile({ profile: "rolling" });
const rf = computeValleyFog({ x: 0, y: 5, z: 0 }, rolling, BASE, cfg);
assert.ok(rf.near > 0 && rf.near < rf.far, "rolling fog is sane (no water table)");
assert.equal(rf.mist, 0, "rolling has no water/snow mist at low altitude");

console.log("atmosphere regression passed (deterministic; basin > ridge; never inverts; mist near water/snow)");
