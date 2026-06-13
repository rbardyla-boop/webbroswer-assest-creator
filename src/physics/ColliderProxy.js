import * as THREE from "three";

export const COLLIDER_TYPES = {
  none: "none",
  box: "box",
  cylinder: "cylinder",
  ramp: "ramp",
  plane: "plane",
  trigger: "trigger",
};

export function defaultColliderForAsset(asset) {
  if (asset.type === "primitive") {
    if (asset.kind === "sphere" || asset.kind === "cylinder") return { type: COLLIDER_TYPES.cylinder, excludeGrass: true };
    if (asset.kind === "plane") return { type: COLLIDER_TYPES.plane, excludeGrass: true };
    if (asset.kind === "ramp") return { type: COLLIDER_TYPES.ramp, excludeGrass: true };
    return { type: COLLIDER_TYPES.box, excludeGrass: true };
  }
  if (asset.type === "relief") return { type: COLLIDER_TYPES.box, excludeGrass: true };
  if (asset.type === "gltf") return { type: COLLIDER_TYPES.box, excludeGrass: true };
  return { type: COLLIDER_TYPES.none, excludeGrass: false };
}

export function getCollider(object) {
  return normalizeCollider(object?.userData?.collider);
}

export function normalizeCollider(collider) {
  const type = Object.values(COLLIDER_TYPES).includes(collider?.type) ? collider.type : COLLIDER_TYPES.none;
  return {
    type,
    dimensions: collider?.dimensions ?? {},
    excludeGrass: collider?.excludeGrass ?? collider?.grassExclusion ?? false,
    excludeTrees: collider?.excludeTrees ?? collider?.treeExclusion ?? collider?.excludeGrass ?? collider?.grassExclusion ?? false,
  };
}

export function getWorldBox(object, target = new THREE.Box3()) {
  return target.setFromObject(object);
}

export function pointInFootprint(box, x, z, padding = 0) {
  return x >= box.min.x - padding && x <= box.max.x + padding && z >= box.min.z - padding && z <= box.max.z + padding;
}
