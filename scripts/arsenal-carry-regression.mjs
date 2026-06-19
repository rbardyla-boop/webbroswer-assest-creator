// test:arsenal-carry — Node regression for Arsenal v6 (multiple carried weapons + holster/draw).
// THREE runs headless (scene-graph ops only, no WebGL), like the v3/v4 arsenal tests. Exercises:
// the PURE slot-occupancy oracle (WeaponSlotOccupancy); carrying 2+ weapons in different slots
// simultaneously (each parented to the Player, oriented, marker on its slot); slot + active
// exclusivity; holster/draw as slot movement without orphaning; drop/store freeing the slot;
// the multi-weapon persist round-trip; deterministic duplicate-slot conflict resolution on load
// (first claimant wins, loser dropped into the world); a poisoned marker refused without aborting
// the other carries; and the src/world+src/editor isolation invariant.
//
// Defended invariant: at most one weapon per slot; rightHand is the only drawn/active slot; back
// and hip are holstered; stored/dropped weapons occupy no slot; conflicts resolve deterministically.

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
import { WeaponCarryRuntime } from "../src/world/placement/WeaponCarryRuntime.js";
import { PLAYER_SLOTS, SLOT_CYCLE } from "../src/world/placement/WeaponEquipSlots.js";
import * as OCC from "../src/world/placement/WeaponSlotOccupancy.js";

function fakePlayer(x, z, facing = 0) {
  const mesh = new THREE.Group();
  mesh.name = "Player";
  mesh.position.set(x, 0, z);
  mesh.rotation.y = facing;
  return { mesh, position: new THREE.Vector3(x, 0, z), facing };
}

// Assert weapon `id`'s equip marker coincides with `slot` on the player in world space, oriented.
function assertOnSlot(runtime, player, id, slot) {
  const entry = runtime.getEntry(id);
  assert.equal(entry.group.parent, player.mesh, `${id} parented to the Player for ${slot}`);
  player.mesh.updateMatrixWorld(true);
  const markerWorld = entry.group.getObjectByName("equip").getWorldPosition(new THREE.Vector3());
  const slotWorld = new THREE.Vector3().fromArray(PLAYER_SLOTS[slot].localPosition).applyMatrix4(player.mesh.matrixWorld);
  assert.ok(markerWorld.distanceTo(slotWorld) < 1e-4, `${id}: equip marker coincides with ${slot}`);
  const playerQ = player.mesh.getWorldQuaternion(new THREE.Quaternion());
  const slotQ = new THREE.Quaternion().fromArray(PLAYER_SLOTS[slot].localRotation).normalize();
  const weaponQ = entry.group.getWorldQuaternion(new THREE.Quaternion());
  assert.ok(weaponQ.angleTo(playerQ.multiply(slotQ)) < 1e-4, `${id}: oriented to ${slot}`);
}

// --- 1. the pure occupancy oracle -------------------------------------------------------------
{
  const empty = OCC.createOccupancy();
  assert.deepEqual(empty, { rightHand: null, back: null, hip: null }, "createOccupancy is all-null");
  assert.deepEqual([...SLOT_CYCLE], ["rightHand", "back", "hip"], "slot cycle order (contract)");

  let occ = OCC.withWeaponAt(empty, "rightHand", "A");
  assert.equal(empty.rightHand, null, "withWeaponAt does not mutate its input");
  assert.equal(OCC.idAt(occ, "rightHand"), "A");
  assert.equal(OCC.slotOf(occ, "A"), "rightHand");
  assert.equal(OCC.primarySlot(occ), "rightHand");
  occ = OCC.withWeaponAt(occ, "back", "B");
  assert.deepEqual(OCC.occupiedSlots(occ), ["rightHand", "back"], "occupied in cycle order");
  assert.deepEqual(OCC.freeSlots(occ), ["hip"], "free in cycle order");
  assert.equal(OCC.firstFreeSlot(occ), "hip");
  assert.equal(OCC.carriedCount(occ), 2);
  // a weapon lives in exactly one slot: re-placing A at hip clears its rightHand entry
  const moved = OCC.withWeaponAt(occ, "hip", "A");
  assert.equal(OCC.slotOf(moved, "A"), "hip", "withWeaponAt moves a weapon, never duplicates it");
  assert.equal(moved.rightHand, null, "old slot cleared on move");
  assert.equal(OCC.idAt(OCC.withoutWeapon(occ, "A"), "rightHand"), null, "withoutWeapon frees the slot");

  // rotateOccupants: single weapon walks the cycle; full set rotates as a unit
  assert.equal(OCC.slotOf(OCC.rotateOccupants(OCC.withWeaponAt(empty, "rightHand", "X")), "X"), "back", "single rotate rightHand→back");
  const tri = OCC.rotateOccupants({ rightHand: "A", back: "B", hip: "C" });
  assert.deepEqual(tri, { rightHand: "C", back: "A", hip: "B" }, "triple rotate shifts all by one (bijection)");

  // resolveConflicts: deterministic first-claimant-wins, losers evicted
  const r1 = OCC.resolveConflicts([{ id: "A", slot: "rightHand" }, { id: "B", slot: "rightHand" }]);
  assert.equal(r1.occupancy.rightHand, "A", "first claimant of a slot wins");
  assert.deepEqual(r1.evicted, ["B"], "loser is evicted");
  const r2 = OCC.resolveConflicts([{ id: "A", slot: "back" }, { id: "B", slot: "pocket" }, { id: "C", slot: "back" }]);
  assert.deepEqual(r2.occupancy, { rightHand: null, back: "A", hip: null }, "unknown slot + taken slot rejected");
  assert.deepEqual(r2.evicted, ["B", "C"], "unknown-slot + dup-slot losers evicted, in order");
  // identical input → identical output (determinism)
  assert.deepEqual(OCC.resolveConflicts([{ id: "A", slot: "rightHand" }, { id: "B", slot: "rightHand" }]), r1, "resolveConflicts is deterministic");
}

