// test:first-playable-hidden — FP-3 hidden-issue sweep (Node half). The deterministic/pure-logic
// hostile probes that don't need a browser: spawn safety (dry/walkable site resolution), proof-drift
// (determinism across reloads), hostile dt (finite under finite extremes), region-border thrash (the
// shared streamer never oscillates), and store/equip/drop reload state. The browser half
// (scripts/browser-first-playable-hidden-proof.mjs) covers the live/integrated cases. Headless THREE.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import * as THREE from "three";

import { createTerrainProfile } from "../src/terrain/profiles/index.js";
import { setTerrainProfile, getHeight, getWaterLevel, getSlope, findGoodSpawn } from "../src/terrain/terrainSampling.js";
import { deriveSites, isWalkable, relicRecipe, RELIC_ID } from "../src/world/objectives/RelicWeaponObjective.js";
import { createWildlifeConfig } from "../src/world/wildlife/WildlifeConfig.js";
import { placeRegion as placeWildlifeRegion } from "../src/world/wildlife/WildlifePlacement.js";
import { placeFlockRegion } from "../src/world/wildlife/FlockPlacement.js";
import { spawnAnimal, updateAnimal } from "../src/world/wildlife/WildlifeRuntime.js";
import { spawnFlock, updateFlock } from "../src/world/wildlife/FlockRuntime.js";
import { createAmbientConfig } from "../src/world/ambient/AmbientConfig.js";
import { placeRegion as placeMoteRegion } from "../src/world/ambient/AmbientPlacement.js";
import { spawnMote, updateMote } from "../src/world/ambient/AmbientRuntime.js";
import { RegionStreamer } from "../src/world/streaming/RegionStreamer.js";
import { createWorldDocument } from "../src/world/WorldDocument.js";
import { generateWeaponRecipe } from "../src/arsenal/WeaponGrammar.js";
import { rollConfig } from "../src/arsenal/WeaponConfig.js";
import { PlacedAssetStore } from "../src/world/assets/PlacedAssetStore.js";
import { placeWeapon } from "../src/world/placement/WeaponPlacementTool.js";
import { PlacedWeaponRuntime } from "../src/world/placement/PlacedWeaponRuntime.js";
import { WeaponEquipRuntime } from "../src/world/placement/WeaponEquipRuntime.js";

