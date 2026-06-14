import * as THREE from "three";
import { VOXEL_LIMITS } from "./VoxelTypes.js";

// A bounded, uniform (cubic-cell) occupancy grid over a world-space AABB. Cell
// size is the longest AABB extent / resolution, so cells are cubes and per-axis
// counts never exceed `resolution` — total cells are bounded by resolution^3.
// Occupancy is a flat Uint8Array; an optional Uint16 id layer records which
// source object filled each cell (0 = none, objectIndex+1 otherwise).
//
// Indexing is x-fastest: index = x + nx*(y + ny*z). Iteration order is fixed
// (z outer, then y, then x) so all consumers see a deterministic ordering.

const MIN_EXTENT = 1e-4; // pad degenerate (flat) AABBs so cellSize stays > 0

export class VoxelGrid {
  constructor({ min, max, resolution }) {
    // Defense in depth: a non-finite resolution (if ever passed directly, bypassing
    // createVoxelConfig) falls back to the default rather than producing NaN dims.
    const safeRes = Number.isFinite(resolution) ? resolution : VOXEL_LIMITS.DEFAULT_RESOLUTION;
    const res = Math.max(VOXEL_LIMITS.MIN_RESOLUTION, Math.min(VOXEL_LIMITS.MAX_RESOLUTION, Math.floor(safeRes)));
    this.min = new THREE.Vector3().copy(min);

    const ex = Math.max(MIN_EXTENT, max.x - min.x);
    const ey = Math.max(MIN_EXTENT, max.y - min.y);
    const ez = Math.max(MIN_EXTENT, max.z - min.z);
    const longest = Math.max(ex, ey, ez);
    this.cellSize = longest / res;

    // Per-axis counts: ceil(extent / cellSize), each in [1, res].
    this.nx = Math.max(1, Math.min(res, Math.ceil(ex / this.cellSize)));
    this.ny = Math.max(1, Math.min(res, Math.ceil(ey / this.cellSize)));
    this.nz = Math.max(1, Math.min(res, Math.ceil(ez / this.cellSize)));
    this.resolution = res;

    const total = this.nx * this.ny * this.nz;
    // Bounded by res^3 ≤ MAX_RESOLUTION^3 by construction; guard anyway.
    if (total > VOXEL_LIMITS.MAX_TOTAL_CELLS) {
      throw new Error(`VoxelGrid exceeds cell cap: ${total} > ${VOXEL_LIMITS.MAX_TOTAL_CELLS}`);
    }
    this.occupancy = new Uint8Array(total);
    this.ids = null; // allocated lazily on first id write
    this._occupiedCount = 0;
  }

  index(x, y, z) {
    return x + this.nx * (y + this.ny * z);
  }

  inBounds(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.nx && y < this.ny && z < this.nz;
  }

  isOccupied(x, y, z) {
    return this.inBounds(x, y, z) && this.occupancy[this.index(x, y, z)] === 1;
  }

  // Mark a cell occupied; optionally record a source-object id (>=0). Returns true
  // if this newly occupied the cell (so callers can count uniquely).
  setOccupied(x, y, z, id = -1) {
    if (!this.inBounds(x, y, z)) return false;
    const i = this.index(x, y, z);
    const wasEmpty = this.occupancy[i] === 0;
    this.occupancy[i] = 1;
    if (id >= 0) {
      if (!this.ids) this.ids = new Uint16Array(this.occupancy.length);
      // First writer wins, so the id is deterministic regardless of overlap order.
      if (this.ids[i] === 0) this.ids[i] = Math.min(0xffff, id + 1);
    }
    if (wasEmpty) this._occupiedCount++;
    return wasEmpty;
  }

  idAt(x, y, z) {
    if (!this.ids || !this.inBounds(x, y, z)) return -1;
    const raw = this.ids[this.index(x, y, z)];
    return raw === 0 ? -1 : raw - 1;
  }

  get occupiedCount() {
    return this._occupiedCount;
  }

  get cellCount() {
    return this.occupancy.length;
  }

  // World position of a cell's center.
  cellCenter(x, y, z, target = new THREE.Vector3()) {
    return target.set(
      this.min.x + (x + 0.5) * this.cellSize,
      this.min.y + (y + 0.5) * this.cellSize,
      this.min.z + (z + 0.5) * this.cellSize
    );
  }

  // Cell containing a world point (may be out of bounds; caller checks).
  worldToCell(p, target = { x: 0, y: 0, z: 0 }) {
    target.x = Math.floor((p.x - this.min.x) / this.cellSize);
    target.y = Math.floor((p.y - this.min.y) / this.cellSize);
    target.z = Math.floor((p.z - this.min.z) / this.cellSize);
    return target;
  }

  // The grid's covered AABB max (min + dims*cellSize, ≥ the source AABB max).
  boundsMax(target = new THREE.Vector3()) {
    return target.set(
      this.min.x + this.nx * this.cellSize,
      this.min.y + this.ny * this.cellSize,
      this.min.z + this.nz * this.cellSize
    );
  }

  // Deterministic iteration over occupied cells (z outer, y, x inner).
  forEachOccupied(fn) {
    let i = 0;
    for (let z = 0; z < this.nz; z++) {
      for (let y = 0; y < this.ny; y++) {
        for (let x = 0; x < this.nx; x++, i++) {
          if (this.occupancy[i] === 1) fn(x, y, z, this.ids ? this.ids[i] - 1 : -1);
        }
      }
    }
  }
}
