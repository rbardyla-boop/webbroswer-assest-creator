// Relic-weapon objective runtime (FP-1). Owns the single gameplay objective: spawn the relic
// (if absent) + the cache, render the in-world markers, derive the live phase each frame, and
// handle the in-zone deposit that completes it. Owned in main.js (runtime-only, like
// WeaponEquipRuntime — it needs the player + the per-load store) and persists across reloads, so
// load() CLEARS its prior markers idempotently (the markers live on `scene`, not in
// WorldRuntimeLoader.dispose()). Reads WeaponEquipRuntime's public API; mutates the live document
// blocks in place (the canonical persistence path). No combat / inventory / quest engine.

import * as THREE from "three";
import { getHeight } from "../../terrain/terrainSampling.js";
import { placeWeapon } from "../placement/WeaponPlacementTool.js";
import { ObjectiveStore } from "./ObjectivePersistence.js";
import { RELIC_ID, OBJECTIVE_KIND, relicRecipe, deriveSites, livePhase, bannerText } from "./RelicWeaponObjective.js";

const PILLAR_H = 1.6; // cache beacon pillar height
const BEAM_H = 2.2; // relic marker beam height
const PEDESTAL_OFFSET = PILLAR_H + 0.4; // relic rests just above the cache pillar top
const CACHE_COLOR = 0xffb020; // amber — active cache
const CLAIMED_COLOR = 0x46e0a0; // green — claimed cache
const RELIC_COLOR = 0xffe070; // gold — the relic marker

export class ObjectiveRuntime {
  constructor() {
    this.scene = null;
    this.placedStore = null; // PlacedAssetStore (runtimeAssets) — the relic descriptor lives here
    this.placedWeaponRuntime = null; // builds/owns the relic's THREE object
    this.equipRuntime = null; // WeaponEquipRuntime — equip state + unequip
    this.objStore = null; // ObjectiveStore (document.objectives)
    this.entry = null; // the live objective descriptor (mutated in place → persists on save)
    this._cacheBeacon = null;
    this._relicMarker = null;
    this._inZone = false;
    this._phase = "find";
    this._spawned = false;
  }

  /**
   * Load (runtime + player only). Clears prior markers, finds-or-creates the objective entry
   * (spawning the relic via the runtimeAssets path if absent), and builds the markers. Returns
   * true if it spawned the relic this load (so the caller persists the fresh world).
   */
  load({ player, scene, placedAssetStore, placedWeaponRuntime, weaponEquipRuntime, document }) {
    this.clear();
    if (!player?.mesh || !scene || !placedAssetStore || !document) return false;
    this.scene = scene;
    this.placedStore = placedAssetStore;
    this.placedWeaponRuntime = placedWeaponRuntime;
    this.equipRuntime = weaponEquipRuntime;
    this.objStore = new ObjectiveStore(document);
    this._spawned = false;

    let entry = this.objStore.getByKind(OBJECTIVE_KIND);
    if (!entry) {
      const spawn = { x: player.position.x, z: player.position.z };
      const sites = deriveSites(spawn);
      const descriptor = placeWeapon(this.placedStore, relicRecipe(), { x: sites.relic.x, z: sites.relic.z, id: RELIC_ID, runtime: { state: "idle" } });
      if (!descriptor) return false; // relic store full — don't create an objective pointing at no relic
      this.placedWeaponRuntime?.add(descriptor);
      entry = this.objStore.add({ kind: OBJECTIVE_KIND, id: OBJECTIVE_KIND, relicId: RELIC_ID, cache: sites.cache, radius: sites.radius, completed: false });
      this._spawned = true;
    }
    this.entry = entry;
    if (this.entry) this._buildMarkers();
    return this._spawned;
  }

  _relicDescriptor() {
    return this.placedStore?.list().find((i) => i.id === RELIC_ID) ?? null;
  }

  _relicEntry() {
    return this.placedWeaponRuntime?.getEntry(RELIC_ID) ?? null;
  }

  /** Per-frame: recompute zone membership + phase, and toggle the relic marker. */
  update(dt, player) {
    if (!this.entry || !player?.position) return;
    const c = this.entry.cache;
    const dx = player.position.x - c.x;
    const dz = player.position.z - c.z;
    this._inZone = dx * dx + dz * dz < this.entry.radius * this.entry.radius;
    const relicEquipped = this.equipRuntime?.equippedId === RELIC_ID;
    this._phase = livePhase({ relicEquipped, completed: this.entry.completed === true, inZone: this._inZone });
    if (this._relicMarker) this._relicMarker.visible = this._phase === "find";
  }

