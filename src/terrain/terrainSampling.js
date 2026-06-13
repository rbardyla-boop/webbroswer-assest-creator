// Reusable terrain field. Everything that needs to know "how high / which way /
// can grass grow here" goes through these pure functions: the terrain mesh,
// grass placement, and the player's grounding all sample the same source.

import { fbm2D } from "../utils/random.js";
import { clamp, smoothstep } from "../utils/math.js";

// Tunable shape of the world. Kept here so the whole field is reproducible.
export const TERRAIN = {
  heightAmplitude: 14, // peak-to-valley scale in world units
  featureScale: 0.012, // lower = larger, rolling features
  detailScale: 0.06, // fine ripple
  detailAmount: 1.6,
  octaves: 5,
};

// World height at (x, z) in world units. Smooth and deterministic.
export function getHeight(x, z) {
  const base = fbm2D(x * TERRAIN.featureScale, z * TERRAIN.featureScale, TERRAIN.octaves);
  // Bias toward gentle valleys with occasional rises.
  const shaped = Math.sign(base) * Math.pow(Math.abs(base), 1.15);
  const detail =
    fbm2D(x * TERRAIN.detailScale, z * TERRAIN.detailScale, 3) * TERRAIN.detailAmount;
  return shaped * TERRAIN.heightAmplitude + detail;
}

// Surface normal via central differences. `eps` trades accuracy for cost.
const _epsDefault = 0.75;
export function getNormal(x, z, target = { x: 0, y: 1, z: 0 }, eps = _epsDefault) {
  const hL = getHeight(x - eps, z);
  const hR = getHeight(x + eps, z);
  const hD = getHeight(x, z - eps);
  const hU = getHeight(x, z + eps);

  // Gradient → normal. (-dh/dx, 2*eps, -dh/dz) normalized.
  let nx = hL - hR;
  let ny = 2 * eps;
  let nz = hD - hU;
  const len = Math.hypot(nx, ny, nz) || 1;
  target.x = nx / len;
  target.y = ny / len;
  target.z = nz / len;
  return target;
}

// Slope as 0 (flat) .. 1 (vertical), from the normal's deviation from up.
export function getSlope(x, z) {
  const n = getNormal(x, z, _normalScratch);
  return clamp(1 - n.y, 0, 1);
}
const _normalScratch = { x: 0, y: 1, z: 0 };

// A spatially-varying density mask so grass clusters into meadows while keeping
// a continuous baseline of coverage (no bare gaps). Returns 0..1.
const GRASS_FLOOR = 0.4; // minimum coverage everywhere grass is allowed
export function getGrassDensityFactor(x, z) {
  const meadow = fbm2D(x * 0.02 + 100, z * 0.02 - 70, 3); // ~[-1,1]
  const mask = smoothstep(-0.3, 0.5, meadow);
  return clamp(GRASS_FLOOR + (1 - GRASS_FLOOR) * mask, 0, 1);
}

// Find a pleasant spawn: an open, fairly flat, slightly elevated spot near the
// origin so the player starts with a view across the field rather than in a pit.
// Reusable for any "place an actor on good ground" need.
export function findGoodSpawn(radius = 80, samples = 17) {
  let best = { x: 0, z: 0 };
  let bestScore = -Infinity;
  for (let iz = 0; iz < samples; iz++) {
    for (let ix = 0; ix < samples; ix++) {
      const x = (ix / (samples - 1) - 0.5) * 2 * radius;
      const z = (iz / (samples - 1) - 0.5) * 2 * radius;
      const h = getHeight(x, z);
      const slope = getSlope(x, z);
      // Prefer elevation and flatness; mild penalty for distance from origin.
      const score = h - slope * 22 - Math.hypot(x, z) * 0.03;
      if (score > bestScore) {
        bestScore = score;
        best = { x, z };
      }
    }
  }
  return best;
}

// Placement rule: should a grass blade be allowed at this point?
// Reusable predicate combining slope, height band, and the meadow mask.
export function canPlaceGrass(x, z, rng01) {
  const slope = getSlope(x, z);
  if (slope > 0.55) return false; // too steep — bare rock/dirt

  const density = getGrassDensityFactor(x, z);
  if (density <= 0.02) return false;

  // Probabilistic thinning toward meadow edges.
  return rng01 < density;
}
