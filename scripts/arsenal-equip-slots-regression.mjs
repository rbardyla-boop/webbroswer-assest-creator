// test:arsenal-equip-slots — Node regression for Arsenal v4 (oriented equip slots + multi-slot
// attachment). THREE runs headless (scene-graph ops only, no WebGL), like the v2/v3 arsenal tests.
// Exercises: the marker-transform contract (WeaponMarkerTransforms) + slot table (WeaponEquipSlots);
// the CORE invariant that after `equip(id, player, slot)` the weapon's `equip` marker lands exactly
// on the chosen slot in world space, oriented, for EACH of rightHand/back/hip; that rightHand
// reduces to the v3 position-only result; the `runtime.slot` persistence round-trip through the
// descriptor sanitizer; slot cleared on drop/store; persisted-equipped re-attaches to its slot on a
// fresh load; poisoned equip marker refused; and the src/world+src/editor isolation invariant.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";

import { createWorldDocument } from "../src/world/WorldDocument.js";
import { generateWeaponRecipe } from "../src/arsenal/WeaponGrammar.js";
import { rollConfig } from "../src/arsenal/WeaponConfig.js";
import { PlacedAssetStore } from "../src/world/assets/PlacedAssetStore.js";
import { normalizeRuntimeAssetDescriptor } from "../src/world/assets/RuntimeAssetTypes.js";
import { placeWeapon } from "../src/world/placement/WeaponPlacementTool.js";
import { PlacedWeaponRuntime } from "../src/world/placement/PlacedWeaponRuntime.js";
import { WeaponEquipRuntime } from "../src/world/placement/WeaponEquipRuntime.js";
import { equipMatrix, markerTransform, markersAllFinite } from "../src/world/placement/WeaponMarkerTransforms.js";
import { slotMatrix, nextSlot, isSlot, SLOT_NAMES, SLOT_CYCLE, PLAYER_SLOTS } from "../src/world/placement/WeaponEquipSlots.js";

const approx = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps;

function fakePlayer(x, z, facing = 0) {
  const mesh = new THREE.Group();
  mesh.name = "Player";
  mesh.position.set(x, 0, z); // mirror Player.syncMesh (position + facing → the mesh)
  mesh.rotation.y = facing;
  return { mesh, position: new THREE.Vector3(x, 0, z), facing };
}

// --- 1. marker-transform contract + slot table are finite -----------------------------------
const recipe = generateWeaponRecipe(rollConfig("v4-a", "longarm"));
const probe = new PlacedWeaponRuntime();
const probeDoc = createWorldDocument({});
const probeStore = new PlacedAssetStore(probeDoc);
const probePlaced = placeWeapon(probeStore, recipe, { x: 0, z: 0 });
probe.load(probeDoc, new THREE.Scene(), null);
const probeMarkers = probe.getEntry(probePlaced.id).group.userData.markers;
assert.ok(markersAllFinite(probeMarkers), "all markers finite via the contract");
assert.ok(equipMatrix(probeMarkers), "equipMatrix returns a finite matrix");
for (const k of ["muzzle", "core", "equip", "socket"]) {
  const t = markerTransform(probeMarkers, k);
  assert.ok(t && [t.position.x, t.position.y, t.position.z].every(Number.isFinite), `markerTransform(${k}) finite position`);
  assert.ok([t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w].every(Number.isFinite), `markerTransform(${k}) finite rotation`);
}
for (const name of SLOT_NAMES) {
  const m = slotMatrix(name);
  assert.ok(m && m.elements.every(Number.isFinite), `slotMatrix(${name}) finite`);
}
assert.equal(slotMatrix("nope"), null, "unknown slot → null matrix");
assert.equal(equipMatrix({ equip: [NaN, 0, 0] }), null, "non-finite equip marker → null matrix");
assert.deepEqual([...SLOT_CYCLE], ["rightHand", "back", "hip"], "slot cycle order");
assert.equal(nextSlot("rightHand"), "back");
assert.equal(nextSlot("back"), "hip");
assert.equal(nextSlot("hip"), "rightHand");
assert.equal(nextSlot(null), "rightHand", "unknown slot cycles to rightHand");

