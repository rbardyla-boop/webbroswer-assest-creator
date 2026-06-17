// Rolling-hills profile — TODAY'S terrain math, extracted verbatim so the original
// world is preserved exactly (a test asserts height-for-height parity). Kept as a
// selectable profile + the comparison baseline for the single-source tests.

import { fbm2D } from "../../utils/random.js";
import { clamp, smoothstep } from "../../utils/math.js";
import { srgbHexToLinear, bandColorAt } from "../visual/ValleyColorBands.js";

const ROLLING_DEFAULTS = { heightAmplitude: 14, featureScale: 0.012, detailScale: 0.06, detailAmount: 1.6, octaves: 5 };
const GRASS_FLOOR = 0.4;

// Original COLOR_LOW / COLOR_GRASS / COLOR_DIRT / COLOR_ROCK, in linear space.
const ROLLING_BANDS = {
  low: srgbHexToLinear(0x3c5530),
  ground: srgbHexToLinear(0x4f6b34),
  dirt: srgbHexToLinear(0x6b5836),
  rock: srgbHexToLinear(0x6a6660),
  lowY0: -8,
  lowY1: 2,
  dirtSlope0: 0.18,
  dirtSlope1: 0.4,
  rockSlope0: 0.42,
  rockSlope1: 0.62,
  snow: null, // no snow band — reproduces the original 4-color blend
};

export function createRollingProfile(config = {}) {
  const p = {
    heightAmplitude: numberOr(config.heightAmplitude, ROLLING_DEFAULTS.heightAmplitude),
    featureScale: numberOr(config.featureScale, ROLLING_DEFAULTS.featureScale),
    detailScale: numberOr(config.detailScale, ROLLING_DEFAULTS.detailScale),
    detailAmount: numberOr(config.detailAmount, ROLLING_DEFAULTS.detailAmount),
    octaves: Math.max(1, Math.floor(numberOr(config.octaves, ROLLING_DEFAULTS.octaves))),
  };
  return {
    id: "rolling",
    params: p,
    grassSlopeLimit: 0.55,
    height(x, z) {
      const base = fbm2D(x * p.featureScale, z * p.featureScale, p.octaves);
      const shaped = Math.sign(base) * Math.pow(Math.abs(base), 1.15);
      const detail = fbm2D(x * p.detailScale, z * p.detailScale, 3) * p.detailAmount;
      return shaped * p.heightAmplitude + detail;
    },
    grassDensity(x, z) {
      const meadow = fbm2D(x * 0.02 + 100, z * 0.02 - 70, 3);
      const mask = smoothstep(-0.3, 0.5, meadow);
      return clamp(GRASS_FLOOR + (1 - GRASS_FLOOR) * mask, 0, 1);
    },
    snowlineAt() {
      return Infinity; // no snow on rolling hills
    },
    colorAt(x, z, h, slope, out) {
      return bandColorAt(h, slope, ROLLING_BANDS, out);
    },
    // Snow effectively disabled (snowlineY far above any terrain); scree off. The
    // terrain material then behaves exactly as before (macro/slope-rock/height-tint).
    // Band edges use edge0 < edge1 with an UNREACHABLE range (slope ≤ 1; height never
    // 1e6) so every smoothstep is well-defined (== 0) on all drivers — never the
    // edge0==edge1 case, which GLSL leaves undefined.
    visual: {
      rockColor: 0x6a6660,
      snowColor: 0xeef3f7,
      screeColor: 0x8b8780,
      snowlineY: 1e6,
      snowBlend: 1,
      screeSlope: [2, 3],
      screeY: [1e6, 2e6],
    },
  };
}

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}
