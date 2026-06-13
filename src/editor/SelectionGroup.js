// Multi-object selection + group transform for the World Builder.
//
// Selected objects always stay parented to the manager's world-objects root (no
// reparenting), so their position/rotation/scale remain world-correct for
// serialization at all times. Group transforms are applied with a delta matrix:
//   newWorld = (pivotCurrent * pivotStart^-1) * objectStart
// which translates/rotates/scales every object about a shared pivot while
// preserving relative offsets. Visual updates happen every drag tick; grass /
// tree / collider commits happen once on drag end (Stage 1 lag protection).

import * as THREE from "three";

const HELPER_COLOR = 0x7fdca0;

export class SelectionGroup {
  constructor({ scene, manager }) {
    this.scene = scene;
    this.manager = manager;
    this.objects = [];

    // Transform handle for multi-select. Not a placed object → never serialized
    // and never raycast for selection.
    this.pivot = new THREE.Object3D();
    this.pivot.name = "SelectionPivot";
    this.scene.add(this.pivot);

    this.helperGroup = new THREE.Group();
    this.helperGroup.name = "SelectionHelpers";
    this.scene.add(this.helperGroup);
    this._helpers = new Map();

    this._box = new THREE.Box3();
    this._pivotStartInv = new THREE.Matrix4();
    this._delta = new THREE.Matrix4();
    this._tmp = new THREE.Matrix4();
    this._starts = [];
    this._startBoxes = [];
  }

  setManager(manager) {
    this.manager = manager;
  }

  get count() {
    return this.objects.length;
  }

  get isMulti() {
    return this.objects.length > 1;
  }

  // Primary = most-recently added; drives single-object UI (collider, label).
  get primary() {
    return this.objects.length ? this.objects[this.objects.length - 1] : null;
  }

  has(object) {
    return this.objects.includes(object);
  }

  set(objects) {
    this.objects = (objects ?? []).filter(Boolean);
    this._refreshHelpers();
  }

  add(object) {
    if (object && !this.has(object)) this.objects.push(object);
    this._refreshHelpers();
  }

  remove(object) {
    this.objects = this.objects.filter((o) => o !== object);
    this._refreshHelpers();
  }

  toggle(object) {
    if (!object) return;
    if (this.has(object)) this.remove(object);
    else this.add(object);
  }

  clear() {
    this.objects = [];
    this._refreshHelpers();
  }

  // Pivot at the centroid of selected object origins, identity rotation/scale.
  recenterPivot() {
    if (!this.objects.length) return;
    const c = new THREE.Vector3();
    for (const o of this.objects) c.add(o.position);
    c.multiplyScalar(1 / this.objects.length);
    this.pivot.position.copy(c);
    this.pivot.quaternion.identity();
    this.pivot.scale.set(1, 1, 1);
    this.pivot.updateMatrix();
    this.pivot.updateMatrixWorld(true);
  }

  // --- group drag (delta-matrix) ---------------------------------------------

  beginDrag() {
    this.pivot.updateMatrix();
    this._pivotStartInv.copy(this.pivot.matrix).invert();
    this._starts = this.objects.map((o) => {
      o.updateMatrix();
      return { object: o, matrix: o.matrix.clone() };
    });
    this._startBoxes = this.objects.map((o) => this._worldBox(o));
  }

  applyDrag() {
    this.pivot.updateMatrix();
    this._delta.copy(this.pivot.matrix).multiply(this._pivotStartInv);
    for (const { object, matrix } of this._starts) {
      this._tmp.copy(this._delta).multiply(matrix);
      this._tmp.decompose(object.position, object.quaternion, object.scale);
      object.updateMatrixWorld(true);
    }
    this._refreshHelperBoxes();
  }

  // Returns before+after world boxes so the caller can rebuild grass/trees once.
  endDrag() {
    const boxes = [...this._startBoxes];
    for (const o of this.objects) boxes.push(this._worldBox(o));
    this._starts = [];
    this._startBoxes = [];
    this.recenterPivot();
    this._refreshHelperBoxes();
    return { boxes };
  }

  // --- selection highlight ----------------------------------------------------

  _refreshHelpers() {
    for (const helper of this._helpers.values()) {
      this.helperGroup.remove(helper);
      helper.geometry?.dispose();
      helper.material?.dispose();
    }
    this._helpers.clear();
    for (const o of this.objects) {
      const helper = new THREE.BoxHelper(o, HELPER_COLOR);
      helper.material.transparent = true;
      helper.material.opacity = 0.9;
      this._helpers.set(o, helper);
      this.helperGroup.add(helper);
    }
  }

  _refreshHelperBoxes() {
    for (const helper of this._helpers.values()) helper.update();
  }

  _worldBox(object) {
    return this._box.setFromObject(object).clone();
  }

  dispose() {
    this.clear();
    this.scene.remove(this.helperGroup);
    this.scene.remove(this.pivot);
  }
}
