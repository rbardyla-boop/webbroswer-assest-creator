// Generates the base (non-instanced) blade meshes at several LOD levels.
// A blade is a thin, tapered, double-sided strip standing on the XY plane:
//   x ∈ [-0.5, 0.5] * taper   (width, scaled per-instance)
//   y ∈ [0, 1]                (height fraction, scaled per-instance)
//   uv.y carries the height fraction (used for bend, color, wind weighting)
//
// These are shared, read-only buffers; GrassPatch references them and layers
// per-instance attributes on top, so geometry is created once per LOD globally.

import * as THREE from "three";

// Build one blade with `segments` height divisions.
function buildBlade(segments) {
  const rows = segments + 1;
  const positions = new Float32Array(rows * 2 * 3);
  const uvs = new Float32Array(rows * 2 * 2);

  for (let i = 0; i < rows; i++) {
    const t = i / segments; // 0 root → 1 tip
    // Taper width toward the tip and round it slightly.
    const taper = (1 - Math.pow(t, 1.4)) * (1 - 0.15 * t);
    const halfW = 0.5 * taper;

    const li = i * 2;
    const ri = i * 2 + 1;

    // left vertex
    positions[li * 3 + 0] = -halfW;
    positions[li * 3 + 1] = t;
    positions[li * 3 + 2] = 0;
    uvs[li * 2 + 0] = 0;
    uvs[li * 2 + 1] = t;

    // right vertex
    positions[ri * 3 + 0] = halfW;
    positions[ri * 3 + 1] = t;
    positions[ri * 3 + 2] = 0;
    uvs[ri * 2 + 0] = 1;
    uvs[ri * 2 + 1] = t;
  }

  // Triangle strip → explicit indices (two tris per segment).
  const indices = [];
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = (i + 1) * 2;
    const d = (i + 1) * 2 + 1;
    indices.push(a, c, b); // front winding
    indices.push(b, c, d);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

// Returns an array of base blade geometries, one per LOD segment count.
export function createBladeLODGeometries(cfg) {
  return cfg.lodSegments.map((seg) => buildBlade(seg));
}

export function disposeBladeLODGeometries(geos) {
  for (const g of geos) g.dispose();
}
