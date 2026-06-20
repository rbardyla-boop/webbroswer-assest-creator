// WebGPU Feasibility Gate-0 — the lab field (THREE + three/webgpu node materials).
//
// The spike's renderable: a single InstancedMesh of thin 2-triangle blades, placed deterministically
// (seeded — never the platform random source). It exists ONLY to prove a WebGPURenderer can init and
// render an instanced field and to give the structural comparison something real to measure. It is the
// "minimal field + capability readout" scope: NOT the production grass, NOT a TSL port of the wind
// shader. Imported ONLY by the lab entry — never by any production path or the Node regression.

import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { mulberry32, hash2i } from "../../utils/random.js";
import { webgpuLabComposition } from "./WebGPULabComposition.js";

// A 2-triangle blade quad (4 verts, 2 tris), upright with its base at the origin.
function bladeGeometry() {
  const g = new THREE.BufferGeometry();
  const w = 0.045;
  const h = 0.5;
  const positions = new Float32Array([-w, 0, 0, w, 0, 0, w, h, 0, -w, h, 0]);
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

/**
 * Build the deterministic instanced grass-like field. A uniform green MeshBasicNodeMaterial keeps it
 * robust across BOTH the WebGPU backend and the WebGL2 fallback backend (no per-instance-color path to
 * differ between them — the feasibility point is "it renders an instanced field", not shading).
 * @param {object} [opts] - forwarded to webgpuLabComposition().
 * @returns {{mesh:THREE.InstancedMesh, plan:object, dispose:Function}}
 */
export function buildWebGPULabField(opts = {}) {
  const plan = webgpuLabComposition(opts);
  const geom = bladeGeometry();
  const mat = new MeshBasicNodeMaterial({ color: 0x4f9d63, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geom, mat, plan.instances);

  const rng = mulberry32(hash2i(plan.rows, plan.cols));
  const dummy = new THREE.Object3D();
  const halfX = plan.bounds.x / 2;
  const halfZ = plan.bounds.z / 2;
  let i = 0;
  for (let r = 0; r < plan.rows; r++) {
    for (let c = 0; c < plan.cols; c++) {
      const jitterX = (rng() - 0.5) * plan.spacing * 0.6;
      const jitterZ = (rng() - 0.5) * plan.spacing * 0.6;
      dummy.position.set(c * plan.spacing - halfX + jitterX, 0, r * plan.spacing - halfZ + jitterZ);
      dummy.rotation.set(0, rng() * Math.PI * 2, 0);
      const s = 0.7 + rng() * 0.6;
      dummy.scale.set(1, s, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      i++;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;

  return {
    mesh,
    plan,
    dispose() {
      geom.dispose();
      mat.dispose();
      mesh.dispose?.();
    },
  };
}
