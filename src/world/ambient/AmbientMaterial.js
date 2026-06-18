// Mote geometry + material — tiny self-lit firefly specks. The geometry is a view-
// independent low-poly octahedron (no billboard, mirrors the wildlife primitive builders);
// the material is a fog-coherent additive glow (MeshBasicMaterial ignores scene lights, so
// the motes read as self-lit points). Additive + depthWrite:false makes overlapping motes
// glow and stack without z-fighting. THREE-only module.

import * as THREE from "three";

export function buildMoteGeometry(species) {
  const g = species.geometry;
  if (g.shape === "octahedron") return new THREE.OctahedronGeometry(g.radius ?? 0.06, 0);
  return new THREE.SphereGeometry(g.radius ?? 0.06, 6, 4); // fallback
}

export function buildMoteMaterial(species) {
  return new THREE.MeshBasicMaterial({
    color: species.color,
    transparent: true,
    opacity: 0.85,
    fog: true, // motes live in the atmosphere — fade with the valley fog like everything else
    blending: THREE.AdditiveBlending, // firefly glow
    depthWrite: false, // glow blobs don't occlude each other
  });
}
