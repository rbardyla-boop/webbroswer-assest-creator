// Spline edit tool (Procedural Authoring-1) — an EDITOR-ONLY in-scene preview for
// authoring a 3..8 point path. While active, terrain clicks add control points (the
// WorldEditor routes the hit here); it draws a live Catmull-Rom line + a control-point
// marker per point. The preview is NEVER serialized and never appears in play — it is
// owned by the editor, separate from the AuthoringRuntime's derived (persisted) visuals.
// Committing the path hands the collected points to the editor, which records an
// undoable AddAuthoringItemCommand; the tool then clears.

import * as THREE from "three";
import { AUTHORING_LIMITS } from "../world/authoring/AuthoringTypes.js";

const LINE_COLOR = 0x7fdca0;
const POINT_COLOR = 0xffffff;

export class SplineEditTool {
  constructor({ scene = null } = {}) {
    this.scene = scene;
    this.active = false;
    this.points = []; // [{x,y,z}]
    this._group = null;
    this._lineMat = new THREE.LineBasicMaterial({ color: LINE_COLOR });
    this._pointGeo = new THREE.SphereGeometry(0.4, 10, 8);
    this._pointMat = new THREE.MeshBasicMaterial({ color: POINT_COLOR });
  }

  get isActive() {
    return this.active;
  }

  get pointCount() {
    return this.points.length;
  }

  activate(scene = this.scene) {
    this.scene = scene ?? this.scene;
    this.active = true;
    this.points = [];
    this._rebuildPreview();
  }

  /** Add a control point (capped at MAX_SPLINE_POINTS); returns the new count. */
  addPoint(p) {
    if (!this.active) return this.points.length;
    if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y) || !Number.isFinite(p?.z)) return this.points.length;
    if (this.points.length >= AUTHORING_LIMITS.MAX_SPLINE_POINTS) return this.points.length;
    this.points.push({ x: p.x, y: p.y, z: p.z });
    this._rebuildPreview();
    return this.points.length;
  }

  removeLastPoint() {
    if (!this.active || !this.points.length) return;
    this.points.pop();
    this._rebuildPreview();
  }

  /** The collected points (a copy), or null when there aren't enough for a path. */
  commitPoints() {
    if (this.points.length < AUTHORING_LIMITS.MIN_SPLINE_POINTS) return null;
    return this.points.map((p) => ({ ...p }));
  }

  deactivate() {
    this.active = false;
    this.points = [];
    this._disposeGroup();
  }

  _rebuildPreview() {
    this._disposeGroup();
    if (!this.scene || !this.points.length) return;
    const group = new THREE.Group();
    group.name = "SplineEditPreview";

    for (const p of this.points) {
      const dot = new THREE.Mesh(this._pointGeo, this._pointMat);
      dot.position.set(p.x, p.y + 0.4, p.z);
      group.add(dot);
    }

    if (this.points.length >= 2) {
      const curve = new THREE.CatmullRomCurve3(this.points.map((p) => new THREE.Vector3(p.x, p.y + 0.2, p.z)), false, "catmullrom", 0.5);
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(Math.max(16, this.points.length * 12)));
      group.add(new THREE.Line(geo, this._lineMat));
    }

    this.scene.add(group);
    this._group = group;
  }

  _disposeGroup() {
    if (!this._group) return;
    this._group.removeFromParent();
    this._group.traverse((node) => {
      // The shared point geometry/material + line material are reused across rebuilds;
      // only the per-rebuild Line geometry is owned here and must be freed.
      if (node.isLine) node.geometry?.dispose?.();
    });
    this._group = null;
  }

  dispose() {
    this._disposeGroup();
    this._pointGeo.dispose();
    this._pointMat.dispose();
    this._lineMat.dispose();
    this.scene = null;
  }
}
