// The player avatar: a simple capsule plus a small "nose" marker so its facing
// is readable in third-person. Pure state + mesh; movement lives in the
// PlayerController and camera framing in the PlayerCameraController.

import * as THREE from "three";

export class Player {
  constructor() {
    this.radius = 0.4;
    this.height = 1.8; // total capsule height (bottom rests on the ground)
    this.eyeHeight = 1.62; // first-person eye height above the feet

    this.position = new THREE.Vector3(0, 0, 0);
    this.facing = 0; // yaw of the mesh
    this.velocityY = 0;
    this.grounded = true;

    this.mesh = this._build();
  }

  _build() {
    const group = new THREE.Group();
    group.name = "Player";

    const cylinderLen = this.height - this.radius * 2;
    const bodyGeo = new THREE.CapsuleGeometry(this.radius, cylinderLen, 6, 16);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xe07a4e,
      roughness: 0.62,
      metalness: 0.04,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = this.height * 0.5; // capsule centered → bottom at y=0
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Facing marker (points along local +Z).
    const noseGeo = new THREE.SphereGeometry(0.12, 12, 12);
    const noseMat = new THREE.MeshStandardMaterial({ color: 0x24302a, roughness: 0.5 });
    const nose = new THREE.Mesh(noseGeo, noseMat);
    nose.position.set(0, this.height * 0.64, this.radius * 0.92);
    nose.castShadow = true;
    group.add(nose);

    return group;
  }

  syncMesh() {
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.facing;
  }
}
