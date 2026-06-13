const DB_NAME = "grass-world-assets";
const DB_VERSION = 1;
const METADATA_STORE = "metadata";
const BLOB_STORE = "blobs";

export class AssetStore {
  constructor({ dbName = DB_NAME } = {}) {
    this.dbName = dbName;
    this._dbPromise = null;
  }

  async listMetadata() {
    const db = await this._db();
    return requestToPromise(db.transaction(METADATA_STORE, "readonly").objectStore(METADATA_STORE).getAll());
  }

  async getMetadata(id) {
    const db = await this._db();
    return requestToPromise(db.transaction(METADATA_STORE, "readonly").objectStore(METADATA_STORE).get(id));
  }

  async putAsset(metadata, blob = null) {
    const db = await this._db();
    await transactionToPromise(db, [METADATA_STORE, BLOB_STORE], "readwrite", (tx) => {
      tx.objectStore(METADATA_STORE).put(metadata);
      if (blob) tx.objectStore(BLOB_STORE).put(blob, metadata.id);
    });
    return metadata;
  }

  async updateMetadata(metadata) {
    const db = await this._db();
    await requestToPromise(db.transaction(METADATA_STORE, "readwrite").objectStore(METADATA_STORE).put(metadata));
    return metadata;
  }

  async getBlob(id) {
    const db = await this._db();
    return requestToPromise(db.transaction(BLOB_STORE, "readonly").objectStore(BLOB_STORE).get(id));
  }

  async deleteAsset(id) {
    const db = await this._db();
    await transactionToPromise(db, [METADATA_STORE, BLOB_STORE], "readwrite", (tx) => {
      tx.objectStore(METADATA_STORE).delete(id);
      tx.objectStore(BLOB_STORE).delete(id);
    });
  }

  async _db() {
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new Error("IndexedDB is unavailable; persistent asset storage cannot be opened."));
        return;
      }
      const request = indexedDB.open(this.dbName, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(METADATA_STORE)) db.createObjectStore(METADATA_STORE, { keyPath: "id" });
        if (!db.objectStoreNames.contains(BLOB_STORE)) db.createObjectStore(BLOB_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this._dbPromise;
  }
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionToPromise(db, stores, mode, run) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
    run(tx);
  });
}
