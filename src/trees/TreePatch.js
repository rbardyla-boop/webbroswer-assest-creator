import * as THREE from "three";

export class TreePatch {
  constructor(gx, gz, data, lodGeometries, materials, cfg) {
    this.gx = gx;
    this.gz = gz;
    this.cfg = cfg;
    this.count = data.count;
    this.center = data.center;
    this.trunkColliders = data.trunkColliders;
    this.lod = 0;
    this.visible = true;

    this.lodCounts = cfg.lodInstanceFactors.map((f) => Math.max(1, Math.floor(this.count * f)));
    this.groups = lodGeometries.map((geos, level) =>
      this._buildLODGroup(geos, materials, data, this.lodCounts[level], level)
    );
    this.group = new THREE.Group();
    this.group.name = `TreePatch_${gx}_${gz}`;
    for (const lodGroup of this.groups) this.group.add(lodGroup);
    this.setLOD(0);

    this.boundingSphere = this._computeBoundingSphere(data);
  }

  _buildLODGroup(geos, materials, data, instanceCount, level) {
    const group = new THREE.Group();
    group.name = `TreeLOD_${level}`;

    const trunk = new THREE.InstancedMesh(geos.trunk, materials.trunk, instanceCount);
    const canopy = new THREE.InstancedMesh(geos.canopy, materials.canopy, instanceCount);
    trunk.name = `${group.name}_Trunks`;
    canopy.name = `${group.name}_Canopies`;
    trunk.castShadow = trunk.receiveShadow = true;
    canopy.castShadow = canopy.receiveShadow = true;
    trunk.frustumCulled = false;
    canopy.frustumCulled = false;

    for (let i = 0; i < instanceCount; i++) {
      trunk.setMatrixAt(i, data.trunks[i]);
      canopy.setMatrixAt(i, data.canopies[i]);
      trunk.setColorAt(i, data.trunkColors[i]);
      canopy.setColorAt(i, data.canopyColors[i]);
    }
    trunk.instanceMatrix.needsUpdate = true;
    canopy.instanceMatrix.needsUpdate = true;
    if (trunk.instanceColor) trunk.instanceColor.needsUpdate = true;
    if (canopy.instanceColor) canopy.instanceColor.needsUpdate = true;

    group.add(trunk, canopy);
    return group;
  }

  _computeBoundingSphere(data) {
    const minY = Number.isFinite(data.bounds?.minY) ? data.bounds.minY : 0;
    const maxY = Number.isFinite(data.bounds?.maxY) ? data.bounds.maxY : this.cfg.treeSize.height;
    const size = this.cfg.patchSize;
    const cy = (minY + maxY) * 0.5;
    const radius = Math.hypot(size * 0.74, (maxY - minY) * 0.5 + this.cfg.treeSize.canopyRadius);
    return new THREE.Sphere(new THREE.Vector3(this.center.x, cy, this.center.z), radius);
  }

  setLOD(level) {
    if (level === this.lod && this.groups[level].visible) return;
    this.lod = level;
    for (let i = 0; i < this.groups.length; i++) this.groups[i].visible = i === level;
  }

  setVisible(visible) {
    this.visible = visible;
    this.group.visible = visible;
  }

  get visibleTreeCount() {
    return this.visible ? this.lodCounts[this.lod] : 0;
  }

  dispose() {
    for (const group of this.groups) {
      for (const child of group.children) child.dispose?.();
    }
    this.groups.length = 0;
  }
}
