// Equip-to-hand runtime (Arsenal v3 → v4). Attaches a PLACED weapon to the player by reparenting
// its group (owned by PlacedWeaponRuntime) onto the player and aligning the weapon's `equip`
// marker onto a player SLOT. Pure of arsenal UI (reads `placedRuntime.getEntry(id).group.userData
// .markers`; imports only THREE + terrain + the slot/marker contract modules).
//
// v4 upgrades the attach from position-only to a full-transform compose against an explicit slot:
//
//     weaponLocal = slotMatrix(slot) × equipMatrix(markers)⁻¹
//
// so the equip marker coincides with the slot in world space, oriented. There are three slots
// (rightHand / back / hip); ONE weapon is equipped at a time and `cycleSlot` moves it between
// them. rightHand uses identity rotation and its localPosition equals the v3 handLocal exactly,
// so for rightHand the compose reduces to the v3 `position = handLocal − equip` (v3 tests stay
// green). The equip marker → transform is the one path with no validator between data and the
// scene graph, so it is finite-guarded here (compute + decompose + guard BEFORE reparenting, so a
// poisoned marker leaves the weapon placed). Both unequip outcomes (drop → world / store → hidden)
// and both persistence modes (transient / persistEquip) are supported; the chosen slot persists.

import * as THREE from "three";
import { getHeight } from "../../terrain/terrainSampling.js";
import { equipMatrix } from "./WeaponMarkerTransforms.js";
import { slotMatrix, nextSlot, isSlot, SLOT_NAMES, DEFAULT_SLOT, PLAYER_SLOTS } from "./WeaponEquipSlots.js";

const FLOAT_HEIGHT = 1.0; // match WeaponPlacementTool — a dropped weapon floats clear of the ground
const EQUIP_RADIUS = 8; // how near a placed weapon must be to equip it with a key press

export class WeaponEquipRuntime {
  constructor(placedRuntime, { scene = null } = {}) {
    this.placedRuntime = placedRuntime;
    this.scene = scene;
    this.store = null; // the per-load PlacedAssetStore (set via setStore); document descriptor access
    this.persistEquip = false; // default transient — equip is session-only unless this is set
    this._equippedId = null;
    this._equippedSlot = null; // which slot the equipped weapon occupies (null when nothing equipped)
    this._tmp = new THREE.Vector3();
    // attach-math scratch (reused so equip()/cycleSlot() don't allocate per call)
    this._mSlot = new THREE.Matrix4();
    this._mEquip = new THREE.Matrix4();
    this._dPos = new THREE.Vector3();
    this._dQuat = new THREE.Quaternion();
    this._dScale = new THREE.Vector3();
  }

  setStore(store) {
    this.store = store;
  }

  // rightHand attach point as a Vector3 (the v3 `handLocal`, kept for back-compat / tests).
  get handLocal() {
    return new THREE.Vector3().fromArray(PLAYER_SLOTS.rightHand.localPosition);
  }

  get equippedSlot() {
    return this._equippedSlot;
  }

  get equippedId() {
    return this._equippedId;
  }

  // The persisted document descriptor for an id (mutating it mutates document.runtimeAssets).
  _descriptor(id) {
    return this.store?.list().find((i) => i.id === id) ?? null;
  }

  /**
   * Attach a placed weapon to the player at the given slot. Returns true on success.
   * @param {string} weaponId
   * @param {{mesh: THREE.Object3D}} player
   * @param {string} [slot] one of rightHand / back / hip
   */
  equip(weaponId, player, slot = DEFAULT_SLOT) {
    if (!player?.mesh) return false;
    const entry = this.placedRuntime?.getEntry(weaponId);
    if (!entry) return false;
    if (!isSlot(slot)) return false;
    // switching to a DIFFERENT weapon drops the held one first; re-equipping the SAME weapon
    // (e.g. cycleSlot moving it to another slot) keeps it attached and just recomputes the math.
    if (this._equippedId && this._equippedId !== weaponId) this.unequip(player, "drop");

    const markers = entry.group.userData?.markers;
    const equipM = equipMatrix(markers, this._mEquip); // null → poisoned/missing equip marker
    const slotM = slotMatrix(slot, this._mSlot); // null → unknown slot (guarded above, defensive)
    if (!equipM || !slotM) return false; // refuse BEFORE reparenting — never orphan the weapon

    // weaponLocal = slot × equip⁻¹  (mutates the scratch slot matrix in place → W)
    const W = slotM.multiply(equipM.invert());
    W.decompose(this._dPos, this._dQuat, this._dScale);
    if (!finiteVec3(this._dPos) || !finiteQuat(this._dQuat)) return false; // guard the result too

    player.mesh.add(entry.group); // reparent scene → player (player.syncMesh propagates each frame)
    entry.group.position.copy(this._dPos);
    entry.group.quaternion.copy(this._dQuat);
    entry.group.scale.set(1, 1, 1); // pin unit scale (don't trust the decomposed float)
    entry.group.visible = true;
    this._equippedId = weaponId;
    this._equippedSlot = slot;

    if (this.persistEquip) {
      const d = this._descriptor(weaponId);
      if (d) {
        d.runtime.state = "equipped";
        d.runtime.owner = "player";
        d.runtime.visible = true;
        d.runtime.slot = slot;
      }
    }
    return true;
  }

  /** Move the equipped weapon to the next slot (rightHand → back → hip → rightHand). */
  cycleSlot(player) {
    if (!this._equippedId) return false;
    return this.equip(this._equippedId, player, nextSlot(this._equippedSlot));
  }

