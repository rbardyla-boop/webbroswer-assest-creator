import * as THREE from 'three';
import { EventEmitter } from '../core/EventEmitter.js';
import { clamp, damp, makeBasisFromUp, projectOnPlane, quaternionFromUpForward } from '../utils/vector.js';

const _gravity = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _down = new THREE.Vector3(0, -1, 0);
const _basis = {};
const _forward = new THREE.Vector3(0, 0, -1);
const _right = new THREE.Vector3(1, 0, 0);
const _groundOrigin = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class CarController extends EventEmitter {
  constructor({ position = new THREE.Vector3(-14, 1, 9), wheelBase = 2.6, acceleration = 24, brakeForce = 30, maxSpeed = 24, reverseSpeed = 9, steerRate = 2.1, drag = 1.6, gravityGrip = 0.9 } = {}) {
    super();
    this.position = position.clone();
    this.velocity = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.forward = new THREE.Vector3(0, 0, -1);
    this.yaw = Math.PI * 0.5;
    this.wheelBase = wheelBase;
    this.acceleration = acceleration;
    this.brakeForce = brakeForce;
    this.maxSpeed = maxSpeed;
    this.reverseSpeed = reverseSpeed;
    this.steerRate = steerRate;
    this.drag = drag;
    this.gravityGrip = gravityGrip;
    this.grounded = false;
    this.animation = { controller: 'car', state: 'parked', speed: 0, grounded: false };
  }

  update(dt, input, world, gravitySystem) {
    _gravity.copy(gravitySystem.sample(this.position, this));
    if (_gravity.lengthSq() > 1e-6) this.up.copy(_gravity).normalize().multiplyScalar(-1);
    _down.copy(this.up).multiplyScalar(-1);
    makeBasisFromUp(this.up, this.forward, _basis);
    _forward.copy(_basis.forward);
    _right.copy(_basis.right);

    const axis = input.getMoveAxis();
    const throttle = axis.y;
    const steer = axis.x;
    const braking = input.brakeHeld();
    const speed = this.velocity.dot(_forward);

    const steerScale = clamp(Math.abs(speed) / 4, 0.25, 1);
    this.yaw += steer * this.steerRate * steerScale * dt * Math.sign(speed || throttle || 1);
    rotateAroundUp(_forward, this.up, this.yaw, this.forward);

    const driveForce = throttle * this.acceleration;
    this.velocity.addScaledVector(this.forward, driveForce * dt);
    if (braking) this.velocity.addScaledVector(this.forward, -Math.sign(speed) * this.brakeForce * dt);

    const max = speed < -0.1 ? this.reverseSpeed : this.maxSpeed;
    const forwardSpeed = clamp(this.velocity.dot(this.forward), -this.reverseSpeed, max);
    const lateral = this.velocity.dot(_right);
    this.velocity.copy(this.forward).multiplyScalar(forwardSpeed).addScaledVector(_right, lateral * Math.exp(-8 * dt));
    this.velocity.multiplyScalar(Math.exp(-this.drag * dt * 0.12));
    this.velocity.addScaledVector(_gravity, dt * (this.grounded ? 0.15 : 1));
    this.position.addScaledVector(this.velocity, dt);

    this._ground(world);
    this._updateAnimation();
    return this.snapshot();
  }

  applyToObject(object) {
    object.position.copy(this.position).addScaledVector(this.up, 0.35);
    quaternionFromUpForward(_q, this.up, this.forward);
    object.quaternion.copy(_q);
    return object;
  }

  snapshot() {
    return { controller: 'car', state: this.animation.state, position: this.position.clone(), velocity: this.velocity.clone(), up: this.up.clone(), forward: this.forward.clone(), grounded: this.grounded, speed: this.animation.speed };
  }

  _ground(world) {
    _groundOrigin.copy(this.position).addScaledVector(this.up, 1.2);
    const hit = world.sampleGround(_groundOrigin, _down, 3.2);
    this.grounded = false;
    if (!hit) return;
    this.position.copy(hit.point);
    this.up.lerp(hit.normal, this.gravityGrip).normalize();
    const into = this.velocity.dot(hit.normal);
    if (into < 0) this.velocity.addScaledVector(hit.normal, -into);
    this.velocity.addScaledVector(hit.velocity, 0.06);
    this.grounded = true;
  }

  _updateAnimation() {
    const speed = projectOnPlane(new THREE.Vector3(), this.velocity, this.up).length();
    let state = 'parked';
    if (!this.grounded) state = 'airborne';
    else if (speed > 12) state = 'drive-fast';
    else if (speed > 0.5) state = 'drive';
    this.animation = { controller: 'car', state, speed, grounded: this.grounded };
    this.emit('animation', this.animation);
  }
}

function rotateAroundUp(out, up, yaw, target) {
  const base = Math.abs(up.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const right = new THREE.Vector3().crossVectors(base, up).normalize();
  const forward = new THREE.Vector3().crossVectors(up, right).normalize();
  target.copy(forward.multiplyScalar(Math.cos(yaw))).addScaledVector(right, Math.sin(yaw)).normalize();
}
