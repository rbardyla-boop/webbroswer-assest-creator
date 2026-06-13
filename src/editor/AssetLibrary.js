import { PRIMITIVE_ASSETS } from "../world/PlacedObject.js";

export class AssetLibrary {
  constructor() {
    this.assets = new Map();
    for (const [kind, info] of Object.entries(PRIMITIVE_ASSETS)) {
      this.add({ type: "primitive", kind, name: info.label });
    }
  }

  add(asset) {
    const id = asset.id ?? `${asset.type}-${asset.kind ?? this.assets.size + 1}-${Date.now()}`;
    const stored = { ...asset, id };
    this.assets.set(id, stored);
    return stored;
  }

  get(id) {
    return this.assets.get(id) ?? null;
  }

  list() {
    return [...this.assets.values()];
  }
}
