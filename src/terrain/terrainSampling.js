// Reusable terrain field. Everything that needs to know "how high / which way /
// can grass grow here" goes through these pure functions: the terrain mesh,
// grass placement, and the player's grounding all sample the same source.
//
// Stage Visual-0 — this module is now a thin WRAPPER over ONE active TerrainProfile.
// getHeight/grassDensity delegate to the profile; getNormal/getSlope/findGoodSpawn
// are built on getHeight so they auto-follow it. Swapping the profile (setTerrain
// profile, called on world load) swaps the whole world's ground truth — there is no
// second mesh and no forked sampler. `TERRAIN` stays exported as the rolling defaults
// the WorldDocument terrain block seeds from.

import { clamp } from "../utils/math.js";
import { createTerrainProfile } from "./profiles/index.js";

// Rolling-hills defaults — the WorldDocument terrain block reads these as its seed
// values. The active SHAPE comes from the profile below, not from mutating this.
export const TERRAIN = {
  heightAmplitude: 14, // peak-to-valley scale in world units
  featureScale: 0.012, // lower = larger, rolling features
  detailScale: 0.06, // fine ripple
  detailAmount: 1.6,
  octaves: 5,
};

// The single active terrain profile. Defaults to alpine (the world's identity);
// the world loader replaces it from the document's terrain block on load.
let activeProfile = createTerrainProfile({});

/** Swap the active terrain profile (whole-world ground-truth switch). */
export function setTerrainProfile(profile) {
  if (profile && typeof profile.height === "function") activeProfile = profile;
  return activeProfile;
}

/** The active profile — for the mesh/material to read colorAt + visual config. */
export function getActiveTerrainProfile() {
  return activeProfile;
}

// World height at (x, z) in world units. Smooth and deterministic — delegated to
// the active profile so this is the ONE height source for mesh, placement, grounding.
export function getHeight(x, z) {
  return activeProfile.height(x, z);
}

// Surface normal via central differences over getHeight. `eps` trades accuracy for
// cost. Profile-agnostic: it only ever calls getHeight, so it follows the profile.
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

// Spatially-varying meadow density mask (0..1) — delegated to the active profile so
// each terrain identity decides where grass clusters.
export function getGrassDensityFactor(x, z) {
  return activeProfile.grassDensity(x, z);
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

// Placement rule: should a grass blade be allowed at this point? Reusable predicate
// combining the profile's slope limit, its snowline (no grass on snow/ice), and the
// meadow mask. Profile-driven so alpine excludes snow + steep rock automatically.
export function canPlaceGrass(x, z, rng01) {
  const slope = getSlope(x, z);
  if (slope > activeProfile.grassSlopeLimit) return false; // too steep — bare rock/scree

  if (getHeight(x, z) > activeProfile.snowlineAt(x, z)) return false; // above snowline — snow/ice

  const density = getGrassDensityFactor(x, z);
  if (density <= 0.02) return false;

  // Probabilistic thinning toward meadow edges.
  return rng01 < density;
}
