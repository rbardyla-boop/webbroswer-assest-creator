import * as THREE from 'three';
import { EventEmitter } from '../core/EventEmitter.js';
import { clamp, dampVector, makeBasisFromUp, projectOnPlane, quaternionFromUpForward, safeNormalize } from '../utils/vector.js';

const _gravity = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _up = new THREE.Vector3(0, 1, 0);
const _basis = {};
const _desired = new THREE.Vector3();
const _targetVel = new THREE.Vector3();
const _horizontalVel = new THREE.Vector3();
const _cameraForward = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _tmp = new THREE.Vector3();

export class CharacterController extends EventEmitter {
  constructor({
    position = new THREE.Vector3(0, 4, 0),
    radius = 0.42,
    height = 1.8,
    walkSpeed = 6.5,
    runSpeed = 11,
    acceleration = 16,
    airAcceleration = 4.5,
    jumpSpeed = 8.5,
    maxSlopeAngle = THREE.MathUtils.degToRad(50),
    groundProbeDistance = 1.1,
    groundSnapDistance = 0.55,
    turnRate = 14,
  } = {}) {
    super();
    this.position = position.clone(); // feet/contact point
    this.velocity = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.forward = new THREE.Vector3(0, 0, -1);
    this.radius = radius;
    this.height = height;
    this.walkSpeed = walkSpeed;
    this.runSpeed = runSpeed;
    this.acceleration = acceleration;
    this.airAcceleration = airAcceleration;
    this.jumpSpeed = jumpSpeed;
    this.maxSlopeAngle = maxSlopeAngle;
    this.groundProbeDistance = groundProbeDistance;
    this.groundSnapDistance = groundSnapDistance;
    this.turnRate = turnRate;
    this.grounded = false;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.groundHit = null;
    this.platform = null;
    this.animation = { controller: 'character', state: 'idle', speed: 0, grounded: false, verticalSpeed: 0, moving: false };
  }

  update(dt, input, world, gravitySystem, camera = null) {
    _gravity.copy(gravitySystem.sample(this.position, this));
    if (_gravity.lengthSq() < 1e-6) _gravity.set(0, -0.0001, 0);
    _down.copy(_gravity).normalize();
    _up.copy(_down).multiplyScalar(-1);
    this.up.lerp(_up, 1 - Math.exp(-10 * dt)).normalize();

    // Carry the character with moving platforms before evaluating input.
    if (this.grounded && this.groundHit?.velocity) {
      this.position.addScaledVector(this.groundHit.velocity, dt);
    }

    const axis = input.getMoveAxis();
    const sprint = input.sprintHeld();
    const speed = sprint ? this.runSpeed : this.walkSpeed;
    this._cameraForward(camera, this.up, _cameraForward);
    makeBasisFromUp(this.up, _cameraForward, _basis);

    _desired.set(0, 0, 0)
      .addScaledVector(_basis.forward, axis.y)
      .addScaledVector(_basis.right, axis.x);
    if (_desired.lengthSq() > 1e-5) _desired.normalize();

    projectOnPlane(_horizontalVel, this.velocity, this.up);
    _targetVel.copy(_desired).multiplyScalar(speed);
    const accel = this.grounded ? this.acceleration : this.airAcceleration;
    dampVector(_horizontalVel, _horizontalVel, _targetVel, accel, dt);

    const verticalSpeed = this.velocity.dot(this.up);
    this.velocity.copy(_horizontalVel).addScaledVector(this.up, verticalSpeed);

    if (input.jumpPressed() && this.grounded) {
      this.velocity.addScaledVector(this.up, Math.max(0, this.jumpSpeed - this.velocity.dot(this.up)));
      this.grounded = false;
      this.platform = null;
      this.emit('jump', this.snapshot());
    }

    this.velocity.addScaledVector(_gravity, dt);
    this.position.addScaledVector(this.velocity, dt);
    world.resolveCapsule(this.position, this.up, this.radius, this.height);

    this._ground(world);

    if (_desired.lengthSq() > 1e-5) {
      this.forward.lerp(_desired, 1 - Math.exp(-this.turnRate * dt)).normalize();
    } else {
      projectOnPlane(this.forward, this.forward, this.up).normalize();
    }

    this._updateAnimation(axis, sprint);
    return this.snapshot();
  }

  applyToObject(object) {
    object.position.copy(this.position);
    quaternionFromUpForward(_q, this.up, this.forward);
    object.quaternion.copy(_q);
    return object;
  }

  snapshot() {
    return {
      controller: 'character',
      state: this.animation.state,
      position: this.position.clone(),
      velocity: this.velocity.clone(),
      up: this.up.clone(),
      grounded: this.grounded,
      speed: this.animation.speed,
      verticalSpeed: this.velocity.dot(this.up),
      groundNormal: this.groundNormal.clone(),
      platform: this.platform,
    };
  }

  _ground(world) {
    const castOrigin = _tmp.copy(this.position).addScaledVector(this.up, this.groundProbeDistance * 0.5);
    const hit = world.sampleGround(castOrigin, _down.copy(this.up).multiplyScalar(-1), this.groundProbeDistance + this.groundSnapDistance);
    this.groundHit = null;
    this.grounded = false;
    this.platform = null;
    if (!hit) return;

    const slopeAngle = Math.acos(clamp(hit.normal.dot(this.up), -1, 1));
    if (slopeAngle > this.maxSlopeAngle) return;

    const velIntoGround = this.velocity.dot(hit.normal) < 0;
    const closeEnough = hit.distance <= this.groundProbeDistance + this.groundSnapDistance;
    if (!velIntoGround && !closeEnough) return;

    this.position.copy(hit.point);
    const into = this.velocity.dot(hit.normal);
    if (into < 0) this.velocity.addScaledVector(hit.normal, -into);
    this.groundNormal.copy(hit.normal);
    this.grounded = true;
    this.groundHit = hit;
    this.platform = hit.collider;
  }

  _cameraForward(camera, up, out) {
    if (camera) {
      camera.getWorldDirection(out);
      projectOnPlane(out, out, up);
      return safeNormalize(out, this.forward);
    }
    return out.copy(this.forward);
  }

  _updateAnimation(axis, sprint) {
    const planarSpeed = projectOnPlane(_tmp, this.velocity, this.up).length();
    const verticalSpeed = this.velocity.dot(this.up);
    let state = 'idle';
    if (!this.grounded) state = verticalSpeed > 0 ? 'jump' : 'fall';
    else if (planarSpeed > 0.35) state = sprint ? 'run' : 'walk';
    this.animation = {
      controller: 'character',
      state,
      speed: planarSpeed,
      grounded: this.grounded,
      verticalSpeed,
      moving: Math.abs(axis.x) + Math.abs(axis.y) > 0.01,
    };
    this.emit('animation', this.animation);
  }
}
