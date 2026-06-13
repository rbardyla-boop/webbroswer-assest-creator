import * as THREE from "three";

export function createTreeConfig(overrides = {}) {
  const cfg = {
    enabled: true,
    density: 0.018,
    seed: 1337,
    patchSize: 36,
    visibleDistance: 190,
    keepDistance: 230,
    lodDistances: [70, 135],
    lodInstanceFactors: [1, 0.78, 0.48],
    maxPatchBuildsPerFrame: 1,
    maxPatchRebuildsPerFrame: 1,
    respectExclusions: true,
    trunkCollision: false,
    slopeLimit: 0.34,
    treeSize: {
      height: 7.5,
      trunkRadius: 0.28,
      canopyRadius: 1.65,
    },
    variation: {
      height: 0.42,
      trunkRadius: 0.35,
      canopy: 0.38,
      lean: 0.18,
      tint: 0.18,
    },
    trunkColor: new THREE.Color(0x6a4930),
    trunkDark: new THREE.Color(0x3f2d22),
    canopyColors: [
      new THREE.Color(0x315f2e),
      new THREE.Color(0x4f7f34),
      new THREE.Color(0x2f6b55),
    ],
  };

  return Object.assign(cfg, overrides);
}

export function patchCandidateCount(cfg) {
  return Math.max(1, Math.round(cfg.patchSize * cfg.patchSize * cfg.density));
}
