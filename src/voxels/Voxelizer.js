import * as THREE from "three";
import { VOXEL_LIMITS, createVoxelConfig } from "./VoxelTypes.js";
import { VoxelGrid } from "./VoxelGrid.js";

// CPU surface voxelization of selected meshes into a bounded occupancy grid.
// Deterministic: objects in selection order, meshes in traversal order, triangles
// in index order, cells in z/y/x order, first-writer-wins ids. Bounded three ways:
// selection count, total triangle count, and a global triangle×cell SAT-test
// budget — so a pathological mesh can never spin an unbounded loop.

const SURFACE_EPS = 1e-4; // tiny box-halfsize pad so boundary triangles aren't missed

/**
 * @param {THREE.Object3D[]} objects  selected roots (each traversed for meshes)
 * @param {object} configOverrides    { resolution }
 * @returns {{ grid: VoxelGrid|null, stats: object }}
 */
export function voxelizeObjects(objects, configOverrides = {}) {
  const config = createVoxelConfig(configOverrides);
  const roots = (Array.isArray(objects) ? objects : []).filter(Boolean).slice(0, VOXEL_LIMITS.MAX_SELECTED_OBJECTS);
  const objectCapped = (Array.isArray(objects) ? objects.filter(Boolean).length : 0) > roots.length;

  // Collect drawable meshes, tagged with their source-object index (for ids).
  const meshes = [];
  roots.forEach((root, objectIndex) => {
    root.updateWorldMatrix(true, true);
    root.traverse((child) => {
      if (child.isMesh && !child.isInstancedMesh && child.geometry?.attributes?.position) {
        meshes.push({ mesh: child, objectIndex });
      }
    });
  });

  const empty = { grid: null, stats: emptyStats(config, roots.length, objectCapped) };
  if (meshes.length === 0) return empty;

  // Combined world-space AABB.
  const bounds = new THREE.Box3();
  const tmpBox = new THREE.Box3();
  for (const { mesh } of meshes) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    tmpBox.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
    // Skip a non-finite (possibly pre-cached) bounding box so it can't poison the
    // combined AABB; any NaN that slips past here is still inert in the per-
    // triangle loop (NaN cell ranges iterate zero times).
    if (tmpBox.isEmpty() || ![tmpBox.min.x, tmpBox.min.y, tmpBox.min.z, tmpBox.max.x, tmpBox.max.y, tmpBox.max.z].every(Number.isFinite)) continue;
    bounds.union(tmpBox);
  }
  if (bounds.isEmpty()) return empty;
  // Reject non-finite geometry (NaN/Infinity vertex coords from a corrupt or
  // hostile mesh) at the boundary — otherwise NaN would propagate into the grid
  // dims and stats. Fail safe: no grid, clean empty stats.
  if (![bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z].every(Number.isFinite)) {
    return empty;
  }

  const grid = new VoxelGrid({ min: bounds.min, max: bounds.max, resolution: config.resolution });
  const half = [grid.cellSize * 0.5 + SURFACE_EPS, grid.cellSize * 0.5 + SURFACE_EPS, grid.cellSize * 0.5 + SURFACE_EPS];

  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const center = new THREE.Vector3();
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  const c = [0, 0, 0];

  let triangleCount = 0;
  let testCount = 0;
  let truncated = false;

  outer: for (const { mesh, objectIndex } of meshes) {
    const geom = mesh.geometry;
    const pos = geom.attributes.position;
    const idx = geom.index;
    // Floor so a malformed (non-multiple-of-3) buffer can't run a partial last
    // triangle that reads past the end of the attribute (OOB read → NaN).
    const triCount = Math.floor((idx ? idx.count : pos.count) / 3);
    const mw = mesh.matrixWorld;

    for (let t = 0; t < triCount; t++) {
      if (triangleCount >= VOXEL_LIMITS.MAX_TRIANGLES) { truncated = true; break outer; }
      triangleCount++;

      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      v0.fromBufferAttribute(pos, i0).applyMatrix4(mw);
      v1.fromBufferAttribute(pos, i1).applyMatrix4(mw);
      v2.fromBufferAttribute(pos, i2).applyMatrix4(mw);
      a[0] = v0.x; a[1] = v0.y; a[2] = v0.z;
      b[0] = v1.x; b[1] = v1.y; b[2] = v1.z;
      c[0] = v2.x; c[1] = v2.y; c[2] = v2.z;

      // Cells overlapping this triangle's AABB (clamped to the grid).
      const x0 = clampCell(Math.floor((Math.min(a[0], b[0], c[0]) - grid.min.x) / grid.cellSize), grid.nx);
      const x1 = clampCell(Math.floor((Math.max(a[0], b[0], c[0]) - grid.min.x) / grid.cellSize), grid.nx);
      const y0 = clampCell(Math.floor((Math.min(a[1], b[1], c[1]) - grid.min.y) / grid.cellSize), grid.ny);
      const y1 = clampCell(Math.floor((Math.max(a[1], b[1], c[1]) - grid.min.y) / grid.cellSize), grid.ny);
      const z0 = clampCell(Math.floor((Math.min(a[2], b[2], c[2]) - grid.min.z) / grid.cellSize), grid.nz);
      const z1 = clampCell(Math.floor((Math.max(a[2], b[2], c[2]) - grid.min.z) / grid.cellSize), grid.nz);

      for (let z = z0; z <= z1; z++) {
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            if (testCount >= VOXEL_LIMITS.MAX_VOXEL_TESTS) { truncated = true; break outer; }
            testCount++;
            grid.cellCenter(x, y, z, center);
            if (triBoxOverlap([center.x, center.y, center.z], half, a, b, c)) {
              grid.setOccupied(x, y, z, objectIndex);
            }
          }
        }
      }
    }
  }

  return {
    grid,
    stats: {
      resolution: config.resolution,
      dims: { x: grid.nx, y: grid.ny, z: grid.nz },
      cellSize: grid.cellSize,
      cellCount: grid.cellCount,
      occupied: grid.occupiedCount,
      triangles: triangleCount,
      tests: testCount,
      objects: roots.length,
      meshes: meshes.length,
      truncated: truncated || objectCapped,
      objectCapped,
      bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    },
  };
}