// --- 2. CORE invariant: the equip marker lands exactly on each slot, oriented ----------------
const doc = createWorldDocument({});
const store = new PlacedAssetStore(doc);
const placed = placeWeapon(store, recipe, { x: 3, z: 4 });
const scene = new THREE.Scene();
const runtime = new PlacedWeaponRuntime();
runtime.load(doc, scene, null);
const equip = new WeaponEquipRuntime(runtime, { scene });
equip.setStore(store);
const player = fakePlayer(10, -5, 0.7);
scene.add(player.mesh);

for (const slot of SLOT_NAMES) {
  assert.equal(equip.equip(placed.id, player, slot), true, `equip to ${slot} succeeds`);
  assert.equal(equip.equippedSlot, slot, `equippedSlot is ${slot}`);
  const entry = runtime.getEntry(placed.id);
  assert.equal(entry.group.parent, player.mesh, `weapon parented to the Player for ${slot}`);
  player.mesh.updateMatrixWorld(true);

  // (a) position: the `equip` marker node sits exactly at the slot origin in world space.
  const markerWorld = entry.group.getObjectByName("equip").getWorldPosition(new THREE.Vector3());
  const slotWorld = new THREE.Vector3().fromArray(PLAYER_SLOTS[slot].localPosition).applyMatrix4(player.mesh.matrixWorld);
  assert.ok(markerWorld.distanceTo(slotWorld) < 1e-4, `${slot}: equip marker coincides with the slot in world space`);
  assert.ok([markerWorld.x, markerWorld.y, markerWorld.z].every(Number.isFinite), `${slot}: marker world finite`);

  // (b) orientation: weapon world quaternion == playerWorldQuat × slotQuat.
  const playerQ = player.mesh.getWorldQuaternion(new THREE.Quaternion());
  const slotQ = new THREE.Quaternion().fromArray(PLAYER_SLOTS[slot].localRotation).normalize();
  const expectedQ = playerQ.multiply(slotQ);
  const weaponQ = entry.group.getWorldQuaternion(new THREE.Quaternion());
  assert.ok(weaponQ.angleTo(expectedQ) < 1e-4, `${slot}: weapon oriented to the slot`);
}

// --- 3. rightHand reduces EXACTLY to the v3 position-only result ------------------------------
equip.equip(placed.id, player, "rightHand");
const e = runtime.getEntry(placed.id);
const m = e.group.userData.markers.equip;
const hl = equip.handLocal;
assert.ok(approx(e.group.position.x, hl.x - m[0]) && approx(e.group.position.y, hl.y - m[1]) && approx(e.group.position.z, hl.z - m[2]), "rightHand position == handLocal − equip (v3 result)");
assert.ok(e.group.quaternion.angleTo(new THREE.Quaternion()) < 1e-6, "rightHand orientation is identity (v3 result)");

// --- 4. cycleSlot walks rightHand → back → hip → rightHand ------------------------------------
assert.equal(equip.equippedSlot, "rightHand");
equip.cycleSlot(player);
assert.equal(equip.equippedSlot, "back", "cycle → back");
equip.cycleSlot(player);
assert.equal(equip.equippedSlot, "hip", "cycle → hip");
equip.cycleSlot(player);
assert.equal(equip.equippedSlot, "rightHand", "cycle wraps → rightHand");
assert.equal(runtime.getEntry(placed.id).group.parent, player.mesh, "stays parented to the player across cycles");

// --- 5. runtime.slot round-trips the descriptor sanitizer -------------------------------------
const okSlot = normalizeRuntimeAssetDescriptor({ kind: "generated.weapon", recipe, transform: {}, runtime: { state: "equipped", slot: "hip" } });
assert.equal(okSlot.runtime.slot, "hip", "valid slot survives normalization");
assert.equal(okSlot.runtime.state, "equipped", "state survives normalization");
const badSlot = normalizeRuntimeAssetDescriptor({ kind: "generated.weapon", recipe, transform: {}, runtime: { slot: "pocket" } });
assert.equal(badSlot.runtime.slot, null, "unknown slot sanitizes to null");
const noSlot = normalizeRuntimeAssetDescriptor({ kind: "generated.weapon", recipe, transform: {} });
assert.equal(noSlot.runtime.slot, null, "absent slot defaults to null");

