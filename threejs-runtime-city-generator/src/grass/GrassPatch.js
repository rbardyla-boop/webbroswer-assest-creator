// One grass chunk. Owns the per-instance attribute buffers and a set of LOD
// geometries that all share those buffers. Visibility and LOD are driven by
// GrassSystem at patch granularity; the patch just swaps its mesh geometry.
//
// Base blade attributes (position/uv/index) are tiny (a handful of verts) and
// are cloned per patch so disposing one patch never frees another's buffers.
// The big per-instance buffers are unique to this patch and shared only across
// its own LOD geometries.

import * as THREE from "three";

export class GrassPatch {
  /**
   * @param {number} gx integer patch cell
   * @param {number} gz integer patch cell
   * @param {object} data output of generatePatchInstances (count > 0)
   * @param {THREE.BufferGeometry[]} bladeLODGeos shared base blades per LOD
   * @param {THREE.Material} material shared grass material
   * @param {object} cfg grass config
   */
  constructor(gx, gz, data, bladeLODGeos, material, cfg) {
    this.gx = gx;
    this.gz = gz;
    this.cfg = cfg;
    this.count = data.count;
    this.center = data.center;
    this.lod = 0;
    this.visible = true;

    // Per-instance attributes — unique to this patch, shared across its LODs.
    this._instAttrs = {
      aOffset: new THREE.InstancedBufferAttribute(data.offset, 3),
      aRot: new THREE.InstancedBufferAttribute(data.rot, 1),
      aScale: new THREE.InstancedBufferAttribute(data.scale, 2),
      aTilt: new THREE.InstancedBufferAttribute(data.tilt, 1),
      aBend: new THREE.InstancedBufferAttribute(data.bend, 1),
      aTint: new THREE.InstancedBufferAttribute(data.tint, 1),
      aPhase: new THREE.InstancedBufferAttribute(data.phase, 1),
    };

    // How many blades each LOD draws (thinning at distance).
    this.lodCounts = cfg.lodInstanceFactors.map((f) =>
      Math.max(1, Math.floor(this.count * f))
    );

    this.boundingSphere = this._computeBoundingSphere(data);

    this.geometries = bladeLODGeos.map((blade, i) =>
      this._buildLODGeometry(blade, this.lodCounts[i])
    );

    this.mesh = new THREE.Mesh(this.geometries[0], material);
    this.mesh.frustumCulled = false; // culled manually at patch level
    this.mesh.matrixAutoUpdate = false; // static at origin
    this.mesh.name = `GrassPatch_${gx}_${gz}`;
  }

  _computeBoundingSphere(data) {
    const off = data.offset;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 1; i < off.length; i += 3) {
      const y = off[i];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const size = this.cfg.patchSize;
    const maxBlade = this.cfg.grassSize.height * (1 + this.cfg.variation.height);
    const cy = (minY + maxY) * 0.5;
    const radius =
      Math.hypot(size * 0.72, (maxY - minY) * 0.5 + maxBlade) + 0.5;
    return new THREE.Sphere(new THREE.Vector3(this.center.x, cy, this.center.z), radius);
  }

  _buildLODGeometry(blade, instanceCount) {
    const g = new THREE.InstancedBufferGeometry();
    // Clone the tiny base blade so patch disposal is independent.
    g.setIndex(blade.getIndex().clone());
    g.setAttribute("position", blade.getAttribute("position").clone());
    g.setAttribute("uv", blade.getAttribute("uv").clone());

    const a = this._instAttrs;
    g.setAttribute("aOffset", a.aOffset);
    g.setAttribute("aRot", a.aRot);
    g.setAttribute("aScale", a.aScale);
    g.setAttribute("aTilt", a.aTilt);
    g.setAttribute("aBend", a.aBend);
    g.setAttribute("aTint", a.aTint);
    g.setAttribute("aPhase", a.aPhase);

    g.instanceCount = instanceCount;
    g.boundingSphere = this.boundingSphere;
    return g;
  }

  setLOD(level) {
    if (level === this.lod) return;
    this.lod = level;
    this.mesh.geometry = this.geometries[level];
  }

  setVisible(v) {
    this.visible = v;
    this.mesh.visible = v;
  }

  get visibleBladeCount() {
    return this.visible ? this.lodCounts[this.lod] : 0;
  }

  dispose() {
    for (const g of this.geometries) g.dispose();
    this.geometries.length = 0;
  }
}
