import * as THREE from "three";

export function createTreeLODGeometries() {
  return [
    {
      trunk: new THREE.CylinderGeometry(0.55, 0.82, 1, 7, 1),
      canopy: new THREE.IcosahedronGeometry(1, 1),
    },
    {
      trunk: new THREE.CylinderGeometry(0.5, 0.78, 1, 5, 1),
      canopy: new THREE.IcosahedronGeometry(1, 0),
    },
    {
      trunk: new THREE.CylinderGeometry(0.45, 0.7, 1, 4, 1),
      canopy: new THREE.ConeGeometry(1, 1.45, 6, 1),
    },
  ];
}

export function disposeTreeLODGeometries(lods) {
  for (const lod of lods) {
    lod.trunk.dispose();
    lod.canopy.dispose();
  }
}