// --- 6. persist mode writes the slot; drop/store clear it ------------------------------------
equip.persistEquip = true;
equip.equip(placed.id, player, "back");
let d = store.list().find((i) => i.id === placed.id);
assert.equal(d.runtime.state, "equipped", "persist writes state equipped");
assert.equal(d.runtime.slot, "back", "persist writes the slot");
equip.unequip(player, "drop");
d = store.list().find((i) => i.id === placed.id);
assert.equal(d.runtime.state, "idle", "drop → idle");
assert.equal(d.runtime.slot, null, "drop clears the slot");
equip.equip(placed.id, player, "hip");
equip.unequip(player, "store");
d = store.list().find((i) => i.id === placed.id);
assert.equal(d.runtime.state, "stored", "store → stored");
assert.equal(d.runtime.slot, null, "store clears the slot");
assert.equal(d.runtime.visible, false, "stored weapon hidden");
equip.persistEquip = false;

// --- 7. a document persisted as equipped@hip re-attaches to that slot on a FRESH load ---------
const d1 = store.list().find((i) => i.id === placed.id);
d1.runtime.state = "equipped"; // simulate a prior persist-mode session
d1.runtime.slot = "hip";
d1.runtime.visible = true;
// round-trip the descriptor through the sanitizer to prove slot survives save→load
const reDoc = createWorldDocument({ runtimeAssets: { version: 1, items: store.list() } });
const reStore = new PlacedAssetStore(reDoc);
assert.equal(reStore.list().find((i) => i.id === placed.id).runtime.slot, "hip", "slot survives the document round-trip");
const scene2 = new THREE.Scene();
const runtime2 = new PlacedWeaponRuntime();
runtime2.load(reDoc, scene2, null);
const equip2 = new WeaponEquipRuntime(runtime2, { scene: scene2 }); // persistEquip false (default)
equip2.setStore(reStore);
const player2 = fakePlayer(0, 0);
scene2.add(player2.mesh);
equip2.load(player2);
assert.equal(equip2.equippedId, placed.id, "persisted-equipped weapon re-attaches on load");
assert.equal(equip2.equippedSlot, "hip", "re-attaches to its persisted slot");
assert.equal(runtime2.getEntry(placed.id).group.parent, player2.mesh, "re-attached onto the player");

// --- 8. poisoned equip marker is refused; the weapon stays placed -----------------------------
const recipe2 = generateWeaponRecipe(rollConfig("v4-b", "sidearm"));
const placed2 = placeWeapon(store, recipe2, { x: 6, z: 1 });
runtime.add(placed2);
const eBad = runtime.getEntry(placed2.id);
eBad.group.userData.markers.equip = [NaN, 0, 0];
assert.equal(equip.equip(placed2.id, player, "rightHand"), false, "poisoned equip marker refused");
assert.equal(eBad.group.parent, scene, "refused weapon stays placed in the scene");
assert.equal(equip.equip(placed2.id, player, "bogus-slot"), false, "unknown slot refused");
assert.equal(eBad.group.parent, scene, "weapon still placed after an unknown-slot refusal");

// --- 9. isolation: no src/world OR src/editor file imports the arsenal UI ----------------------
const offenders = [...walk("src/world"), ...walk("src/editor")].filter((f) => /WeaponWorkbench|arsenalMain/.test(fs.readFileSync(f, "utf8")));
assert.equal(offenders.length, 0, `world/editor must not import arsenal UI — offenders: ${offenders.join(", ")}`);

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

console.log("arsenal equip-slots regression passed (marker/slot transforms; equip marker == slot for all 3 slots; rightHand reduces to v3; cycle; slot round-trip + clear; persisted re-attach to slot; poisoned/unknown refused; isolation)");
