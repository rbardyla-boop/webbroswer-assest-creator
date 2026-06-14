// Amanatides–Woo voxel-grid DDA traversal. Returns the first occupied cell a ray
// enters, with the face normal it crossed. Pure (numbers in, plain object out) so
// it is deterministic and Node-testable. Handles every awkward case explicitly:
// rays that miss the grid, rays parallel to an axis (zero direction components),
// negative directions, rays starting inside the grid, and bounds exit.

const EPS = 1e-12;

/**
 * @param {import('./VoxelGrid.js').VoxelGrid} grid
 * @param {{x,y,z}} origin       ray origin (world space)
 * @param {{x,y,z}} direction    ray direction (need not be normalized)
 * @param {{maxDistance?:number}} [opts]
 * @returns {object} { hit, reason, voxel?, point?, normal?, face?, distance?, id?, steps }
 */
export function raycastVoxels(grid, origin, direction, opts = {}) {
  const maxDistance = Number.isFinite(opts.maxDistance) ? opts.maxDistance : Infinity;

  // Normalize direction; a zero-length ray can't traverse.
  const dlen = Math.hypot(direction.x, direction.y, direction.z);
  if (dlen < EPS) return miss("zero-direction");
  const d = [direction.x / dlen, direction.y / dlen, direction.z / dlen];
  const o = [origin.x, origin.y, origin.z];

  const minB = [grid.min.x, grid.min.y, grid.min.z];
  const maxB = [
    grid.min.x + grid.nx * grid.cellSize,
    grid.min.y + grid.ny * grid.cellSize,
    grid.min.z + grid.nz * grid.cellSize,
  ];
  const dims = [grid.nx, grid.ny, grid.nz];

  // Ray/AABB slab clip → [tEnter, tExit], tracking the axis the ray entered on.
  let tEnter = 0;
  let tExit = maxDistance;
  let entryAxis = -1;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < EPS) {
      // Parallel to this slab: must already be inside it.
      if (o[a] < minB[a] || o[a] > maxB[a]) return miss("miss");
      continue;
    }
    const inv = 1 / d[a];
    let tNear = (minB[a] - o[a]) * inv;
    let tFar = (maxB[a] - o[a]) * inv;
    if (tNear > tFar) {
      const tmp = tNear;
      tNear = tFar;
      tFar = tmp;
    }
    if (tNear > tEnter) {
      tEnter = tNear;
      entryAxis = a;
    }
    if (tFar < tExit) tExit = tFar;
    if (tEnter > tExit) return miss("miss");
  }
  if (tEnter > tExit) return miss("miss");
  if (tExit < 0) return miss("behind");

  // Entry point + starting cell (clamped against FP boundary overshoot).
  const tStart = Math.max(tEnter, 0);
  const point = [o[0] + d[0] * tStart, o[1] + d[1] * tStart, o[2] + d[2] * tStart];
  const cell = [
    clampCell(Math.floor((point[0] - minB[0]) / grid.cellSize), dims[0]),
    clampCell(Math.floor((point[1] - minB[1]) / grid.cellSize), dims[1]),
    clampCell(Math.floor((point[2] - minB[2]) / grid.cellSize), dims[2]),
  ];

  // Per-axis DDA setup. Zero direction → never steps that axis (tMax = Infinity).
  const step = [0, 0, 0];
  const tMax = [Infinity, Infinity, Infinity];
  const tDelta = [Infinity, Infinity, Infinity];
  for (let a = 0; a < 3; a++) {
    if (d[a] > EPS) {
      step[a] = 1;
      const nextBoundary = minB[a] + (cell[a] + 1) * grid.cellSize;
      tMax[a] = tStart + (nextBoundary - point[a]) / d[a];
      tDelta[a] = grid.cellSize / d[a];
    } else if (d[a] < -EPS) {
      step[a] = -1;
      const prevBoundary = minB[a] + cell[a] * grid.cellSize;
      tMax[a] = tStart + (prevBoundary - point[a]) / d[a];
      tDelta[a] = grid.cellSize / -d[a];
    }
  }

  // The face we crossed to enter the current cell. On entry from outside it is the
  // slab axis (normal opposes the ray); inside-start has no entry face.
  let lastAxis = entryAxis;
  const maxSteps = dims[0] + dims[1] + dims[2] + 3;

  let t = tStart;
  for (let s = 0; s <= maxSteps; s++) {
    if (cell[0] < 0 || cell[1] < 0 || cell[2] < 0 || cell[0] >= dims[0] || cell[1] >= dims[1] || cell[2] >= dims[2]) {
      return miss("bounds-exit", s);
    }
    if (grid.occupancy[grid.index(cell[0], cell[1], cell[2])] === 1) {
      // Face crossed to enter this cell: normal opposes the ray on the last axis.
      const normal = [0, 0, 0];
      let face = "inside"; // ray started inside the grid → no entry face
      if (lastAxis >= 0) {
        const n = -Math.sign(d[lastAxis]);
        normal[lastAxis] = n;
        face = (n > 0 ? "+" : "-") + "xyz"[lastAxis];
      }
      const hitPoint = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
      return {
        hit: true,
        reason: "hit",
        voxel: { x: cell[0], y: cell[1], z: cell[2] },
        point: { x: hitPoint[0], y: hitPoint[1], z: hitPoint[2] },
        normal: { x: normal[0], y: normal[1], z: normal[2] },
        face,
        distance: t,
        id: grid.idAt(cell[0], cell[1], cell[2]),
        steps: s,
      };
    }
    if (t > maxDistance) return miss("max-distance", s);

    // Advance to the next cell across the nearest boundary.
    let axis = 0;
    if (tMax[1] < tMax[0]) axis = 1;
    if (tMax[2] < tMax[axis]) axis = 2;
    cell[axis] += step[axis];
    t = tMax[axis];
    tMax[axis] += tDelta[axis];
    lastAxis = axis;
  }
  return miss("max-steps", maxSteps);
}

function clampCell(v, n) {
  return v < 0 ? 0 : v >= n ? n - 1 : v;
}

function miss(reason, steps = 0) {
  return { hit: false, reason, steps };
}
