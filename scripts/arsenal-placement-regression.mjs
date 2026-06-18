// test:arsenal-placement — Node regression for Arsenal v3 (interactive placement CRUD +
// equip-to-hand). THREE runs headless (scene-graph ops only, no WebGL) like the v2 test.
// Exercises: PlacedWeaponRuntime.add/getEntry/remove; the equip-marker reparent math
// (group → player at handLocal − equipLocal); drop/store unequip; persist-mode descriptor
// state; hostile-descriptor + poisoned-marker rejection; and the isolation invariant
// extended to src/editor (no world/editor file imports the arsenal UI).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";

import { createWorldDocument } from "../src/world/WorldDocument.js";
import { generateWeaponRecipe } from "../src/arsenal/WeaponGrammar.js";
import { rollConfig } from "../src/arsenal/WeaponConfig.js";
import { PlacedAssetStore } from "../src/world/assets/PlacedAssetStore.js";
import { placeWeapon } from "../src/world/placement/WeaponPlacementTool.js";
import { PlacedWeaponRuntime } from "../src/world/placement/PlacedWeaponRuntime.js";
import { WeaponEquipRuntime } from "../src/world/placement/WeaponEquipRuntime.js";
import { getHeight } from "../src/terrain/terrainSampling.js";

const EPS = 1e-6;
const FLOAT_HEIGHT = 1.0;
const approx = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps;

function fakePlayer(x, z, facing = 0) {
  const mesh = new THREE.Group();
  mesh.name = "Player";
  return { mesh, position: new THREE.Vector3(x, 0, z), facing };
}

// --- setup: a world with two placed weapons --------------------------------------
const doc = createWorldDocument({});
const store = new PlacedAssetStore(doc);
const recipe1 = generateWeaponRecipe(rollConfig("v3-a", "sidearm"));
const placed1 = placeWeapon(store, recipe1, { x: 3, z: 4 });
assert.ok(placed1, "placeWeapon returns a descriptor");

const scene = new THREE.Scene();
const placedRuntime = new PlacedWeaponRuntime();
placedRuntime.load(doc, scene, null);
assert.equal(placedRuntime.entries.size, 1, "load rebuilt the placed weapon");
assert.ok(placedRuntime.getEntry(placed1.id), "getEntry finds the loaded weapon");

// --- CRUD: add a second weapon the interactive (click-to-place) way --------------
const recipe2 = generateWeaponRecipe(rollConfig("v3-b", "longarm"));
const placed2 = placeWeapon(store, recipe2, { x: 6, z: 1 }); // store pushes to the document
const e2 = placedRuntime.add(placed2); // runtime builds the THREE object
assert.ok(e2 && placedRuntime.getEntry(placed2.id), "add builds + registers a weapon");
assert.equal(placedRuntime.entries.size, 2, "two weapons live");
assert.equal(placedRuntime.add({ kind: "generated.weapon", recipe: { parts: [] }, transform: {} }), null, "hostile recipe rejected by add");
assert.equal(placedRuntime.add({ kind: "bogus", recipe: recipe1, transform: {} }), null, "bad kind rejected by add");

// --- equip-to-hand: reparent to the player at the inverted equip marker ----------
const equip = new WeaponEquipRuntime(placedRuntime, { scene });
equip.setStore(store);
const player = fakePlayer(10, -5, 0.3);
scene.add(player.mesh);

assert.equal(equip.equip(placed1.id, player), true, "equip succeeds");
const entry = placedRuntime.getEntry(placed1.id);
assert.equal(entry.group.parent, player.mesh, "weapon reparented onto the player");
const m = entry.group.userData.markers.equip;
assert.ok(Array.isArray(m) && m.every(Number.isFinite), "equip marker finite");
const hl = equip.handLocal;
assert.ok(approx(entry.group.position.x, hl.x - m[0]) && approx(entry.group.position.y, hl.y - m[1]) && approx(entry.group.position.z, hl.z - m[2]), "group placed at handLocal − equipLocal");
// the equip MARKER, in world space, coincides with the player-hand point
player.mesh.updateMatrixWorld(true);
const markerWorld = entry.group.getObjectByName("equip").getWorldPosition(new THREE.Vector3());
const handWorld = hl.clone().applyMatrix4(player.mesh.matrixWorld);
assert.ok(markerWorld.distanceTo(handWorld) < 1e-4, "equip marker sits at the player's hand in world space");
assert.ok([markerWorld.x, markerWorld.y, markerWorld.z].every(Number.isFinite), "equipped marker world finite");

// --- unequip "drop" → grounded in the world, idle --------------------------------
assert.equal(equip.unequip(player, "drop"), true, "drop unequip succeeds");
assert.equal(entry.group.parent, scene, "dropped weapon back in the scene");
assert.ok(approx(entry.group.position.y, getHeight(10, -5) + FLOAT_HEIGHT, 1e-5), "dropped weapon grounded at the player");
assert.ok(entry.group.visible, "dropped weapon visible");
assert.equal(store.list().find((i) => i.id === placed1.id).runtime.state, "idle", "descriptor state → idle on drop");

