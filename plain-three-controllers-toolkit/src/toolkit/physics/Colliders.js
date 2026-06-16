import * as THREE from 'three';
import { EPSILON, projectOnPlane } from '../utils/vector.js';

const _ray = new THREE.Ray();
const _box = new THREE.Box3();
const _hit = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _local = new THREE.Vector3();

export class PlaneCollider {
  constructor({ point = new THREE.Vector3(), normal = new THREE.Vector3(0, 1, 0), tangent = new THREE.Vector3(1, 0, 0), halfSize = new THREE.Vector2(100, 100), name = 'plane' } = {}) {
    this.type = 'plane';
    this.name = name;
    this.point = point.clone();
    this.normal = normal.clone().normalize();
    this.tangent = tangent.clone();
    projectOnPlane(this.tangent, this.tangent, this.normal).normalize();
    if (this.tangent.lengthSq() < EPSILON) this.tangent.set(1, 0, 0);
    this.bitangent = new THREE.Vector3().crossVectors(this.normal, this.tangent).normalize();
    this.halfSize = halfSize.clone();
    this.velocity = new THREE.Vector3();
  }

  update() {}

  raycast(origin, direction, maxDistance = Infinity) {
    const denom = direction.dot(this.normal);
    if (Math.abs(denom) < EPSILON) return null;
    const t = _tmp.copy(this.point).sub(origin).dot(this.normal) / denom;
    if (t < 0 || t > maxDistance) return null;
    _hit.copy(origin).addScaledVector(direction, t);
    _local.copy(_hit).sub(this.point);
    const x = _local.dot(this.tangent);
    const z = _local.dot(this.bitangent);
    if (Math.abs(x) > this.halfSize.x || Math.abs(z) > this.halfSize.y) return null;
    return {
      collider: this,
      point: _hit.clone(),
      normal: this.normal.clone(),
      distance: t,
      velocity: this.velocity.clone(),
    };
  }
}

export class BoxCollider {
  constructor({ center = new THREE.Vector3(), size = new THREE.Vector3(1, 1, 1), name = 'box' } = {}) {
    this.type = 'box';
    this.name = name;
    this.center = center.clone();
    this.size = size.clone();
    this.velocity = new THREE.Vector3();
    this.box = new THREE.Box3();
    this.updateBox();
  }

  updateBox() {
    const h = _tmp.copy(this.size).multiplyScalar(0.5);
    this.box.min.copy(this.center).sub(h);
    this.box.max.copy(this.center).add(h);
  }

  update() {
    this.updateBox();
  }

  raycast(origin, direction, maxDistance = Infinity) {
    _ray.set(origin, direction);
    const p = _ray.intersectBox(this.box, _hit);
    if (!p) return null;
    const d = p.distanceTo(origin);
    if (d > maxDistance) return null;
    return {
      collider: this,
      point: p.clone(),
      normal: boxNormalAt(this.box, p),
      distance: d,
      velocity: this.velocity.clone(),
    };
  }

  resolveSphere(center, radius, outPush = new THREE.Vector3()) {
    const closest = this.box.clampPoint(center, _tmp);
    outPush.copy(center).sub(closest);
    let distSq = outPush.lengthSq();
    if (distSq > radius * radius) return false;
    if (distSq < EPSILON) {
      // Center is inside the box; push out through the nearest face.
      const dxMin = Math.abs(center.x - this.box.min.x);
      const dxMax = Math.abs(this.box.max.x - center.x);
      const dyMin = Math.abs(center.y - this.box.min.y);
      const dyMax = Math.abs(this.box.max.y - center.y);
      const dzMin = Math.abs(center.z - this.box.min.z);
      const dzMax = Math.abs(this.box.max.z - center.z);
      const m = Math.min(dxMin, dxMax, dyMin, dyMax, dzMin, dzMax);
      if (m === dxMin) outPush.set(-(radius + dxMin), 0, 0);
      else if (m === dxMax) outPush.set(radius + dxMax, 0, 0);
      else if (m === dyMin) outPush.set(0, -(radius + dyMin), 0);
      else if (m === dyMax) outPush.set(0, radius + dyMax, 0);
      else if (m === dzMin) outPush.set(0, 0, -(radius + dzMin));
      else outPush.set(0, 0, radius + dzMax);
      return true;
    }
    const dist = Math.sqrt(distSq);
    outPush.multiplyScalar((radius - dist) / dist);
    return true;
  }
}

