// Defensive sanitizers for prefab documents and the world-document prefab
// manifest. Pure and Node-safe. Unknown/garbage input never throws — it is
// coerced to a safe shape with warnings, mirroring WorldValidation's contract.

import {
  PREFAB_OBJECT_TYPES,
  PREFAB_VERSION,
  PREFAB_KINDS,
  createPrefabId,
  identityTransform,
  inferPrefabKind,
} from "./PrefabTypes.js";

const KINDS = new Set(Object.values(PREFAB_KINDS));

export function validatePrefabDocument(input) {
  const warnings = [];
  if (!input || typeof input !== "object") {
    return { prefab: null, warnings: ["Prefab document was empty or invalid; skipped."] };
  }

  const name = stringOr(input.name, "Prefab");
  const objects = sanitizeObjects(input.objects, warnings);
  if (!objects.length) {
    warnings.push(`Prefab "${name}" had no valid objects; skipped.`);
    return { prefab: null, warnings };
  }

  const tags = Array.isArray(input.tags) ? input.tags.map(String) : Array.isArray(input.metadata?.tags) ? input.metadata.tags.map(String) : [];

  const prefab = {
    version: PREFAB_VERSION,
    id: stringOr(input.id, null) || createPrefabId(name),
    name,
    kind: KINDS.has(input.kind) ? input.kind : inferPrefabKind(objects, tags),
    metadata: sanitizeMetadata(input.metadata, { name, objects, tags }),
    root: { transform: sanitizeTransform(input.root?.transform) ?? identityTransform() },
    objects,
  };
  return { prefab, warnings };
}

export function sanitizePrefabManifest(manifest) {
  const warnings = [];
  const items = [];
  const seen = new Set();
  const rawItems = Array.isArray(manifest?.items) ? manifest.items : [];
  for (const raw of rawItems) {
    const { prefab, warnings: itemWarnings } = validatePrefabDocument(raw);
    warnings.push(...itemWarnings);
    if (!prefab) continue;
    if (seen.has(prefab.id)) continue; // de-dupe by stable id
    seen.add(prefab.id);
    items.push(prefab);
  }
  return { manifest: { version: 1, items }, warnings };
}

function sanitizeObjects(objects, warnings) {
  const safe = [];
  let index = 0;
  for (const raw of Array.isArray(objects) ? objects : []) {
    const transform = sanitizeTransform(raw?.localTransform);
    if (!transform) {
      warnings.push(`Skipped prefab object ${raw?.localId ?? "(unknown)"} with an invalid transform.`);
      continue;
    }
    const type = PREFAB_OBJECT_TYPES.has(raw?.type) ? raw.type : "primitive";
    safe.push({
      localId: stringOr(raw?.localId, `child-${index}`),
      name: stringOr(raw?.name, "Object"),
      type,
      assetRef: typeof raw?.assetRef === "string" ? raw.assetRef : null,
      primitive: typeof raw?.primitive === "string" ? raw.primitive : null,
      asset: raw?.assetRef ? null : raw?.asset ?? null,
      localTransform: transform,
      collider: sanitizeCollider(raw?.collider),
      exclusion: sanitizeExclusion(raw?.exclusion),
      runtime: sanitizeRuntime(raw?.runtime),
    });
    index++;
  }
  return safe;
}

function sanitizeMetadata(metadata = {}, { name, objects, tags }) {
  const now = new Date().toISOString();
  return {
    name,
    createdAt: stringOr(metadata?.createdAt, now),
    updatedAt: stringOr(metadata?.updatedAt, now),
    sourceObjectIds: Array.isArray(metadata?.sourceObjectIds) ? metadata.sourceObjectIds.map(String) : [],
    thumbnailRef: typeof metadata?.thumbnailRef === "string" ? metadata.thumbnailRef : null,
    objectCount: objects.length,
    bounds: sanitizeBounds(metadata?.bounds),
    tags,
    defaultColliderSummary: metadata?.defaultColliderSummary ?? { type: "none", count: objects.length, types: {} },
    defaultExclusionSummary: {
      grass: metadata?.defaultExclusionSummary?.grass === true,
      trees: metadata?.defaultExclusionSummary?.trees === true,
    },
  };
}

function sanitizeBounds(bounds) {
  const min = sanitizeVec3(bounds?.min, null);
  const max = sanitizeVec3(bounds?.max, null);
  if (!min || !max) return null;
  return { min, max };
}

function sanitizeTransform(transform = {}) {
  const position = sanitizeVec3(transform?.position, { x: 0, y: 0, z: 0 });
  const rotation = sanitizeVec3(transform?.rotation, { x: 0, y: 0, z: 0 });
  const scale = sanitizeVec3(transform?.scale, { x: 1, y: 1, z: 1 });
  if (!position || !rotation || !scale) return null;
  if (Math.abs(scale.x) < 1e-5 || Math.abs(scale.y) < 1e-5 || Math.abs(scale.z) < 1e-5) return null;
  return { position, rotation, scale };
}

function sanitizeCollider(collider = {}) {
  return {
    type: typeof collider?.type === "string" ? collider.type : "none",
    dimensions: collider && typeof collider.dimensions === "object" && !Array.isArray(collider.dimensions)
      ? sanitizeDimensions(collider.dimensions)
      : {},
    enabled: collider?.enabled === true,
  };
}

function sanitizeDimensions(dimensions) {
  const out = {};
  for (const [key, value] of Object.entries(dimensions)) {
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

function sanitizeExclusion(exclusion = {}) {
  return {
    grass: exclusion?.grass === true,
    trees: exclusion?.trees === true,
    radius: Math.max(0, numberOr(exclusion?.radius, 0)),
    bounds: sanitizeBounds(exclusion?.bounds),
  };
}

function sanitizeRuntime(runtime = {}) {
  return {
    visible: runtime?.visible !== false,
    static: runtime?.static !== false,
    castShadow: runtime?.castShadow !== false,
    receiveShadow: runtime?.receiveShadow !== false,
  };
}

function sanitizeVec3(value, fallback) {
  const out = {
    x: numberOr(value?.x, NaN),
    y: numberOr(value?.y, NaN),
    z: numberOr(value?.z, NaN),
  };
  if (Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z)) return out;
  return fallback ? { ...fallback } : null;
}

function stringOr(value, fallback) {
  return typeof value === "string" && value ? value : fallback;
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
