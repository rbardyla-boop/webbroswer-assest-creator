// Equip-to-hand runtime (Arsenal v3). Attaches a PLACED weapon to the player by reparenting
// its group (owned by PlacedWeaponRuntime) onto the player at the inverted `equip` marker, so
// the grip sits in the player's hand. No combat/firing — just attachment. Pure of arsenal UI
// (reads `placedRuntime.getEntry(id).group.userData.markers`; imports only THREE + terrain).
//
// Markers are POSITION-ONLY (no orientation), so the attach transform is simply
// `group.position = handLocal − equipLocal` at identity orientation. The one path with no
// validator between data and the scene graph is the marker → equip-transform, so it is
// finite-guarded here. Both unequip outcomes (drop → world / store → hidden) and both
// persistence modes (transient / persistEquip) are supported.

import * as THREE from "three";
import { getHeight } from "../../terrain/terrainSampling.js";

const FLOAT_HEIGHT = 1.0; // match WeaponPlacementTool — a dropped weapon floats clear of the ground
const EQUIP_RADIUS = 8; // how near a placed weapon must be to equip it with a key press

export class WeaponEquipRuntime {
  constructor(placedRuntime, { scene = null, handLocal = new THREE.Vector3(0.35, 1.1, 0.25) } = {}) {
    this.placedRuntime = placedRuntime;
    this.scene = scene;
    this.handLocal = handLocal.clone();
    this.store = null; // the per-load PlacedAssetStore (set via setStore); document descriptor access
    this.persistEquip = false; // default transient — equip is session-only unless this is set
    this._equippedId = null;
    this._tmp = new THREE.Vector3();
  }

  setStore(store) {
    this.store = store;
  }

  // The persisted document descriptor for an id (mutating it mutates document.runtimeAssets).
  _descriptor(id) {
    return this.store?.list().find((i) => i.id === id) ?? null;
  }

  /** Attach a placed weapon to the player's hand. Returns true on success. */
  equip(weaponId, player) {
    if (!player?.mesh) return false;
    const entry = this.placedRuntime?.getEntry(weaponId);
    if (!entry) return false;
    if (this._equippedId && this._equippedId !== weaponId) this.unequip(player, "drop");

    const m = entry.group.userData?.markers?.equip;
    if (!Array.isArray(m) || !m.every(Number.isFinite)) return false; // refuse a poisoned marker
    const px = this.handLocal.x - m[0];
    const py = this.handLocal.y - m[1];
    const pz = this.handLocal.z - m[2];
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return false;

    player.mesh.add(entry.group); // reparent scene → player (player.syncMesh propagates each frame)
    entry.group.position.set(px, py, pz);
    entry.group.quaternion.identity();
    entry.group.scale.set(1, 1, 1);
    entry.group.visible = true;
    this._equippedId = weaponId;

    if (this.persistEquip) {
      const d = this._descriptor(weaponId);
      if (d) {
        d.runtime.state = "equipped";
        d.runtime.owner = "player";
        d.runtime.visible = true;
      }
    }
    return true;
  }

  /** Detach the equipped weapon. mode "drop" → ground at the player (state idle, visible);
   *  mode "store" → hide it away (state stored, invisible). Both persist to the document. */
  unequip(player, mode = "drop") {
    if (!this._equippedId) return false;
    const entry = this.placedRuntime?.getEntry(this._equippedId);
    const id = this._equippedId;
    this._equippedId = null;
    if (!entry) return false;

    const d = this._descriptor(id);
    if (mode === "store") {
      entry.group.visible = false; // hide BEFORE reparenting — never a visible frame at the wrong spot
      this.scene?.add(entry.group); // reparent player → scene (invisible)
      if (d) {
        d.runtime.state = "stored";
        d.runtime.owner = null;
        d.runtime.visible = false;
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
    }
    return true;
  }

  /** Press-to-toggle: if something is equipped, unequip it; else equip the nearest placed
   *  weapon within EQUIP_RADIUS of the player (skipping hidden/stored ones). */
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

  /** On world load (runtime + player only): re-attach any item the DOCUMENT persisted as
   *  "equipped". This is UNCONDITIONAL — the document is the source of truth, not the
   *  session's persistEquip flag (which only governs whether equip() WRITES that state).
   *  A transient-mode equip never wrote "equipped", so it simply won't be here. Editor
   *  (no player) → no-op (equipped-flagged items render as plain placed weapons). */
  load(player) {
    this._equippedId = null; // prior groups were disposed by placedRuntime.clear()
    if (!player?.mesh || !this.store) return;
    const equipped = this.store.list().find((i) => i.runtime?.state === "equipped");
    if (equipped) this.equip(equipped.id, player);
  }

  debugSnapshot() {
    const entry = this._equippedId ? this.placedRuntime?.getEntry(this._equippedId) : null;
    const markers = entry?.group?.userData?.markers ?? null;
    const markersFinite = markers
      ? ["muzzle", "core", "equip", "socket"].every((k) => Array.isArray(markers[k]) && markers[k].every(Number.isFinite))
      : false;
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
      equippedType: entry?.weapon?.recipe?.type ?? null,
      equippedParentIsPlayer: entry ? entry.group.parent?.name === "Player" : false,
      persistEquip: this.persistEquip,
      markersFinite,
      equipMarkerWorld,
    };
  }

  dispose() {
    this._equippedId = null;
    this.store = null;
  }
}
