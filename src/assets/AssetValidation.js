import { ASSET_TYPES, defaultColliderTypeForAsset, defaultExclusionForAsset } from "./AssetTypes.js";
import { sanitizeAssetAnimation } from "../animation/AnimationValidation.js";

export function normalizeAssetMetadata(metadata) {
  const now = new Date().toISOString();
  const type = Object.values(ASSET_TYPES).includes(metadata?.type) ? metadata.type : ASSET_TYPES.material;
  const asset = {
    id: String(metadata?.id ?? "").trim(),
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
    // Optional rigged-asset animation metadata (gltf only); null when absent.
    animation: sanitizeAssetAnimation(metadata?.animation).animation,
  };
  if (!asset.defaultColliderType) asset.defaultColliderType = defaultColliderTypeForAsset(asset);
  if (!asset.defaultExclusion) asset.defaultExclusion = defaultExclusionForAsset(asset);
  return asset;
}

export function validateAssetMetadata(metadata) {
  const warnings = [];
  const asset = normalizeAssetMetadata(metadata);
  if (!asset.id) warnings.push("Asset metadata is missing a stable id.");
  if (metadata?.type && !Object.values(ASSET_TYPES).includes(metadata.type)) {
    warnings.push(`Asset ${asset.id || "(unknown)"} had invalid type "${metadata.type}"; using safe material placeholder metadata.`);
  }
  return { asset, warnings, valid: warnings.length === 0 };
}