function emptyStats(config, objects, objectCapped) {
  return {
    resolution: config.resolution,
    dims: { x: 0, y: 0, z: 0 },
    cellSize: 0,
    cellCount: 0,
    occupied: 0,
    triangles: 0,
    tests: 0,
    objects,
    meshes: 0,
    truncated: objectCapped,
    objectCapped,
    bounds: null,
  };
}

function clampCell(v, n) {
  return v < 0 ? 0 : v >= n ? n - 1 : v;
}

// --- triangle / AABB separating-axis test (Akenine-Möller, generic form) ------

// True if triangle (a,b,c) overlaps the box centered at boxC with half-extents
// boxH. 13 separating axes: 3 box axes, the triangle normal, 9 edge×axis crosses.
function triBoxOverlap(boxC, boxH, a, b, c) {
  const t0 = [a[0] - boxC[0], a[1] - boxC[1], a[2] - boxC[2]];
  const t1 = [b[0] - boxC[0], b[1] - boxC[1], b[2] - boxC[2]];
  const t2 = [c[0] - boxC[0], c[1] - boxC[1], c[2] - boxC[2]];

  // 3 box axes (fast AABB reject).
  for (let ax = 0; ax < 3; ax++) {
    const mn = Math.min(t0[ax], t1[ax], t2[ax]);
    const mx = Math.max(t0[ax], t1[ax], t2[ax]);
    if (mn > boxH[ax] || mx < -boxH[ax]) return false;
  }

  const e0 = [t1[0] - t0[0], t1[1] - t0[1], t1[2] - t0[2]];
  const e1 = [t2[0] - t1[0], t2[1] - t1[1], t2[2] - t1[2]];
  const e2 = [t0[0] - t2[0], t0[1] - t2[1], t0[2] - t2[2]];

  // Triangle face normal.
  if (separatedOnAxis(cross(e0, e1), t0, t1, t2, boxH)) return false;

  // 9 edge × unit-axis cross products.
  const edges = [e0, e1, e2];
  for (const e of edges) {
    if (separatedOnAxis([0, -e[2], e[1]], t0, t1, t2, boxH)) return false; // e × X
    if (separatedOnAxis([e[2], 0, -e[0]], t0, t1, t2, boxH)) return false; // e × Y
    if (separatedOnAxis([-e[1], e[0], 0], t0, t1, t2, boxH)) return false; // e × Z
  }
  return true;
}

function separatedOnAxis(L, t0, t1, t2, boxH) {
  const len2 = L[0] * L[0] + L[1] * L[1] + L[2] * L[2];
  if (len2 < 1e-12) return false; // degenerate axis can't separate
  const p0 = t0[0] * L[0] + t0[1] * L[1] + t0[2] * L[2];
  const p1 = t1[0] * L[0] + t1[1] * L[1] + t1[2] * L[2];
  const p2 = t2[0] * L[0] + t2[1] * L[1] + t2[2] * L[2];
  const mn = Math.min(p0, p1, p2);
  const mx = Math.max(p0, p1, p2);
  const r = boxH[0] * Math.abs(L[0]) + boxH[1] * Math.abs(L[1]) + boxH[2] * Math.abs(L[2]);
  return mn > r || mx < -r;
}

function cross(u, v) {
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}