  /**
   * The deposit action (bound to KeyG). Returns true iff it consumed the press (i.e. the player is
   * holding the relic). Holding the relic + in the cache zone → deposit it on the pedestal and
   * complete; holding the relic elsewhere → just drop it (visible, re-grabbable — never hidden, so
   * no soft-lock). Not holding the relic → false (the generic store/toggle runs instead).
   */
  tryDeposit(player) {
    if (!this.entry || !player?.mesh || !this.equipRuntime) return false;
    if (this.equipRuntime.equippedId !== RELIC_ID) return false;
    this.equipRuntime.unequip(player, "drop"); // detach to the world, visible, idle
    if (!this._inZone) return true; // dropped near the player — re-grabbable
    // in-zone: place the relic on the cache pedestal (idempotent) and mark complete.
    const e = this._relicEntry();
    const d = this._relicDescriptor();
    const cx = this.entry.cache.x;
    const cz = this.entry.cache.z;
    const cy = getHeight(cx, cz) + PEDESTAL_OFFSET;
    if (e) {
      e.group.position.set(cx, cy, cz);
      e.group.rotation.set(0, 0, 0);
      e.group.scale.set(1, 1, 1);
      e.group.visible = true;
    }
    if (d) {
      d.transform.position = { x: cx, y: cy, z: cz };
      d.transform.rotation = { x: 0, y: 0, z: 0 };
      d.runtime.state = "idle";
      d.runtime.visible = true;
      d.runtime.slot = null;
    }
    if (this.entry.completed !== true) this.entry.completed = true;
    this._setClaimed();
    return true;
  }

  /** Current banner copy for the on-screen objective line (empty when no objective). */
  bannerText() {
    return this.entry ? bannerText(this._phase) : "";
  }

  // --- markers ---------------------------------------------------------------------------------

  _buildMarkers() {
    const c = this.entry.cache;
    const completed = this.entry.completed === true;
    this._cacheBeacon = buildCacheBeacon(c.x, getHeight(c.x, c.z), c.z, this.entry.radius, completed);
    this.scene.add(this._cacheBeacon);
    // relic marker at the relic's CURRENT position (its spawn, or wherever it was last placed),
    // shown only while the player still has to find it.
    const rd = this._relicDescriptor();
    const rx = rd?.transform?.position?.x ?? c.x;
    const rz = rd?.transform?.position?.z ?? c.z;
    this._relicMarker = buildRelicMarker(rx, getHeight(rx, rz), rz);
    this._relicMarker.visible = !completed;
    this.scene.add(this._relicMarker);
  }

  _setClaimed() {
    if (this._cacheBeacon) recolor(this._cacheBeacon, CLAIMED_COLOR);
    if (this._relicMarker) this._relicMarker.visible = false;
  }

  debugSnapshot() {
    const rd = this._relicDescriptor();
    const relicPos = rd?.transform?.position ?? null;
    // Derive phase LIVE (not the cached this._phase, which only updates on the per-frame update)
    // so a deterministic driver sees the effect of equip/deposit in the same synchronous turn.
    const relicEquipped = this.equipRuntime?.equippedId === RELIC_ID;
    const phase = this.entry ? livePhase({ relicEquipped, completed: this.entry.completed === true, inZone: this._inZone }) : "find";
    return {
      present: true,
      phase,
      relicId: RELIC_ID,
      relicExists: !!rd,
      relicPos,
      inZone: this._inZone,
      completed: this.entry?.completed === true,
      cache: this.entry ? { ...this.entry.cache } : null,
      radius: this.entry?.radius ?? null,
      beaconPresent: !!this._cacheBeacon,
      relicMarkerVisible: !!this._relicMarker?.visible,
    };
  }

  /** Remove + dispose the markers (idempotent). Called at the top of load() and on teardown. */
  clear() {
    disposeGroup(this._cacheBeacon);
    disposeGroup(this._relicMarker);
    this._cacheBeacon = null;
    this._relicMarker = null;
    this.entry = null;
    this._inZone = false;
    this._phase = "find";
  }

  dispose() {
    this.clear();
    this.scene = null;
    this.placedStore = null;
    this.placedWeaponRuntime = null;
    this.equipRuntime = null;
    this.objStore = null;
  }
}

// --- marker construction (folded ObjectiveMarkers) ---------------------------------------------

function beaconMat(color, emissiveIntensity) {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity, roughness: 0.4, metalness: 0.1 });
}

function buildCacheBeacon(x, groundY, z, radius, claimed) {
  const g = new THREE.Group();
  g.name = "ObjectiveCacheBeacon";
  g.position.set(x, groundY, z);
  const color = claimed ? CLAIMED_COLOR : CACHE_COLOR;
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, PILLAR_H, 14), beaconMat(color, 0.55));
  pillar.position.y = PILLAR_H / 2;
  pillar.castShadow = true;
  g.add(pillar);
  // a flat ring at the base showing the deposit zone extent
  const ring = new THREE.Mesh(new THREE.TorusGeometry(Math.max(1, radius), 0.1, 8, 32), beaconMat(color, 0.85));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.06;
  g.add(ring);
  return g;
}

function buildRelicMarker(x, groundY, z) {
  const g = new THREE.Group();
  g.name = "ObjectiveRelicMarker";
  g.position.set(x, groundY, z);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, BEAM_H, 10), beaconMat(RELIC_COLOR, 0.7));
  beam.position.y = BEAM_H / 2;
  g.add(beam);
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), beaconMat(RELIC_COLOR, 0.95));
  gem.position.y = BEAM_H + 0.3;
  g.add(gem);
  return g;
}

function recolor(group, color) {
  group.traverse((node) => {
    if (node.material) {
      node.material.color?.setHex(color);
      node.material.emissive?.setHex(color);
    }
  });
}

function disposeGroup(group) {
  if (!group) return;
  group.removeFromParent();
  group.traverse((node) => {
    node.geometry?.dispose?.();
    const m = node.material;
    if (Array.isArray(m)) m.forEach((mm) => mm.dispose?.());
    else m?.dispose?.();
  });
}
