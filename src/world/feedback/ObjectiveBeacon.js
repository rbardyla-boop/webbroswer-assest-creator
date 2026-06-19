import * as THREE from "three";

export class ObjectiveBeacon {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.name = "SliceObjectiveBeacon";
    const material = new THREE.MeshBasicMaterial({ color: 0x9eeeff, transparent: true, opacity: 0.62, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.055, 8, 40), material);
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = 3.2;
    this.root.add(this.ring);
    this.crown = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), material.clone());
    this.crown.position.y = 3.2;
    this.root.add(this.crown);
    scene.add(this.root);
  }

  setTarget(target, visible = true) {
    this.root.visible = visible && !!target;
    if (target) this.root.position.set(target.x, target.y ?? 0, target.z);
  }

  update(dt, elapsed, urgent = false) {
    this.ring.rotation.z += dt * (urgent ? 1.8 : 0.7);
    const pulse = 1 + Math.sin(elapsed * (urgent ? 5 : 2.4)) * 0.12;
    this.crown.scale.setScalar(pulse);
    this.ring.material.opacity = urgent ? 0.9 : 0.62;
  }

  dispose() {
    this.root.removeFromParent();
    this.root.traverse((node) => {
      node.geometry?.dispose?.();
      node.material?.dispose?.();
    });
  }
}
