// Sanitizer for the world's lighting rig. Invalid values are repaired to defaults
// or clamped, never fatal. Pure and Node-safe.

import {
  defaultLighting,
  sanitizeColor,
  clamp,
  boolOr,
  wrapAzimuth,
  MIN_INTENSITY,
  MAX_INTENSITY,
  MIN_ELEVATION,
  MAX_ELEVATION,
  MIN_FOG,
  MAX_FOG,
} from "./LightingTypes.js";

export function sanitizeLighting(input) {
  const d = defaultLighting();
  if (!input || typeof input !== "object" || Array.isArray(input)) return d;

  const sun = input.sun ?? {};
  const hemi = input.hemisphere ?? {};
  const fog = input.fog ?? {};

  const near = clamp(fog.near, MIN_FOG, MAX_FOG, d.fog.near);
  const far = Math.max(near + 1, clamp(fog.far, MIN_FOG, MAX_FOG, d.fog.far));

  return {
    sun: {
      color: sanitizeColor(sun.color, d.sun.color),
      intensity: clamp(sun.intensity, MIN_INTENSITY, MAX_INTENSITY, d.sun.intensity),
      azimuth: wrapAzimuth(sun.azimuth, d.sun.azimuth),
      elevation: clamp(sun.elevation, MIN_ELEVATION, MAX_ELEVATION, d.sun.elevation),
      castShadow: boolOr(sun.castShadow, d.sun.castShadow),
    },
    hemisphere: {
      skyColor: sanitizeColor(hemi.skyColor, d.hemisphere.skyColor),
      groundColor: sanitizeColor(hemi.groundColor, d.hemisphere.groundColor),
      intensity: clamp(hemi.intensity, MIN_INTENSITY, MAX_INTENSITY, d.hemisphere.intensity),
    },
    fog: {
      color: sanitizeColor(fog.color, d.fog.color),
      near,
      far,
      enabled: boolOr(fog.enabled, d.fog.enabled),
    },
  };
}
