// PagedGeometryValidation — Geometry Stream Gate-0 boundary checks.
//
// Two layers of rejection, both fail-safe (reject, never relocate/clamp into validity):
//   - validatePageDescriptor: structural — id / bounds / counts / build, and the 64k cap,
//   - validateBuiltGeometry:  the realized THREE.BufferGeometry — every position, normal,
//     uv and index value must be finite and in-range, and the vertex count must match the
//     promised count and stay under the cap (a producer cannot under-promise then over-build).
// Duplicate page ids across a batch are rejected by validatePages.
//
// THREE-free: geometry is read duck-typed (`.attributes`, `.index`, `.array`, `.count`) so
// the same checks run in Node and the browser without importing the renderer.

import { MAX_VERTICES_PER_CHUNK, boundsValid, normalizePageDescriptor } from "./PagedGeometryTypes.js";

const fail = (reason) => ({ ok: false, reason });
const pass = (descriptor) => ({ ok: true, descriptor });

/** Structural validation of one descriptor (no build() call). */
export function validatePageDescriptor(item, { maxVerticesPerChunk = MAX_VERTICES_PER_CHUNK } = {}) {
  if (!item || typeof item !== "object") return fail("page descriptor is not an object");
  const id = typeof item.id === "string" ? item.id.trim() : "";
  if (!id) return fail("page id is empty");
  if (!boundsValid(item.bounds)) return fail(`page ${id}: non-finite or inverted bounds`);
  if (!Number.isInteger(item.vertexCount) || item.vertexCount <= 0) return fail(`page ${id}: vertexCount must be a positive integer`);
  if (item.vertexCount > maxVerticesPerChunk) return fail(`page ${id}: ${item.vertexCount} vertices exceeds the ${maxVerticesPerChunk} per-chunk limit`);
  if (!Number.isInteger(item.indexCount) || item.indexCount < 0) return fail(`page ${id}: indexCount must be a non-negative integer`);
  if (typeof item.build !== "function") return fail(`page ${id}: build must be a function`);
  const normalized = normalizePageDescriptor(item, { maxVerticesPerChunk });
  if (!normalized) return fail(`page ${id}: failed normalization`);
  return pass(normalized);
}

/** Validate a batch: every descriptor structurally valid AND all ids unique. */
export function validatePages(items, opts = {}) {
  if (!Array.isArray(items)) return fail("pages must be an array");
  const seen = new Set();
  const descriptors = [];
  for (const item of items) {
    const v = validatePageDescriptor(item, opts);
    if (!v.ok) return v;
    if (seen.has(v.descriptor.id)) return fail(`duplicate page id: ${v.descriptor.id}`);
    seen.add(v.descriptor.id);
    descriptors.push(v.descriptor);
  }
  return { ok: true, descriptors };
}

function allFinite(array) {
  if (!array) return true; // an absent optional attribute is fine
  for (let i = 0; i < array.length; i++) {
    if (!Number.isFinite(array[i])) return false;
  }
  return true;
}

/**
 * Validate a realized geometry against its descriptor and the per-chunk cap. Rejects:
 *   - a missing/empty position attribute,
 *   - a vertex count that disagrees with the descriptor or exceeds the cap,
 *   - any non-finite position / normal / uv value,
 *   - an index referencing a vertex outside [0, count) or carrying a non-finite entry.
 */
export function validateBuiltGeometry(geometry, descriptor, { maxVerticesPerChunk = MAX_VERTICES_PER_CHUNK } = {}) {
  const id = descriptor?.id ?? "?";
  if (!geometry || typeof geometry !== "object" || !geometry.attributes) return fail(`page ${id}: build() did not return a geometry`);
  const position = geometry.attributes.position;
  if (!position || !position.array || position.count <= 0) return fail(`page ${id}: geometry has no position data`);
  if (position.count > maxVerticesPerChunk) return fail(`page ${id}: built ${position.count} vertices exceeds the ${maxVerticesPerChunk} per-chunk limit`);
  if (Number.isInteger(descriptor?.vertexCount) && position.count !== descriptor.vertexCount) {
    return fail(`page ${id}: built ${position.count} vertices but promised ${descriptor.vertexCount}`);
  }
  if (!allFinite(position.array)) return fail(`page ${id}: non-finite position value`);
  if (!allFinite(geometry.attributes.normal?.array)) return fail(`page ${id}: non-finite normal value`);
  if (!allFinite(geometry.attributes.uv?.array)) return fail(`page ${id}: non-finite uv value`);
  const index = geometry.index;
  if (index?.array) {
    for (let i = 0; i < index.array.length; i++) {
      const v = index.array[i];
      if (!Number.isFinite(v) || v < 0 || v >= position.count) return fail(`page ${id}: index ${v} out of range [0, ${position.count})`);
    }
  }
  return { ok: true };
}
