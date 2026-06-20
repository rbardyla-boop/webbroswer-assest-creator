// Deterministic asset-budget fixtures for tests/proofs (Asset Pipeline-1).
//
// Builds two tiny scenes: a CLEAN low-poly prop (passes the budget) and a HEAVY
// high-tessellation prop (deterministically over the triangle reject tier). No
// randomness, no wall-clock — identical output every call. The Node gate runs
// computeAssetBudget on buildScene() directly; the browser proof imports the exported
// GLB through the real Asset Library.
//
// This module is test/proof infrastructure: nothing in the app imports it, so it never
// enters the production bundle. No binary asset is committed.

import * as THREE from "three";

// A low-poly box prop — a handful of triangles, one material, no textures.
export function buildCleanAssetScene() {
  const root = new THREE.Group();
  root.name = "CleanProp";
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1.2, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x8fc7ff })
  );
  mesh.name = "CleanBox";
  root.add(mesh);
  return root;
}

// A high-tessellation sphere whose triangle count is far above ASSET_BUDGET_LIMITS
// triangles.reject (200k). SphereGeometry(r, w, h) is indexed; 420 x 260 segments yields
// 217,560 triangles — slightly under the w*h*2 approximation (218,400) because the poles
// are deduplicated (the top/bottom rows are triangle fans). Deterministic for a fixed
// segment count.
const HEAVY_WIDTH_SEGMENTS = 420;
const HEAVY_HEIGHT_SEGMENTS = 260;

export function buildHeavyAssetScene() {
  const root = new THREE.Group();
  root.name = "HeavyProp";
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, HEAVY_WIDTH_SEGMENTS, HEAVY_HEIGHT_SEGMENTS),
    new THREE.MeshStandardMaterial({ color: 0xff7043 })
  );
  mesh.name = "HeavySphere";
  root.add(mesh);
  return root;
}

async function exportGLB(root) {
  const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(root, resolve, reject, { binary: true });
  });
}

/** Export the clean prop as a binary GLB (browser/proof use). @returns {Promise<ArrayBuffer>} */
export function exportCleanAssetGLB() {
  return exportGLB(buildCleanAssetScene());
}

/** Export the heavy prop as a binary GLB (browser/proof use). @returns {Promise<ArrayBuffer>} */
export function exportHeavyAssetGLB() {
  return exportGLB(buildHeavyAssetScene());
}
