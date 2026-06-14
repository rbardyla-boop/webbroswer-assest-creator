import * as THREE from "three";

// Three LOD shrub meshes (single geometry each — no trunk/canopy split, so a
// patch draws one instanced mesh per LOD). Detail falls off with distance.
export function createBushLODGeometries() {
  return [
    { bush: new THREE.IcosahedronGeometry(1, 1) },
    { bush: new THREE.IcosahedronGeometry(1, 0) },
    { bush: new THREE.TetrahedronGeometry(1, 0) },
  ];
}

export function disposeBushLODGeometries(lods) {
  for (const lod of lods) lod.bush.dispose();
}
