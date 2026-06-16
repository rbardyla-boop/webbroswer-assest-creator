// Owns the shared camera and both view modes. Mouse (pointer-locked) controls
// yaw/pitch in both modes. First-person sits at eye level; third-person orbits
// behind the player with smoothed follow and stays above the terrain. Pressing
// the toggle key flips between them.

import * as THREE from "three";
import { clamp, damp } from "../utils/math.js";
import { getHeight } from "../terrain/terrainSampling.js";

// Camera look direction from yaw/pitch (three.js forward = -Z at yaw/pitch 0).
function lookDir(yaw, pitch, target) {
  const cp = Math.cos(pitch);
  target.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
  return target;
}

export class PlayerCameraController {
  constructor(camera, player, input, { toggleKey = "KeyV" } = {}) {
    this.camera = camera;
    this.player = player;
    this.input = input;
    this.toggleKey = toggleKey;

    this.mode = "third"; // 'first' | 'third'
    this.yaw = 0;
    this.pitch = -0.14;
    this.sensitivity = 0.0022;
    this.minPitch = -1.15;
    this.maxPitch = 0.85;

    // Third-person rig.
    this.distance = 6.5;
    this.followRate = 9;

    this._target = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._desiredPos = new THREE.Vector3();
    this._smoothPos = new THREE.Vector3();
    this._initialized = false;
  }

  toggleMode() {
    this.mode = this.mode === "third" ? "first" : "third";
    // Hide the body in first-person so we don't see inside the capsule.
    this.player.mesh.visible = this.mode !== "first";
    this._initialized = false; // re-seat the smoothed follow position
  }

  update(dt) {
    if (this.input.wasPressed(this.toggleKey)) this.toggleMode();

    // Apply mouse look (only moves when pointer is locked; deltas are 0 else).
    const d = this.input.consumeMouseDelta();
    this.yaw -= d.x * this.sensitivity;
    this.pitch = clamp(this.pitch - d.y * this.sensitivity, this.minPitch, this.maxPitch);

    if (this.mode === "first") {
      this._updateFirstPerson();
    } else {
      this._updateThirdPerson(dt);
    }
  }

  _updateFirstPerson() {
    const p = this.player.position;
    this._target.set(p.x, p.y + this.player.eyeHeight, p.z);
    this.camera.position.copy(this._target);
    lookDir(this.yaw, this.pitch, this._dir);
    this.camera.lookAt(
      this._target.x + this._dir.x,
      this._target.y + this._dir.y,
      this._target.z + this._dir.z
    );
  }

  _updateThirdPerson(dt) {
    const p = this.player.position;
    this._target.set(p.x, p.y + this.player.eyeHeight * 0.92, p.z);

    lookDir(this.yaw, this.pitch, this._dir);
    this._desiredPos.set(
      this._target.x - this._dir.x * this.distance,
      this._target.y - this._dir.y * this.distance,
      this._target.z - this._dir.z * this.distance
    );

    if (!this._initialized) {
      this._smoothPos.copy(this._desiredPos);
      this._initialized = true;
    } else {
      this._smoothPos.x = damp(this._smoothPos.x, this._desiredPos.x, this.followRate, dt);
      this._smoothPos.y = damp(this._smoothPos.y, this._desiredPos.y, this.followRate, dt);
      this._smoothPos.z = damp(this._smoothPos.z, this._desiredPos.z, this.followRate, dt);
    }

    // Don't let the camera dip below the terrain.
    const minY = getHeight(this._smoothPos.x, this._smoothPos.z) + 0.6;
    if (this._smoothPos.y < minY) this._smoothPos.y = minY;

    this.camera.position.copy(this._smoothPos);
    this.camera.lookAt(this._target);
  }

  get modeLabel() {
    return this.mode === "first" ? "First-Person" : "Third-Person";
  }
}
