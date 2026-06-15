// Placement validation (Stage 17C-2). Detects bad overlaps + invalid placements
// among placed objects (typically a generator's output) using a Stage-16 bounded
// VoxelGrid as a broad-phase spatial hash and AABB (bounds) intersection as the
// narrow phase. Only SOLID objects (collider != "none") are overlap-checked —
// flat ground decals like streets intentionally overlap at intersections and
// underlap buildings, so they are excluded.

import * as THREE from "three";
import { VoxelGrid } from "../voxels/VoxelGrid.js";

// Fraction of the smaller object's volume that must be shared to count as a real
// overlap (so incidental touching / a tree brushing a wall isn't flagged).
const OVERLAP_TOLERANCE = 0.25;

/**
 * @param {Map|Iterable} objects placed object Groups
 * @returns {{ checked:number, solids:number, overlaps:Array, invalid:Array }}
 */
export function validatePlacement(objects, { resolution = 48 } = {}) {
  const list = objects instanceof Map ? [...objects.values()] : Array.from(objects ?? []);
  const entries = [];
  const invalid = [];
  const bounds = new THREE.Box3();
  const tmp = new THREE.Box3();

  for (const object of list) {
    object.updateWorldMatrix?.(true, true);
    tmp.setFromObject(object);
    const finite = [tmp.min.x, tmp.min.y, tmp.min.z, tmp.max.x, tmp.max.y, tmp.max.z].every(Number.isFinite);
    if (tmp.isEmpty() || !finite) {
      invalid.push({ id: object.userData?.objectId ?? null, name: object.name, reason: "non-finite-or-empty-bounds" });
      continue;
    }
    const solid = (object.userData?.collider?.type ?? "none") !== "none";
    entries.push({ id: object.userData?.objectId ?? null, name: object.name, box: tmp.clone(), solid });
    bounds.union(tmp);
  }

  const solids = entries.filter((e) => e.solid);
  if (solids.length < 2) return { checked: entries.length, solids: solids.length, overlaps: [], invalid };

  // Broad phase: bucket each solid's AABB cells into a bounded grid.
  const grid = new VoxelGrid({ min: bounds.min, max: bounds.max, resolution: Math.min(64, Math.max(2, Math.floor(resolution))) });
  const buckets = new Map();
  const lo = { x: 0, y: 0, z: 0 };
  const hi = { x: 0, y: 0, z: 0 };
  for (let s = 0; s < solids.length; s++) {
    grid.worldToCell(solids[s].box.min, lo);
    grid.worldToCell(solids[s].box.max, hi);
    for (let z = clampCell(lo.z, grid.nz); z <= clampCell(hi.z, grid.nz); z++) {
      for (let y = clampCell(lo.y, grid.ny); y <= clampCell(hi.y, grid.ny); y++) {
        for (let x = clampCell(lo.x, grid.nx); x <= clampCell(hi.x, grid.nx); x++) {
          const idx = grid.index(x, y, z);
          let arr = buckets.get(idx);
          if (!arr) buckets.set(idx, (arr = []));
          arr.push(s);
        }
      }
    }
  }

  // Narrow phase: AABB overlap within shared cells, deduped.
  const seen = new Set();
  const overlaps = [];
  const inter = new THREE.Box3();
  for (const arr of buckets.values()) {
    for (let a = 0; a < arr.length; a++) {
      for (let b = a + 1; b < arr.length; b++) {
        const i = arr[a];
        const j = arr[b];
        const key = i < j ? i * solids.length + j : j * solids.length + i;
        if (seen.has(key)) continue;
        seen.add(key);
        inter.copy(solids[i].box).intersect(solids[j].box);
        if (inter.isEmpty()) continue;
        const shared = boxVolume(inter);
        const minVol = Math.min(boxVolume(solids[i].box), boxVolume(solids[j].box));
        if (minVol > 1e-9 && shared / minVol > OVERLAP_TOLERANCE) {
          overlaps.push({
            a: solids[i].id,
            b: solids[j].id,
            aName: solids[i].name,
            bName: solids[j].name,
            fraction: +(shared / minVol).toFixed(3),
          });
        }
      }
    }
  }

  return { checked: entries.length, solids: solids.length, overlaps, invalid };
}

function clampCell(v, n) {
  return v < 0 ? 0 : v >= n ? n - 1 : v;
}

function boxVolume(b) {
  return Math.max(0, b.max.x - b.min.x) * Math.max(0, b.max.y - b.min.y) * Math.max(0, b.max.z - b.min.z);
}
