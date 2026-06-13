import * as THREE from "three";

export class TreeMaterial {
  constructor(cfg) {
    this.trunk = new THREE.MeshStandardMaterial({
      color: cfg.trunkColor,
      roughness: 0.9,
      metalness: 0,
      vertexColors: true,
    });
    this.canopy = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.82,
      metalness: 0,
      vertexColors: true,
    });
  }

  update() {}

  dispose() {
    this.trunk.dispose();
    this.canopy.dispose();
  }
}
