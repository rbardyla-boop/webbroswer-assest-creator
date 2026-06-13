import * as THREE from "three";
import { createTreeConfig } from "./TreeConfig.js";
import { createTreeLODGeometries, disposeTreeLODGeometries } from "./TreeGeometry.js";
import { TreeMaterial } from "./TreeMaterial.js";
import { generateTreePatchData } from "./TreePlacement.js";
import { TreePatch } from "./TreePatch.js";

export class TreeSystem {
  constructor(scene, config = {}, exclusionSystem = null) {
    this.scene = scene;
    this.cfg = config.enabled !== undefined ? config : createTreeConfig(config);
    this.exclusionSystem = exclusionSystem;

    this.lodGeometries = createTreeLODGeometries(this.cfg);
    this.materials = new TreeMaterial(this.cfg);
    this.patches = new Map();
    this._emptyCells = new Set();
    this._buildQueue = [];
    this._queued = new Set();
    this._rebuildQueue = [];
    this._queuedRebuilds = new Set();

    this._projScreen = new THREE.Matrix4();
    this._frustum = new THREE.Frustum();
    this._camPos = new THREE.Vector3();

    this.stats = {
      enabled: this.cfg.enabled,
      visiblePatches: 0,
      activePatches: 0,
      visibleTrees: 0,
      lod: [0, 0, 0],
      builtThisFrame: 0,
      rebuiltThisFrame: 0,
      queueLength: 0,
      rebuildQueueLength: 0,
      drawCalls: 0,
      disposedThisFrame: 0,
      lastRebuildMs: 0,
    };
  }

  _key(gx, gz) {
    return gx + "," + gz;
  }

  update(camera) {
    this.stats.enabled = this.cfg.enabled;
    this.stats.builtThisFrame = 0;
    this.stats.rebuiltThisFrame = 0;
    this.stats.disposedThisFrame = 0;
    if (!this.cfg.enabled) {
      for (const patch of this.patches.values()) patch.setVisible(false);
      this._updateInactiveStats();
      return;
    }

    camera.getWorldPosition(this._camPos);
    const camX = this._camPos.x;
    const camZ = this._camPos.z;

    this._enqueueNearby(camX, camZ);
    this._disposeFar(camX, camZ);
    this._processRebuildQueue();
    this._processBuildQueue();
    this._frustum.setFromProjectionMatrix(
      this._projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    );
    this._cullAndLOD(camX, camZ);
  }

  setEnabled(enabled) {
    this.cfg.enabled = enabled;
    if (!enabled) for (const patch of this.patches.values()) patch.setVisible(false);
  }

