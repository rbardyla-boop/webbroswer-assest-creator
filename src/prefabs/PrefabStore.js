// Local-first persistence for prefabs.
//
// Prefab documents are small (transforms + asset references, no binary blobs),
// so the manifest lives in localStorage. Large preview thumbnails (data URLs)
// are kept out of localStorage and stored in IndexedDB, keyed by thumbnailRef.
//
// Every storage access is guarded so the module imports and runs in Node (no
// window / localStorage / indexedDB), where it simply behaves as empty.

import { PREFAB_DB_NAME, PREFAB_STORAGE_KEY } from "./PrefabTypes.js";
import { validatePrefabDocument } from "./PrefabValidation.js";

const DB_VERSION = 1;
const THUMB_STORE = "thumbnails";

export class PrefabStore {
  constructor({ storageKey = PREFAB_STORAGE_KEY, dbName = PREFAB_DB_NAME } = {}) {
    this.storageKey = storageKey;
    this.dbName = dbName;
    this._dbPromise = null;
  }

  async loadAll() {
    const raw = safeLocalStorage()?.getItem(this.storageKey);
    if (!raw) return [];
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
    const out = [];
    for (const entry of list) {
      const { prefab } = validatePrefabDocument(entry);
      if (prefab) out.push(prefab);
    }
    return out;
  }

  async saveAll(prefabs) {
    const store = safeLocalStorage();
    if (!store) return;
    try {
      store.setItem(this.storageKey, JSON.stringify(prefabs ?? []));
    } catch (error) {
      console.warn("Could not persist prefab library to localStorage.", error);
    }
  }

  async putThumbnail(ref, dataUrl) {
    if (!ref || !dataUrl) return;
    const db = await this._db().catch(() => null);
    if (!db) return;
    await requestToPromise(
      db.transaction(THUMB_STORE, "readwrite").objectStore(THUMB_STORE).put(dataUrl, ref)
    ).catch(() => {});
  }

  async getThumbnail(ref) {
    if (!ref) return null;
    const db = await this._db().catch(() => null);
    if (!db) return null;
    return requestToPromise(
      db.transaction(THUMB_STORE, "readonly").objectStore(THUMB_STORE).get(ref)
    ).catch(() => null);
  }

  async deleteThumbnail(ref) {
    if (!ref) return;
    const db = await this._db().catch(() => null);
    if (!db) return;
    await requestToPromise(
      db.transaction(THUMB_STORE, "readwrite").objectStore(THUMB_STORE).delete(ref)
    ).catch(() => {});
  }

  _db() {
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new Error("IndexedDB is unavailable; prefab thumbnails cannot be stored."));
        return;
      }
      const request = indexedDB.open(this.dbName, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(THUMB_STORE)) db.createObjectStore(THUMB_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this._dbPromise;
  }
}

function safeLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
