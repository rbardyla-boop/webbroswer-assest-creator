// Places prefabs into the live world through the WorldObjectManager.
//
// Expansion produces normal world-object descriptors (carrying prefabRef); each
// becomes an ordinary placed object. Placement snaps the prefab origin to the
// terrain by default while child local offsets are preserved by the serializer.
// Asset caches in the manager/library are reused — no geometry is duplicated.

import { worldObjectsFromPrefab } from "./PrefabSerializer.js";
import { getHeight } from "../terrain/terrainSampling.js";

export class PrefabInstancer {
  constructor(manager, { snapToTerrain = true, heightSampler = getHeight } = {}) {
    this.manager = manager;
    this.snapToTerrain = snapToTerrain;
    this.heightSampler = heightSampler;
  }

  setManager(manager) {
    this.manager = manager;
  }

  // Expand a prefab to descriptors without touching the scene (tests/previews).
  expand(prefab, placement = {}) {
    return worldObjectsFromPrefab(prefab, this._resolvePlacement(placement));
  }

  // Place a prefab and return the created placed objects (one per child).
  async instantiate(prefab, placement = {}) {
    if (!this.manager || !prefab) return [];
    const descriptors = worldObjectsFromPrefab(prefab, this._resolvePlacement(placement));
    const placed = [];
    for (const descriptor of descriptors) {
      const object = await this.manager.addWorldObject(descriptor);
      if (object) placed.push(object);
    }
    return placed;
  }

  _resolvePlacement(placement) {
    const place = {
      ...placement,
      position: { ...(placement.position ?? { x: 0, y: 0, z: 0 }) },
    };
    if (this.snapToTerrain && this.heightSampler) {
      place.position.y = this.heightSampler(place.position.x, place.position.z);
    }
    return place;
  }
}
