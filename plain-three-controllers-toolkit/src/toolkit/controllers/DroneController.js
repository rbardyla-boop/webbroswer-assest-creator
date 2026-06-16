import * as THREE from 'three';
import { EventEmitter } from '../core/EventEmitter.js';
import { clamp, dampAngle, makeBasisFromUp, quaternionFromUpForward } from '../utils/vector.js';

const _gravity = new THREE.Vector3();
const _basis = {};
const _q = new THREE.Quaternion();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class DroneController extends EventEmitter {
  constructor({ position = new THREE.Vector3(8, 8, 8), maxSpeed = 18, acceleration = 18, verticalSpeed = 12, yawRate = 2.4, drag = 2.2, gravityScale = 0.2 } = {}) {
    super();
    this.position = position.clone();
    this.velocity = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.forward = new THREE.Vector3(0, 0, -1);
    this.yaw = 0;
    this.visualBank = 0;
    this.maxSpeed = maxSpeed;
    this.acceleration = acceleration;
    this.verticalSpeed = verticalSpeed;
    this.yawRate = yawRate;
    this.drag = drag;
    this.gravityScale = gravityScale;
    this.animation = { controller: 'drone', state: 'hover', speed: 0, grounded: false };
  }

  update(dt, input, world, gravitySystem, camera = null) {
    _gravity.copy(gravitySystem.sample(this.position, this));
    if (_gravity.lengthSq() > 1e-6) this.up.copy(_gravity).normalize().multiplyScalar(-1);
    makeBasisFromUp(this.up, cameraForward(camera, this.forward), _basis);
    _forward.copy(_basis.forward);
    _right.copy(_basis.right);

    const axis = input.getMoveAxis();
    this.yaw += axis.x * this.yawRate * 0.35 * dt;
    this.forward.lerp(_forward, 1 - Math.exp(-5 * dt)).normalize();

    const target = new THREE.Vector3()
      .addScaledVector(_forward, axis.y * this.maxSpeed)
      .addScaledVector(_right, axis.x * this.maxSpeed * 0.75);
    if (input.upHeld()) target.addScaledVector(this.up, this.verticalSpeed);
    if (input.downHeld()) target.addScaledVector(this.up, -this.verticalSpeed);

    this.velocity.lerp(target, 1 - Math.exp(-this.acceleration * dt));
    this.velocity.addScaledVector(_gravity, this.gravityScale * dt);
    this.velocity.multiplyScalar(Math.exp(-this.drag * 0.03 * dt));
    if (this.velocity.length() > this.maxSpeed * 1.4) this.velocity.setLength(this.maxSpeed * 1.4);
    this.position.addScaledVector(this.velocity, dt);

    this.visualBank = dampAngle(this.visualBank, -axis.x * 0.45, 7, dt);
    this._updateAnimation();
    return this.snapshot();
  }

  applyToObject(object) {
    object.position.copy(this.position);
    quaternionFromUpForward(_q, this.up, this.forward);
    const bank = new THREE.Quaternion().setFromAxisAngle(this.forward, this.visualBank);
    object.quaternion.copy(_q).multiply(bank);
    return object;
  }

  snapshot() {
    return { controller: 'drone', state: this.animation.state, position: this.position.clone(), velocity: this.velocity.clone(), up: this.up.clone(), forward: this.forward.clone(), grounded: false, speed: this.animation.speed };
  }

  _updateAnimation() {
    const speed = this.velocity.length();
    let state = 'hover';
    if (speed > 10) state = 'dash';
    else if (speed > 1.2) state = 'fly';
    this.animation = { controller: 'drone', state, speed, grounded: false };
    this.emit('animation', this.animation);
  }
}

function cameraForward(camera, fallback) {
  if (!camera) return fallback;
  const f = new THREE.Vector3();
  camera.getWorldDirection(f);
  return f.lengthSq() > 1e-6 ? f : fallback;
}
