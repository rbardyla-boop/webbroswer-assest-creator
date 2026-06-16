import * as THREE from 'three';
import { clamp, makeBasisFromUp, safeNormalize } from '../utils/vector.js';

const _basis = {};
const _target = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _forwardHint = new THREE.Vector3(0, 0, -1);

export class SmoothFollowCamera {
  constructor(camera, {
    distance = 7,
    height = 2.3,
    targetHeight = 1.35,
    yaw = 0,
    pitch = -0.22,
    minPitch = -1.15,
    maxPitch = 0.75,
    sensitivity = 0.0022,
    damping = 12,
  } = {}) {
    this.camera = camera;
    this.distance = distance;
    this.height = height;
    this.targetHeight = targetHeight;
    this.yaw = yaw;
    this.pitch = pitch;
    this.minPitch = minPitch;
    this.maxPitch = maxPitch;
    this.sensitivity = sensitivity;
    this.damping = damping;
    this.initialized = false;
  }

  update(dt, input, subject) {
    const md = input.consumeMouseDelta();
    const look = input.getLookAxis?.() || { x: 0, y: 0 };
    this.yaw -= md.x * this.sensitivity + look.x * dt * 2.5;
    this.pitch = clamp(this.pitch - md.y * this.sensitivity - look.y * dt * 1.8, this.minPitch, this.maxPitch);

    const up = subject.up || new THREE.Vector3(0, 1, 0);
    _forwardHint.copy(subject.forward || _forwardHint);
    makeBasisFromUp(up, _forwardHint, _basis);

    // Orbit direction in the subject tangent basis.
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    _dir.set(0, 0, 0)
      .addScaledVector(_basis.forward, cy * cp)
      .addScaledVector(_basis.right, sy * cp)
      .addScaledVector(up, sp);
    safeNormalize(_dir, _basis.forward);

    _target.copy(subject.position).addScaledVector(up, this.targetHeight);
    _desired.copy(_target).addScaledVector(_dir, -this.distance).addScaledVector(up, this.height);

    if (!this.initialized) {
      this.camera.position.copy(_desired);
      this.initialized = true;
    } else {
      this.camera.position.lerp(_desired, 1 - Math.exp(-this.damping * dt));
    }
    this.camera.up.copy(up);
    this.camera.lookAt(_target);
  }

  reset() {
    this.initialized = false;
  }
}
