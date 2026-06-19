// test:first-objective — Node regression for FP-1 (relic weapon objective). THREE runs headless
// (scene-graph ops only, no WebGL). Exercises: the deterministic relic recipe; relic/cache site
// derivation on dry walkable ground; the `objectives` document block round-trip (the persistence
// whitelist — `completed` survives as a literal, hostile cache dropped, radius clamped, zero
// warnings when empty); ObjectiveStore self-heal; ObjectiveRuntime spawn-if-absent + idempotent
// reload (no double-spawn, one beacon, markers disposed); the in-zone deposit (relic onto the
// pedestal + completed) vs out-of-zone drop vs not-holding; and persistence of completion + the
// relic's pedestal transform across a save→load round-trip.

import assert from "node:assert/strict";
import * as THREE from "three";

import { createWorldDocument } from "../src/world/WorldDocument.js";
import { validateWorldDocument } from "../src/world/WorldValidation.js";
import { sanitizeWeaponRecipe } from "../src/arsenal/WeaponRecipeValidation.js";
import { PlacedAssetStore } from "../src/world/assets/PlacedAssetStore.js";
import { PlacedWeaponRuntime } from "../src/world/placement/PlacedWeaponRuntime.js";
import { WeaponEquipRuntime } from "../src/world/placement/WeaponEquipRuntime.js";
import { getHeight } from "../src/terrain/terrainSampling.js";
import { normalizeObjectiveDescriptor, sanitizeObjectivesBlock } from "../src/world/objectives/ObjectiveTypes.js";
import { ObjectiveStore } from "../src/world/objectives/ObjectivePersistence.js";
import { ObjectiveRuntime } from "../src/world/objectives/ObjectiveRuntime.js";
import { RELIC_ID, OBJECTIVE_KIND, relicRecipe, deriveSites, isWalkable, livePhase, bannerText } from "../src/world/objectives/RelicWeaponObjective.js";
import { relicBannerText } from "../src/world/objectives/RelicPresentation.js";
import { weaponName } from "../src/arsenal/WeaponIdentity.js";

const approx = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps;

function fakePlayer(x, z, facing = 0) {
  const mesh = new THREE.Group();
  mesh.name = "Player";
  mesh.position.set(x, 0, z);
  return { mesh, position: new THREE.Vector3(x, 0, z), facing, velocityY: 0, syncMesh() {} };
}

function countNamed(scene, name) {
  let n = 0;
  scene.traverse((o) => {
    if (o.name === name) n++;
  });
  return n;
}

// --- 1. deterministic relic recipe is a valid weapon -----------------------------------------
const r1 = relicRecipe();
const r2 = relicRecipe();
assert.ok(sanitizeWeaponRecipe(r1), "relic recipe passes sanitizeWeaponRecipe (non-null)");
assert.deepEqual(r1, r2, "relic recipe is deterministic");

// --- 2. deriveSites: deterministic, dry walkable ground, separated ---------------------------
const spawn = { x: 4, z: -6 };
const s1 = deriveSites(spawn);
const s2 = deriveSites(spawn);
assert.deepEqual(s1, s2, "deriveSites deterministic for the same spawn");
assert.ok(isWalkable(s1.relic.x, s1.relic.z), "relic site is on dry walkable ground");
assert.ok(isWalkable(s1.cache.x, s1.cache.z), "cache site is on dry walkable ground");
assert.ok([s1.cache.x, s1.cache.y, s1.cache.z].every(Number.isFinite), "cache is finite");
const sep = Math.hypot(s1.relic.x - s1.cache.x, s1.relic.z - s1.cache.z);
assert.ok(sep > 10, `relic and cache are separated (carrying required): ${sep.toFixed(1)}`);
assert.ok(s1.radius >= 1 && s1.radius <= 40, "radius in range");

// --- 3. objectives block round-trip + whitelist ----------------------------------------------
const emptyWarnings = [];
const emptyBlock = sanitizeObjectivesBlock({ version: 1, items: [] }, emptyWarnings);
assert.equal(emptyWarnings.length, 0, "empty objectives block produces zero warnings");
assert.deepEqual(emptyBlock, { version: 1, items: [] }, "empty block sanitizes to empty");
assert.ok(createWorldDocument({}).objectives, "createWorldDocument seeds an objectives block");

