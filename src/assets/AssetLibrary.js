import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { AssetStore } from "./AssetStore.js";
import { ASSET_TYPES, createAssetId, primitiveMetadata } from "./AssetTypes.js";
import { normalizeAssetMetadata, validateAssetMetadata } from "./AssetValidation.js";

export class AssetLibrary {
  constructor({ store = new AssetStore() } = {}) {
    this.store = store;
    this.assets = new Map();
    this.loaded = new Map();
    for (const asset of primitiveMetadata()) this.assets.set(asset.id, asset);
  }

  async init() {
    try {
      this._resetToPrimitives();
      for (const metadata of await this.store.listMetadata()) {
        const result = validateAssetMetadata(metadata);
        for (const warning of result.warnings) console.warn(warning);
        if (!result.asset.id) continue;
        this.assets.set(result.asset.id, result.asset);
      }
    } catch (error) {
      console.warn("Asset library storage unavailable; using in-memory primitives only.", error);
    }
    return this;
  }

  list() {
    return [...this.assets.values()].sort((a, b) => {
      if (a.type === ASSET_TYPES.primitive && b.type !== ASSET_TYPES.primitive) return -1;
      if (a.type !== ASSET_TYPES.primitive && b.type === ASSET_TYPES.primitive) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  get(id) {
    return this.assets.get(id) ?? null;
  }

  async storeAsset(metadata, blob = null) {
    const now = new Date().toISOString();
    let safe = normalizeAssetMetadata({
      ...metadata,
      id: metadata.id || createAssetId(metadata.type || ASSET_TYPES.material, metadata.name || metadata.sourceName),
      createdAt: metadata.createdAt ?? now,
      updatedAt: now,
    });
    if (this.assets.has(safe.id)) safe = { ...safe, id: this._uniqueId(safe.type, safe.name) };
    this.assets.set(safe.id, safe);
    await this.store.putAsset(safe, blob);
    return safe;
  }

  async rename(id, name) {
    const asset = this.get(id);
    if (!asset || asset.type === ASSET_TYPES.primitive) return asset;
    const updated = normalizeAssetMetadata({ ...asset, name: name || asset.name, updatedAt: new Date().toISOString() });
    this.assets.set(id, updated);
    await this.store.updateMetadata(updated);
    return updated;
  }

  async delete(id) {
    const asset = this.get(id);
    if (!asset || asset.type === ASSET_TYPES.primitive) return false;
    this.assets.delete(id);
    this.loaded.delete(id);
    await this.store.deleteAsset(id);
    return true;
  }

  createManifest() {
    return {
      version: 1,
      embedded: [],
      localIndexedDB: true,
      warning: "Large asset binaries are stored locally in IndexedDB and are not embedded in .world.json exports.",
      items: this.list().map((asset) => ({
        id: asset.id,
        type: asset.type,
        kind: asset.kind,
        name: asset.name,
        createdAt: asset.createdAt,
        updatedAt: asset.updatedAt,
        sourceName: asset.sourceName,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        thumbnailRef: asset.thumbnailRef,
        bounds: asset.bounds,
        defaultColliderType: asset.defaultColliderType,
        defaultExclusion: asset.defaultExclusion,
        runtime: asset.runtime,
      })),
    };
  }

  cacheLoadedAsset(id, asset) {
    this.loaded.set(id, asset);
  }

  async resolve(id) {
    const metadata = this.get(id);
    if (!metadata) return null;
    if (metadata.type === ASSET_TYPES.primitive) return metadata;
    if (this.loaded.has(id)) return this.loaded.get(id);

    const blob = await this.store.getBlob(id);
    if (!blob) return null;

    if (metadata.type === ASSET_TYPES.gltf) {
      const gltf = await parseGLTFBlob(blob);
      const asset = { ...metadata, scene: gltf.scene };
      this.loaded.set(id, asset);
      return asset;
    }

    if (metadata.type === ASSET_TYPES.relief) {
      const geometryData = JSON.parse(await blob.text());
      const geometry = new THREE.BufferGeometryLoader().parse(geometryData);
      const asset = { ...metadata, geometry, geometryData };
      this.loaded.set(id, asset);
      return asset;
    }

    if (metadata.type === ASSET_TYPES.image) {
      const texture = await textureFromBlob(blob);
      const asset = { ...metadata, texture };
      this.loaded.set(id, asset);
      return asset;
    }

    return metadata;
  }

  _resetToPrimitives() {
    this.assets.clear();
    for (const asset of primitiveMetadata()) this.assets.set(asset.id, asset);
  }

  _uniqueId(type, name) {
    let id = createAssetId(type, name);
    while (this.assets.has(id)) id = createAssetId(type, name);
    return id;
  }
}

function textureFromBlob(blob) {
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        URL.revokeObjectURL(url);
        resolve(texture);
      },
      undefined,
      (error) => {
        URL.revokeObjectURL(url);
        reject(error);
      }
    );
  });
}

function parseGLTFBlob(blob) {
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(
      url,
      (gltf) => {
        URL.revokeObjectURL(url);
        resolve(gltf);
      },
      undefined,
      (error) => {
        URL.revokeObjectURL(url);
        reject(error);
      }
    );
  });
}
