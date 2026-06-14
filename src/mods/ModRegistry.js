// Local registry of installed mod packages. Tracks lightweight entries in
// localStorage; delegates heavy asset blobs to the existing AssetLibrary /
// AssetStore (IndexedDB) and prefab defs to the PrefabLibrary, so nothing is
// duplicated. Imported content is provenance-tracked per mod.
//
// Install never overwrites existing user content: a colliding asset/prefab id is
// skipped with a warning rather than clobbered. No code is ever executed.

import { validateModPackage } from "./ModValidation.js";
import { summarizeModContents } from "./ModManifest.js";
import { base64ToUint8Array } from "../export/BuildAssetCollector.js";
import { normalizeAssetMetadata } from "../assets/AssetValidation.js";

const STORAGE_KEY = "grass-world-mods";

export class ModRegistry {
  constructor({ store = new LocalStorageModStore() } = {}) {
    this.store = store;
    this.entries = new Map(); // id -> registry entry
  }

  async init() {
    try {
      this.entries.clear();
      for (const entry of await this.store.load()) this.entries.set(entry.id, entry);
    } catch (error) {
      console.warn("Mod registry storage unavailable; starting empty.", error);
    }
    return this;
  }

  // Most-recently-installed first.
  list() {
    return [...this.entries.values()].sort((a, b) => (b.installedAt ?? "").localeCompare(a.installedAt ?? ""));
  }

  get(id) {
    return this.entries.get(id) ?? null;
  }

  has(id) {
    return this.entries.has(id);
  }

  /**
   * Validate + install a parsed mod package. Imports assets/prefabs into the
   * shared libraries (skipping id collisions with existing content) and records
   * a provenance-tracked registry entry.
   *
   * @returns {Promise<{ entry: object, warnings: string[] }>}
   * @throws if the package fails validation (caller should have pre-validated)
   */
  async install(modpack, { assetLibrary = null, prefabLibrary = null } = {}) {
    const validation = validateModPackage(modpack);
    if (!validation.ok) throw new Error(`Refusing to install invalid mod: ${validation.errors.join("; ")}`);

    const warnings = [...validation.warnings];
    const contributed = { assetIds: [], prefabIds: [], kitIds: [] };

    const worldpacks = arr(modpack.contents?.worldpacks);
    const embeddedAssets = [...arr(modpack.contents?.assets), ...worldpacks.flatMap((p) => arr(p?.assets))];

    // Assets → AssetLibrary (skip collisions with existing content).
    if (assetLibrary) {
      for (const asset of embeddedAssets) {
        if (!asset?.id || !asset?.dataBase64) continue;
        if (assetLibrary.get(asset.id)) {
          warnings.push(`Asset "${asset.id}" already exists locally; kept the existing one.`);
          continue;
        }
        try {
          const bytes = base64ToUint8Array(asset.dataBase64);
          const blob = new Blob([bytes], { type: asset.mimeType || "application/octet-stream" });
          const metadata = normalizeAssetMetadata({ ...asset, sizeBytes: asset.sizeBytes ?? bytes.length });
          await assetLibrary.storeAsset(metadata, blob);
          contributed.assetIds.push(asset.id);
        } catch (error) {
          warnings.push(`Could not import asset "${asset.id}": ${error.message}`);
        }
      }
    }

    // Prefabs → PrefabLibrary (skip collisions; built-ins never touched).
    if (prefabLibrary) {
      for (const prefab of arr(modpack.contents?.prefabs)) {
        if (!prefab?.id) continue;
        if (prefabLibrary.has(prefab.id)) {
          warnings.push(`Prefab "${prefab.id}" already exists locally; kept the existing one.`);
          continue;
        }
        try {
          const saved = await prefabLibrary.upsert(prefab);
          if (saved) contributed.prefabIds.push(saved.id);
        } catch (error) {
          warnings.push(`Could not import prefab "${prefab.id}": ${error.message}`);
        }
      }
    }

    // Kits are references only (built-ins regenerate locally). Warn if absent.
    for (const kit of arr(modpack.contents?.kits)) {
      if (!kit?.id) continue;
      contributed.kitIds.push(kit.id);
      if (prefabLibrary && !prefabLibrary.get(kit.id)) {
        warnings.push(`Mod references kit "${kit.id}" which is not available in this build.`);
      }
    }

    // Worlds (lightweight docs; blobs already imported above).
    const worlds = [
      ...arr(modpack.contents?.worlds).map((document, i) => ({ name: document?.metadata?.name ?? `World ${i + 1}`, document })),
      ...worldpacks.map((pack, i) => ({ name: pack?.world?.metadata?.name ?? `World ${i + 1}`, document: pack?.world })),
    ].filter((w) => w.document);

    const entry = {
      id: modpack.id,
      name: modpack.name,
      author: modpack.author ?? "",
      description: modpack.description ?? "",
      version: modpack.version,
      license: modpack.license ?? "",
      installedAt: new Date().toISOString(),
      enabled: true,
      counts: summarizeModContents(modpack),
      warnings,
      worlds,
      contributed,
    };

    this.entries.set(entry.id, entry);
    await this._persist();
    return { entry, warnings };
  }

  // The primary (or indexed) world document of an installed mod.
  getModWorld(id, index = 0) {
    const entry = this.get(id);
    const world = entry?.worlds?.[index];
    return world ? { name: world.name, document: world.document } : null;
  }

  async setEnabled(id, enabled) {
    const entry = this.get(id);
    if (!entry) return null;
    const updated = { ...entry, enabled: enabled !== false };
    this.entries.set(id, updated);
    await this._persist();
    return updated;
  }

  // Which of a mod's contributed ids are referenced by the given world document.
  // Lets the UI warn before uninstalling content that is in use.
  referencesInWorld(id, worldDocument) {
    const entry = this.get(id);
    if (!entry || !worldDocument) return { assetIds: [], prefabIds: [] };
    const assetRefs = new Set();
    const prefabRefs = new Set();
    for (const object of worldDocument.objects ?? []) {
      if (object?.assetRef) assetRefs.add(object.assetRef);
      if (object?.prefabRef) prefabRefs.add(object.prefabRef);
    }
    return {
      assetIds: entry.contributed.assetIds.filter((a) => assetRefs.has(a)),
      prefabIds: entry.contributed.prefabIds.filter((p) => prefabRefs.has(p)),
    };
  }

  // Remove the mod entry. Does NOT delete contributed assets/prefabs (they may be
  // used by other worlds); returns what it contributed so the caller can decide.
  async uninstall(id) {
    const entry = this.get(id);
    if (!entry) return null;
    this.entries.delete(id);
    await this._persist();
    return { id, contributed: entry.contributed };
  }

  _persist() {
    return this.store.save([...this.entries.values()]);
  }
}

// localStorage-backed index. Node-safe: throws if localStorage is absent, which
// init() catches to fall back to an empty in-memory registry.
class LocalStorageModStore {
  constructor({ key = STORAGE_KEY } = {}) {
    this.key = key;
  }

  async load() {
    if (typeof localStorage === "undefined") throw new Error("localStorage unavailable");
    const raw = localStorage.getItem(this.key);
    return raw ? JSON.parse(raw) : [];
  }

  async save(entries) {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(this.key, JSON.stringify(entries));
  }
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}
