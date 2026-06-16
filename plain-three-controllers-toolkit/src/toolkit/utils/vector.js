import * as THREE from 'three';

export const EPSILON = 1e-6;
export const WORLD_UP = new THREE.Vector3(0, 1, 0);
export const WORLD_FORWARD = new THREE.Vector3(0, 0, -1);
export const WORLD_RIGHT = new THREE.Vector3(1, 0, 0);

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function dampVector(out, current, target, lambda, dt) {
  const t = 1 - Math.exp(-lambda * dt);
  out.copy(current).lerp(target, t);
  return out;
}

export function safeNormalize(v, fallback = WORLD_UP) {
  const len = v.length();
  if (len < EPSILON) return v.copy(fallback);
  return v.multiplyScalar(1 / len);
}

export function projectOnPlane(out, v, normal) {
  return out.copy(v).addScaledVector(normal, -v.dot(normal));
}

export function removeComponent(out, v, axis) {
  return out.copy(v).addScaledVector(axis, -v.dot(axis));
}

export function signedAngleOnPlane(a, b, normal) {
  const pa = _tmpA.copy(a).addScaledVector(normal, -a.dot(normal)).normalize();
  const pb = _tmpB.copy(b).addScaledVector(normal, -b.dot(normal)).normalize();
  const cross = _tmpC.crossVectors(pa, pb);
  return Math.atan2(cross.dot(normal), pa.dot(pb));
}

export function makeBasisFromUp(up, forwardHint = WORLD_FORWARD, target = {}) {
  const basis = target;
  basis.up = basis.up || new THREE.Vector3();
  basis.forward = basis.forward || new THREE.Vector3();
  basis.right = basis.right || new THREE.Vector3();
  basis.up.copy(up).normalize();
  basis.forward.copy(forwardHint).addScaledVector(basis.up, -forwardHint.dot(basis.up));
  if (basis.forward.lengthSq() < EPSILON) {
    basis.forward.copy(Math.abs(basis.up.y) < 0.9 ? WORLD_UP : WORLD_RIGHT);
    basis.forward.addScaledVector(basis.up, -basis.forward.dot(basis.up));
  }
  basis.forward.normalize();
  basis.right.crossVectors(basis.forward, basis.up).normalize();
  basis.forward.crossVectors(basis.up, basis.right).normalize();
  return basis;
}

export function alignObjectToUp(object, up, forwardHint = WORLD_FORWARD) {
  const b = makeBasisFromUp(up, forwardHint, _basisScratch);
  _mat.makeBasis(b.right, b.up, _tmpA.copy(b.forward).multiplyScalar(-1));
  object.quaternion.setFromRotationMatrix(_mat);
  return object;
}

export function quaternionFromUpForward(out, up, forwardHint = WORLD_FORWARD) {
  const b = makeBasisFromUp(up, forwardHint, _basisScratch);
  _mat.makeBasis(b.right, b.up, _tmpA.copy(b.forward).multiplyScalar(-1));
  return out.setFromRotationMatrix(_mat);
}

export function angleDelta(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function dampAngle(current, target, lambda, dt) {
  return current + angleDelta(current, target) * (1 - Math.exp(-lambda * dt));
}

const _tmpA = new THREE.Vector3();
const _tmpB = new THREE.Vector3();
const _tmpC = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const _basisScratch = {};
