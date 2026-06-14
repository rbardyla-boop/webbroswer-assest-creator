import * as THREE from "three";
import { VOXEL_LIMITS } from "./VoxelTypes.js";

// Occupancy visualization: ONE InstancedMesh of unit cubes — a single instanced
// draw call for the whole grid, never a Mesh per voxel. Instance count is hard-
// capped (MAX_DEBUG_INSTANCES); past the cap the remaining cells are simply not
// drawn and `truncated` is set. Cells are tinted by source-object id.

const PALETTE = [0x7fdca0, 0xe6c463, 0x6db3ff, 0xe0795a, 0xc78bff, 0x68d8c6, 0xd6d65a, 0xff8fbf];

export class VoxelDebugMesh {
  constructor(grid, { maxInstances = VOXEL_LIMITS.MAX_DEBUG_INSTANCES, opacity = 0.55 } = {}) {
    const count = Math.min(grid.occupiedCount, maxInstances);
    this.instanceCount = count;
    this.truncated = grid.occupiedCount > count;

    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.75,
      metalness: 0.0,
      transparent: opacity < 1,
      opacity,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.name = "VoxelDebug";
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.userData.isVoxelDebug = true; // never serialized, but easy to spot

    const s = grid.cellSize * 0.9; // slight gap so voxels read as a grid
    const matrix = new THREE.Matrix4();
    const center = new THREE.Vector3();
    const scale = new THREE.Vector3(s, s, s);
    const quat = new THREE.Quaternion();
    const color = new THREE.Color();

    let i = 0;
    grid.forEachOccupied((x, y, z, id) => {
      if (i >= count) return; // capped — remaining cells are reported, not drawn
      grid.cellCenter(x, y, z, center);
      matrix.compose(center, quat, scale);
      this.mesh.setMatrixAt(i, matrix);
      color.set(PALETTE[(id >= 0 ? id : 0) % PALETTE.length]);
      this.mesh.setColorAt(i, color);
      i++;
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  get object3D() {
    return this.mesh;
  }

  // One instanced draw call when populated; zero when empty.
  get drawCalls() {
    return this.instanceCount > 0 ? 1 : 0;
  }

  dispose() {
    // Geometry + material are owned here, so dispose them. InstancedMesh.dispose()
    // frees the per-instance GPU buffers (do NOT call instanceMatrix.dispose() —
    // BufferAttribute has no dispose() in r169).
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose?.();
  }
}
