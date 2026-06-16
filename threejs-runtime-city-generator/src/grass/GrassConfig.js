// Single source of truth for every tunable knob in the grass system.
// Everything downstream (placement, geometry, material, streaming, LOD) reads
// from one config object so the system can be reconfigured in one place.

import * as THREE from "three";

export function createGrassConfig(overrides = {}) {
  const cfg = {
    // --- density & extent -----------------------------------------------------
    density: 7, // blades per square world-unit (before placement thinning)
    patchSize: 24, // world size of one square patch/chunk
    visibleDistance: 165, // patches beyond this (from player) are not built/shown
    keepDistance: 200, // built patches beyond this are disposed (hysteresis)

    // --- LOD ------------------------------------------------------------------
    // Distance bands (patch center → camera) that select blade detail + count.
    lodDistances: [55, 110], // [lod0→lod1, lod1→lod2]
    lodInstanceFactors: [1.0, 0.55, 0.28], // fraction of blades drawn per LOD
    lodSegments: [5, 3, 1], // height segments of the blade mesh per LOD

    // --- blade size & variation ----------------------------------------------
    grassSize: {
      width: 0.12, // base blade width (world units)
      height: 1.05, // base blade height
    },
    variation: {
      height: 0.55, // ± fraction of base height
      width: 0.4, // ± fraction of base width
      bend: 0.5, // forward lean amount (world units at tip)
      tilt: 0.22, // random pitch so blades aren't all vertical
      hue: 0.12, // tint spread
    },

    // --- color ----------------------------------------------------------------
    colorBase: new THREE.Color(0x36531f), // root color (shadowed)
    colorTip: new THREE.Color(0x9bcf5a), // tip color (lit)
    colorDry: new THREE.Color(0xb6a14a), // dry/golden accent

    // --- wind (GPU) -----------------------------------------------------------
    wind: {
      direction: new THREE.Vector2(1, 0.45).normalize(),
      strength: 0.32, // sway amplitude (world units at tip)
      frequency: 1.7, // temporal speed
      scale: 0.06, // spatial frequency of the gust field
      gustiness: 0.55, // secondary turbulence amount
    },

    // --- streaming/perf -------------------------------------------------------
    maxPatchBuildsPerFrame: 3, // spread patch creation to avoid hitches
    debug: true,
  };

  // Shallow-merge overrides (nested objects replaced wholesale if provided).
  return Object.assign(cfg, overrides);
}

// Number of candidate blades for a patch before placement thinning.
export function patchCandidateCount(cfg) {
  return Math.round(cfg.patchSize * cfg.patchSize * cfg.density);
}
