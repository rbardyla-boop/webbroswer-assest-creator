import { COLLIDER_TYPES } from "../physics/ColliderProxy.js";

export const ASSET_TYPES = {
  primitive: "primitive",
  relief: "relief",
  image: "image",
  gltf: "gltf",
  material: "material",
};

export const PRIMITIVE_ASSET_DEFS = {
  cube: { id: "primitive-cube", type: ASSET_TYPES.primitive, kind: "cube", name: "Cube", color: 0x8fc7ff },
  sphere: { id: "primitive-sphere", type: ASSET_TYPES.primitive, kind: "sphere", name: "Sphere", color: 0xffc36e },
  cylinder: { id: "primitive-cylinder", type: ASSET_TYPES.primitive, kind: "cylinder", name: "Cylinder", color: 0x90dda1 },
  plane: { id: "primitive-plane", type: ASSET_TYPES.primitive, kind: "plane", name: "Plane", color: 0xd8e0ee },
  ramp: { id: "primitive-ramp", type: ASSET_TYPES.primitive, kind: "ramp", name: "Ramp", color: 0xc69cff },
};

export function createAssetId(type, name = "") {
  const clean = String(name)
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 36) || type;
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${type}-${clean}-${String(random).slice(0, 8)}`;
}

export function defaultColliderTypeForAsset(asset) {
  if (asset?.type === ASSET_TYPES.primitive) {
    if (asset.kind === "sphere" || asset.kind === "cylinder") return COLLIDER_TYPES.cylinder;
    if (asset.kind === "plane") return COLLIDER_TYPES.plane;
    if (asset.kind === "ramp") return COLLIDER_TYPES.ramp;
    return COLLIDER_TYPES.box;
  }
  if (asset?.type === ASSET_TYPES.relief) return COLLIDER_TYPES.box;
  if (asset?.type === ASSET_TYPES.gltf) return COLLIDER_TYPES.box;
  if (asset?.type === ASSET_TYPES.image) return COLLIDER_TYPES.plane;
  return COLLIDER_TYPES.none;
}

export function defaultExclusionForAsset(asset) {
  const collider = defaultColliderTypeForAsset(asset);
  const blocks = collider !== COLLIDER_TYPES.none && collider !== COLLIDER_TYPES.trigger;
  return { grass: blocks, trees: blocks };
}

export function primitiveMetadata() {
  const now = new Date().toISOString();
  return Object.values(PRIMITIVE_ASSET_DEFS).map((asset) => ({
    ...asset,
    createdAt: now,
    updatedAt: now,
    sourceName: asset.name,
    mimeType: "application/x-world-builder-primitive",
    sizeBytes: 0,
    thumbnailRef: null,
    bounds: null,
    defaultColliderType: defaultColliderTypeForAsset(asset),
    defaultExclusion: defaultExclusionForAsset(asset),
    runtime: { static: true },
  }));
}

export function isPrimitiveAssetId(id) {
  return Object.values(PRIMITIVE_ASSET_DEFS).some((asset) => asset.id === id);
}
