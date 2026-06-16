// Streams grass patches around the camera. Patches are built lazily within a
// per-frame budget, disposed once far away (with hysteresis), and each visible
// patch is frustum-culled and assigned an LOD by distance. This is where all
// the patch-level visibility / distance management lives.

import * as THREE from "three";
import { createGrassConfig } from "./GrassConfig.js";
import { createBladeLODGeometries, disposeBladeLODGeometries } from "./GrassGeometry.js";
import { GrassMaterial } from "./GrassMaterial.js";
import { generatePatchInstances } from "./GrassPlacement.js";
import { GrassPatch } from "./GrassPatch.js";

export class GrassSystem {
  constructor(scene, lights, fog, config = {}) {
    this.scene = scene;
    this.cfg = config.density !== undefined ? config : createGrassConfig(config);

    this.bladeLODGeos = createBladeLODGeometries(this.cfg);
    this.grassMaterial = new GrassMaterial(this.cfg, lights, fog);

    this.patches = new Map(); // key "gx,gz" -> GrassPatch
    this._emptyCells = new Set(); // cells known to contain no blades
    this._buildQueue = []; // [{gx,gz}]
    this._queued = new Set();

    // Scratch for frustum culling.
    this._projScreen = new THREE.Matrix4();
    this._frustum = new THREE.Frustum();
    this._camPos = new THREE.Vector3();

    // Live stats consumed by the debug panel.
    this.stats = {
      visiblePatches: 0,
      activePatches: 0,
      visibleBlades: 0,
      lod: [0, 0, 0],
      builtThisFrame: 0,
      queueLength: 0,
    };
  }

  _key(gx, gz) {
    return gx + "," + gz;
  }

  // Ensure every patch within visibleDistance is built or queued, and dispose
  // patches past keepDistance. Then frustum-cull + assign LOD to active ones.
  update(camera, elapsed) {
    this.grassMaterial.update(elapsed);

    camera.getWorldPosition(this._camPos);
    const camX = this._camPos.x;
    const camZ = this._camPos.z;

    this._enqueueNearby(camX, camZ);
    this._disposeFar(camX, camZ);
    this._processBuildQueue();
    this._frustum.setFromProjectionMatrix(
      this._projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    );
    this._cullAndLOD(camX, camZ);
  }

  _enqueueNearby(camX, camZ) {
    const cfg = this.cfg;
    const size = cfg.patchSize;
    const cx = Math.floor(camX / size);
    const cz = Math.floor(camZ / size);
    const r = Math.ceil(cfg.visibleDistance / size) + 1;
    const halfDiag = size * 0.7072;
    const visSq = cfg.visibleDistance * cfg.visibleDistance;

    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const gx = cx + dx;
        const gz = cz + dz;
        const key = this._key(gx, gz);
        if (this.patches.has(key) || this._emptyCells.has(key) || this._queued.has(key)) {
          continue;
        }
        // Nearest-corner distance test so partially-in-range patches still load.
        const centerX = (gx + 0.5) * size;
        const centerZ = (gz + 0.5) * size;
        const ddx = centerX - camX;
        const ddz = centerZ - camZ;
        const dist = Math.hypot(ddx, ddz) - halfDiag;
        if (dist * dist > visSq && dist > 0) continue;

        this._buildQueue.push({ gx, gz, priority: dist });
        this._queued.add(key);
      }
    }

    // Build closest patches first for a pleasant fill-in order.
    if (this._buildQueue.length > 1) {
      this._buildQueue.sort((a, b) => a.priority - b.priority);
    }
  }

  _disposeFar(camX, camZ) {
    const keepSq = this.cfg.keepDistance * this.cfg.keepDistance;
    for (const [key, patch] of this.patches) {
      const ddx = patch.center.x - camX;
      const ddz = patch.center.z - camZ;
      if (ddx * ddx + ddz * ddz > keepSq) {
        this.scene.remove(patch.mesh);
        patch.dispose();
        this.patches.delete(key);
      }
    }
    // Forget far empty cells too so they can be reconsidered later.
    if (this._emptyCells.size > 4096) this._emptyCells.clear();
  }

  _processBuildQueue() {
    const budget = this.cfg.maxPatchBuildsPerFrame;
    let built = 0;
    while (this._buildQueue.length > 0 && built < budget) {
      const { gx, gz } = this._buildQueue.shift();
      this._queued.delete(this._key(gx, gz));
      this._buildPatch(gx, gz);
      built++;
    }
    this.stats.builtThisFrame = built;
    this.stats.queueLength = this._buildQueue.length;
  }

  _buildPatch(gx, gz) {
    const key = this._key(gx, gz);
    if (this.patches.has(key) || this._emptyCells.has(key)) return;

    const data = generatePatchInstances(gx, gz, this.cfg);
    if (data.count === 0) {
      this._emptyCells.add(key);
      return;
    }
    const patch = new GrassPatch(gx, gz, data, this.bladeLODGeos, this.grassMaterial.material, this.cfg);
    this.patches.set(key, patch);
    this.scene.add(patch.mesh);
  }

  _cullAndLOD(camX, camZ) {
    const cfg = this.cfg;
    const visSq = cfg.visibleDistance * cfg.visibleDistance;
    const [l0, l1] = cfg.lodDistances;

    let visiblePatches = 0;
    let visibleBlades = 0;
    const lod = [0, 0, 0];

    for (const patch of this.patches.values()) {
      const ddx = patch.center.x - camX;
      const ddz = patch.center.z - camZ;
      const distSq = ddx * ddx + ddz * ddz;

      // Distance cull first (cheap), then frustum cull (sphere test).
      if (distSq > visSq || !this._frustum.intersectsSphere(patch.boundingSphere)) {
        patch.setVisible(false);
        continue;
      }

      patch.setVisible(true);
      const dist = Math.sqrt(distSq);
      const level = dist < l0 ? 0 : dist < l1 ? 1 : 2;
      patch.setLOD(level);

      visiblePatches++;
      visibleBlades += patch.visibleBladeCount;
      lod[level]++;
    }

    this.stats.visiblePatches = visiblePatches;
    this.stats.activePatches = this.patches.size;
    this.stats.visibleBlades = visibleBlades;
    this.stats.lod = lod;
  }

  // Synchronously drain the build queue once (used before revealing the scene
  // so the player doesn't start in a bald patch). Bounded to avoid a hang.
  prewarm(camera, maxBuilds = 1200) {
    camera.getWorldPosition(this._camPos);
    this._enqueueNearby(this._camPos.x, this._camPos.z);
    let built = 0;
    while (this._buildQueue.length > 0 && built < maxBuilds) {
      const { gx, gz } = this._buildQueue.shift();
      this._queued.delete(this._key(gx, gz));
      this._buildPatch(gx, gz);
      built++;
    }
  }

  dispose() {
    for (const patch of this.patches.values()) {
      this.scene.remove(patch.mesh);
      patch.dispose();
    }
    this.patches.clear();
    disposeBladeLODGeometries(this.bladeLODGeos);
    this.grassMaterial.dispose();
  }
}
