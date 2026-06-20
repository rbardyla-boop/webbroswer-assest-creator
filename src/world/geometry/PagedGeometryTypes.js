// PagedGeometryTypes — Geometry Stream Gate-0 value types + pure predicates.
//
// The contract boundary for a chunked geometry streaming layer: a procedural producer
// emits PAGE DESCRIPTORS, each bounded to <= MAX_VERTICES_PER_CHUNK vertices, and the
// stream commits them incrementally. This module is PURE: no THREE, no DOM, no RNG, no
// wall-clock — the determinism the gate depends on lives here and in the producer.
//
// A page descriptor is the unit of streaming:
//   { id: string, bounds: { min:[x,y,z], max:[x,y,z] }, vertexCount, indexCount, build }
// `build` is a LAZY THREE.BufferGeometry factory — it is never called during planning,
// so descriptor metadata (id / order / counts / bounds) is comparable without building.

/** Hard per-chunk vertex ceiling. A page over this is rejected, never split silently. */
export const MAX_VERTICES_PER_CHUNK = 64_000;

/** Default number of pages committed per commitNext() call (deterministic pacing). */
export const DEFAULT_COMMIT_MAX_PAGES = 1;

/** Whitelisted descriptor fields — anything else is dropped on normalization. */
export const PAGE_DESCRIPTOR_FIELDS = Object.freeze(["id", "bounds", "vertexCount", "indexCount", "build"]);

export function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

export function isFiniteVec3(v) {
  return Array.isArray(v) && v.length === 3 && v.every(isFiniteNumber);
}

/** A bounds object is valid when min/max are finite vec3s and min <= max componentwise. */
export function boundsValid(bounds) {
  if (!bounds || typeof bounds !== "object") return false;
  if (!isFiniteVec3(bounds.min) || !isFiniteVec3(bounds.max)) return false;
  return bounds.min.every((lo, i) => lo <= bounds.max[i]);
}

function isPositiveInt(n) {
  return isFiniteNumber(n) && Number.isInteger(n) && n > 0;
}

function isNonNegativeInt(n) {
  return isFiniteNumber(n) && Number.isInteger(n) && n >= 0;
}

/**
 * Normalize a raw page descriptor to exactly the whitelisted fields, or null if it is
 * structurally invalid. Bounds are deep-copied (frozen arrays) so a producer cannot hand
 * the stream a live reference it later mutates. `build` is preserved by reference (it IS
 * the lazy factory). This does NOT call build() or inspect geometry — see PagedGeometryValidation.
 */
export function normalizePageDescriptor(item, { maxVerticesPerChunk = MAX_VERTICES_PER_CHUNK } = {}) {
  if (!item || typeof item !== "object") return null;
  const id = typeof item.id === "string" ? item.id.trim() : "";
  if (!id) return null;
  if (!boundsValid(item.bounds)) return null;
  if (!isPositiveInt(item.vertexCount) || item.vertexCount > maxVerticesPerChunk) return null;
  if (!isNonNegativeInt(item.indexCount)) return null;
  if (typeof item.build !== "function") return null;
  return Object.freeze({
    id,
    bounds: Object.freeze({ min: Object.freeze([...item.bounds.min]), max: Object.freeze([...item.bounds.max]) }),
    vertexCount: item.vertexCount,
    indexCount: item.indexCount,
    build: item.build,
  });
}
