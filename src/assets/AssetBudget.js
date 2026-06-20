// Per-asset budget report + validation (Asset Pipeline-1).
//
// The existing pipeline imports/stores/places GLB assets but never measures their
// cost. This module is the validation boundary an imported asset must clear: it
// traverses a loaded scene and computes a flat budget report (triangles, materials,
// textures, nodes, animation presence, bounding-box dimension = scale discipline),
// then grades it against per-asset ceilings with `ok` / `warn` / `reject` tiers.
//
// PURE: imports only `three`. No GL context, no randomness, no wall-clock — the same
// scene always yields the same counts, so the Node gate can run it headless. It knows
// nothing about the arsenal/authoring/world layers (the isolation boundary the gate
// grep-enforces).

import * as THREE from "three";

// Per-asset ceilings. A single placed prop must not, by itself, approach a whole
// scene's contract ceiling (~700k triangles, mostly vegetation). `warn` flags an
// expensive-but-usable asset; `reject` refuses an asset that would corrupt the budget.
// `maxDimension` is the bounding-box longest axis in world metres — a value in the
// thousands is almost always a centimetre/metre export mistake (scale discipline);
// a sub-`tinyDimension` asset is the inverse mistake and warns.
export const ASSET_BUDGET_LIMITS = Object.freeze({
  triangles: Object.freeze({ warn: 40_000, reject: 200_000 }),
  materials: Object.freeze({ warn: 8, reject: 24 }),
  textures: Object.freeze({ warn: 8, reject: 24 }),
  nodes: Object.freeze({ warn: 64, reject: 256 }),
  maxDimension: Object.freeze({ warn: 250, reject: 2_000 }),
  tinyDimension: 0.05,
});

// The four count metrics + maxDimension are graded as UPPER bounds.
const UPPER_METRICS = Object.freeze(["triangles", "materials", "textures", "nodes", "maxDimension"]);

function trianglesOf(geometry) {
  if (!geometry || !geometry.attributes?.position) return 0;
  const index = geometry.index;
  if (index) return Math.floor(index.count / 3);
  return Math.floor(geometry.attributes.position.count / 3);
}

/**
 * Compute the flat budget report for a loaded asset scene. Counts unique materials and
 * textures by uuid (a material/texture shared across meshes is counted once).
 * @param {THREE.Object3D|null} object3D
 * @param {THREE.AnimationClip[]} [animations]
 * @returns {{triangles:number, materials:number, textures:number, nodes:number, meshes:number, hasAnimation:boolean, clipCount:number, maxDimension:number}}
 */
export function computeAssetBudget(object3D, animations = []) {
  let triangles = 0;
  let nodes = 0;
  let meshes = 0;
  const materialIds = new Set();
  const textureIds = new Set();

  object3D?.traverse?.((child) => {
    nodes += 1;
    if (!child.isMesh && !child.isSkinnedMesh) return;
    meshes += 1;
    triangles += trianglesOf(child.geometry);
    const mats = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
    for (const mat of mats) {
      if (!mat) continue;
      materialIds.add(mat.uuid);
      for (const value of Object.values(mat)) {
        if (value && value.isTexture) textureIds.add(value.uuid);
      }
    }
  });

  let maxDimension = 0;
  if (object3D) {
    const box = new THREE.Box3().setFromObject(object3D);
    if (!box.isEmpty()) {
      const size = new THREE.Vector3();
      box.getSize(size);
      maxDimension = Math.max(size.x, size.y, size.z);
    }
  }

  const clips = Array.isArray(animations) ? animations : [];
  return {
    triangles,
    materials: materialIds.size,
    textures: textureIds.size,
    nodes,
    meshes,
    hasAnimation: clips.length > 0,
    clipCount: clips.length,
    maxDimension: Number.isFinite(maxDimension) ? +maxDimension.toFixed(4) : 0,
  };
}

/**
 * Grade a budget report against per-asset limits.
 * @param {ReturnType<typeof computeAssetBudget>} budget
 * @param {typeof ASSET_BUDGET_LIMITS} [limits]
 * @returns {{severity:'ok'|'warn'|'reject', breaches:Array<{metric:string,value:number,tier:'warn'|'reject',limit:number}>}}
 */
export function validateAssetBudget(budget, limits = ASSET_BUDGET_LIMITS) {
  const breaches = [];
  for (const metric of UPPER_METRICS) {
    const limit = limits[metric];
    const value = Number(budget?.[metric]);
    if (!limit || !Number.isFinite(value)) continue;
    if (Number.isFinite(limit.reject) && value > limit.reject) {
      breaches.push({ metric, value, tier: "reject", limit: limit.reject });
    } else if (Number.isFinite(limit.warn) && value > limit.warn) {
      breaches.push({ metric, value, tier: "warn", limit: limit.warn });
    }
  }
  // A sub-tiny asset is a scale mistake too, but only ever a warning (a small prop is
  // legitimate; a model exported in millimetres is not, and the operator should see it).
  const tiny = limits.tinyDimension;
  const dim = Number(budget?.maxDimension);
  if (Number.isFinite(tiny) && Number.isFinite(dim) && dim > 0 && dim < tiny) {
    breaches.push({ metric: "tinyDimension", value: dim, tier: "warn", limit: tiny });
  }

  const severity = breaches.some((b) => b.tier === "reject")
    ? "reject"
    : breaches.some((b) => b.tier === "warn")
      ? "warn"
      : "ok";
  return { severity, breaches };
}

/** Thrown by the import path when an asset hard-breaches the budget. Carries the report. */
export class AssetBudgetError extends Error {
  /** @param {{budget:object, verdict:object}} report */
  constructor(report) {
    const worst = report?.verdict?.breaches?.find((b) => b.tier === "reject");
    super(worst ? `Asset rejected: ${worst.metric}=${worst.value} exceeds ${worst.limit}` : "Asset rejected by budget");
    this.name = "AssetBudgetError";
    this.report = report;
  }
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize a persisted budget descriptor (from IndexedDB metadata or a world-document
 * manifest item) to finite numbers, or null when absent/garbage. Pure data — used by
 * both the asset metadata validator and the world-document manifest sanitizer so the
 * captured counts survive every save→load round-trip.
 * @param {unknown} value
 */
export function sanitizeAssetBudget(value) {
  if (!value || typeof value !== "object") return null;
  const triangles = num(value.triangles);
  const materials = num(value.materials);
  const textures = num(value.textures);
  const nodes = num(value.nodes);
  if (triangles === null && materials === null && textures === null && nodes === null) return null;
  // Counts + dimension are non-negative by construction (computeAssetBudget starts at 0
  // and only increments); clamp here so a corrupted/hand-edited persisted budget can't
  // inject a negative that would later SUBTRACT from a summed report (boundary hardening).
  const nonNeg = (n) => Math.max(0, n ?? 0);
  return {
    triangles: nonNeg(triangles),
    materials: nonNeg(materials),
    textures: nonNeg(textures),
    nodes: nonNeg(nodes),
    meshes: nonNeg(num(value.meshes)),
    hasAnimation: value.hasAnimation === true,
    clipCount: nonNeg(num(value.clipCount)),
    maxDimension: nonNeg(num(value.maxDimension)),
    severity: value.severity === "warn" || value.severity === "reject" ? value.severity : "ok",
  };
}
