// test:wildlife — wildlife placement derives from the active TerrainProfile, is
// deterministic from (seed, region, profile), spawns ONLY in legal habitat, stays
// bounded, and — critically — its MOVEMENT stays habitat-clamped (a fleeing animal
// pushed toward water never enters it). Pure Node (THREE not needed for the math).
// Also a source scan: no Math.random / Date.now leaks into the wildlife modules.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createTerrainProfile } from "../src/terrain/profiles/index.js";
import {
  setTerrainProfile,
  getHeight,
  getWaterLevel,
  getActiveTerrainProfile,
} from "../src/terrain/terrainSampling.js";
import { createWildlifeConfig } from "../src/world/wildlife/WildlifeConfig.js";
import { placeRegion, habitatOK } from "../src/world/wildlife/WildlifePlacement.js";
import { speciesById, WILDLIFE_SPECIES } from "../src/world/wildlife/WildlifeSpecies.js";
import { spawnAnimal, updateAnimal } from "../src/world/wildlife/WildlifeRuntime.js";

const SEED = 12345;
const cfg = createWildlifeConfig({ density: 2 }); // dense so regions reliably populate

// --- determinism: same seed+region+profile → identical accepted set --------------
setTerrainProfile(createTerrainProfile({})); // alpine
for (const [rx, rz] of [[0, 0], [1, -1], [-2, 2], [3, 0]]) {
  const a = placeRegion(rx, rz, cfg, SEED);
  const b = placeRegion(rx, rz, cfg, SEED);
  assert.deepEqual(a, b, `placeRegion deterministic @ ${rx},${rz}`);
}

// --- spawn legality + bounded + actually produces animals ------------------------
let total = 0;
let nonEmpty = 0;
const HARE = speciesById("alpine_hare");
const IBEX = speciesById("ibex");
const perRegionCap = HARE.regionMemberCap + IBEX.regionMemberCap; // both grounded species
for (let rx = -3; rx <= 3; rx++) {
  for (let rz = -3; rz <= 3; rz++) {
    const members = placeRegion(rx, rz, cfg, SEED);
    total += members.length;
    if (members.length) nonEmpty++;
    assert.ok(members.length <= perRegionCap, `region ${rx},${rz} within per-species caps (${members.length})`);
    for (const m of members) {
      const s = speciesById(m.speciesId);
      assert.ok(s, `member has a known species (${m.speciesId})`);
      assert.ok(habitatOK(m.x, m.z, s), `member spawned in legal habitat @ ${m.x.toFixed(1)},${m.z.toFixed(1)}`);
      assert.ok(Math.abs(m.y - getHeight(m.x, m.z)) < 1e-9, "member grounded on the terrain single source");
      assert.ok(getHeight(m.x, m.z) >= getWaterLevel(m.x, m.z), "member not submerged");
      assert.ok(getHeight(m.x, m.z) <= getActiveTerrainProfile().snowlineAt(m.x, m.z), "member below the snowline");
    }
  }
}
assert.ok(total > 100, `alpine world is populated (${total} animals across 49 regions)`);
assert.ok(nonEmpty > 10, `herds spread across regions (${nonEmpty} non-empty)`);

// --- snow_finch is ALOFT (Wildlife-1): the GROUNDED placeRegion never emits it ----
const finch = WILDLIFE_SPECIES.find((s) => s.id === "snow_finch");
assert.equal(finch.groundContract, "aloft", "snow_finch is an aloft species (placed by FlockPlacement, not placeRegion)");
for (let rx = -3; rx <= 3; rx++) {
  for (let rz = -3; rz <= 3; rz++) {
    assert.ok(!placeRegion(rx, rz, cfg, SEED).some((m) => m.speciesId === "snow_finch"), "grounded placeRegion never emits the aloft finch");
  }
}

// --- MOVEMENT legality: a relentless flee in EVERY direction never escapes habitat -
// Spawn a hare, then chase it from a slowly sweeping angle so its flee heading rotates
// through all directions (toward water, snow, and cliffs). The per-step habitat clamp
// must keep it in legal ground every frame — if the gate were removed it would walk
// into the trough or up a scree wall within a few hundred steps.
let start = null;
for (let z = -60; z <= 60 && !start; z += 2) {
  for (let x = -60; x <= 60; x += 2) {
    if (habitatOK(x, z, HARE)) start = { x, z };
  }
}
assert.ok(start, "found a hare start point");
const animal = spawnAnimal({
  speciesId: "alpine_hare",
  home: { x: start.x, z: start.z },
  x: start.x,
  z: start.z,
  y: getHeight(start.x, start.z),
  heading: 0,
  motionSeed: 99,
});
const CHASE_GAP = 5; // < hare panicDistance (12) → always fleeing, directly away from the threat
for (let step = 0; step < 2000; step++) {
  const ang = step * 0.05; // sweep the threat around so flee heading covers every direction
  updateAnimal(animal, 0.05, animal.x - Math.cos(ang) * CHASE_GAP, animal.z - Math.sin(ang) * CHASE_GAP);
  assert.ok(habitatOK(animal.x, animal.z, HARE), `fleeing hare stays in legal habitat (step ${step})`);
  assert.ok(getHeight(animal.x, animal.z) >= getWaterLevel(animal.x, animal.z), `fleeing hare never submerges (step ${step})`);
}

// --- rolling profile (no water/snow) stays deterministic + legal + bounded --------
setTerrainProfile(createTerrainProfile({ profile: "rolling" }));
for (const [rx, rz] of [[0, 0], [2, -1]]) {
  assert.deepEqual(placeRegion(rx, rz, cfg, SEED), placeRegion(rx, rz, cfg, SEED), "rolling deterministic");
}
let rtotal = 0;
for (let rx = -2; rx <= 2; rx++) {
  for (let rz = -2; rz <= 2; rz++) {
    const members = placeRegion(rx, rz, cfg, SEED);
    rtotal += members.length;
    for (const m of members) assert.ok(habitatOK(m.x, m.z, speciesById(m.speciesId)), "rolling member legal");
  }
}
assert.ok(rtotal > 0, "rolling world still hosts wildlife (slope-gated only)");
setTerrainProfile(createTerrainProfile({})); // restore alpine

// --- source scan: no Math.random / Date.now / performance.now in wildlife modules -
const wildlifeDir = path.join(process.cwd(), "src", "world", "wildlife");
for (const file of readdirSync(wildlifeDir)) {
  if (!file.endsWith(".js")) continue;
  const src = readFileSync(path.join(wildlifeDir, file), "utf8");
  // Require a call paren so prose mentions in comments ("no Math.random") don't trip it.
  assert.ok(!/Math\.random\s*\(|Date\.now\s*\(|performance\.now\s*\(/.test(src), `${file} calls no nondeterministic time/random`);
}

console.log(`wildlife placement regression passed (${total} alpine animals, ${nonEmpty} regions; deterministic; flee never submerges; rolling-safe; no Math.random)`);
