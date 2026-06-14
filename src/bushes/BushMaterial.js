import * as THREE from "three";

// Shared foliage material for all bush LODs. Per-instance tint via setColorAt
// (vertexColors), MeshStandardMaterial so it reacts to scene fog + lights/shadows
// (including Stage 13A lighting edits) with no manual shader work.
export class BushMaterial {
  constructor() {
    this.bush = new THREE.MeshStandardMaterial({
      color: 0xffffff, // overridden per-instance
      roughness: 0.86,
      metalness: 0,
      vertexColors: true,
    });
  }

  dispose() {
    this.bush.dispose();
  }
}