  /** Detach the equipped weapon. mode "drop" → ground at the player (state idle, visible);
   *  mode "store" → hide it away (state stored, invisible). Both persist to the document and
   *  clear the slot. */
  unequip(player, mode = "drop") {
    if (!this._equippedId) return false;
    const entry = this.placedRuntime?.getEntry(this._equippedId);
    const id = this._equippedId;
    this._equippedId = null;
    this._equippedSlot = null;
    if (!entry) return false;

    const d = this._descriptor(id);
    if (mode === "store") {
      entry.group.visible = false; // hide BEFORE reparenting — never a visible frame at the wrong spot
      this.scene?.add(entry.group); // reparent player → scene (invisible)
      if (d) {
        d.runtime.state = "stored";
        d.runtime.owner = null;
        d.runtime.visible = false;
        d.runtime.slot = null;
      }
      return true;
    }
    // drop: ground at the player's feet and persist that as the new placed transform
    this.scene?.add(entry.group); // reparent player → scene, then position in scene space
    const px = player?.position?.x ?? 0;
    const pz = player?.position?.z ?? 0;
    const py = getHeight(px, pz) + FLOAT_HEIGHT;
    entry.group.position.set(px, py, pz);
    entry.group.rotation.set(0, player?.facing ?? 0, 0);
    entry.group.scale.set(1, 1, 1);
    entry.group.visible = true;
    if (d) {
      d.transform.position = { x: px, y: py, z: pz };
      d.transform.rotation = { x: 0, y: player?.facing ?? 0, z: 0 };
      d.runtime.state = "idle";
      d.runtime.owner = null;
      d.runtime.visible = true;
      d.runtime.slot = null;
    }
    return true;
  }

  /** Press-to-toggle: if something is equipped, unequip it; else equip the nearest placed
   *  weapon within EQUIP_RADIUS of the player (skipping hidden/stored ones) at the default slot. */
  toggleNearest(player, mode = "drop") {
    if (this._equippedId) return this.unequip(player, mode);
    if (!player?.position || !this.placedRuntime) return false;
    let best = null;
    let bestSq = EQUIP_RADIUS * EQUIP_RADIUS;
    for (const [id, entry] of this.placedRuntime.entries) {
      if (!entry.group.visible) continue; // stored weapons are "put away"
      entry.group.getWorldPosition(this._tmp);
      const dx = this._tmp.x - player.position.x;
      const dz = this._tmp.z - player.position.z;
      const sq = dx * dx + dz * dz;
      if (sq <= bestSq) {
        bestSq = sq;
        best = id;
      }
    }
    return best ? this.equip(best, player) : false;
  }

  /** On world load (runtime + player only): re-attach the item the DOCUMENT persisted as
   *  "equipped" to its persisted slot (defaulting to rightHand for legacy/transient saves). This
   *  is UNCONDITIONAL — the document is the source of truth, not the session's persistEquip flag
   *  (which only governs whether equip() WRITES that state). The cycle model only ever has one
   *  equipped item. Editor (no player) → no-op. */
  load(player) {
    this._equippedId = null; // prior groups were disposed by placedRuntime.clear()
    this._equippedSlot = null;
    if (!player?.mesh || !this.store) return;
    const equipped = this.store.list().find((i) => i.runtime?.state === "equipped");
    if (equipped) this.equip(equipped.id, player, isSlot(equipped.runtime?.slot) ? equipped.runtime.slot : DEFAULT_SLOT);
  }

  debugSnapshot() {
    const entry = this._equippedId ? this.placedRuntime?.getEntry(this._equippedId) : null;
    const markers = entry?.group?.userData?.markers ?? null;
    const markersFinite = markers
      ? ["muzzle", "core", "equip", "socket"].every((k) => Array.isArray(markers[k]) && markers[k].every(Number.isFinite))
      : false;
    // Distinct from markersFinite (raw arrays): exercises the v4 compose path — the equip marker
    // lifted into a Matrix4 — and confirms every element of that matrix is finite.
    const eqM = markers ? equipMatrix(markers) : null;
    const markerTransformsFinite = !!eqM && eqM.elements.every(Number.isFinite);
    const slotsFinite = SLOT_NAMES.every((n) => {
      const m = slotMatrix(n);
      return !!m && m.elements.every(Number.isFinite);
    });
    let equipMarkerWorld = null;
    if (entry && markers?.equip) {
      this._tmp.set(markers.equip[0], markers.equip[1], markers.equip[2]).applyMatrix4(entry.group.matrixWorld);
      equipMarkerWorld = { x: this._tmp.x, y: this._tmp.y, z: this._tmp.z };
      equipMarkerWorld.finite = Number.isFinite(this._tmp.x) && Number.isFinite(this._tmp.y) && Number.isFinite(this._tmp.z);
    }
    return {
      present: true,
      placed: this.placedRuntime?.entries.size ?? 0,
      equippedId: this._equippedId,
      equippedSlot: this._equippedSlot,
      equippedType: entry?.weapon?.recipe?.type ?? null,
      equippedParentIsPlayer: entry ? entry.group.parent?.name === "Player" : false,
      persistEquip: this.persistEquip,
      markersFinite,
      markerTransformsFinite,
      slotsFinite,
      slots: SLOT_NAMES,
      equipMarkerWorld,
    };
  }

  dispose() {
    this._equippedId = null;
    this._equippedSlot = null;
    this.store = null;
  }
}

// --- small local helpers ----------------------------------------------------------------------

function finiteVec3(v) {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function finiteQuat(q) {
  return Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w);
}
