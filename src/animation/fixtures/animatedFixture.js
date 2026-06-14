// Deterministic animated-asset fixture for tests/proofs. Builds a tiny scene
// with (1) a plain moving node and (2) a minimal 2-bone skinned mesh, plus two
// clips. No randomness/time — identical output every call. Used by the Node
// regression test (scene+clips directly) and the browser proof (exported GLB).
//
// This module is test/proof infrastructure: nothing in the app imports it, so it
// never enters the production bundle. No binary asset is committed.

import * as THREE from "three";

const SLIDE_CLIP = "Slide"; // animates the "Mover" node's position.x 0 -> 2
const BEND_CLIP = "Bend"; // rotates the "Joint" bone of the skinned mesh

/**
 * @returns {{ root: THREE.Group, clips: THREE.AnimationClip[] }}
 */
export function buildAnimatedFixtureScene() {
  const root = new THREE.Group();
  root.name = "AnimFixture";

  // 1. A plain moving node — the reliable, easy-to-observe transform track.
  const mover = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x88ccff })
  );
  mover.name = "Mover";
  root.add(mover);

  // 2. A minimal 2-bone skinned mesh (proves the SkeletonUtils.clone path).
  const geometry = new THREE.CylinderGeometry(0.2, 0.2, 2, 6, 4);
  const position = geometry.attributes.position;
  const skinIndices = [];
  const skinWeights = [];
  for (let i = 0; i < position.count; i++) {
    // Bind each vertex fully to bone 0 (lower) or bone 1 (upper) by height.
    const upper = position.getY(i) > 0 ? 1 : 0;
    skinIndices.push(upper, 0, 0, 0);
    skinWeights.push(1, 0, 0, 0);
  }
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));

  const rootBone = new THREE.Bone();
  rootBone.name = "Root";
  rootBone.position.y = -1;
  const jointBone = new THREE.Bone();
  jointBone.name = "Joint";
  jointBone.position.y = 1;
  rootBone.add(jointBone);

  const skeleton = new THREE.Skeleton([rootBone, jointBone]);
  const limb = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial({ color: 0xffaa66 }));
  limb.name = "Limb";
  limb.add(rootBone);
  limb.bind(skeleton);
  limb.position.x = 1.5;
  root.add(limb);

  // Clips.
  const slide = new THREE.AnimationClip(SLIDE_CLIP, 1, [
    new THREE.VectorKeyframeTrack("Mover.position", [0, 1], [0, 0, 0, 2, 0, 0]),
  ]);
  const q0 = new THREE.Quaternion();
  const q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1);
  const bend = new THREE.AnimationClip(BEND_CLIP, 1, [
    new THREE.QuaternionKeyframeTrack("Joint.quaternion", [0, 1], [q0.x, q0.y, q0.z, q0.w, q1.x, q1.y, q1.z, q1.w]),
  ]);

  return { root, clips: [slide, bend] };
}

export const FIXTURE_CLIP_NAMES = [SLIDE_CLIP, BEND_CLIP];

/**
 * Export the fixture as a binary GLB (browser/proof use). GLTFExporter is loaded
 * dynamically so this module's top level stays Node-safe.
 * @returns {Promise<ArrayBuffer>}
 */
export async function exportAnimatedFixtureGLB() {
  const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
  const { root, clips } = buildAnimatedFixtureScene();
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(root, resolve, reject, { binary: true, animations: clips });
  });
}
