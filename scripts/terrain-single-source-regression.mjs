// test:terrain-source — the SINGLE-SOURCE invariant. The terrain mesh, the slope
// field, and the placement predicate all read ONE profile-backed height source;
// there is no second terrain truth. Builds the real Terrain mesh headless and
// proves: (1) every mesh vertex Y == getHeight at its XZ; (2) getSlope is exactly
// the central-difference of getHeight; (3) setTerrainProfile moves ALL of them at
// once. THREE runs in Node (geometry builds without a GL context).

import assert from "node:assert/strict";
import { Terrain } from "../src/terrain/Terrain.js";
import {
  getHeight,
  getSlope,
  getNormal,
  canPlaceGrass,
  setTerrainProfile,
  getActiveTerrainProfile,
} from "../src/terrain/terrainSampling.js";
import { createTerrainProfile } from "../src/terrain/profiles/index.js";

// Default active profile is the alpine identity.
assert.equal(getActiveTerrainProfile().id, "alpine", "default active profile is alpine");

// --- (1) mesh vertices == getHeight (the mesh is built FROM the single source) ---
function assertMeshMatchesSource(label) {
  const t = new Terrain({ size: 600, segments: 64 });
  const pos = t.mesh.geometry.attributes.position;
  let maxErr = 0;
  for (let i = 0; i < pos.count; i++) {
    maxErr = Math.max(maxErr, Math.abs(pos.getY(i) - getHeight(pos.getX(i), pos.getZ(i))));
  }
  // float32 vertex storage vs float64 getHeight → only rounding, never a fork.
  assert.ok(maxErr < 1e-3, `[${label}] mesh Y == getHeight (max err ${maxErr.toExponential(2)})`);
  t.dispose();
  return pos.count;
}
const verts = assertMeshMatchesSource("alpine");

// --- (2) getSlope is the central-difference of getHeight (same source) -----------
const EPS = 0.75;
for (const [x, z] of [[0, 0], [40, -25], [150, 90], [-220, 60]]) {
  const hL = getHeight(x - EPS, z), hR = getHeight(x + EPS, z);
  const hD = getHeight(x, z - EPS), hU = getHeight(x, z + EPS);
  const len = Math.hypot(hL - hR, 2 * EPS, hD - hU) || 1;
  const expected = Math.max(0, Math.min(1, 1 - (2 * EPS) / len));
  assert.ok(Math.abs(getSlope(x, z) - expected) < 1e-12, `getSlope == ∂getHeight @ ${x},${z}`);
}
// getNormal is unit-length (built on getHeight).
const n = getNormal(33, -33);
assert.ok(Math.abs(Math.hypot(n.x, n.y, n.z) - 1) < 1e-9, "getNormal is unit length");

// --- (3) setTerrainProfile swaps EVERYTHING at once ------------------------------
const PT = [120, 80];
const alpineH = getHeight(...PT);
const alpineSlope = getSlope(...PT);

setTerrainProfile(createTerrainProfile({ profile: "rolling" }));
assert.equal(getActiveTerrainProfile().id, "rolling", "profile swapped to rolling");
const rollingH = getHeight(...PT);
assert.ok(Math.abs(rollingH - alpineH) > 1, "height moved with the profile");
assert.ok(Math.abs(getSlope(...PT) - alpineSlope) > 1e-6, "slope moved with the profile");
// The freshly-built mesh now matches the rolling source too (still ONE source).
assertMeshMatchesSource("rolling");

// Snow gate follows the active profile: an explicit snowcap profile rejects grass.
// waterLevelAt is part of the profile contract (Visual-1) — a dry one is -Infinity.
setTerrainProfile({
  id: "snowcap", params: {}, grassSlopeLimit: 0.5, grassDensity: () => 1, waterLevelAt: () => -Infinity,
  height: () => 99, snowlineAt: () => 40, colorAt: (a, b, c, d, o) => o, visual: { snowlineY: 40 },
});
assert.equal(canPlaceGrass(0, 0, 0), false, "no grass above the active snowline");

// Restore the default identity so any later import sees alpine.
setTerrainProfile(createTerrainProfile({}));
assert.equal(getActiveTerrainProfile().id, "alpine");

console.log(`terrain single-source regression passed (${verts} mesh verts == getHeight; slope == ∂getHeight; one swap moves all)`);
