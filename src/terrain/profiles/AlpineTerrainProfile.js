// Alpine glacial-valley profile — the world's visual identity, from math only.
// A broad U-shaped glacial trough runs along +Z with ridged-multifractal walls
// rising on either side (|x|), a gently down-flowing floor, a snowline high on the
// walls, and rock/scree on the steeps. Pure + deterministic + seeded.

import { fbm2D } from "../../utils/random.js";
import { clamp, smoothstep, lerp } from "../../utils/math.js";
import { srgbHexToLinear, bandColorAt } from "../visual/ValleyColorBands.js";
import { ridged, GRASS_DENSITY_FLOOR } from "./TerrainProfile.js";

// Tunable envelope. heightAmplitude scales the overall vertical relief so the world
// terrain config still tunes the mountains; everything else shapes the valley.
const ALPINE = {
  floor: -5, // valley-floor base height
  peak: 80, // ridge-crest height at full amplitude
  valleyHalfWidth: 220, // distance from the axis to the ridge crest
  floorFlat: 0.16, // fraction of the half-width that stays flat valley floor
  warpScale: 0.004, // domain-warp frequency
  warpAmt: 55, // domain-warp displacement (world units)
  ridgeScale: 0.0065, // ridge feature frequency
  flow: 0.0045, // gentle downhill along +Z (glacial flow)
  detailScale: 0.05,
  detailAmount: 2.2,
  snowline: 44, // base snow height
};

const ALPINE_BANDS = {
  low: srgbHexToLinear(0x3f4f3c), // damp valley floor
  ground: srgbHexToLinear(0x5c7340), // alpine meadow
  rock: srgbHexToLinear(0x6f6a63), // grey rock
  lowY0: ALPINE.floor - 2,
  lowY1: 10,
  rockSlope0: 0.3,
  rockSlope1: 0.6,
  snow: srgbHexToLinear(0xeef3f7),
  snowY0: ALPINE.snowline - 6,
  snowY1: ALPINE.snowline + 9,
  scree: srgbHexToLinear(0x8b8780),
  screeSlope0: 0.35,
  screeSlope1: 0.7,
};

export function createAlpineProfile(config = {}) {
  const amp = clamp(numberOr(config.heightAmplitude, 14) / 14, 0.5, 3); // 14 = baseline → ×1
  const seed = String(config.seed ?? 0);
  const so = (Number(config.seed) || 0) * 0.013; // small seed offset into the noise field

  // U-trough wall height at a domain-warped point.
  const wallHeight = (x, z) => {
    const wx = x + fbm2D(x * ALPINE.warpScale + so, z * ALPINE.warpScale, 3) * ALPINE.warpAmt;
    const wz = z + fbm2D(x * ALPINE.warpScale + 50, z * ALPINE.warpScale - 30 + so, 3) * ALPINE.warpAmt;
    const wall = smoothstep(ALPINE.valleyHalfWidth * ALPINE.floorFlat, ALPINE.valleyHalfWidth, Math.abs(wx));
    const r = ridged(wx * ALPINE.ridgeScale, wz * ALPINE.ridgeScale, 5);
    const top = (ALPINE.floor + (ALPINE.peak - ALPINE.floor) * (0.4 + 0.6 * r)) * amp;
    return lerp(ALPINE.floor, top, wall);
  };

  const height = (x, z) => {
    const base = wallHeight(x, z);
    const undulate = fbm2D(x * 0.004 + 10 + so, z * 0.004, 3) * 3;
    const flow = -z * ALPINE.flow; // glacial downhill along +Z
    const detail = fbm2D(x * ALPINE.detailScale + so, z * ALPINE.detailScale, 3) * ALPINE.detailAmount;
    return base + undulate + flow + detail;
  };

  // Snow band thresholds scaled with amplitude — precomputed ONCE (colorAt runs per
  // mesh vertex; building a config object per call would churn the GC at build time).
  const bands = amp === 1
    ? ALPINE_BANDS
    : { ...ALPINE_BANDS, snowY0: ALPINE.snowline * amp - 6, snowY1: ALPINE.snowline * amp + 9 };

  return {
    id: "alpine",
    params: { heightAmplitude: numberOr(config.heightAmplitude, 14), seed, profile: "alpine" },
    grassSlopeLimit: 0.5,
    height,
    grassDensity(x, z) {
      // Meadow lives on the valley floor (away from the walls), patchy by fbm.
      const wall = smoothstep(ALPINE.valleyHalfWidth * ALPINE.floorFlat, ALPINE.valleyHalfWidth, Math.abs(x));
      const floorMask = 1 - wall;
      const patch = smoothstep(-0.3, 0.5, fbm2D(x * 0.02 + so, z * 0.02 - 40, 3));
      return clamp(GRASS_DENSITY_FLOOR + (1 - GRASS_DENSITY_FLOOR) * floorMask * patch, 0, 1);
    },
    snowlineAt(x, z) {
      return ALPINE.snowline * amp + fbm2D(x * 0.01 + so, z * 0.01, 2) * 6;
    },
    colorAt(x, z, h, slope, out) {
      return bandColorAt(h, slope, bands, out);
    },
    visual: {
      rockColor: 0x6f6a63,
      snowColor: 0xeef3f7,
      screeColor: 0x8b8780,
      snowlineY: ALPINE.snowline * amp,
      snowBlend: 9,
      screeSlope: [0.35, 0.7],
      screeY: [18 * amp, ALPINE.snowline * amp],
    },
  };
}

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}
