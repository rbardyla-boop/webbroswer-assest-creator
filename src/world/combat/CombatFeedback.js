// Transient impact visuals for combat strikes (Combat-0). On each hit, spawns a small emissive
// octahedron at the world hit point that fades + grows over LIFETIME, then is removed and disposed.
// It owns its meshes; clear() removes + disposes ALL of them and is idempotent, so a world reload
// never leaks an impact mark. Lightweight: one shared geometry, additive-style basic material, a
// hard mark cap, and only compositor-friendly animation (scale + opacity).

import * as THREE from "three";

const LIFETIME = 0.35; // seconds an impact mark lives
const MAX_MARKS = 24; // hard ceiling so rapid use can't grow the pool unbounded
const MARK_COLOR = 0xffe08a;

export class CombatFeedback {
  constructor(scene) {
    this.scene = scene;
    this._marks = []; // { mesh, age }
    this._geo = new THREE.OctahedronGeometry(0.18); // shared by every mark; disposed only in dispose()
  }

  /** Spawn an impact mark at a finite [x,y,z] world point. No-op on a non-finite point. */
  spawn(point) {
    if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || !Number.isFinite(point[2])) return;
    if (!this.scene) return;
    if (this._marks.length >= MAX_MARKS) this._retire(0); // evict the oldest
    const material = new THREE.MeshBasicMaterial({
      color: MARK_COLOR,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this._geo, material);
    mesh.name = "CombatImpact";
    mesh.position.set(point[0], point[1], point[2]);
    this.scene.add(mesh);
    this._marks.push({ mesh, age: 0 });
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt < 0) return; // a non-finite step must never write NaN to a mesh
    for (let i = this._marks.length - 1; i >= 0; i--) {
      const m = this._marks[i];
      m.age += dt;
      const k = m.age / LIFETIME; // 0 → 1
      if (k >= 1) {
        this._retire(i);
        continue;
      }
      m.mesh.material.opacity = 1 - k;
      m.mesh.scale.setScalar(1 + k * 1.5);
    }
  }

  get activeMarks() {
    return this._marks.length;
  }

  _retire(i) {
    const m = this._marks[i];
    if (!m) return;
    m.mesh.removeFromParent();
    m.mesh.material.dispose();
    this._marks.splice(i, 1);
  }

  /** Remove + dispose every live mark (idempotent). Called on reload and teardown. */
  clear() {
    for (const m of this._marks) {
      m.mesh.removeFromParent();
      m.mesh.material.dispose();
    }
    this._marks = [];
  }

  dispose() {
    this.clear();
    this._geo.dispose();
    this.scene = null;
  }
}