const goodCache = { x: 1, y: 2, z: 3 };
const incomplete = normalizeObjectiveDescriptor({ kind: OBJECTIVE_KIND, id: OBJECTIVE_KIND, relicId: RELIC_ID, cache: goodCache, radius: 4, completed: false });
assert.equal(incomplete.completed, false, "completed:false is emitted as a literal (not undefined)");
assert.ok("completed" in incomplete, "completed key is always present");
const done = normalizeObjectiveDescriptor({ kind: OBJECTIVE_KIND, relicId: RELIC_ID, cache: goodCache, radius: 4, completed: true });
assert.equal(done.completed, true, "completed:true survives");
assert.equal(normalizeObjectiveDescriptor({ kind: OBJECTIVE_KIND, relicId: RELIC_ID, cache: { x: NaN, y: 0, z: 0 }, radius: 4 }), null, "non-finite cache → objective dropped");
assert.equal(normalizeObjectiveDescriptor({ kind: OBJECTIVE_KIND, cache: goodCache, radius: 4 }), null, "missing relicId → objective dropped");
assert.equal(normalizeObjectiveDescriptor({ kind: "bogus", relicId: RELIC_ID, cache: goodCache }), null, "unknown kind → dropped");
assert.equal(normalizeObjectiveDescriptor({ kind: OBJECTIVE_KIND, relicId: RELIC_ID, cache: goodCache, radius: 9999 }).radius, 40, "huge radius clamped");

// document round-trip: completed:false survives JSON + re-validation as a literal key
const docRT = createWorldDocument({ objectives: { version: 1, items: [{ kind: OBJECTIVE_KIND, id: OBJECTIVE_KIND, relicId: RELIC_ID, cache: goodCache, radius: 4, completed: false }] } });
const v1 = validateWorldDocument(docRT);
assert.equal(v1.document.objectives.items.length, 1, "objective survives validation");
assert.equal(v1.document.objectives.items[0].completed, false, "completed:false survives validation");
const v2 = validateWorldDocument(JSON.parse(JSON.stringify(v1.document))).document; // simulate save→load
assert.equal(v2.objectives.items[0].completed, false, "completed:false survives save→load round-trip");
assert.ok(!v1.warnings.some((w) => /objective/i.test(w)), "no objective warnings on a valid doc");

// --- 4. ObjectiveStore self-heals + adds in place --------------------------------------------
const bare = {};
const heal = new ObjectiveStore(bare);
assert.deepEqual(bare.objectives, { version: 1, items: [] }, "ObjectiveStore self-heals a missing block");
heal.add({ kind: OBJECTIVE_KIND, id: OBJECTIVE_KIND, relicId: RELIC_ID, cache: goodCache, radius: 4, completed: false });
assert.equal(heal.list().length, 1, "add pushes into the document block");
assert.equal(heal.getByKind(OBJECTIVE_KIND)?.relicId, RELIC_ID, "getByKind finds it");

// --- 5. ObjectiveRuntime.load: spawn-if-absent + idempotent reload ----------------------------
const doc = createWorldDocument({});
const store = new PlacedAssetStore(doc);
const scene = new THREE.Scene();
const placedWeapons = new PlacedWeaponRuntime();
placedWeapons.load(doc, scene, null); // empty runtimeAssets → no weapons yet
const equip = new WeaponEquipRuntime(placedWeapons, { scene });
equip.setStore(store);
const player = fakePlayer(0, 0);
scene.add(player.mesh);
const objective = new ObjectiveRuntime();

const spawned = objective.load({ player, scene, placedAssetStore: store, placedWeaponRuntime: placedWeapons, weaponEquipRuntime: equip, document: doc });
assert.equal(spawned, true, "first load spawns the relic (returns true)");
assert.ok(store.list().some((i) => i.id === RELIC_ID), "relic added to runtimeAssets");
assert.ok(placedWeapons.getEntry(RELIC_ID), "relic THREE object built");
assert.equal(doc.objectives.items.length, 1, "objective entry created");
assert.equal(objective.entry.completed, false, "objective starts incomplete");
assert.equal(countNamed(scene, "ObjectiveCacheBeacon"), 1, "one cache beacon");
assert.equal(countNamed(scene, "ObjectiveRelicMarker"), 1, "one relic marker");

