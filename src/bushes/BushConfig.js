import * as THREE from "three";

// Bushes: small instanced shrubs that fill the mid-ground between grass and
// trees. Denser + shorter than trees, tolerant of steeper slopes, and clustered
// by a noise field. Mirrors the tree/grass config shape so the streaming system
// can reuse the same patch machinery.
export function createBushConfig(overrides = {}) {
  const cfg = {
    enabled: true,
    density: 0.05, // bushes per square world-unit
    seed: 911,
    patchSize: 28,
    visibleDistance: 130,
    keepDistance: 165,
    lodDistances: [55, 95], // [lod0→lod1, lod1→lod2]
    lodInstanceFactors: [1, 0.6, 0.32],
    maxPatchBuildsPerFrame: 2,
    maxPatchRebuildsPerFrame: 2,
    respectExclusions: true,
    slopeLimit: 0.5, // bushes climb steeper ground than trees
    minHeight: -1e6, // height-band filter (world Y)
    maxHeight: 1e6,
    // Runtime-only snow ceiling (loader sets it to the profile snowline). Kept
    // separate from maxHeight so user intent serializes unchanged. Infinity = none.
    snowlineMaxHeight: Infinity,
    clumpStrength: 0.45, // 0 = uniform; →1 thins bushes outside noise clumps
    clumpScale: 0.06, // spatial frequency of the clump field
    bushSize: { radius: 0.9, height: 0.8 },
    variation: { scale: 0.4, tint: 0.22 },
    colors: [new THREE.Color(0x3c5a2a), new THREE.Color(0x4d6b30), new THREE.Color(0x5a6f3a)],
  };
  return Object.assign(cfg, overrides);
}

// Hard ceiling on per-patch candidates so a hostile density × patchSize can't
// spin a multi-billion-iteration synchronous loop and hang the tab.
export const MAX_BUSH_CANDIDATES = 4096;

export function bushCandidateCount(cfg) {
  return Math.min(MAX_BUSH_CANDIDATES, Math.max(1, Math.round(cfg.patchSize * cfg.patchSize * cfg.density)));
}
