import * as THREE from "three";

// One streamed bush chunk: three LOD InstancedMeshes (one geometry each — a
// single instanced draw per visible patch). Only one LOD is visible at a time.
export class BushPatch {
  constructor(gx, gz, data, lodGeometries, material, cfg) {
    this.gx = gx;
    this.gz = gz;
    this.cfg = cfg;
    this.count = data.count;
    this.center = data.center;
    this.lod = 0;
    this.visible = true;

    this.lodCounts = cfg.lodInstanceFactors.map((f) => Math.max(1, Math.floor(this.count * f)));
    this.meshes = lodGeometries.map((geos, level) => this._buildLODMesh(geos, material, data, this.lodCounts[level], level));
    this.group = new THREE.Group();
    this.group.name = `BushPatch_${gx}_${gz}`;
    for (const mesh of this.meshes) this.group.add(mesh);
    this.setLOD(0);

    this.boundingSphere = this._computeBoundingSphere(data);
  }

  _buildLODMesh(geos, material, data, instanceCount, level) {
    const mesh = new THREE.InstancedMesh(geos.bush, material.bush, instanceCount);
    mesh.name = `BushLOD_${level}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.visible = false; // setLOD turns on exactly one (no first-frame 3× spike)
    for (let i = 0; i < instanceCount; i++) {
      mesh.setMatrixAt(i, data.matrices[i]);
      mesh.setColorAt(i, data.colors[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
  }

  _computeBoundingSphere(data) {
    const minY = Number.isFinite(data.bounds?.minY) ? data.bounds.minY : 0;
    const maxY = Number.isFinite(data.bounds?.maxY) ? data.bounds.maxY : this.cfg.bushSize.height;
    const size = this.cfg.patchSize;
    const cy = (minY + maxY) * 0.5;
    const radius = Math.hypot(size * 0.74, (maxY - minY) * 0.5 + this.cfg.bushSize.radius);
    return new THREE.Sphere(new THREE.Vector3(this.center.x, cy, this.center.z), radius);
  }

  setLOD(level) {
    if (level === this.lod && this.meshes[level].visible) return;
    this.lod = level;
    for (let i = 0; i < this.meshes.length; i++) this.meshes[i].visible = i === level;
  }

  setVisible(visible) {
    this.visible = visible;
    this.group.visible = visible;
  }

  get visibleBushCount() {
    return this.visible ? this.lodCounts[this.lod] : 0;
  }

  dispose() {
    // InstancedMesh.dispose() frees the per-instance GPU buffers (instanceMatrix/
    // instanceColor) via the renderer; the geometry + material are SHARED and are
    // disposed once by BushSystem.dispose, so they must not be touched here.
    for (const mesh of this.meshes) mesh.dispose?.();
    this.meshes.length = 0;
  }
}