// --- shared world setup helper ----------------------------------------------------------------
function freshWorld() {
  const doc = createWorldDocument({});
  const store = new PlacedAssetStore(doc);
  const scene = new THREE.Scene();
  const runtime = new PlacedWeaponRuntime();
  runtime.load(doc, scene, null);
  const equip = new WeaponEquipRuntime(runtime, { scene });
  equip.setStore(store);
  const carry = new WeaponCarryRuntime(equip);
  return { doc, store, scene, runtime, equip, carry };
}
function placeNamed(store, runtime, seed, type, x, z) {
  const descriptor = placeWeapon(store, generateWeaponRecipe(rollConfig(seed, type)), { x, z });
  runtime.add(descriptor);
  return descriptor.id;
}

// --- 2. multi-carry: two weapons in two slots at once -----------------------------------------
{
  const w = freshWorld();
  const player = fakePlayer(0, 0, 0.5);
  w.scene.add(player.mesh);
  const a = placeNamed(w.store, w.runtime, "carry-a", "sidearm", 1, 0);
  const b = placeNamed(w.store, w.runtime, "carry-b", "longarm", 2, 0);

  assert.equal(w.equip.equip(a, player, "rightHand"), true, "equip A to rightHand");
  assert.equal(w.equip.equip(b, player, "back"), true, "equip B to back — A NOT dropped (multi-carry)");
  assert.equal(w.equip.carriedCount, 2, "two weapons carried at once");
  assert.equal(w.equip.slotOf(a), "rightHand", "A on rightHand");
  assert.equal(w.equip.slotOf(b), "back", "B on back");
  assert.equal(w.equip.activeId, a, "active = the rightHand weapon only");
  assertOnSlot(w.runtime, player, a, "rightHand");
  assertOnSlot(w.runtime, player, b, "back");
  // both equipped weapons are children of the player simultaneously
  assert.equal(w.runtime.getEntry(a).group.parent, player.mesh, "A on player");
  assert.equal(w.runtime.getEntry(b).group.parent, player.mesh, "B on player");
}

// --- 3. slot exclusivity: a second weapon for an occupied slot displaces the incumbent ---------
{
  const w = freshWorld();
  const player = fakePlayer(0, 0);
  w.scene.add(player.mesh);
  const a = placeNamed(w.store, w.runtime, "excl-a", "sidearm", 1, 0);
  const c = placeNamed(w.store, w.runtime, "excl-c", "heavy", 2, 0);
  w.equip.equip(a, player, "back");
  w.equip.equip(c, player, "back"); // same slot → A displaced (dropped to world)
  assert.equal(w.equip.idAt("back"), c, "C now occupies back");
  assert.equal(w.equip.slotOf(a), null, "A no longer carried");
  assert.equal(w.runtime.getEntry(a).group.parent, w.scene, "displaced A dropped into the world");
  assert.equal(w.runtime.getEntry(a).group.visible, true, "displaced A visible in the world");
  assert.equal(w.equip.carriedCount, 1, "still at most one weapon per slot");
}