const spawned2 = objective.load({ player, scene, placedAssetStore: store, placedWeaponRuntime: placedWeapons, weaponEquipRuntime: equip, document: doc });
assert.equal(spawned2, false, "second load does NOT re-spawn (idempotent)");
assert.equal(store.list().filter((i) => i.id === RELIC_ID).length, 1, "still exactly one relic");
assert.equal(doc.objectives.items.length, 1, "still exactly one objective");
assert.equal(countNamed(scene, "ObjectiveCacheBeacon"), 1, "old beacon disposed — still one");

// --- 6. tryDeposit: in-zone → pedestal + complete; out-of-zone → drop; not holding → false ----
assert.equal(objective.tryDeposit(player), false, "not holding the relic → tryDeposit returns false");
assert.equal(equip.equip(RELIC_ID, player, "rightHand"), true, "equip the relic");
// out of zone (player at origin, cache far): deposit drops, does not complete
objective.update(0, player);
assert.equal(objective.debugSnapshot().inZone, false, "player starts out of the cache zone");
assert.equal(objective.tryDeposit(player), true, "holding relic out-of-zone → consumed (drop)");
assert.equal(objective.entry.completed, false, "out-of-zone deposit does not complete");
assert.equal(store.list().find((i) => i.id === RELIC_ID).runtime.state, "idle", "relic dropped (idle, visible)");

// now: equip again, move into the zone, deposit → pedestal + complete
equip.equip(RELIC_ID, player, "rightHand");
const cache = objective.entry.cache;
player.position.set(cache.x, 0, cache.z);
objective.update(0, player);
assert.equal(objective.debugSnapshot().inZone, true, "player now in the cache zone");
assert.equal(objective.tryDeposit(player), true, "in-zone deposit succeeds");
assert.equal(objective.entry.completed, true, "objective completed");
assert.equal(equip.equippedId, null, "relic unequipped on deposit");
const rd = store.list().find((i) => i.id === RELIC_ID);
assert.ok(approx(rd.transform.position.x, cache.x) && approx(rd.transform.position.z, cache.z), "relic descriptor moved to the cache");
assert.ok(rd.transform.position.y > getHeight(cache.x, cache.z), "relic rests above the cache ground (pedestal)");
assert.equal(rd.runtime.state, "idle", "relic idle (a visible trophy, not stored/hidden)");
assert.equal(rd.runtime.visible, true, "relic visible on the pedestal");

// --- 7. completion + pedestal transform survive save→load -------------------------------------
const reloaded = validateWorldDocument(JSON.parse(JSON.stringify(doc))).document;
assert.equal(reloaded.objectives.items[0].completed, true, "completed survives reload");
const rrd = reloaded.runtimeAssets.items.find((i) => i.id === RELIC_ID);
assert.ok(approx(rrd.transform.position.x, cache.x) && approx(rrd.transform.position.z, cache.z), "relic pedestal transform survives reload");

// --- 8. livePhase truth table -----------------------------------------------------------------
assert.equal(livePhase({}), "find");
assert.equal(livePhase({ relicEquipped: true }), "carry");
assert.equal(livePhase({ relicEquipped: true, inZone: true }), "atCache");
assert.equal(livePhase({ completed: true }), "complete");
assert.equal(livePhase({ relicEquipped: true, inZone: true, completed: true }), "complete", "completed wins");

// --- 9. relic banner presentation (Arsenal v5) ------------------------------------------------
{
  const rRecipe = relicRecipe();
  const name = weaponName(rRecipe);
  const banner = relicBannerText("find", rRecipe, { relicGrade: true });
  assert.ok(banner.startsWith("Relic · "), "banner leads with the relic-grade tier label");
  assert.ok(banner.includes(name), "banner contains the derived relic name");
  assert.ok(banner.includes("equip it (F)"), "banner preserves the phase action copy");
  assert.ok(!banner.startsWith("Relic Objective"), "the canonical prefix is replaced, not duplicated");
  // No recipe → graceful fall back to the plain canonical phase copy (no name, no crash).
  assert.equal(relicBannerText("carry", null), bannerText("carry"), "missing recipe → plain phase copy");
  assert.equal(relicBannerText("complete", undefined), bannerText("complete"), "undefined recipe → plain phase copy");
}

console.log("first-objective regression passed (deterministic relic + dry sites; objectives round-trip + completed-literal; self-heal; spawn-if-absent + idempotent reload + beacon dispose; deposit pedestal/drop/no-op; persistence; phase table)");
