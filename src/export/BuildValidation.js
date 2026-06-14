// Runtime-safety validation for an exported world. Produces an enumerated,
// checkable report (one criterion → one PASS/WARN/FAIL) so the export path can
// fail or warn clearly. Node-safe (no DOM, no scene instantiation): all checks
// run against the document + the asset-collection result.

import { COLLIDER_TYPES } from "../physics/ColliderProxy.js";
import { validateWorldDocument } from "../world/WorldValidation.js";

const RUNTIME_OBJECT_TYPES = new Set(["primitive", "relief", "image", "gltf"]);
const COLLIDER_TYPE_SET = new Set(Object.values(COLLIDER_TYPES));
// Colliders that occupy volume the player can be embedded inside (planes are
// walkable surfaces, triggers are non-solid).
const BLOCKING_COLLIDERS = new Set([COLLIDER_TYPES.box, COLLIDER_TYPES.cylinder, COLLIDER_TYPES.ramp]);

// Coarse footprint radius (XZ) for a placed object, by primitive base size.
const BASE_FOOTPRINT = { cube: 0.9, ramp: 1.0, cylinder: 0.8, sphere: 1.0, plane: 1.2 };

/**
 * @param {object} document  WorldDocument v2 (sanitized or raw — re-validated here)
 * @param {object} collection { embedded, missing } from collectBuildAssets (optional)
 * @returns {{ ok: boolean, errors: string[], warnings: string[], report: object }}
 */
export function validateBuild(document, { embedded = [], missing = [] } = {}) {
  const base = validateWorldDocument(document);
  const doc = base.document;
  const criteria = [];
  const errors = [];
  const warnings = [...base.warnings];

  // 1. World document is valid (validation always yields a usable doc; surface
  //    its sanitization warnings but do not fail the build on them).
  criteria.push(criterion("world-document-valid", "World document is WorldDocument v2-valid", "PASS",
    base.warnings.length ? `${base.warnings.length} field(s) sanitized` : "no issues"));

  // 2. Player spawn exists and is finite.
  const spawn = doc.player?.spawn;
  const spawnFinite = spawn && ["x", "y", "z"].every((k) => Number.isFinite(spawn[k]));
  if (spawnFinite) {
    criteria.push(criterion("player-spawn-present", "Player spawn is present and finite", "PASS",
      `(${spawn.x.toFixed(1)}, ${spawn.y.toFixed(1)}, ${spawn.z.toFixed(1)})`));
  } else {
    criteria.push(criterion("player-spawn-present", "Player spawn is present and finite", "FAIL", "spawn is missing or non-finite"));
    errors.push("Player spawn is missing or non-finite.");
  }

  // 3. Spawn is not obviously embedded inside a blocking object (coarse check).
  if (spawnFinite) {
    const intruder = spawnInsideBlockingGeometry(doc, spawn);
    if (intruder) {
      criteria.push(criterion("player-spawn-clear", "Player spawn is clear of blocking geometry", "WARN",
        `spawn is close to "${intruder.name}" — player may start inside it`));
      warnings.push(`Player spawn is close to "${intruder.name}"; the player may start inside geometry.`);
    } else {
      criteria.push(criterion("player-spawn-clear", "Player spawn is clear of blocking geometry", "PASS", "no blocking object at spawn"));
    }
  }

  // 4. Object transforms are valid.
  const badTransforms = doc.objects.filter((o) => !transformFinite(o.transform));
  if (badTransforms.length) {
    criteria.push(criterion("object-transforms-valid", "All object transforms are finite", "FAIL", `${badTransforms.length} invalid`));
    errors.push(`${badTransforms.length} object(s) have non-finite transforms.`);
  } else {
    criteria.push(criterion("object-transforms-valid", "All object transforms are finite", "PASS", `${doc.objects.length} object(s)`));
  }

  // 5. Collider types are valid.
  const badColliders = doc.objects.filter((o) => o.collider?.type && !COLLIDER_TYPE_SET.has(o.collider.type));
  criteria.push(badColliders.length
    ? criterion("collider-types-valid", "All collider types are known", "WARN", `${badColliders.length} coerced to none`)
    : criterion("collider-types-valid", "All collider types are known", "PASS", "all valid"));
  if (badColliders.length) warnings.push(`${badColliders.length} object(s) had unknown collider types (coerced to none).`);

  // 6. Asset references resolve (or are reported missing → runtime placeholders).
  if (missing.length) {
    criteria.push(criterion("assets-resolve", "External assets resolve", "WARN",
      `${missing.length} missing → placeholder at runtime`));
    warnings.push(`${missing.length} asset(s) are missing and will render as placeholders: ${missing.map((m) => m.id).join(", ")}.`);
  } else {
    criteria.push(criterion("assets-resolve", "External assets resolve", "PASS",
      embedded.length ? `${embedded.length} embedded` : "primitives only — no external assets"));
  }

  // 7. No object requires editor-only/unsupported runtime features.
  const unsupported = doc.objects.filter((o) => o.type && !RUNTIME_OBJECT_TYPES.has(o.type));
  if (unsupported.length) {
    criteria.push(criterion("runtime-supported-objects", "All objects are runtime-supported", "FAIL", `${unsupported.length} unsupported`));
    errors.push(`${unsupported.length} object(s) use an unsupported runtime type.`);
  } else {
    criteria.push(criterion("runtime-supported-objects", "All objects are runtime-supported", "PASS", "no editor-only objects"));
  }

  // 8. prefabRefs are advisory: placed objects are already expanded, so unknown
  //    prefabRefs never block the runtime. Informational PASS.
  const withPrefabRef = doc.objects.filter((o) => typeof o.prefabRef === "string").length;
  criteria.push(criterion("prefabrefs-optional", "prefabRefs are optional at runtime", "PASS",
    `${withPrefabRef} object(s) tagged; objects are pre-expanded`));

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    report: {
      ok: errors.length === 0,
      objectCount: doc.objects.length,
      assetCount: embedded.length,
      missingAssetCount: missing.length,
      prefabCount: doc.prefabs?.items?.length ?? 0,
      criteria,
    },
  };
}

function criterion(id, label, status, detail) {
  return { id, label, status, detail };
}

function transformFinite(transform) {
  return ["position", "rotation", "scale"].every((key) => {
    const v = transform?.[key];
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
  });
}

function spawnInsideBlockingGeometry(document, spawn) {
  for (const object of document.objects) {
    const collider = object.collider ?? {};
    if (collider.enabled === false) continue;
    if (!BLOCKING_COLLIDERS.has(collider.type)) continue;
    const center = object.transform?.position;
    if (!center) continue;
    const scale = object.transform?.scale ?? { x: 1, y: 1, z: 1 };
    const baseRadius = BASE_FOOTPRINT[object.primitive] ?? BASE_FOOTPRINT.cube;
    const radius = baseRadius * Math.max(Math.abs(scale.x), Math.abs(scale.z), 0.01);
    const dx = spawn.x - center.x;
    const dz = spawn.z - center.z;
    if (dx * dx + dz * dz > radius * radius) continue;
    // Within the footprint: flag only if the spawn sits below the object's top
    // (i.e. not standing cleanly on top of a low platform). Object position is
    // the geometry center, so the top is center.y + half the (full) height.
    const halfHeight = Math.abs(((collider.dimensions?.height ?? 1.8) / 2) * Math.abs(scale.y));
    if (spawn.y < center.y + halfHeight - 0.1) return object;
  }
  return null;
}
