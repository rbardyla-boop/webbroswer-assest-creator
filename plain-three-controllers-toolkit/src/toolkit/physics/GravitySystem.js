import * as THREE from 'three';

export class DirectionalGravityField {
  constructor(direction = new THREE.Vector3(0, -1, 0), strength = 24, { priority = 0, bounds = null } = {}) {
    this.direction = direction.clone().normalize();
    this.strength = strength;
    this.priority = priority;
    this.bounds = bounds;
  }

  contains(position) {
    return !this.bounds || this.bounds.containsPoint(position);
  }

  sample(position) {
    if (!this.contains(position)) return null;
    return this.direction.clone().multiplyScalar(this.strength);
  }
}

export class PointGravityField {
  constructor(center = new THREE.Vector3(), strength = 34, { radius = Infinity, minDistance = 2, priority = 1 } = {}) {
    this.center = center.clone();
    this.strength = strength;
    this.radius = radius;
    this.minDistance = minDistance;
    this.priority = priority;
  }

  contains(position) {
    return position.distanceTo(this.center) <= this.radius;
  }

  sample(position) {
    if (!this.contains(position)) return null;
    const toCenter = this.center.clone().sub(position);
    const d = Math.max(this.minDistance, toCenter.length());
    return toCenter.normalize().multiplyScalar(this.strength * Math.min(1, this.radius / d));
  }
}

export class GravitySystem {
  constructor(defaultGravity = new THREE.Vector3(0, -24, 0)) {
    this.defaultGravity = defaultGravity.clone();
    this.fields = [];
    this.enabled = true;
  }

  setDefaultGravity(v) {
    this.defaultGravity.copy(v);
    return this;
  }

  clearFields() {
    this.fields.length = 0;
    return this;
  }

  addField(field) {
    this.fields.push(field);
    this.fields.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return field;
  }

  sample(position, object = null) {
    if (!this.enabled) return new THREE.Vector3(0, 0, 0);
    for (const field of this.fields) {
      const g = field.sample(position, object);
      if (g) return g;
    }
    return this.defaultGravity.clone();
  }
}