// --- 4. active exclusivity + drawSlot swap ----------------------------------------------------
{
  const w = freshWorld();
  const player = fakePlayer(0, 0);
  w.scene.add(player.mesh);
  const a = placeNamed(w.store, w.runtime, "draw-a", "sidearm", 1, 0);
  const b = placeNamed(w.store, w.runtime, "draw-b", "longarm", 2, 0);
  w.equip.equip(a, player, "rightHand");
  w.equip.equip(b, player, "hip");
  assert.equal(w.carry.activeId, a, "A active");
  assert.equal(w.carry.drawSlot("hip", player), true, "draw the hip weapon");
  assert.equal(w.carry.activeId, b, "B now active (drawn to hand)");
  assert.equal(w.equip.slotOf(a), "hip", "A swapped into the vacated hip slot (still carried)");
  assert.equal(w.equip.carriedCount, 2, "swap keeps both carried — nothing orphaned");
  assertOnSlot(w.runtime, player, b, "rightHand");
  assertOnSlot(w.runtime, player, a, "hip");
}

// --- 5. holster/draw is slot movement without orphaning ---------------------------------------
{
  const w = freshWorld();
  const player = fakePlayer(0, 0);
  w.scene.add(player.mesh);
  const a = placeNamed(w.store, w.runtime, "hol-a", "sidearm", 1, 0);
  w.equip.equip(a, player, "rightHand");
  assert.equal(w.carry.holsterOrDraw(player), true, "holster the active weapon");
  assert.equal(w.carry.activeId, null, "nothing drawn after holstering");
  assert.notEqual(w.equip.slotOf(a), null, "holstered weapon still carried (a slot)");
  assert.notEqual(w.equip.slotOf(a), "rightHand", "holstered to back/hip, not the hand");
  assert.equal(w.runtime.getEntry(a).group.parent, player.mesh, "holstered weapon stays attached to the player");
  assert.equal(w.runtime.getEntry(a).group.visible, true, "holstered weapon visible on the player");
  assert.equal(w.carry.holsterOrDraw(player), true, "draw the holstered weapon back");
  assert.equal(w.carry.activeId, a, "weapon drawn back into the hand");
}

// --- 6. drop/store free the slot and clear runtime.slot ---------------------------------------
{
  const w = freshWorld();
  const player = fakePlayer(3, -2);
  w.scene.add(player.mesh);
  w.equip.persistEquip = true;
  const a = placeNamed(w.store, w.runtime, "ds-a", "sidearm", 3, -2);
  w.equip.equip(a, player, "rightHand");
  assert.equal(w.carry.dropActive(player), true, "drop the active weapon");
  let d = w.store.list().find((i) => i.id === a);
  assert.equal(d.runtime.state, "idle", "dropped → idle");
  assert.equal(d.runtime.slot, null, "dropped clears the slot");
  assert.equal(w.equip.activeId, null, "hand empty after drop");

  w.equip.equip(a, player, "rightHand");
  assert.equal(w.carry.storeActive(player), true, "store the active weapon");
  d = w.store.list().find((i) => i.id === a);
  assert.equal(d.runtime.state, "stored", "stored → stored");
  assert.equal(d.runtime.slot, null, "stored clears the slot");
  assert.equal(d.runtime.visible, false, "stored weapon hidden");
  assert.equal(w.runtime.getEntry(a).group.visible, false, "stored weapon group hidden (occupies no slot)");
}

// --- 7. multi-weapon persist round-trip -------------------------------------------------------
{
  const w = freshWorld();
  const player = fakePlayer(0, 0);
  w.scene.add(player.mesh);
  w.equip.persistEquip = true;
  const a = placeNamed(w.store, w.runtime, "rt-a", "sidearm", 1, 0);
  const b = placeNamed(w.store, w.runtime, "rt-b", "longarm", 2, 0);
  w.equip.equip(a, player, "rightHand");
  w.equip.equip(b, player, "hip");

  // round-trip every descriptor through the sanitizer (save→load) — both carry states survive
  const reDoc = createWorldDocument({ runtimeAssets: { version: 1, items: w.store.list() } });
  const reStore = new PlacedAssetStore(reDoc);
  const reScene = new THREE.Scene();
  const reRuntime = new PlacedWeaponRuntime();
  reRuntime.load(reDoc, reScene, null);
  const reEquip = new WeaponEquipRuntime(reRuntime, { scene: reScene }); // persistEquip false (default)
  reEquip.setStore(reStore);
  const player2 = fakePlayer(0, 0);
  reScene.add(player2.mesh);
  reEquip.load(player2);
  assert.equal(reEquip.slotOf(a), "rightHand", "A re-attaches to rightHand on load");
  assert.equal(reEquip.slotOf(b), "hip", "B re-attaches to hip on load");
  assert.equal(reEquip.carriedCount, 2, "both carried after reload");
  assert.equal(reRuntime.getEntry(a).group.parent, player2.mesh, "A on the player after reload");
  assert.equal(reRuntime.getEntry(b).group.parent, player2.mesh, "B on the player after reload");
}

