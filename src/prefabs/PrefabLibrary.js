// In-memory registry of prefab documents with local-first persistence.
// Mirrors AssetLibrary: a Map keyed by stable prefab id, backed by a store.
//
// Two tiers:
//   - builtins: system structural kits, generated procedurally each init. Never
//     persisted, never deletable, excluded from the world export manifest.
//   - user prefabs: created from selections, persisted to the store.
//
// Deleting a user prefab only removes the template — placed world objects
// created from it are independent objects and are never touched here.

import { PrefabStore } from "./PrefabStore.js";
import { prefabFromWorldObjects } from "./PrefabSerializer.js";
import { validatePrefabDocument, sanitizePrefabManifest } from "./PrefabValidation.js";
import { shortRandom } from "./PrefabTypes.js";
import { createBuiltinPrefabs } from "./BuiltinKits.js";

export class PrefabLibrary {
  constructor({ store = new PrefabStore() } = {}) {
    this.store = store;
    this.prefabs = new Map(); // user prefabs (persisted)
    this.builtins = new Map(); // system kits (regenerated, not persisted)
  }

  async init() {
    this._registerBuiltins();
    try {
      this.prefabs.clear();
      for (const prefab of await this.store.loadAll()) this.prefabs.set(prefab.id, prefab);
    } catch (error) {
      console.warn("Prefab storage unavailable; starting with built-ins only.", error);
    }
    return this;
  }

  _registerBuiltins() {
    this.builtins.clear();
    for (const prefab of createBuiltinPrefabs()) this.builtins.set(prefab.id, prefab);
  }

  // Built-ins first (stable catalog), then user prefabs most-recent-first.
  list() {
    const builtins = [...this.builtins.values()].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    const user = [...this.prefabs.values()].sort((a, b) => {
      const ta = a.metadata?.updatedAt ?? "";
      const tb = b.metadata?.updatedAt ?? "";
      if (ta !== tb) return tb.localeCompare(ta);
      return (a.name ?? "").localeCompare(b.name ?? "");
    });
    return [...builtins, ...user];
  }

  get(id) {
    return this.prefabs.get(id) ?? this.builtins.get(id) ?? null;
  }

  has(id) {
    return this.prefabs.has(id) || this.builtins.has(id);
  }

  isBuiltin(id) {
    return this.builtins.has(id);
  }

  /**
   * Build and persist a user prefab from serialized world-object descriptors.
   * @param {object[]} descriptors  output of WorldObjectManager.serializeWorldObject(s)
   */
  async createFromObjects(descriptors, { name, tags = [], thumbnailDataUrl = null } = {}) {
    let prefab = prefabFromWorldObjects(descriptors, { name, tags });
    if (this.has(prefab.id)) prefab = { ...prefab, id: this._uniqueId(prefab.id) };

    if (thumbnailDataUrl) {
      const ref = `thumb-${prefab.id}`;
      await this.store.putThumbnail(ref, thumbnailDataUrl);
      prefab.metadata.thumbnailRef = ref;
    }

    this.prefabs.set(prefab.id, prefab);
    await this._persist();
    return prefab;
  }

  async rename(id, name) {
    if (this.isBuiltin(id) || !name) return this.get(id);
    const prefab = this.prefabs.get(id);
    if (!prefab) return null;
    const updated = {
      ...prefab,
      name,
      metadata: { ...prefab.metadata, name, updatedAt: new Date().toISOString() },
    };
    this.prefabs.set(id, updated);
    await this._persist();
    return updated;
  }

  async delete(id) {
    if (this.isBuiltin(id)) return false; // system kits cannot be deleted
    const prefab = this.prefabs.get(id);
    if (!prefab) return false;
    this.prefabs.delete(id);
    if (prefab.metadata?.thumbnailRef) await this.store.deleteThumbnail(prefab.metadata.thumbnailRef);
    await this._persist();
    return true;
  }

  async setThumbnail(id, dataUrl) {
    const prefab = this.prefabs.get(id); // built-ins do not carry thumbnails
    if (!prefab || !dataUrl) return this.get(id);
    const ref = prefab.metadata?.thumbnailRef ?? `thumb-${id}`;
    await this.store.putThumbnail(ref, dataUrl);
    const updated = { ...prefab, metadata: { ...prefab.metadata, thumbnailRef: ref } };
    this.prefabs.set(id, updated);
    await this._persist();
    return updated;
  }

  getThumbnail(id) {
    const ref = this.get(id)?.metadata?.thumbnailRef;
    if (!ref) return Promise.resolve(null);
    return this.store.getThumbnail(ref);
  }

  // Metadata-only manifest for embedding in a world document. User prefabs only
  // — built-ins are regenerated locally, so they need not travel with worlds.
  createManifest() {
    return {
      version: 1,
      items: [...this.prefabs.values()].map((prefab) => structuredCloneSafe(prefab)),
    };
  }

  // Merge prefabs from an imported world manifest. Existing prefabs (by id, in
  // either tier) are kept; only previously-unknown prefabs are added.
  async importManifest(manifest, { persist = true } = {}) {
    const { manifest: safe } = sanitizePrefabManifest(manifest);
    let added = 0;
    for (const prefab of safe.items) {
      if (this.has(prefab.id)) continue;
      this.prefabs.set(prefab.id, prefab);
      added++;
    }
    if (added && persist) await this._persist();
    return added;
  }

  // Replace a user prefab wholesale from a (possibly external) document.
  async upsert(document, { persist = true } = {}) {
    const { prefab } = validatePrefabDocument(document);
    if (!prefab || this.isBuiltin(prefab.id)) return null;
    this.prefabs.set(prefab.id, prefab);
    if (persist) await this._persist();
    return prefab;
  }

  _persist() {
    // Persist user prefabs only; built-ins are never written to the store.
    return this.store.saveAll([...this.prefabs.values()]);
  }

  _uniqueId(id) {
    let candidate = `${id}-${shortRandom()}`;
    while (this.has(candidate)) candidate = `${id}-${shortRandom()}`;
    return candidate;
  }
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