  updateSettings(settings) {
    const rebuild =
      settings.density !== undefined && settings.density !== this.cfg.density ||
      settings.visibleDistance !== undefined && settings.visibleDistance !== this.cfg.visibleDistance ||
      settings.keepDistance !== undefined && settings.keepDistance !== this.cfg.keepDistance ||
      settings.seed !== undefined && settings.seed !== this.cfg.seed ||
      settings.respectExclusions !== undefined && settings.respectExclusions !== this.cfg.respectExclusions;

    Object.assign(this.cfg, settings);
    if (rebuild) this._resetPatches();
    else this.setEnabled(this.cfg.enabled);
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
        if (this.patches.has(key) || this._emptyCells.has(key) || this._queued.has(key)) continue;

        const centerX = (gx + 0.5) * size;
        const centerZ = (gz + 0.5) * size;
        const dist = Math.hypot(centerX - camX, centerZ - camZ) - halfDiag;
        if (dist * dist > visSq && dist > 0) continue;

        this._buildQueue.push({ gx, gz, priority: dist });
        this._queued.add(key);
      }
    }
    if (this._buildQueue.length > 1) this._buildQueue.sort((a, b) => a.priority - b.priority);
  }

  _disposeFar(camX, camZ) {
    const keepSq = this.cfg.keepDistance * this.cfg.keepDistance;
    for (const [key, patch] of this.patches) {
      const dx = patch.center.x - camX;
      const dz = patch.center.z - camZ;
      if (dx * dx + dz * dz > keepSq) {
        this.scene.remove(patch.group);
        patch.dispose();
        this.patches.delete(key);
        this.stats.disposedThisFrame++;
      }
    }
    if (this._emptyCells.size > 2048) this._emptyCells.clear();
  }

  _processBuildQueue() {
    let built = 0;
    while (this._buildQueue.length > 0 && built < this.cfg.maxPatchBuildsPerFrame) {
      const { gx, gz } = this._buildQueue.shift();
      this._queued.delete(this._key(gx, gz));
      this._buildPatch(gx, gz);
      built++;
    }
    this.stats.builtThisFrame = built;
    this.stats.queueLength = this._buildQueue.length;
  }

  _processRebuildQueue() {
    let rebuilt = 0;
    while (this._rebuildQueue.length > 0 && rebuilt < this.cfg.maxPatchRebuildsPerFrame) {
      const { gx, gz } = this._rebuildQueue.shift();
      this._queuedRebuilds.delete(this._key(gx, gz));
      const t0 = performance.now();
      this._rebuildPatch(gx, gz);
      this.stats.lastRebuildMs = performance.now() - t0;
      rebuilt++;
    }
    this.stats.rebuiltThisFrame = rebuilt;
    this.stats.rebuildQueueLength = this._rebuildQueue.length;
  }

  _buildPatch(gx, gz) {
    const key = this._key(gx, gz);
    if (this.patches.has(key) || this._emptyCells.has(key)) return;

    const data = generateTreePatchData(gx, gz, this.cfg, this.exclusionSystem);
    if (data.count === 0) {
      this._emptyCells.add(key);
      return;
    }

    const patch = new TreePatch(gx, gz, data, this.lodGeometries, this.materials, this.cfg);
    this.patches.set(key, patch);
    this.scene.add(patch.group);
  }

  _cullAndLOD(camX, camZ) {
    const [l0, l1] = this.cfg.lodDistances;
    const visSq = this.cfg.visibleDistance * this.cfg.visibleDistance;
    const lod = [0, 0, 0];
    let visiblePatches = 0;
    let visibleTrees = 0;

    for (const patch of this.patches.values()) {
      const dx = patch.center.x - camX;
      const dz = patch.center.z - camZ;
      const distSq = dx * dx + dz * dz;
      if (distSq > visSq || !this._frustum.intersectsSphere(patch.boundingSphere)) {
        patch.setVisible(false);
        continue;
      }

      patch.setVisible(true);
      const dist = Math.sqrt(distSq);
      const level = dist < l0 ? 0 : dist < l1 ? 1 : 2;
      patch.setLOD(level);
      visiblePatches++;
      visibleTrees += patch.visibleTreeCount;
      lod[level]++;
    }

    this.stats.visiblePatches = visiblePatches;
    this.stats.activePatches = this.patches.size;
    this.stats.visibleTrees = visibleTrees;
    this.stats.lod = lod;
    this.stats.drawCalls = visiblePatches * 2;
  }

  _updateInactiveStats() {
    this.stats.visiblePatches = 0;
    this.stats.activePatches = this.patches.size;
    this.stats.visibleTrees = 0;
    this.stats.lod = [0, 0, 0];
    this.stats.drawCalls = 0;
    this.stats.queueLength = this._buildQueue.length;
    this.stats.rebuildQueueLength = this._rebuildQueue.length;
  }

  rebuildActivePatches() {
    for (const patch of this.patches.values()) this.queuePatchRebuild(patch.gx, patch.gz);
  }

  _resetPatches() {
    for (const patch of this.patches.values()) {
      this.scene.remove(patch.group);
      patch.dispose();
      this.stats.disposedThisFrame++;
    }
    this.patches.clear();
    this._emptyCells.clear();
    this._buildQueue.length = 0;
    this._queued.clear();
    this._rebuildQueue.length = 0;
    this._queuedRebuilds.clear();
  }

  queueRebuildForBox(box, padding = 3) {
    if (!box || box.isEmpty()) return;
    const size = this.cfg.patchSize;
    const minX = Math.floor((box.min.x - padding) / size);
    const maxX = Math.floor((box.max.x + padding) / size);
    const minZ = Math.floor((box.min.z - padding) / size);
    const maxZ = Math.floor((box.max.z + padding) / size);
    for (let gz = minZ; gz <= maxZ; gz++) {
      for (let gx = minX; gx <= maxX; gx++) this.queuePatchRebuild(gx, gz);
    }
  }

  queuePatchRebuild(gx, gz) {
    const key = this._key(gx, gz);
    if (this._queuedRebuilds.has(key)) return;
    if (!this.patches.has(key) && !this._emptyCells.has(key)) return;
    this._queuedRebuilds.add(key);
    this._rebuildQueue.push({ gx, gz });
  }

  _rebuildPatch(gx, gz) {
    const key = this._key(gx, gz);
    const patch = this.patches.get(key);
    if (patch) {
      this.scene.remove(patch.group);
      patch.dispose();
      this.patches.delete(key);
    }
    this._emptyCells.delete(key);
    this._buildPatch(gx, gz);
  }

  dispose() {
    for (const patch of this.patches.values()) {
      this.scene.remove(patch.group);
      patch.dispose();
    }
    this.patches.clear();
    disposeTreeLODGeometries(this.lodGeometries);
    this.materials.dispose();
  }
}
