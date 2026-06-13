// In-memory registry of prefab documents with local-first persistence.
// Mirrors AssetLibrary: a Map keyed by stable prefab id, backed by a store.
//
// Deleting a prefab only removes the template — placed world objects created
// from it are independent objects and are never touched here.

import { PrefabStore } from "./PrefabStore.js";
import { prefabFromWorldObjects } from "./PrefabSerializer.js";
import { validatePrefabDocument, sanitizePrefabManifest } from "./PrefabValidation.js";
import { shortRandom } from "./PrefabTypes.js";

export class PrefabLibrary {
  constructor({ store = new PrefabStore() } = {}) {
    this.store = store;
    this.prefabs = new Map();
  }

  async init() {
    try {
      this.prefabs.clear();
      for (const prefab of await this.store.loadAll()) this.prefabs.set(prefab.id, prefab);
    } catch (error) {
      console.warn("Prefab storage unavailable; starting with an empty prefab library.", error);
    }
    return this;
  }

  list() {
    return [...this.prefabs.values()].sort((a, b) => {
      const ta = a.metadata?.updatedAt ?? "";
      const tb = b.metadata?.updatedAt ?? "";
      if (ta !== tb) return tb.localeCompare(ta); // most-recent first
      return (a.name ?? "").localeCompare(b.name ?? "");
    });
  }

  get(id) {
    return this.prefabs.get(id) ?? null;
  }

  has(id) {
    return this.prefabs.has(id);
  }

  /**
   * Build and persist a prefab from serialized world-object descriptors.
   * @param {object[]} descriptors  output of WorldObjectManager.serializeWorldObject(s)
   */
  async createFromObjects(descriptors, { name, tags = [], thumbnailDataUrl = null } = {}) {
    let prefab = prefabFromWorldObjects(descriptors, { name, tags });
    if (this.prefabs.has(prefab.id)) prefab = { ...prefab, id: this._uniqueId(prefab.id) };

    if (thumbnailDataUrl) {
      const ref = `thumb-${prefab.id}`;
      await this.store.putThumbnail(ref, thumbnailDataUrl);
      prefab.metadata.thumbnailRef = ref;
    }

    this.prefabs.set(prefab.id, prefab);
    await this.store.saveAll(this.list());
    return prefab;
  }

  async rename(id, name) {
    const prefab = this.get(id);
    if (!prefab || !name) return prefab;
    const updated = {
      ...prefab,
      name,
      metadata: { ...prefab.metadata, name, updatedAt: new Date().toISOString() },
    };
    this.prefabs.set(id, updated);
    await this.store.saveAll(this.list());
    return updated;
  }

  async delete(id) {
    const prefab = this.get(id);
    if (!prefab) return false;
    this.prefabs.delete(id);
    if (prefab.metadata?.thumbnailRef) await this.store.deleteThumbnail(prefab.metadata.thumbnailRef);
    await this.store.saveAll(this.list());
    return true;
  }

  async setThumbnail(id, dataUrl) {
    const prefab = this.get(id);
    if (!prefab || !dataUrl) return prefab;
    const ref = prefab.metadata?.thumbnailRef ?? `thumb-${id}`;
    await this.store.putThumbnail(ref, dataUrl);
    const updated = { ...prefab, metadata: { ...prefab.metadata, thumbnailRef: ref } };
    this.prefabs.set(id, updated);
    await this.store.saveAll(this.list());
    return updated;
  }

  getThumbnail(id) {
    const ref = this.get(id)?.metadata?.thumbnailRef;
    if (!ref) return Promise.resolve(null);
    return this.store.getThumbnail(ref);
  }

  // Metadata-only manifest for embedding in a world document. Prefab documents
  // carry no binary blobs (assets are referenced by id), so the full document
  // is included — letting an imported world restore its prefab library.
  createManifest() {
    return {
      version: 1,
      items: this.list().map((prefab) => structuredCloneSafe(prefab)),
    };
  }

  // Merge prefabs from an imported world manifest. Existing prefabs (by id) are
  // kept; only previously-unknown prefabs are added. Never throws on bad input.
  async importManifest(manifest, { persist = true } = {}) {
    const { manifest: safe } = sanitizePrefabManifest(manifest);
    let added = 0;
    for (const prefab of safe.items) {
      if (this.prefabs.has(prefab.id)) continue;
      this.prefabs.set(prefab.id, prefab);
      added++;
    }
    if (added && persist) await this.store.saveAll(this.list());
    return added;
  }

  // Replace a prefab wholesale from a (possibly external) document.
  async upsert(document, { persist = true } = {}) {
    const { prefab } = validatePrefabDocument(document);
    if (!prefab) return null;
    this.prefabs.set(prefab.id, prefab);
    if (persist) await this.store.saveAll(this.list());
    return prefab;
  }

  _uniqueId(id) {
    let candidate = `${id}-${shortRandom()}`;
    while (this.prefabs.has(candidate)) candidate = `${id}-${shortRandom()}`;
    return candidate;
  }
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
