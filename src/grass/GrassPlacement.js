// Generates the per-instance data for one patch: where each blade stands and
// how it varies. Deterministic (seeded per patch) so a patch always rebuilds
// identically, and so neighboring patches tile seamlessly.
//
// Placement goes through the terrain sampling rules (height, slope, meadow
// mask) — grass never floats and never climbs cliffs.

import { mulberry32, hash2i } from "../utils/random.js";
import { TAU } from "../utils/math.js";
import { getHeight, canPlaceGrass } from "../terrain/terrainSampling.js";
import { patchCandidateCount } from "./GrassConfig.js";

/**
 * @param {number} gx integer patch cell X
 * @param {number} gz integer patch cell Z
 * @param {object} cfg grass config
 * @returns instance buffers + count, or count 0 if the patch is empty
 */
export function generatePatchInstances(gx, gz, cfg, exclusionSystem = null) {
  const size = cfg.patchSize;
  const originX = gx * size;
  const originZ = gz * size;

  const rng = mulberry32(hash2i(gx, gz) ^ 0x9e3779b9);
  const candidates = patchCandidateCount(cfg);

  const offset = [];
  const rot = [];
  const scale = [];
  const tilt = [];
  const bend = [];
  const tint = [];
  const phase = [];

  const baseH = cfg.grassSize.height;
  const baseW = cfg.grassSize.width;
  const vr = cfg.variation;

  for (let i = 0; i < candidates; i++) {
    const rx = rng();
    const rz = rng();
    const x = originX + rx * size;
    const z = originZ + rz * size;

    // Placement rule (uses its own random draw for thinning).
    if (!canPlaceGrass(x, z, rng())) continue;
    if (exclusionSystem?.isGrassExcluded(x, z)) continue;

    const y = getHeight(x, z);

    offset.push(x, y, z);
    rot.push(rng() * TAU);

    const hMul = 1 + (rng() * 2 - 1) * vr.height;
    const wMul = 1 + (rng() * 2 - 1) * vr.width;
    scale.push(baseW * wMul, baseH * hMul);

    tilt.push((rng() * 2 - 1) * vr.tilt);
    bend.push(rng() * vr.bend);
    tint.push(rng() * 2 - 1);
    phase.push(rng());
  }

  const count = rot.length;
  if (count === 0) return { count: 0 };

  return {
    count,
    offset: Float32Array.from(offset),
    rot: Float32Array.from(rot),
    scale: Float32Array.from(scale),
    tilt: Float32Array.from(tilt),
    bend: Float32Array.from(bend),
    tint: Float32Array.from(tint),
    phase: Float32Array.from(phase),
    // Center used for culling / LOD distance.
    center: { x: originX + size * 0.5, z: originZ + size * 0.5 },
  };
}
