import * as THREE from "three";
import { COLLIDER_TYPES } from "../physics/ColliderProxy.js";
import { createWorldDocument, WORLD_DOCUMENT_FORMAT, WORLD_DOCUMENT_VERSION } from "./WorldDocument.js";

const PRIMITIVES = new Set(["cube", "sphere", "cylinder", "plane", "ramp"]);
const OBJECT_TYPES = new Set(["primitive", "relief", "imported", "image", "custom"]);
const CAMERA_MODES = new Set(["first", "third"]);
const COLLIDERS = new Set(Object.values(COLLIDER_TYPES));

export function validateWorldDocument(input) {
  const warnings = [];
  let source = input;

  if (!source || typeof source !== "object") {
    warnings.push("World document was empty or invalid; defaults were used.");
    source = {};
  }

  if (source.version === 1 || isLegacyObjectOnlySave(source)) {
    source = migrateLegacyDocument(source);
    warnings.push("Loaded legacy world save and migrated it to world-builder-v2.");
  } else if (source.version !== WORLD_DOCUMENT_VERSION) {
    warnings.push(`Unsupported world version ${source.version}; safe defaults were applied where possible.`);
  }

  const doc = createWorldDocument(source);
  doc.version = WORLD_DOCUMENT_VERSION;
  doc.metadata.format = WORLD_DOCUMENT_FORMAT;
  doc.metadata.updatedAt = stringOrNow(doc.metadata.updatedAt);
  doc.metadata.createdAt = stringOrNow(doc.metadata.createdAt);
  doc.objects = sanitizeObjects(doc.objects, warnings);
  doc.assets = sanitizeAssets(doc.assets);
  doc.player.spawn = sanitizeVec3Object(doc.player.spawn, { x: 0, y: 0, z: 0 });
  if (!CAMERA_MODES.has(doc.player.cameraMode)) doc.player.cameraMode = "third";

  doc.terrain.size = positiveNumber(doc.terrain.size, 700);
  doc.terrain.segments = Math.max(8, Math.floor(positiveNumber(doc.terrain.segments, 240)));
  doc.terrain.heightAmplitude = numberOr(doc.terrain.heightAmplitude, 14);
  doc.terrain.featureScale = positiveNumber(doc.terrain.featureScale, 0.012);
  doc.terrain.detailScale = positiveNumber(doc.terrain.detailScale, 0.06);
  doc.terrain.detailAmount = numberOr(doc.terrain.detailAmount, 1.6);

  doc.grass.enabled = doc.grass.enabled !== false;
  doc.grass.density = Math.max(0, numberOr(doc.grass.density, 7));
  doc.grass.patchSize = positiveNumber(doc.grass.patchSize, 24);
  doc.grass.visibleDistance = positiveNumber(doc.grass.visibleDistance, 165);
  doc.grass.keepDistance = Math.max(doc.grass.visibleDistance, positiveNumber(doc.grass.keepDistance, 200));
  doc.grass.lodDistances = sanitizeNumberArray(doc.grass.lodDistances, [55, 110]);
  doc.grass.seed = Math.floor(numberOr(doc.grass.seed, 0));

  doc.trees.enabled = doc.trees.enabled !== false;
  doc.trees.density = Math.max(0, numberOr(doc.trees.density, 0.018));
  doc.trees.patchSize = positiveNumber(doc.trees.patchSize, 36);
  doc.trees.visibleDistance = positiveNumber(doc.trees.visibleDistance, 190);
  doc.trees.keepDistance = Math.max(doc.trees.visibleDistance, positiveNumber(doc.trees.keepDistance, 230));
  doc.trees.seed = Math.floor(numberOr(doc.trees.seed, 1337));
  doc.trees.respectExclusions = doc.trees.respectExclusions !== false;

  return { document: doc, warnings };
}

export function migrateLegacyDocument(legacy = {}) {
  return createWorldDocument({
    objects: (legacy.objects ?? []).map((item) => legacyObjectToV2(item)),
  });
}

function legacyObjectToV2(item = {}) {
  const asset = item.asset ?? {};
  const primitive = asset.kind && PRIMITIVES.has(asset.kind) ? asset.kind : "cube";
  const type = asset.type === "relief" ? "relief" : "primitive";
  return {
    id: item.id,
    name: asset.name,
    type,
    assetRef: asset.id ?? null,
    primitive,
    asset,
    transform: {
      position: arrayToVec3(item.position, [0, 0, 0]),
      rotation: arrayToVec3(item.rotation, [0, 0, 0]),
      scale: arrayToVec3(item.scale, [1, 1, 1]),
    },
    collider: colliderToV2(item.collider),
    exclusion: {
      grass: item.collider?.excludeGrass ?? item.collider?.grassExclusion ?? false,
      trees: item.collider?.excludeGrass ?? item.collider?.grassExclusion ?? false,
      radius: 0,
      bounds: null,
    },
  };
}