// --- unequip "store" → hidden, stored --------------------------------------------
equip.equip(placed1.id, player);
assert.equal(equip.unequip(player, "store"), true, "store unequip succeeds");
assert.equal(entry.group.visible, false, "stored weapon hidden");
const ds = store.list().find((i) => i.id === placed1.id);
assert.equal(ds.runtime.state, "stored", "descriptor state → stored");
assert.equal(ds.runtime.visible, false, "descriptor visible → false on store");

// --- persist mode → equip writes the descriptor ----------------------------------
equip.persistEquip = true;
assert.equal(equip.equip(placed1.id, player), true, "persist-mode equip succeeds");
const dp = store.list().find((i) => i.id === placed1.id);
assert.equal(dp.runtime.state, "equipped", "persist mode writes state → equipped");
assert.equal(dp.runtime.owner, "player", "persist mode writes owner → player");
equip.unequip(player, "drop");

// --- poisoned equip marker is refused (the one path with no validator) -----------
const eBad = placedRuntime.getEntry(placed2.id);
eBad.group.userData.markers.equip = [NaN, 0, 0];
assert.equal(equip.equip(placed2.id, player), false, "poisoned equip marker refused");
assert.equal(eBad.group.parent, scene, "refused weapon stays placed in the scene");

// --- remove detaches from the ACTUAL parent (even when equipped) ------------------
equip.persistEquip = false;
eBad.group.userData.markers.equip = [0.1, -0.2, 0.05]; // restore a finite marker
assert.equal(equip.equip(placed2.id, player), true, "equip placed2 after fixing marker");
assert.equal(eBad.group.parent, player.mesh, "placed2 equipped to player");
assert.equal(placedRuntime.remove(placed2.id), true, "remove a currently-equipped weapon");
assert.equal(eBad.group.parent, null, "removed weapon detached from the player (not just the scene)");
assert.equal(placedRuntime.getEntry(placed2.id), null, "removed weapon gone from entries");

// --- persist mechanism: a document persisted as "equipped" re-attaches on a FRESH load
const d1 = store.list().find((i) => i.id === placed1.id);
d1.runtime.state = "equipped"; // simulate a prior persist-mode session having saved this
const scene2 = new THREE.Scene();
const freshRuntime = new PlacedWeaponRuntime();
freshRuntime.load(doc, scene2, null);
const freshEquip = new WeaponEquipRuntime(freshRuntime, { scene: scene2 }); // persistEquip false (default)
freshEquip.setStore(store);
const player2 = fakePlayer(0, 0);
scene2.add(player2.mesh);
freshEquip.load(player2); // unconditional re-attach from the document, regardless of the flag
assert.equal(freshRuntime.getEntry(placed1.id).group.parent, player2.mesh, "persisted-equipped weapon re-attaches on load");

// --- toggleNearest respects EQUIP_RADIUS: equips an in-range weapon, ignores far ones
const doc3 = createWorldDocument({});
const store3 = new PlacedAssetStore(doc3);
const near = placeWeapon(store3, generateWeaponRecipe(rollConfig("near", "sidearm")), { x: 2, z: 0 });
const far = placeWeapon(store3, generateWeaponRecipe(rollConfig("far", "heavy")), { x: 50, z: 0 });
const scene3 = new THREE.Scene();
const runtime3 = new PlacedWeaponRuntime();
runtime3.load(doc3, scene3, null);
const equip3 = new WeaponEquipRuntime(runtime3, { scene: scene3 });
equip3.setStore(store3);
const player3 = fakePlayer(0, 0);
scene3.add(player3.mesh);
assert.equal(equip3.toggleNearest(player3, "drop"), true, "toggleNearest equips the in-range weapon");
assert.equal(runtime3.getEntry(near.id).group.parent, player3.mesh, "the NEAR weapon was equipped");
assert.equal(runtime3.getEntry(far.id).group.parent, scene3, "the FAR weapon (>EQUIP_RADIUS) stayed placed");
assert.equal(equip3.toggleNearest(player3, "drop"), true, "toggleNearest again unequips");
assert.equal(runtime3.getEntry(near.id).group.parent, scene3, "the weapon dropped back to the world");

// --- isolation: no src/world OR src/editor file imports the arsenal UI ------------
const offenders = [...walk("src/world"), ...walk("src/editor")].filter((f) => /WeaponWorkbench|arsenalMain/.test(fs.readFileSync(f, "utf8")));
assert.equal(offenders.length, 0, `world/editor must not import arsenal UI — offenders: ${offenders.join(", ")}`);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

console.log("arsenal placement regression passed (CRUD; equip marker reparent finite; drop/store/persist; hostile + poisoned rejected; isolation src/world+src/editor)");
