// Mask edit tool (Procedural Authoring-1) — an EDITOR-ONLY in-scene preview for placing
// a circular influence area. While active, the next terrain click sets the mask center;
// the WorldEditor then records an undoable AddAuthoringItemCommand and the AuthoringRuntime
// draws the persisted ring. The preview here is a transient ring at the pending center,
// never serialized and never shown in play. Radius is adjusted afterward from the panel.

import * as THREE from "three";

const RING_COLOR = 0x9eeeff;

export class MaskEditTool {
  constructor({ scene = null } = {}) {
    this.scene = scene;
    this.active = false;
    this.radius = 12;
    this._ring = null;
    this._ringMat = new THREE.MeshBasicMaterial({ color: RING_COLOR, transparent: true, opacity: 0.6 });
  }

  get isActive() {
    return this.active;
  }

  activate(scene = this.scene, { radius = 12 } = {}) {
    this.scene = scene ?? this.scene;
    this.active = true;
    this.radius = radius;
  }

  /** Show the pending ring at a candidate center (called as the cursor lands on terrain). */
  preview(center) {
    if (!this.active || !this.scene) return;
    if (!Number.isFinite(center?.x) || !Number.isFinite(center?.y) || !Number.isFinite(center?.z)) return;
    this._disposeRing();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(Math.max(0.5, this.radius), 0.12, 8, 44), this._ringMat);
    ring.name = "MaskEditPreview";
    ring.rotation.x = Math.PI / 2;
    ring.position.set(center.x, center.y + 0.05, center.z);
    this.scene.add(ring);
    this._ring = ring;
  }

  /** Commit a center, returning a plain { x, y, z, radius } the editor turns into a mask. */
  commit(center) {
    if (!Number.isFinite(center?.x) || !Number.isFinite(center?.y) || !Number.isFinite(center?.z)) return null;
    return { x: center.x, y: center.y, z: center.z, radius: this.radius };
  }

  deactivate() {
    this.active = false;
    this._disposeRing();
  }

  _disposeRing() {
    if (!this._ring) return;
    this._ring.removeFromParent();
    this._ring.geometry?.dispose?.();
    this._ring = null;
  }

  dispose() {
    this._disposeRing();
    this._ringMat.dispose();
    this.scene = null;
  }
}
