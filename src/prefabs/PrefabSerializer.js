// Pure data transforms between placed world objects and prefab documents.
//
//   prefabFromWorldObjects(descriptors, opts)  -> prefab document
//   worldObjectsFromPrefab(prefab, placement)  -> world-object descriptors
//
// "Descriptors" are exactly the shape produced by
// WorldObjectManager.serializeWorldObjects(): { name, type, assetRef, primitive,
// asset, transform:{position,rotation,scale}, collider, exclusion, runtime }.
//
// THREE is used only for transform math (compose/decompose); inputs and outputs
// are plain JSON objects, so this module runs unchanged in Node tests.

import * as THREE from "three";
import {
  PREFAB_VERSION,
  createPrefabId,
  identityTransform,
  inferPrefabKind,
  vec3,
} from "./PrefabTypes.js";

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, "XYZ");
const _mA = new THREE.Matrix4();
const _mB = new THREE.Matrix4();
const _mC = new THREE.Matrix4();

function readVec(value, fallback) {
  return {
    x: numberOr(value?.x, fallback.x),
    y: numberOr(value?.y, fallback.y),
    z: numberOr(value?.z, fallback.z),
  };
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function composeMatrix(transform, target = new THREE.Matrix4()) {
  const p = readVec(transform?.position, { x: 0, y: 0, z: 0 });
  const r = readVec(transform?.rotation, { x: 0, y: 0, z: 0 });
  const s = readVec(transform?.scale, { x: 1, y: 1, z: 1 });
  _euler.set(r.x, r.y, r.z, "XYZ");
  _quat.setFromEuler(_euler);
  return target.compose(_pos.set(p.x, p.y, p.z), _quat, _scl.set(s.x, s.y, s.z));
}

function decomposeMatrix(matrix) {
  matrix.decompose(_pos, _quat, _scl);
  _euler.setFromQuaternion(_quat, "XYZ");
  return {
    position: { x: _pos.x, y: _pos.y, z: _pos.z },
    rotation: { x: _euler.x, y: _euler.y, z: _euler.z },
    scale: { x: _scl.x, y: _scl.y, z: _scl.z },
  };
}

// --- creation ----------------------------------------------------------------

/**
 * Build a prefab document from one or more serialized world-object descriptors.
 * The prefab origin is the XZ centroid at the lowest object base, so placement
 * snaps the origin to terrain while child Y offsets are preserved.
 */
export function prefabFromWorldObjects(descriptors, { name, tags = [], id = null, origin = null } = {}) {
  const list = Array.isArray(descriptors) ? descriptors.filter(Boolean) : [descriptors].filter(Boolean);
  if (!list.length) throw new Error("prefabFromWorldObjects requires at least one object");

  // `origin` lets callers (e.g. built-in kits authored in local ground space)
  // override the computed centroid so child local offsets are taken as-is.
  const resolvedOrigin = origin
    ? { x: numberOr(origin.x, 0), y: numberOr(origin.y, 0), z: numberOr(origin.z, 0) }
    : computeOrigin(list);
  const objects = list.map((descriptor, index) => childFromDescriptor(descriptor, resolvedOrigin, index));
  const prefabName = (name && String(name).trim()) || list[0]?.name || "Prefab";
  const now = new Date().toISOString();

  return {
    version: PREFAB_VERSION,
    id: id || createPrefabId(prefabName),
    name: prefabName,
    kind: inferPrefabKind(objects, tags),
    metadata: {
      name: prefabName,
      createdAt: now,
      updatedAt: now,
      sourceObjectIds: list.map((d) => d.id ?? null).filter(Boolean),
      thumbnailRef: null,
      objectCount: objects.length,
      bounds: computeLocalBounds(objects),
      tags: [...tags],
      defaultColliderSummary: summarizeColliders(objects),
      defaultExclusionSummary: summarizeExclusions(objects),
    },
    root: { transform: identityTransform() },
    objects,
  };
}

function computeOrigin(list) {
  let sumX = 0;
  let sumZ = 0;
  let minY = Infinity;
  for (const d of list) {
    const p = readVec(d.transform?.position, { x: 0, y: 0, z: 0 });
    sumX += p.x;
    sumZ += p.z;
    if (p.y < minY) minY = p.y;
  }
  return vec3(sumX / list.length, Number.isFinite(minY) ? minY : 0, sumZ / list.length);
}

function childFromDescriptor(descriptor, origin, index) {
  const p = readVec(descriptor.transform?.position, { x: 0, y: 0, z: 0 });
  return {
    localId: typeof descriptor.id === "string" && descriptor.id ? descriptor.id : `child-${index}`,
    name: descriptor.name ?? "Object",
    type: descriptor.type ?? "primitive",
    assetRef: descriptor.assetRef ?? null,
    primitive: descriptor.primitive ?? null,
    // Keep an inline asset only when there is no assetRef to resolve (e.g. an
    // inline relief). This never duplicates IndexedDB blobs for asset-backed
    // objects, which carry assetRef and a null inline asset.
    asset: descriptor.assetRef ? null : descriptor.asset ?? null,
    localTransform: {
      position: { x: p.x - origin.x, y: p.y - origin.y, z: p.z - origin.z },
      rotation: readVec(descriptor.transform?.rotation, { x: 0, y: 0, z: 0 }),
      scale: readVec(descriptor.transform?.scale, { x: 1, y: 1, z: 1 }),
    },
    collider: normalizeColliderMeta(descriptor.collider),
    exclusion: normalizeExclusionMeta(descriptor.exclusion),
    runtime: normalizeRuntimeMeta(descriptor.runtime),
  };
}

// --- expansion ---------------------------------------------------------------

/**
 * Expand a prefab into world-object descriptors at a placement.
 * placement = { position:{x,y,z}, yaw?:number, scale?:number|{x,y,z} }.
 * Each descriptor carries prefabRef so placed instances remain traceable.
 */
export function worldObjectsFromPrefab(prefab, placement = {}) {
  if (!prefab || !Array.isArray(prefab.objects)) return [];
  const placementScale = normalizeScale(placement.scale);
  const placementTransform = {
    position: readVec(placement.position, { x: 0, y: 0, z: 0 }),
    rotation: { x: 0, y: numberOr(placement.yaw, 0), z: 0 },
    scale: placementScale,
  };

  composeMatrix(placementTransform, _mA); // placement
  composeMatrix(prefab.root?.transform, _mB); // prefab root offset
  _mA.multiply(_mB); // base = placement * root

  return prefab.objects.map((child) => {
    composeMatrix(child.localTransform, _mC);
    _mC.premultiply(_mA); // world = base * local
    const transform = decomposeMatrix(_mC);
    return {
      name: child.name ?? "Object",
      type: child.type ?? "primitive",
      assetRef: child.assetRef ?? null,
      primitive: child.primitive ?? null,
      asset: child.assetRef ? null : child.asset ?? null,
      transform,
      collider: normalizeColliderMeta(child.collider),
      exclusion: normalizeExclusionMeta(child.exclusion),
      runtime: normalizeRuntimeMeta(child.runtime),
      prefabRef: prefab.id ?? null,
    };
  });
}

// --- shared helpers ----------------------------------------------------------

function normalizeScale(scale) {
  if (typeof scale === "number" && Number.isFinite(scale)) return { x: scale, y: scale, z: scale };
  return readVec(scale, { x: 1, y: 1, z: 1 });
}

function normalizeColliderMeta(collider = {}) {
  return {
    type: typeof collider?.type === "string" ? collider.type : "none",
    dimensions: collider && typeof collider.dimensions === "object" && !Array.isArray(collider.dimensions)
      ? { ...collider.dimensions }
      : {},
    enabled: collider?.enabled !== false && collider?.type && collider.type !== "none" ? true : collider?.enabled === true,
  };
}

function normalizeExclusionMeta(exclusion = {}) {
  return {
    grass: exclusion?.grass === true,
    trees: exclusion?.trees === true,
    radius: Math.max(0, numberOr(exclusion?.radius, 0)),
    bounds: exclusion?.bounds ?? null,
  };
}

function normalizeRuntimeMeta(runtime = {}) {
  return {
    visible: runtime?.visible !== false,
    static: runtime?.static !== false,
    castShadow: runtime?.castShadow !== false,
    receiveShadow: runtime?.receiveShadow !== false,
  };
}

function computeLocalBounds(objects) {
  if (!objects.length) return null;
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const child of objects) {
    const p = child.localTransform.position;
    min.x = Math.min(min.x, p.x);
    min.y = Math.min(min.y, p.y);
    min.z = Math.min(min.z, p.z);
    max.x = Math.max(max.x, p.x);
    max.y = Math.max(max.y, p.y);
    max.z = Math.max(max.z, p.z);
  }
  return { min, max };
}

function summarizeColliders(objects) {
  const types = {};
  let dominant = "none";
  let dominantCount = 0;
  for (const child of objects) {
    const type = child.collider?.type ?? "none";
    types[type] = (types[type] ?? 0) + 1;
    if (types[type] > dominantCount) {
      dominantCount = types[type];
      dominant = type;
    }
  }
  return { type: dominant, count: objects.length, types };
}

function summarizeExclusions(objects) {
  return {
    grass: objects.some((child) => child.exclusion?.grass === true),
    trees: objects.some((child) => child.exclusion?.trees === true),
  };
}
