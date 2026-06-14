// Voxel Debug Lab — shared limits + config. This is an editor/debug inspection
// tool (voxelize a selection, visualize occupancy, ray-traverse it), NOT a voxel
// renderer or destructible-terrain system. Every bound here exists so an untrusted
// or pathological mesh can never blow up memory or spin an unbounded loop.

// Hard caps. Chosen so the worst case stays small: 64^3 occupancy = 256 KB, and
// the triangle/test budgets bound voxelization time regardless of mesh size.
export const VOXEL_LIMITS = Object.freeze({
  MIN_RESOLUTION: 2, // cells along the longest grid axis
  MAX_RESOLUTION: 64, // → at most 64^3 = 262144 cells
  DEFAULT_RESOLUTION: 24,
  MAX_TOTAL_CELLS: 64 * 64 * 64, // occupancy byte-array ceiling (defense in depth)
  MAX_SELECTED_OBJECTS: 32, // selection voxelized at once
  MAX_TRIANGLES: 1_500_000, // total source triangles across the selection
  MAX_VOXEL_TESTS: 8_000_000, // global triangle×cell SAT-test budget (anti-blowup)
  MAX_DEBUG_INSTANCES: 60_000, // instanced debug cubes (one InstancedMesh, capped)
});

// Clamp + floor an integer into [lo, hi] with a fallback for garbage input.
export function clampInt(value, lo, hi, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

// Build a sanitized voxel config. Only `resolution` is authored; everything else
// is a fixed safety bound. Invalid input falls back to the default resolution.
export function createVoxelConfig(overrides = {}) {
  const src = overrides && typeof overrides === "object" ? overrides : {};
  return {
    resolution: clampInt(src.resolution, VOXEL_LIMITS.MIN_RESOLUTION, VOXEL_LIMITS.MAX_RESOLUTION, VOXEL_LIMITS.DEFAULT_RESOLUTION),
  };
}