function fakePlayer(x, z, facing = 0) {
  const mesh = new THREE.Group();
  mesh.name = "Player";
  mesh.position.set(x, 0, z);
  mesh.rotation.y = facing;
  return { mesh, position: new THREE.Vector3(x, 0, z), facing };
}
const finite3 = (p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

// =============================================================================
// A. Spawn safety — player spawn + relic + cache resolve to dry / walkable ground
// =============================================================================
setTerrainProfile(createTerrainProfile({})); // alpine glacial valley (the first-playable profile)

// The water is real: at least one submerged point exists in the valley (so the dry-spawn guard is
// non-trivial — if it didn't, findGoodSpawn's "never pick a submerged spot" check would be vacuous).
let wet = null;
for (let z = -60; z <= 160 && !wet; z += 2) {
  for (let x = -120; x <= 120 && !wet; x += 2) {
    if (getHeight(x, z) < getWaterLevel(x, z)) wet = { x, z };
  }
}
assert.ok(wet, "a submerged point exists in the alpine valley (the dry-spawn guard is meaningful)");

// findGoodSpawn never returns a submerged point (the spawn-in-water guard).
const spawn = findGoodSpawn();
assert.ok(Number.isFinite(spawn.x) && Number.isFinite(spawn.z), "findGoodSpawn is finite");
assert.ok(getHeight(spawn.x, spawn.z) >= getWaterLevel(spawn.x, spawn.z), "spawn is dry (not submerged)");

// The relic + cache derive onto dry, walkable, below-snowline ground and are separated (carry required).
const sites = deriveSites(spawn);
assert.ok(isWalkable(sites.relic.x, sites.relic.z), "relic site is dry/walkable/below-snowline");
assert.ok(isWalkable(sites.cache.x, sites.cache.z), "cache site is dry/walkable/below-snowline");
const sep = Math.hypot(sites.relic.x - sites.cache.x, sites.relic.z - sites.cache.z);
assert.ok(sep > 10, `relic and cache are separated (${sep.toFixed(1)} units) — the loop requires carrying`);

// =============================================================================
// B. Proof drift — terrain / water / slope / sites / recipe are byte-identical across reloads
// =============================================================================
const DRIFT_SEED = 8125;
function worldSnapshot() {
  setTerrainProfile(createTerrainProfile({ seed: DRIFT_SEED })); // a fresh profile instance == a reload
  return {
    height: [getHeight(0, 0), getHeight(50, 30), getHeight(-40, 80), getHeight(120, -60)],
    water: [getWaterLevel(0, 0), getWaterLevel(50, 30), getWaterLevel(-40, 80)],
    slope: [getSlope(10, 10), getSlope(-20, 40), getSlope(70, 70)],
    sites: deriveSites({ x: 0, z: 0 }),
    recipe: JSON.stringify(relicRecipe()),
  };
}
assert.deepEqual(worldSnapshot(), worldSnapshot(), "terrain/water/slope/sites/recipe are byte-identical across reloads (no drift)");

// Defense-in-depth: the witnessed paths (objectives + terrain + the relic recipe modules) call no
// nondeterministic time/random — the drift root cause. (The section-B deepEqual is the BEHAVIORAL
// guard for terrain; this static scan covers the same paths so a stray Math.random surfaces twice.)
function jsFilesUnder(dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) jsFilesUnder(p, out);
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}
const detFiles = [
  ...jsFilesUnder(path.join(process.cwd(), "src", "world", "objectives")),
  ...jsFilesUnder(path.join(process.cwd(), "src", "terrain")),
  path.join(process.cwd(), "src", "arsenal", "WeaponGrammar.js"),
  path.join(process.cwd(), "src", "arsenal", "WeaponConfig.js"),
];
for (const file of detFiles) {
  const src = readFileSync(file, "utf8");
  assert.ok(!/Math\.random\s*\(|Date\.now\s*\(|performance\.now\s*\(/.test(src), `${path.relative(process.cwd(), file)} calls no nondeterministic time/random`);
}

// =============================================================================
// C. Hostile dt — player-driven actors stay FINITE under finite extremes {0, 1e6, -1}
//    NaN is out of scope: the frame loop (Math.min((now-last)/1000, 0.05)) guarantees a finite,
//    non-negative dt; flock/mote additionally early-return on dt<=0. We probe the reachable +
//    defensive extremes (a huge stalled frame, a zero frame, a backwards clock) and prove finiteness.
// =============================================================================
setTerrainProfile(createTerrainProfile({})); // alpine
const HOSTILE_DT = [0, 1e6, -1];

// grounded animal (the gap — WildlifeRuntime has no dt<=0 early-return; relies on the MAX_STEP clamp)
const animal = spawnAnimal({ speciesId: "alpine_hare", home: { x: 0, z: 0 }, x: 0, z: 0, y: getHeight(0, 0), heading: 0, motionSeed: 7 });
for (const dt of HOSTILE_DT) {
  updateAnimal(animal, dt, animal.x - 5, animal.z); // a close threat to provoke a flee step
  assert.ok(finite3(animal), `grounded animal stays finite under dt=${dt}`);
}
updateAnimal(animal, 0.05, animal.x - 5, animal.z); // recover with a normal step
assert.ok(finite3(animal), "grounded animal still finite after a normal recovery step");

// flock (aloft) — re-affirm the FP probe end-to-end (FlockRuntime guards dt<=0 + clamps high)
const wcfg = createWildlifeConfig({ density: 3 });
let flockDesc = null;
for (let rx = -3; rx <= 3 && !flockDesc; rx++) for (let rz = -3; rz <= 3 && !flockDesc; rz++) {
  const fs = placeFlockRegion(rx, rz, wcfg, 4242);
  if (fs.length) flockDesc = fs[0];
}
assert.ok(flockDesc, "found a flock descriptor to drive");
const flock = spawnFlock(flockDesc);
for (const dt of HOSTILE_DT) {
  updateFlock(flock, dt, 0, 0);
  assert.ok(Number.isFinite(flock.center.x) && Number.isFinite(flock.center.z), `flock stays finite under dt=${dt}`);
}

// mote (ambient) — AmbientRuntime guards dt<=0 + clamps high
const acfg = createAmbientConfig({ density: 3 });
let moteDesc = null;
for (let rx = -3; rx <= 3 && !moteDesc; rx++) for (let rz = -3; rz <= 3 && !moteDesc; rz++) {
  const ms = placeMoteRegion(rx, rz, acfg, 9137);
  if (ms.length) moteDesc = ms[0];
}
assert.ok(moteDesc, "found a mote descriptor to drive");
const mote = spawnMote(moteDesc);
for (const dt of HOSTILE_DT) {
  updateMote(mote, dt, { x: 0, z: 0 }, 0, 0);
  assert.ok(finite3(mote) && mote.scale > 0, `mote stays finite (+positive scale) under dt=${dt}`);
}

// =============================================================================
// D. Region-border thrash — oscillating the camera in the hysteresis band adds each region ≤ once
//    (the shared RegionStreamer feeds wildlife + flocks + motes, so this proves no-thrash for all
//    three). A broken hysteresis (keep==visible) would drop+re-add a boundary region every step.
// =============================================================================
function makeStreamer() {
  return new RegionStreamer({
    getRegionSize: () => 64,
    getVisibleDistance: () => 140,
    getKeepDistance: () => 180, // keep − visible = 40 unit hysteresis gap
    maxItems: 100000,
    buildRegion: (rx, rz, cx, cz) => ({ items: [0], center: { x: cx, z: cz } }),
    countItems: (r) => r.items.length,
  });
}
{
  const s = makeStreamer();
  const addCount = new Map();
  let prev = new Set();
  // Oscillate ±25 across the x=64 border (amplitude < the 40-unit gap → no region ever exits keep
  // range once entered, so each region is BUILT at most once over the whole sweep).
  for (let i = 0; i < 80; i++) {
    s.update(i % 2 === 0 ? 0 : 25, 0);
    const cur = new Set(s.regions.keys());
    for (const k of cur) if (!prev.has(k)) addCount.set(k, (addCount.get(k) ?? 0) + 1);
    prev = cur;
  }
  let maxAdds = 0;
  for (const c of addCount.values()) maxAdds = Math.max(maxAdds, c);
  assert.ok(maxAdds <= 1, `every region built at most once under oscillation (no thrash) — worst was ${maxAdds}`);

  // idempotent at rest: re-updating at a fixed position changes nothing.
  const before = [...s.regions.keys()];
  s.update(0, 0);
  assert.deepEqual([...s.regions.keys()], before, "re-update at a fixed position changes nothing");
}

// =============================================================================
// E. Store / equip / drop reload state — each persisted runtime state round-trips correctly
// =============================================================================
const recipe = generateWeaponRecipe(rollConfig("fp3-store", "longarm"));

function roundTripLoad(state, slot, visible) {
  const doc0 = createWorldDocument({});
  const store0 = new PlacedAssetStore(doc0);
  const placed = placeWeapon(store0, recipe, { x: 0, z: 0 });
  const d = store0.list().find((i) => i.id === placed.id);
  d.runtime.state = state;
  d.runtime.slot = slot;
  d.runtime.visible = visible;
  // round-trip through the sanitizer (a save→load), then load fresh.
  const reDoc = createWorldDocument({ runtimeAssets: { version: 1, items: store0.list() } });
  const reStore = new PlacedAssetStore(reDoc);
  const scene = new THREE.Scene();
  const runtime = new PlacedWeaponRuntime();
  runtime.load(reDoc, scene, null);
  const equip = new WeaponEquipRuntime(runtime, { scene });
  equip.setStore(reStore);
  const player = fakePlayer(0, 0);
  scene.add(player.mesh);
  equip.load(player);
  return { equip, runtime, player, id: placed.id };
}

// equipped@hip → re-attaches to the hip slot on the player
{
  const r = roundTripLoad("equipped", "hip", true);
  assert.equal(r.equip.equippedId, r.id, "equipped state re-attaches on reload");
  assert.equal(r.equip.equippedSlot, "hip", "re-attaches to the persisted slot (hip)");
  assert.equal(r.runtime.getEntry(r.id).group.parent, r.player.mesh, "re-attached onto the player");
}
// stored → NOT equipped + hidden + not parented to the player
{
  const r = roundTripLoad("stored", null, false);
  assert.equal(r.equip.equippedId, null, "stored state is not equipped on reload");
  assert.equal(r.runtime.getEntry(r.id).group.visible, false, "stored weapon stays hidden");
  assert.notEqual(r.runtime.getEntry(r.id).group.parent, r.player.mesh, "stored weapon is not on the player");
}
// idle (dropped) → NOT equipped + visible in the world
{
  const r = roundTripLoad("idle", null, true);
  assert.equal(r.equip.equippedId, null, "dropped/idle state is not equipped on reload");
  assert.equal(r.runtime.getEntry(r.id).group.visible, true, "dropped weapon stays visible in the world");
}
// transient equip (persist OFF) does NOT persist → not equipped after reload
{
  const doc0 = createWorldDocument({});
  const store0 = new PlacedAssetStore(doc0);
  const placed = placeWeapon(store0, recipe, { x: 0, z: 0 });
  const scene = new THREE.Scene();
  const runtime = new PlacedWeaponRuntime();
  runtime.load(doc0, scene, null);
  const equip = new WeaponEquipRuntime(runtime, { scene });
  equip.setStore(store0);
  const player = fakePlayer(0, 0);
  scene.add(player.mesh);
  equip.persistEquip = false; // default — equip() must not write the equipped state
  equip.equip(placed.id, player, "hip");
  assert.notEqual(store0.list().find((i) => i.id === placed.id).runtime.state, "equipped", "transient equip does not persist the equipped state");
  const reDoc = createWorldDocument({ runtimeAssets: { version: 1, items: store0.list() } });
  const reStore = new PlacedAssetStore(reDoc);
  const scene2 = new THREE.Scene();
  const runtime2 = new PlacedWeaponRuntime();
  runtime2.load(reDoc, scene2, null);
  const equip2 = new WeaponEquipRuntime(runtime2, { scene: scene2 });
  equip2.setStore(reStore);
  const player2 = fakePlayer(0, 0);
  scene2.add(player2.mesh);
  equip2.load(player2);
  assert.equal(equip2.equippedId, null, "a transient (persist-off) equip is not restored on reload");
}

// =============================================================================
// F. Poisoned equip marker is refused WITHOUT reparent/orphan (headless — enforced even when
//    Chromium is absent, so equip-refusal is not browser-only; mirrors the live POISON_CHECK probe)
// =============================================================================
{
  const doc = createWorldDocument({});
  const store = new PlacedAssetStore(doc);
  const placed = placeWeapon(store, recipe, { x: 3, z: 1 });
  const scene = new THREE.Scene();
  const runtime = new PlacedWeaponRuntime();
  runtime.load(doc, scene, null);
  const equip = new WeaponEquipRuntime(runtime, { scene });
  equip.setStore(store);
  const player = fakePlayer(0, 0);
  scene.add(player.mesh);
  const e = runtime.getEntry(placed.id);
  e.group.userData.markers.equip = [NaN, 0, 0]; // poison the equip marker
  assert.equal(equip.equip(placed.id, player, "rightHand"), false, "poisoned equip marker is refused");
  assert.equal(e.group.parent, scene, "refused weapon stays placed in the scene (not orphaned onto the player)");
  assert.equal(equip.equippedId, null, "nothing is equipped after a poisoned refusal");
}

// keep the relic id referenced so a rename surfaces here too
assert.equal(RELIC_ID, "relic-weapon-fp1", "relic id is the fixed spawn-if-absent id");

console.log("first-playable hidden regression passed (spawn safety; no drift; hostile-dt finite; no region thrash; store/equip/drop reload; poisoned-marker refusal)");