// --- 8. duplicate persisted slot claims resolve deterministically on load ----------------------
{
  const doc = createWorldDocument({});
  const store = new PlacedAssetStore(doc);
  const a = placeWeapon(store, generateWeaponRecipe(rollConfig("conf-a", "sidearm")), { x: 1, z: 0 });
  const b = placeWeapon(store, generateWeaponRecipe(rollConfig("conf-b", "longarm")), { x: 2, z: 0 });
  // hand-author a hostile save: BOTH claim rightHand
  a.runtime.state = "equipped"; a.runtime.slot = "rightHand"; a.runtime.visible = true;
  b.runtime.state = "equipped"; b.runtime.slot = "rightHand"; b.runtime.visible = true;
  const reDoc = createWorldDocument({ runtimeAssets: { version: 1, items: store.list() } });
  const reStore = new PlacedAssetStore(reDoc);
  const scene = new THREE.Scene();
  const runtime = new PlacedWeaponRuntime();
  runtime.load(reDoc, scene, null);
  const equip = new WeaponEquipRuntime(runtime, { scene });
  equip.setStore(reStore);
  const player = fakePlayer(0, 0);
  scene.add(player.mesh);
  equip.load(player);
  const order = reStore.list().map((i) => i.id); // stable document order decides the winner
  const winner = order[0];
  const loser = order[1];
  assert.equal(equip.idAt("rightHand"), winner, "first claimant (document order) wins the slot");
  assert.equal(equip.slotOf(loser), null, "the loser is not carried");
  assert.equal(runtime.getEntry(winner).group.parent, player.mesh, "winner attached to the player");
  assert.equal(runtime.getEntry(loser).group.parent, scene, "loser dropped into the world (re-findable)");
  assert.equal(runtime.getEntry(loser).group.visible, true, "loser visible in the world");
}

// --- 9. a poisoned marker is refused on load without aborting the other carries ----------------
{
  const doc = createWorldDocument({});
  const store = new PlacedAssetStore(doc);
  const good = placeWeapon(store, generateWeaponRecipe(rollConfig("poi-good", "sidearm")), { x: 1, z: 0 });
  const bad = placeWeapon(store, generateWeaponRecipe(rollConfig("poi-bad", "longarm")), { x: 2, z: 0 });
  good.runtime.state = "equipped"; good.runtime.slot = "rightHand"; good.runtime.visible = true;
  bad.runtime.state = "equipped"; bad.runtime.slot = "back"; bad.runtime.visible = true;
  const reDoc = createWorldDocument({ runtimeAssets: { version: 1, items: store.list() } });
  const reStore = new PlacedAssetStore(reDoc);
  const scene = new THREE.Scene();
  const runtime = new PlacedWeaponRuntime();
  runtime.load(reDoc, scene, null);
  runtime.getEntry(bad.id).group.userData.markers.equip = [NaN, 0, 0]; // poison after build, before load
  const equip = new WeaponEquipRuntime(runtime, { scene });
  equip.setStore(reStore);
  const player = fakePlayer(0, 0);
  scene.add(player.mesh);
  assert.doesNotThrow(() => equip.load(player), "load tolerates a poisoned carry");
  assert.equal(equip.slotOf(good.id), "rightHand", "the good weapon still attached");
  assert.equal(runtime.getEntry(good.id).group.parent, player.mesh, "good weapon on the player");
  assert.equal(equip.slotOf(bad.id), null, "the poisoned weapon was refused (not carried)");
  assert.equal(runtime.getEntry(bad.id).group.parent, scene, "poisoned weapon stays placed");
}

// --- 10. isolation: no src/world OR src/editor file imports the arsenal UI ---------------------
{
  const offenders = [...walk("src/world"), ...walk("src/editor")].filter((f) => /WeaponWorkbench|arsenalMain/.test(fs.readFileSync(f, "utf8")));
  assert.equal(offenders.length, 0, `world/editor must not import arsenal UI — offenders: ${offenders.join(", ")}`);
}

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

console.log("arsenal carry regression passed (occupancy oracle; 2+ weapons carried at once; slot+active exclusivity; holster/draw swap without orphaning; drop/store free the slot; multi-persist round-trip; deterministic conflict resolution; poisoned carry refused; isolation)");
