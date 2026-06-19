// Authoring runtime (Procedural Authoring-1) — turns the persisted `authoring` block
// (splines/masks/modifiers) into derived scene visuals. It is the runtimeAssets idiom
// applied to authoring: the block is the source of truth and the visuals are REBUILT
// from it each load, never baked into `objects`. One THREE.Group per enabled modifier;
// markers are a single InstancedMesh (flat draw calls) and the mask edge is one Torus.
// Runs in BOTH editor preview and play (it is owned by WorldRuntimeLoader). Idempotent
// load/clear/dispose, mirroring ObjectiveRuntime. The spline/mask EDIT gizmos are
// editor-only and live in the editor tools — they are NOT built here.

import * as THREE from "three";
import { getHeight } from "../../terrain/terrainSampling.js";
import { deriveBeaconTrail } from "./BeaconTrailModifier.js";

const TRAIL_COLOR = 0xffb347; // warm amber so the derived trail reads as guidance

export class AuthoringRuntime {
  constructor(scene = null) {
    this.scene = scene;
    this._document = null;
    this._groups = new Map(); // modifierId → THREE.Group
    this._markerGeo = null; // shared octahedron gem geometry (disposed on teardown)
    this._markerMat = null;
    this._ringMat = null;
  }

  /** Build every enabled modifier's derived group from the document (idempotent). */
  load(document, scene = this.scene) {
    this.scene = scene ?? this.scene;
    this._document = document ?? null;
    this.clear();
    if (!this.scene || !this._document) return;
    this._ensureShared();
    for (const modifier of this._enabledModifiers()) this._buildModifier(modifier);
  }

  /**
   * Rebuild derived visuals from the live document. With an id, rebuild just that
   * modifier; without, rebuild all (an edit to a shared spline/mask can touch several).
   */
  rebuild(modifierId = null) {
    if (!this.scene || !this._document) return;
    this._ensureShared();
    if (modifierId == null) {
      this.clear();
      for (const modifier of this._enabledModifiers()) this._buildModifier(modifier);
      return;
    }
    this._disposeGroup(modifierId);
    const modifier = this._enabledModifiers().find((m) => m.id === modifierId);
    if (modifier) this._buildModifier(modifier);
  }

  _enabledModifiers() {
    const a = this._document?.authoring;
    if (!a || !Array.isArray(a.modifiers)) return [];
    return a.modifiers.filter((m) => m && m.enabled !== false);
  }

  _resolve(modifier) {
    const a = this._document?.authoring ?? {};
    const splines = Array.isArray(a.splines) ? a.splines : [];
    const masks = Array.isArray(a.masks) ? a.masks : [];
    const spline = splines.find((s) => s.id === modifier.splineId && s.enabled !== false) ?? null;
    const mask = modifier.maskId ? masks.find((m) => m.id === modifier.maskId && m.enabled !== false) ?? null : null;
    return { spline, mask };
  }

  _buildModifier(modifier) {
    const { spline, mask } = this._resolve(modifier);
    if (!spline) return; // dangling reference (spline deleted/disabled) → skip, don't crash
    const layout = deriveBeaconTrail(modifier, spline, mask, { getHeight });
    if (!layout) return;

    const group = new THREE.Group();
    group.name = `AuthoringTrail:${modifier.id}`;

    if (layout.markers.length) {
      const mesh = new THREE.InstancedMesh(this._markerGeo, this._markerMat, layout.markers.length);
      mesh.name = `AuthoringMarkers:${modifier.id}`;
      mesh.castShadow = false;
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const pos = new THREE.Vector3();
      const scl = new THREE.Vector3();
      let written = 0;
      for (const marker of layout.markers) {
        if (!Number.isFinite(marker.x) || !Number.isFinite(marker.y) || !Number.isFinite(marker.z) || !(marker.scale > 0)) continue;
        pos.set(marker.x, marker.y + 0.3 * marker.scale, marker.z); // float the gem above the ground
        scl.set(marker.scale, marker.scale, marker.scale);
        m.compose(pos, q, scl);
        mesh.setMatrixAt(written++, m);
      }
      mesh.count = written;
      mesh.instanceMatrix.needsUpdate = true;
      if (written > 0) group.add(mesh);
      else mesh.dispose();
    }

    if (layout.ring) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(Math.max(0.5, layout.ring.radius), 0.08, 8, 40), this._ringMat);
      ring.name = `AuthoringRing:${modifier.id}`;
      ring.rotation.x = Math.PI / 2;
      ring.position.set(layout.ring.x, layout.ring.y + 0.04, layout.ring.z);
      group.add(ring);
    }

    if (group.children.length) {
      this.scene.add(group);
      this._groups.set(modifier.id, group);
    }
  }

  _ensureShared() {
    if (!this._markerGeo) this._markerGeo = new THREE.OctahedronGeometry(0.22);
    if (!this._markerMat) {
      this._markerMat = new THREE.MeshStandardMaterial({ color: TRAIL_COLOR, emissive: TRAIL_COLOR, emissiveIntensity: 0.85, roughness: 0.4, metalness: 0.1 });
    }
    if (!this._ringMat) {
      this._ringMat = new THREE.MeshStandardMaterial({ color: TRAIL_COLOR, emissive: TRAIL_COLOR, emissiveIntensity: 0.7, roughness: 0.5, metalness: 0.1 });
    }
  }

  /** Counts for the DEV snapshot hook. */
  stats() {
    let markers = 0;
    for (const group of this._groups.values()) {
      const mesh = group.children.find((c) => c.isInstancedMesh);
      if (mesh) markers += mesh.count;
    }
    return { groups: this._groups.size, markers };
  }

  _disposeGroup(modifierId) {
    const group = this._groups.get(modifierId);
    if (!group) return;
    group.removeFromParent();
    // Free only the per-group GPU resources. In three.js r0.169 InstancedMesh.dispose()
    // frees ONLY the per-instance buffer (instanceMatrix) — it does NOT touch the shared
    // geometry/material — so calling it here is safe. The ring's own TorusGeometry is
    // per-group and freed via geometry.dispose(). The SHARED marker geometry + both
    // materials are reused across rebuilds and disposed exactly once in dispose().
    group.traverse((node) => {
      if (node.isInstancedMesh) node.dispose?.();
      else if (node.geometry) node.geometry.dispose?.();
    });
    this._groups.delete(modifierId);
  }

  /** Remove + dispose every derived group (idempotent). Keeps shared geo/materials. */
  clear() {
    for (const id of [...this._groups.keys()]) this._disposeGroup(id);
    this._groups.clear();
  }

  dispose() {
    this.clear();
    this._markerGeo?.dispose?.();
    this._markerMat?.dispose?.();
    this._ringMat?.dispose?.();
    this._markerGeo = null;
    this._markerMat = null;
    this._ringMat = null;
    this.scene = null;
    this._document = null;
  }
}
