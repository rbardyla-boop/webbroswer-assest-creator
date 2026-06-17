// Sanitizer for the world's `atmosphere` block. Invalid values are repaired to
// defaults or clamped, never fatal. Pure and Node-safe. Reuses the canonical
// color/number validators from the lighting types.

import { sanitizeColor, clamp, boolOr } from "../../lighting/LightingTypes.js";
import { DEFAULT_ATMOSPHERE } from "./AtmosphereConfig.js";

export function sanitizeAtmosphere(input) {
  const d = DEFAULT_ATMOSPHERE;
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ...d };
  return {
    enabled: boolOr(input.enabled, d.enabled),
    basinFogBoost: clamp(input.basinFogBoost, 0, 0.9, d.basinFogBoost),
    mistStrength: clamp(input.mistStrength, 0, 1, d.mistStrength),
    mistColor: sanitizeColor(input.mistColor, d.mistColor),
    easeRate: clamp(input.easeRate, 0.1, 10, d.easeRate),
    ridgeSpan: clamp(input.ridgeSpan, 5, 400, d.ridgeSpan),
    mistBand: clamp(input.mistBand, 1, 100, d.mistBand),
  };
}
