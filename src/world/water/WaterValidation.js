// Sanitizer for the world's `water` render block. Invalid values are repaired to
// defaults or clamped, never fatal. Pure and Node-safe. Reuses the canonical
// color/number validators from the lighting types (no duplicate sanitizers).

import { sanitizeColor, clamp, boolOr } from "../../lighting/LightingTypes.js";
import { DEFAULT_WATER } from "./WaterConfig.js";

export function sanitizeWater(input) {
  const d = DEFAULT_WATER;
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ...d };
  return {
    enabled: boolOr(input.enabled, d.enabled),
    shallowColor: sanitizeColor(input.shallowColor, d.shallowColor),
    deepColor: sanitizeColor(input.deepColor, d.deepColor),
    foamColor: sanitizeColor(input.foamColor, d.foamColor),
    opacity: clamp(input.opacity, 0, 1, d.opacity),
    flowSpeed: clamp(input.flowSpeed, 0, 4, d.flowSpeed),
    depthRange: clamp(input.depthRange, 0.5, 60, d.depthRange),
    foamBand: clamp(input.foamBand, 0, 20, d.foamBand),
    fresnel: clamp(input.fresnel, 0, 1, d.fresnel),
  };
}
