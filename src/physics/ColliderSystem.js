import * as THREE from "three";
import { getHeight } from "../terrain/terrainSampling.js";
import { COLLIDER_TYPES, getCollider, getWorldBox, pointInFootprint } from "./ColliderProxy.js";
import { resolveCapsuleAABB, resolveCapsuleCylinder } from "./capsuleCollision.js";

const _box = new THREE.Box3();
const _inverse = new THREE.Matrix4();
const _local = new THREE.Vector3();
const _world = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();

export class ColliderSystem {
  constructor() {
    this.manager = null;
    this.debugVisible = false;
    this.debugGroup = new THREE.Group();
    this.debugGroup.name = "Collider Debug";
    this.debugGroup.visible = false;
  }

  attachScene(scene) {
    scene.add(this.debugGroup);
  }

  setManager(manager) {
    this.manager = manager;
    this.rebuildDebug();
  }

  toggleDebug() {
    this.debugVisible = !this.debugVisible;
    this.debugGroup.visible = this.debugVisible;
    if (this.debugVisible) this.rebuildDebug();
  }

  get objects() {
    return this.manager?.objects ? [...this.manager.objects.values()] : [];
  }

  getSupportHeight(x, z, playerY = Infinity) {
    let best = getHeight(x, z);
    for (const object of this.objects) {
      const collider = getCollider(object);
      if (![COLLIDER_TYPES.box, COLLIDER_TYPES.plane, COLLIDER_TYPES.ramp].includes(collider.type)) continue;
      const h = this._supportFromObject(object, collider, x, z);
      if (h == null) continue;
      if (h <= playerY + 0.65 && h > best) best = h;
    }
    return best;
  }

  resolveHorizontalCapsule(position, previous, radius, height) {
    const yMin = position.y + radius;
    const yMax = position.y + height - radius;
    for (const object of this.objects) {
      const collider = getCollider(object);
      if (![COLLIDER_TYPES.box, COLLIDER_TYPES.cylinder, COLLIDER_TYPES.ramp].includes(collider.type)) continue;

      const box = getWorldBox(object, _box);
      if (yMax < box.min.y + 0.08 || yMin > box.max.y - 0.08) continue;
      if (collider.type === COLLIDER_TYPES.ramp && this._pointInsideRampTop(object, position.x, position.z)) {
        if (!this._enteredRampFromSide(object, position, previous)) continue;
      }

      if (collider.type === COLLIDER_TYPES.cylinder) resolveCapsuleCylinder(position, previous, box, radius);
      else resolveCapsuleAABB(position, previous, box, radius);
    }
  }

  isGrassExcluded(x, z) {
    return this._isExcluded(x, z, "excludeGrass");
  }

  isTreeExcluded(x, z) {
    return this._isExcluded(x, z, "excludeTrees");
  }

  _isExcluded(x, z, flag) {
    for (const object of this.objects) {
      const collider = getCollider(object);
      if (!collider[flag] || collider.type === COLLIDER_TYPES.none || collider.type === COLLIDER_TYPES.trigger) continue;
      const box = getWorldBox(object, _box);
      if (pointInFootprint(box, x, z, 0.35)) return true;
    }
    return false;
  }

  rebuildDebug() {
    this.debugGroup.clear();
    const material = new THREE.LineBasicMaterial({ color: 0x7fdca0, transparent: true, opacity: 0.85 });
    for (const object of this.objects) {
      const collider = getCollider(object);
      if (collider.type === COLLIDER_TYPES.none) continue;
      const box = getWorldBox(object, new THREE.Box3());
      const helper = new THREE.Box3Helper(box, material.color);
      helper.name = `Collider_${object.name}`;
      this.debugGroup.add(helper);
    }
  }

  _supportFromObject(object, collider, x, z) {
    const box = getWorldBox(object, _box);
    if (!pointInFootprint(box, x, z, 0.05)) return null;
    if (collider.type === COLLIDER_TYPES.box) return box.max.y;
    if (collider.type === COLLIDER_TYPES.plane) return this._supportFromPlane(object, x, z);
    if (collider.type !== COLLIDER_TYPES.ramp) return null;

    _inverse.copy(object.matrixWorld).invert();
    _local.set(x, 0, z).applyMatrix4(_inverse);
    if (Math.abs(_local.x) > 1.05 || Math.abs(_local.z) > 1.05) return null;
    const t = THREE.MathUtils.clamp((_local.z + 1) * 0.5, 0, 1);
    _world.set(_local.x, t * 1.2, _local.z).applyMatrix4(object.matrixWorld);
    return _world.y;
  }

  _supportFromPlane(object, x, z) {
    object.updateMatrixWorld();
    object.matrixWorld.decompose(_origin, _quat, _scale);
    _normal.set(0, 1, 0).applyQuaternion(_quat).normalize();

    // A nearly vertical plane is a wall, not a walkable support surface.
    if (_normal.y < 0.18) return null;

    const y =
      _origin.y -
      (_normal.x * (x - _origin.x) + _normal.z * (z - _origin.z)) / _normal.y;

    _inverse.copy(object.matrixWorld).invert();
    _local.set(x, y, z).applyMatrix4(_inverse);

    // The primitive plane is 2.4 x 2.4 in local X/Z. Keep a tiny edge tolerance
    // so the capsule does not flicker off at exact borders.
    if (Math.abs(_local.x) > 1.23 || Math.abs(_local.z) > 1.23) return null;
    return y;
  }

  _pointInsideRampTop(object, x, z) {
    _inverse.copy(object.matrixWorld).invert();
    _local.set(x, 0, z).applyMatrix4(_inverse);
    return Math.abs(_local.x) <= 1.03 && Math.abs(_local.z) <= 1.03;
  }

  _enteredRampFromSide(object, position, previous) {
    _inverse.copy(object.matrixWorld).invert();
    const current = _local.set(position.x, 0, position.z).applyMatrix4(_inverse).clone();
    const before = _world.set(previous.x, 0, previous.z).applyMatrix4(_inverse);
    return Math.abs(before.x) > 1.02 && Math.abs(current.x) <= 1.02 && Math.abs(current.z) <= 1.08;
  }
}
