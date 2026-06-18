// Placed weapon runtime. On world load, rebuilds every persisted runtime-asset weapon
// from its recipe (via the registry — recipes only, never baked geometry), positions it,
// adds it to the scene, and registers it with the visibility kernel. Each frame it
// advances the energy shader's idle pulse for AWAKE weapons only (far ones sleep,
// mirroring AnimationRuntime). Built in both editor + runtime so placed weapons are
// visible while authoring and while playing.

import { buildRuntimeAsset } from "../assets/RuntimeAssetRegistry.js";
import { normalizeRuntimeAssetDescriptor } from "../assets/RuntimeAssetTypes.js";

export class PlacedWeaponRuntime {
  constructor() {
    this.entries = new Map(); // id -> { weapon, group }
    this._scene = null;
    this._kernel = null;
    this._elapsed = 0;
  }

  /** Rebuild all placed weapons from the document's runtimeAssets block. */
  load(document, scene, kernel = null) {
    this.clear();
    this._scene = scene;
    this._kernel = kernel;
    const items = document?.runtimeAssets?.items ?? [];
    for (const item of items) this._instantiate(item);
  }

  // Build ONE normalized item into a live weapon in the scene + entries (+kernel). Shared
  // by load() and add() so they can never drift. Returns the entry, or null on a bad item.
  _instantiate(item) {
    const weapon = buildRuntimeAsset(item.kind, item.recipe);
    if (!weapon) return null;
    const g = weapon.group;
    const t = item.transform;
    g.position.set(t.position.x, t.position.y, t.position.z);
    g.rotation.set(t.rotation.x, t.rotation.y, t.rotation.z);
    g.scale.set(t.scale.x, t.scale.y, t.scale.z);
    g.visible = item.runtime?.visible !== false; // stored weapons load hidden
    g.userData.objectId = item.id;
    g.userData.runtimeAssetKind = item.kind;
    this._scene?.add(g);
    const entry = { weapon, group: g };
    this.entries.set(item.id, entry);
    this._kernel?.register?.({ id: item.id, object3D: g, kind: "weapon" });
    return entry;
  }

  /** Add ONE weapon to the live scene from a descriptor (interactive placement). The
   *  descriptor is (re)normalized defensively; an existing id is replaced. Returns the
   *  entry or null. The document/store already holds the descriptor — this only builds. */
  add(descriptor) {
    const item = normalizeRuntimeAssetDescriptor(descriptor);
    if (!item) return null;
    if (this.entries.has(item.id)) this.remove(item.id);
    return this._instantiate(item);
  }

  /** Remove ONE weapon's live scene object. Detaches from its ACTUAL parent (which may be
   *  the player when equipped — NOT necessarily the scene), disposes, unregisters. */
  remove(id) {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.group.removeFromParent();
    entry.weapon.dispose();
    this._kernel?.unregister?.(id);
    this.entries.delete(id);
    return true;
  }

  getEntry(id) {
    return this.entries.get(id) ?? null;
  }

  update(dt, isAwake = null) {
    this._elapsed += dt;
    for (const e of this.entries.values()) {
      if (isAwake && !isAwake(e.group)) continue;
      e.weapon.update(this._elapsed);
    }
  }

  get stats() {
    let awake = 0;
    for (const e of this.entries.values()) {
      if (!this._kernel || this._kernel.isAwake?.(e.group) !== false) awake++;
    }
    return { count: this.entries.size, awake, sleeping: this.entries.size - awake };
  }

  /** Test/debug snapshot: counts, ids, and the first weapon's marker map. */
  snapshot() {
    const first = this.entries.values().next().value;
    return { ...this.stats, ids: [...this.entries.keys()], markers: first?.group?.userData?.markers ?? null };
  }

  clear() {
    for (const e of this.entries.values()) {
      e.group.removeFromParent(); // detach from ACTUAL parent (scene OR player when equipped)
      e.weapon.dispose();
    }
    this.entries.clear();
  }

  dispose() {
    this.clear();
  }
}
