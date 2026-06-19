// Equip-to-hand runtime (Arsenal v3 → v4 → v6). Attaches PLACED weapons to the player by reparenting
// their groups (owned by PlacedWeaponRuntime) onto the player and aligning each weapon's `equip`
// marker onto a player SLOT. Pure of arsenal UI (reads `placedRuntime.getEntry(id).group.userData
// .markers`; imports only THREE + terrain + the slot/marker/occupancy contract modules).
//
// v4 upgraded the attach from position-only to a full-transform compose against an explicit slot:
//
//     weaponLocal = slotMatrix(slot) × equipMatrix(markers)⁻¹
//
// so the equip marker coincides with the slot in world space, oriented. v6 generalizes the engine
// from ONE equipped weapon to a slot OCCUPANCY map (WeaponSlotOccupancy): multiple weapons can be
// carried at once, one per slot (rightHand / back / hip). rightHand is the drawn/active slot; back +
// hip are holstered. The single-weapon v4 surface reduces exactly: `equippedSlot`/`equippedId` report
// the primary (first-occupied-in-cycle) weapon, `cycleSlot` rotates every occupant one slot, and
// `load` re-attaches ALL persisted-equipped weapons (deterministic conflict resolution for hostile
// saves). The equip marker → transform is the one path with no validator between data and the scene
// graph, so every attach is finite-guarded (compute + decompose + guard BEFORE reparenting, so a
// poisoned marker leaves the weapon placed). Both unequip outcomes (drop → world / store → hidden)
// and both persistence modes (transient / persistEquip) are supported; each weapon's slot persists.

import * as THREE from "three";
import { getHeight } from "../../terrain/terrainSampling.js";
import { equipMatrix } from "./WeaponMarkerTransforms.js";
import { slotMatrix, isSlot, SLOT_NAMES, SLOT_CYCLE, DEFAULT_SLOT, PLAYER_SLOTS } from "./WeaponEquipSlots.js";
import {
  createOccupancy,
  idAt,
  slotOf,
  occupiedSlots,
  primarySlot,
  carriedCount,
  rotateOccupants,
  resolveConflicts,
} from "./WeaponSlotOccupancy.js";

const FLOAT_HEIGHT = 1.0; // match WeaponPlacementTool — a dropped weapon floats clear of the ground
const EQUIP_RADIUS = 8; // how near a placed weapon must be to equip it with a key press
const MARKER_KEYS = ["muzzle", "core", "equip", "socket"];

