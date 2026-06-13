import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ASSET_TYPES, createAssetId, defaultColliderTypeForAsset, defaultExclusionForAsset } from "./AssetTypes.js";
import { computeBoundsFromGeometry, computeBoundsFromObject } from "./AssetPreview.js";
import { iconThumbnail, thumbnailFromImageBlob } from "./AssetThumbnails.js";

export class AssetImporter {
  constructor(assetLibrary) {
    this.library = assetLibrary;
  }

  async importGLTF(file) {
    const id = createAssetId(ASSET_TYPES.gltf, file.name);
    const blob = file.slice(0, file.size, file.type || "model/gltf-binary");
    const loaded = await parseGLTFBlob(blob);
    const assetShape = { type: ASSET_TYPES.gltf };
    const metadata = await this.library.storeAsset({
      id,
      type: ASSET_TYPES.gltf,
      name: stripExtension(file.name),
      sourceName: file.name,
      mimeType: file.type || "model/gltf-binary",
      sizeBytes: file.size,
      thumbnailRef: iconThumbnail("GLTF", "#8fc7ff"),
      bounds: computeBoundsFromObject(loaded.scene),
      defaultColliderType: defaultColliderTypeForAsset(assetShape),
      defaultExclusion: defaultExclusionForAsset(assetShape),
      runtime: { static: true },
    }, blob);
    this.library.cacheLoadedAsset(id, { ...metadata, scene: loaded.scene });
    return metadata;
  }

  async importImage(file) {
    const id = createAssetId(ASSET_TYPES.image, file.name);
    const blob = file.slice(0, file.size, file.type || "image/*");
    const assetShape = { type: ASSET_TYPES.image };
    return this.library.storeAsset({
      id,
      type: ASSET_TYPES.image,
      name: stripExtension(file.name),
      sourceName: file.name,
      mimeType: file.type || "image/*",
      sizeBytes: file.size,
      thumbnailRef: await thumbnailFromImageBlob(blob),
      bounds: { size: { x: 4, y: 3, z: 0.04 }, center: { x: 0, y: 1.5, z: 0 } },
      defaultColliderType: defaultColliderTypeForAsset(assetShape),
      defaultExclusion: defaultExclusionForAsset(assetShape),
      runtime: { static: true, billboard: false },
    }, blob);
  }

  async importRelief({ name = "Relief Asset", geometry }) {
    const id = createAssetId(ASSET_TYPES.relief, name);
    const geometryData = geometry.toJSON();
    const blob = new Blob([JSON.stringify(geometryData)], { type: "application/json" });
    const assetShape = { type: ASSET_TYPES.relief };
    const metadata = await this.library.storeAsset({
      id,
      type: ASSET_TYPES.relief,
      name,
      sourceName: name,
      mimeType: "application/vnd.grass-world.relief+json",
      sizeBytes: blob.size,
      thumbnailRef: iconThumbnail("RELIEF", "#c69cff"),
      bounds: computeBoundsFromGeometry(geometry),
      defaultColliderType: defaultColliderTypeForAsset(assetShape),
      defaultExclusion: defaultExclusionForAsset(assetShape),
      runtime: { static: true },
    }, blob);
    this.library.cacheLoadedAsset(id, { ...metadata, geometry: geometry.clone(), geometryData });
    return metadata;
  }
}

export function parseGLTFBlob(blob) {
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

function stripExtension(name) {
  return String(name).replace(/\.[a-z0-9]+$/i, "");
}