export class MovingPlatformCollider extends BoxCollider {
  constructor({ center = new THREE.Vector3(), size = new THREE.Vector3(4, 0.4, 4), axis = new THREE.Vector3(1, 0, 0), amplitude = 4, speed = 1, phase = 0, name = 'moving-platform' } = {}) {
    super({ center, size, name });
    this.baseCenter = center.clone();
    this.axis = axis.clone().normalize();
    this.amplitude = amplitude;
    this.speed = speed;
    this.phase = phase;
    this._lastCenter = center.clone();
  }

  update(elapsed, dt) {
    this._lastCenter.copy(this.center);
    const offset = Math.sin(elapsed * this.speed + this.phase) * this.amplitude;
    this.center.copy(this.baseCenter).addScaledVector(this.axis, offset);
    this.velocity.copy(this.center).sub(this._lastCenter).multiplyScalar(dt > 0 ? 1 / dt : 0);
    this.updateBox();
  }
}

export class SphereGroundCollider {
  constructor({ center = new THREE.Vector3(), radius = 10, name = 'sphere-ground' } = {}) {
    this.type = 'sphere';
    this.name = name;
    this.center = center.clone();
    this.radius = radius;
    this.velocity = new THREE.Vector3();
  }

  update() {}

  raycast(origin, direction, maxDistance = Infinity) {
    const oc = _tmp.copy(origin).sub(this.center);
    const b = oc.dot(direction);
    const c = oc.lengthSq() - this.radius * this.radius;
    const disc = b * b - c;
    if (disc < 0) return null;
    const sqrt = Math.sqrt(disc);
    let t = -b - sqrt;
    if (t < 0) t = -b + sqrt;
    if (t < 0 || t > maxDistance) return null;
    const p = origin.clone().addScaledVector(direction, t);
    const n = p.clone().sub(this.center).normalize();
    return { collider: this, point: p, normal: n, distance: t, velocity: this.velocity.clone() };
  }
}

export class PhysicsWorld {
  constructor() {
    this.colliders = [];
    this.time = 0;
  }

  add(collider) {
    this.colliders.push(collider);
    return collider;
  }

  remove(collider) {
    const i = this.colliders.indexOf(collider);
    if (i >= 0) this.colliders.splice(i, 1);
  }

  update(dt, elapsed = this.time + dt) {
    this.time = elapsed;
    for (const c of this.colliders) c.update?.(elapsed, dt);
  }

  sampleGround(origin, down, maxDistance = 2.5) {
    let best = null;
    for (const c of this.colliders) {
      const hit = c.raycast?.(origin, down, maxDistance);
      if (!hit) continue;
      if (!best || hit.distance < best.distance) best = hit;
    }
    return best;
  }

  resolveCapsule(position, up, radius, height) {
    let any = false;
    const sphereCenters = [
      _tmp.copy(position).addScaledVector(up, radius).clone(),
      _tmp.copy(position).addScaledVector(up, height * 0.5).clone(),
      _tmp.copy(position).addScaledVector(up, Math.max(radius, height - radius)).clone(),
    ];
    for (const c of this.colliders) {
      if (!c.resolveSphere) continue;
      for (const center of sphereCenters) {
        const push = new THREE.Vector3();
        if (c.resolveSphere(center, radius, push)) {
          position.add(push);
          for (const s of sphereCenters) s.add(push);
          any = true;
        }
      }
    }
    return any;
  }
}

function boxNormalAt(box, p) {
  const dxMin = Math.abs(p.x - box.min.x);
  const dxMax = Math.abs(p.x - box.max.x);
  const dyMin = Math.abs(p.y - box.min.y);
  const dyMax = Math.abs(p.y - box.max.y);
  const dzMin = Math.abs(p.z - box.min.z);
  const dzMax = Math.abs(p.z - box.max.z);
  const m = Math.min(dxMin, dxMax, dyMin, dyMax, dzMin, dzMax);
  if (m === dxMin) return new THREE.Vector3(-1, 0, 0);
  if (m === dxMax) return new THREE.Vector3(1, 0, 0);
  if (m === dyMin) return new THREE.Vector3(0, -1, 0);
  if (m === dyMax) return new THREE.Vector3(0, 1, 0);
  if (m === dzMin) return new THREE.Vector3(0, 0, -1);
  return new THREE.Vector3(0, 0, 1);
}