function sanitizeObjects(objects, warnings) {
  const safe = [];
  for (const item of objects ?? []) {
    const transform = sanitizeTransform(item?.transform);
    if (!transform) {
      warnings.push(`Skipped object ${item?.id ?? "(unknown)"} because its transform was invalid.`);
      continue;
    }
    const primitive = PRIMITIVES.has(item?.primitive) ? item.primitive : item?.asset?.kind;
    const type = OBJECT_TYPES.has(item?.type) ? item.type : item?.asset?.type === "relief" ? "relief" : "primitive";
    const collider = colliderToV2(item?.collider, warnings, item?.id);
    safe.push({
      id: typeof item?.id === "string" && item.id ? item.id : `obj-${cryptoRandomId()}`,
      name: typeof item?.name === "string" && item.name ? item.name : item?.asset?.name ?? "Placed Object",
      type,
      assetRef: item?.assetRef ?? item?.asset?.id ?? null,
      primitive: PRIMITIVES.has(primitive) ? primitive : "cube",
      asset: item?.asset ?? null,
      transform,
      collider,
      exclusion: {
        grass: item?.exclusion?.grass ?? item?.collider?.excludeGrass ?? false,
        trees: item?.exclusion?.trees ?? item?.collider?.excludeTrees ?? item?.collider?.excludeGrass ?? false,
        radius: Math.max(0, numberOr(item?.exclusion?.radius, 0)),
        bounds: item?.exclusion?.bounds ?? null,
      },
      runtime: {
        visible: item?.runtime?.visible !== false,
        static: item?.runtime?.static !== false,
        castShadow: item?.runtime?.castShadow !== false,
        receiveShadow: item?.runtime?.receiveShadow !== false,
      },
    });
  }
  return safe;
}

function sanitizeAssets(assets = {}) {
  return {
    version: Math.max(1, Math.floor(numberOr(assets.version, 1))),
    embedded: Array.isArray(assets.embedded) ? assets.embedded : [],
    localIndexedDB: assets.localIndexedDB === true,
    warning: typeof assets.warning === "string" ? assets.warning : null,
    items: Array.isArray(assets.items) ? assets.items.map(sanitizeAssetManifestItem).filter(Boolean) : [],
    reliefs: Array.isArray(assets.reliefs) ? assets.reliefs : [],
    images: Array.isArray(assets.images) ? assets.images : [],
    imported: Array.isArray(assets.imported) ? assets.imported : [],
  };
}

function sanitizeAssetManifestItem(item) {
  if (!item?.id || !item?.type) return null;
  return {
    id: String(item.id),
    type: String(item.type),
    kind: item.kind,
    name: String(item.name ?? item.id),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    sourceName: item.sourceName,
    mimeType: item.mimeType,
    sizeBytes: numberOr(item.sizeBytes, 0),
    thumbnailRef: item.thumbnailRef ?? null,
    bounds: item.bounds ?? null,
    defaultColliderType: item.defaultColliderType,
    defaultExclusion: item.defaultExclusion,
    runtime: item.runtime ?? {},
  };
}

function sanitizeTransform(transform = {}) {
  const position = sanitizeVec3Object(transform.position, null);
  const rotation = sanitizeVec3Object(transform.rotation, { x: 0, y: 0, z: 0 });
  const scale = sanitizeVec3Object(transform.scale, { x: 1, y: 1, z: 1 });
  if (!position || !rotation || !scale) return null;
  if (Math.abs(scale.x) < 1e-5 || Math.abs(scale.y) < 1e-5 || Math.abs(scale.z) < 1e-5) return null;
  return { position, rotation, scale };
}

function colliderToV2(collider = {}, warnings = null, objectId = null) {
  const type = COLLIDERS.has(collider?.type) ? collider.type : COLLIDER_TYPES.none;
  if (collider?.type && type === COLLIDER_TYPES.none) {
    warnings?.push(`Object ${objectId ?? "(unknown)"} had invalid collider type "${collider.type}"; using none.`);
  }
  return {
    type,
    dimensions: sanitizeDimensions(collider?.dimensions),
    enabled: collider?.enabled !== false && type !== COLLIDER_TYPES.none,
  };
}

function sanitizeDimensions(dimensions) {
  if (!dimensions || typeof dimensions !== "object" || Array.isArray(dimensions)) return {};
  const out = {};
  for (const [key, value] of Object.entries(dimensions)) {
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

function isLegacyObjectOnlySave(source) {
  if (source.version !== undefined) return false;
  if (source.metadata?.format) return false;
  if (!Array.isArray(source.objects) || source.objects.length === 0) return false;
  return source.objects.some((object) => Array.isArray(object?.position) || Array.isArray(object?.rotation));
}

function sanitizeVec3Object(value, fallback) {
  const out = {
    x: numberOr(value?.x, NaN),
    y: numberOr(value?.y, NaN),
    z: numberOr(value?.z, NaN),
  };
  if (Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z)) return out;
  return fallback ? { ...fallback } : null;
}

function arrayToVec3(value, fallback) {
  const v = Array.isArray(value) ? value : fallback;
  return { x: numberOr(v[0], fallback[0]), y: numberOr(v[1], fallback[1]), z: numberOr(v[2], fallback[2]) };
}

function sanitizeNumberArray(value, fallback) {
  const numbers = Array.isArray(value) ? value.map((n) => Number(n)).filter(Number.isFinite) : [];
  return numbers.length ? numbers : [...fallback];
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positiveNumber(value, fallback) {
  const n = numberOr(value, fallback);
  return n > 0 ? n : fallback;
}

function stringOrNow(value) {
  return typeof value === "string" && value ? value : new Date().toISOString();
}

function cryptoRandomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}
