import { ASSET_TYPES, defaultColliderTypeForAsset, defaultExclusionForAsset } from "./AssetTypes.js";

export function normalizeAssetMetadata(metadata) {
  const now = new Date().toISOString();
  const type = Object.values(ASSET_TYPES).includes(metadata?.type) ? metadata.type : ASSET_TYPES.primitive;
  const asset = {
    id: String(metadata?.id ?? ""),
    type,
    kind: metadata?.kind,
    name: metadata?.name || metadata?.sourceName || "Asset",
    createdAt: metadata?.createdAt || now,
    updatedAt: metadata?.updatedAt || now,
    sourceName: metadata?.sourceName || metadata?.name || "Asset",
    mimeType: metadata?.mimeType || "",
    sizeBytes: Number.isFinite(metadata?.sizeBytes) ? metadata.sizeBytes : 0,
    thumbnailRef: metadata?.thumbnailRef ?? null,
    bounds: metadata?.bounds ?? null,
    defaultColliderType: metadata?.defaultColliderType,
    defaultExclusion: metadata?.defaultExclusion,
    runtime: metadata?.runtime ?? { static: true },
  };
  if (!asset.defaultColliderType) asset.defaultColliderType = defaultColliderTypeForAsset(asset);
  if (!asset.defaultExclusion) asset.defaultExclusion = defaultExclusionForAsset(asset);
  return asset;
}