export class WeaponEquipRuntime {
  constructor(placedRuntime, { scene = null } = {}) {
    this.placedRuntime = placedRuntime;
    this.scene = scene;
    this.store = null; // the per-load PlacedAssetStore (set via setStore); document descriptor access
    this.persistEquip = false; // default transient — equip is session-only unless this is set
    this._bySlot = createOccupancy(); // slot → weaponId (v6 occupancy; v4 was a single scalar)
    this._tmp = new THREE.Vector3();
    // attach-math scratch (reused so attach paths don't allocate per call)
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

  // --- v4 single-weapon surface (reduces exactly: "primary" = first occupied slot in cycle order) ---
  get equippedSlot() {
    return primarySlot(this._bySlot);
  }

  get equippedId() {
    const s = this.equippedSlot;
    return s ? this._bySlot[s] : null;
  }

  // --- v6 multi-carry accessors ----------------------------------------------------------------
  /** The drawn/active weapon (the rightHand occupant), or null when nothing is drawn. */
  get activeId() {
    return this._bySlot.rightHand ?? null;
  }

  get carriedCount() {
    return carriedCount(this._bySlot);
  }

  /** The slot holding `id`, or null. */
  slotOf(id) {
    return slotOf(this._bySlot, id);
  }

  /** The weapon id at `slot`, or null. */
  idAt(slot) {
    return idAt(this._bySlot, slot);
  }

  /** Occupied slot names, in cycle order. */
  occupiedSlots() {
    return occupiedSlots(this._bySlot);
  }

  /** A defensive copy of the occupancy map (for the carry/verb layer to compute against). */
  occupancy() {
    return { ...this._bySlot };
  }

  // The persisted document descriptor for an id (mutating it mutates document.runtimeAssets).
  _descriptor(id) {
    return this.store?.list().find((i) => i.id === id) ?? null;
  }

  /**
   * Attach a placed weapon to the player at the given slot (the v4 contract). A DIFFERENT weapon
   * already in the target slot is displaced first (dropped into the world); the weapon's own prior
   * slot, if any, is vacated. Returns true on success. Re-equipping the same weapon to a new slot
   * MOVES it. With a single weapon this reduces exactly to the v4 behavior.
   * @param {string} weaponId
   * @param {{mesh: THREE.Object3D}} player
   * @param {string} [slot] one of rightHand / back / hip
   */
  equip(weaponId, player, slot = DEFAULT_SLOT) {
    if (!player?.mesh) return false;
    if (!this.placedRuntime?.getEntry(weaponId)) return false;
    if (!isSlot(slot)) return false;
    // one weapon per slot: a different incumbent of the target slot is dropped to the world.
    const incumbent = this.idAt(slot);
    if (incumbent && incumbent !== weaponId) this.unequipWeapon(incumbent, player, "drop");
    return this._attachOne(weaponId, player, slot);
  }

  /**
   * Low-level attach of ONE weapon to ONE slot. Computes + guards the full transform BEFORE
   * reparenting (a poisoned/missing marker leaves the weapon placed), then on success makes it a
   * child of the player at the slot, records the slot in the occupancy map (vacating any other slot
   * the weapon held), and persists the equipped state when persistEquip is set. Does NOT displace
   * another weapon already in the slot — callers manage occupancy.
   */
  _attachOne(weaponId, player, slot) {
    if (!player?.mesh) return false;
    const entry = this.placedRuntime?.getEntry(weaponId);
    if (!entry) return false;
    const markers = entry.group.userData?.markers;
    const equipM = equipMatrix(markers, this._mEquip); // null → poisoned/missing equip marker
    const slotM = slotMatrix(slot, this._mSlot); // null → unknown slot
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
    // record occupancy: a weapon lives in exactly one slot (vacate any other it held).
    for (const s of SLOT_CYCLE) if (s !== slot && this._bySlot[s] === weaponId) this._bySlot[s] = null;
    this._bySlot[slot] = weaponId;

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

  /**
   * Re-attach a whole target occupancy onto the player: clear the live map, then attach each target
   * weapon to its slot. Used for atomic moves (cycle, holster/draw swaps) where weapons relocate but
   * stay carried. Returns true iff every occupant attached. Weapons absent from `target` are NOT
   * detached here — the caller is responsible for dropping/storing them first.
   */
  applyOccupancy(target, player) {
    this._bySlot = createOccupancy();
    let ok = true;
    for (const slot of SLOT_CYCLE) {
      const id = target?.[slot];
      if (id == null) continue;
      if (!this._attachOne(id, player, slot)) ok = false;
    }
    return ok;
  }

  /** Move every carried weapon to the next slot (rightHand → back → hip → rightHand). With one
   *  weapon this walks it through the slots exactly like v4. */
  cycleSlot(player) {
    if (this.carriedCount === 0) return false;
    return this.applyOccupancy(rotateOccupants(this._bySlot), player);
  }

  /** Detach a SPECIFIC carried weapon by id. mode "drop" → ground it at the player (state idle,
   *  visible); mode "store" → hide it (state stored, invisible). Both persist + free the slot. */
  unequipWeapon(weaponId, player, mode = "drop") {
    const slot = this.slotOf(weaponId);
    if (slot == null) return false; // not carried
    const entry = this.placedRuntime?.getEntry(weaponId);
    this._bySlot[slot] = null; // free the slot
    if (!entry) return false;

    const d = this._descriptor(weaponId);
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

  /** Detach the PRIMARY equipped weapon (v4 surface — the first occupied slot in cycle order). */
  unequip(player, mode = "drop") {
    const id = this.equippedId;
    if (id == null) return false;
    return this.unequipWeapon(id, player, mode);
  }

  /** The nearest visible, NOT-already-carried placed weapon within EQUIP_RADIUS, or null. */
  nearestUncarried(player) {
    return this._nearestUncarried(player);
  }

  _nearestUncarried(player) {
    if (!player?.position || !this.placedRuntime) return null;
    let best = null;
    let bestSq = EQUIP_RADIUS * EQUIP_RADIUS;
    for (const [id, entry] of this.placedRuntime.entries) {
      if (!entry.group.visible) continue; // stored weapons are "put away"
      if (this.slotOf(id) != null) continue; // already carried (it's on the player)
      entry.group.getWorldPosition(this._tmp);
      const dx = this._tmp.x - player.position.x;
      const dz = this._tmp.z - player.position.z;
      const sq = dx * dx + dz * dz;
      if (sq <= bestSq) {
        bestSq = sq;
        best = id;
      }
    }
    return best;
  }

  /** Press-to-toggle (v4 surface): if something is equipped, unequip the primary; else equip the
   *  nearest placed weapon within EQUIP_RADIUS at the default slot. */
  toggleNearest(player, mode = "drop") {
    if (this.equippedId) return this.unequip(player, mode);
    const id = this._nearestUncarried(player);
    return id ? this.equip(id, player) : false;
  }

  /** On world load (runtime + player only): re-attach EVERY item the DOCUMENT persisted as
   *  "equipped" to its persisted slot (defaulting to rightHand for legacy/transient saves). This is
   *  UNCONDITIONAL — the document is the source of truth, not the session's persistEquip flag (which
   *  only governs whether attach WRITES that state). Duplicate slot claims resolve deterministically
   *  (first valid claimant in document order wins; losers stay placed in the world, re-findable).
   *  Editor (no player) → no-op. */
  load(player) {
    this._bySlot = createOccupancy(); // prior groups were disposed by placedRuntime.clear()
    if (!player?.mesh || !this.store) return;
    const equipped = this.store.list().filter((i) => i.runtime?.state === "equipped");
    const claims = equipped.map((i) => ({ id: i.id, slot: isSlot(i.runtime?.slot) ? i.runtime.slot : DEFAULT_SLOT }));
    const { occupancy } = resolveConflicts(claims);
    for (const slot of SLOT_CYCLE) {
      const id = occupancy[slot];
      if (id != null) this._attachOne(id, player, slot); // each guarded — one failure leaves only itself placed
    }
    // conflict losers (evicted) stay where PlacedWeaponRuntime loaded them: visible in the world.
  }

  debugSnapshot() {
    const primaryId = this.equippedId;
    const entry = primaryId ? this.placedRuntime?.getEntry(primaryId) : null;
    const markers = entry?.group?.userData?.markers ?? null;
    const markersFinite = markers
      ? MARKER_KEYS.every((k) => Array.isArray(markers[k]) && markers[k].every(Number.isFinite))
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
    // v6: per-slot parent truth so a proof can confirm EVERY carried weapon is on the player.
    const equippedParentsBySlot = {};
    for (const slot of this.occupiedSlots()) {
      const e = this.placedRuntime?.getEntry(this._bySlot[slot]);
      equippedParentsBySlot[slot] = e ? e.group.parent?.name === "Player" : false;
    }
    return {
      present: true,
      placed: this.placedRuntime?.entries.size ?? 0,
      equippedId: primaryId,
      equippedSlot: this.equippedSlot,
      equippedType: entry?.weapon?.recipe?.type ?? null,
      equippedParentIsPlayer: entry ? entry.group.parent?.name === "Player" : false,
      persistEquip: this.persistEquip,
      markersFinite,
      markerTransformsFinite,
      slotsFinite,
      slots: SLOT_NAMES,
      equipMarkerWorld,
      // --- v6 multi-carry ---
      activeId: this.activeId,
      bySlot: { ...this._bySlot },
      occupiedSlots: this.occupiedSlots(),
      equippedParentsBySlot,
      carriedCount: this.carriedCount,
    };
  }

  dispose() {
    this._bySlot = createOccupancy();
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
