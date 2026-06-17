// Placed weapon runtime. On world load, rebuilds every persisted runtime-asset weapon
// from its recipe (via the registry — recipes only, never baked geometry), positions it,
// adds it to the scene, and registers it with the visibility kernel. Each frame it
// advances the energy shader's idle pulse for AWAKE weapons only (far ones sleep,
// mirroring AnimationRuntime). Built in both editor + runtime so placed weapons are
// visible while authoring and while playing.

import { buildRuntimeAsset } from "../assets/RuntimeAssetRegistry.js";

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
    for (const item of items) {
      const weapon = buildRuntimeAsset(item.kind, item.recipe);
      if (!weapon) continue;
      const g = weapon.group;
      const t = item.transform;
      g.position.set(t.position.x, t.position.y, t.position.z);
      g.rotation.set(t.rotation.x, t.rotation.y, t.rotation.z);
      g.scale.set(t.scale.x, t.scale.y, t.scale.z);
      g.visible = item.runtime.visible;
      g.userData.objectId = item.id;
      g.userData.runtimeAssetKind = item.kind;
      scene.add(g);
      this.entries.set(item.id, { weapon, group: g });
      kernel?.register?.({ id: item.id, object3D: g, kind: "weapon" });
    }
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
      this._scene?.remove(e.group);
      e.weapon.dispose();
    }
    this.entries.clear();
  }

  dispose() {
    this.clear();
  }
}
