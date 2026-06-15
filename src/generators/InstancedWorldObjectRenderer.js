// Render-optimization layer (Stage 17C-2). Repeated static primitive WorldObjects
// (e.g. a procedural city's buildings/streets/trees) are expensive as one draw call
// each. This service batches eligible objects by render class into ONE InstancedMesh
// per class (per-instance matrix + color), and hides the source meshes — so the
// instance renders + casts/receives shadows in their place.
//
// CRITICAL: this is a render VIEW over WorldObjects, NOT a replacement. The Group
// objects stay in the manager (selectable, serializable, collidable, lockable,
// regenerable) — only their child MESH is hidden, and only where instancing is
// applied (runtime). The editor never instances, so editor identity is untouched.
// Animated / interactive / particle objects are never instanced (they need their
// live individual mesh).

import * as THREE from "three";
import { createPrimitiveGeometry } from "../world/PlacedObject.js";

const DEFAULT_MIN_INSTANCES = 4; // below this, a class stays individual (no batch)

export class InstancedWorldObjectRenderer {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = "InstancedWorldObjects";
    this.scene.add(this.group);
    this.batches = []; // { mesh }
    this.hidden = []; // source meshes we hid (to restore on clear)
    this.stats = emptyStats();
  }

  /**
   * Rebuild instanced batches from the current placed objects. Idempotent: clears
   * the previous batches + restores hidden sources first.
   * @param {Map|Iterable} objects  placed object Groups
   */
  rebuild(objects, { minInstances = DEFAULT_MIN_INSTANCES } = {}) {
    this.clear();
    const list = objects instanceof Map ? [...objects.values()] : Array.from(objects ?? []);
    this.scene.updateMatrixWorld(true); // ensure source world matrices are current

    // Group eligible objects by render class (kind + shadow flags). Color is
    // per-instance, so all tints of a kind share one batch.
    const classes = new Map();
    let eligible = 0;
    for (const object of list) {
      const entry = this._eligible(object);
      if (!entry) continue;
      eligible++;
      const key = `${entry.kind}:${entry.mesh.castShadow ? 1 : 0}:${entry.mesh.receiveShadow ? 1 : 0}`;
      let cls = classes.get(key);
      if (!cls) {
        cls = { kind: entry.kind, castShadow: entry.mesh.castShadow, receiveShadow: entry.mesh.receiveShadow, items: [] };
        classes.set(key, cls);
      }
      cls.items.push(entry);
    }

    const color = new THREE.Color();
    let totalInstances = 0;
    for (const cls of classes.values()) {
      if (cls.items.length < minInstances) continue; // small class → leave individual
      const geometry = createPrimitiveGeometry(cls.kind);
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff, // white base — the per-instance color is the effective tint
        roughness: 0.82,
        metalness: 0.02,
        side: cls.kind === "plane" ? THREE.DoubleSide : THREE.FrontSide,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, cls.items.length);
      mesh.name = `Instanced_${cls.kind}`;
      mesh.castShadow = cls.castShadow;
      mesh.receiveShadow = cls.receiveShadow;

      let i = 0;
      for (const entry of cls.items) {
        mesh.setMatrixAt(i, entry.mesh.matrixWorld);
        color.copy(entry.mesh.material.color);
        mesh.setColorAt(i, color);
        entry.mesh.visible = false; // hide the source; the instance renders it now
        this.hidden.push(entry.mesh);
        i++;
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // One batch per class collapses per-object frustum culling to batch-level:
      // the city-wide bounding sphere means the whole batch draws whenever any of
      // it is on screen. That is the accepted instancing tradeoff (one draw of N
      // beats N culled draws here); per-region batch partitioning is a later refinement.
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      this.batches.push({ mesh, kind: cls.kind });
      totalInstances += cls.items.length;
    }

    this.stats = {
      batches: this.batches.length,
      instances: totalInstances,
      hiddenSources: this.hidden.length,
      eligible,
      drawCalls: this.batches.length,
    };
    return this.stats;
  }

  // An object is instanceable iff it is a plain static primitive with a single mesh
  // and no animation / interaction / particles (those need their live mesh).
  _eligible(object) {
    if (!object || object.userData?.asset?.type !== "primitive") return null;
    if (object.userData.animationClips?.length) return null;
    if (object.userData.interaction) return null;
    if (object.userData.particles) return null;
    const kind = object.userData.asset?.kind;
    if (!kind) return null;
    let mesh = null;
    let meshCount = 0;
    object.traverse((c) => {
      if (c.isMesh) {
        mesh = c;
        meshCount++;
      }
    });
    if (meshCount !== 1 || !mesh || !mesh.material?.color) return null;
    return { object, mesh, kind };
  }

  clear() {
    for (const src of this.hidden) src.visible = true;
    this.hidden.length = 0;
    for (const { mesh } of this.batches) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose?.();
    }
    this.batches.length = 0;
    this.stats = emptyStats();
  }

  dispose() {
    this.clear();
    this.scene.remove(this.group);
  }
}

function emptyStats() {
  return { batches: 0, instances: 0, hiddenSources: 0, eligible: 0, drawCalls: 0 };
}
