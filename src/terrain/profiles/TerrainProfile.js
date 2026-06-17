// TerrainProfile — the contract every terrain shape implements. A profile is PURE
// math (Node-safe, deterministic, seeded; no Math.random, no THREE). The terrain
// field (terrainSampling.js) holds ONE active profile and routes every getHeight /
// slope / grass query through it, so swapping the profile swaps the whole world's
// ground truth with no second mesh and no forked sampler.
//
// A profile exposes:
//   id            : string
//   params        : the resolved numeric config (for serialize-back)
//   height(x,z)   : world Y (the single source of truth)
//   grassDensity(x,z) -> 0..1 meadow mask
//   snowlineAt(x,z)   -> world Y above which it reads as snow (Infinity = none)
//   grassSlopeLimit   : 0..1 max slope grass tolerates
//   colorAt(x,z,h,slope,out3) -> linear [r,g,b] vertex color (writes into out3)
//   visual : material-shader config (hex colors + thresholds) the terrain material
//            reads to add the snow/scree pixel bands. Plain data — the material does
//            the THREE.Color conversion, keeping the profile THREE-free.

export const GRASS_DENSITY_FLOOR = 0.2; // minimum coverage where grass is allowed at all

// Shared meadow mask helper (low-frequency fbm → 0..1) — used by profiles that want
// patchy meadows. Profiles pass their own scale/offset so masks don't collide.
import { fbm2D } from "../../utils/random.js";
import { clamp, smoothstep } from "../../utils/math.js";

export function meadowMask(x, z, scale = 0.02, ox = 0, oz = 0) {
  const m = fbm2D(x * scale + ox, z * scale + oz, 3);
  return smoothstep(-0.3, 0.5, m);
}

// Ridged multifractal in ~[0,1] — sharp ridge crests for mountain walls.
export function ridged(x, z, octaves = 5) {
  const r = 1 - Math.abs(fbm2D(x, z, octaves));
  return clamp(r * r, 0, 1);
}
