// Shapes, defaults, and clamps for the world's global lighting rig (sun +
// hemisphere fill + distance fog). Pure and Node-safe (no THREE, no DOM).
//
// The sun direction is authored as azimuth/elevation (degrees) rather than a raw
// position, so it reads naturally in the editor and stays stable across saves;
// the runtime derives a world-space offset from it.

export const SUN_DISTANCE = 115;

export const MIN_INTENSITY = 0;
export const MAX_INTENSITY = 8;

export const MIN_ELEVATION = 5; // keep the sun off the horizon (stable shadows)
export const MAX_ELEVATION = 90;

export const MIN_FOG = 1;
export const MAX_FOG = 4000;

const DEG2RAD = Math.PI / 180;

export function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function boolOr(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

export function clamp(value, min, max, fallback) {
  const n = numberOr(value, fallback);
  return Math.min(max, Math.max(min, n));
}

// Normalize a color to "#rrggbb". Accepts "#rgb"/"#rrggbb" (with or without #).
export function sanitizeColor(value, fallback) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const m = trimmed.match(/^#?([0-9a-fA-F]{6})$/) || trimmed.match(/^#?([0-9a-fA-F]{3})$/);
    if (m) {
      let hex = m[1];
      if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
      return `#${hex.toLowerCase()}`;
    }
  }
  return fallback;
}

// Wrap an azimuth into [0, 360).
export function wrapAzimuth(value, fallback) {
  const n = numberOr(value, fallback);
  return ((n % 360) + 360) % 360;
}

// Derive a world-space sun offset (relative to the player) from azimuth/elevation
// degrees. Returns a plain { x, y, z } so this stays Node-safe.
export function computeSunOffset(azimuth, elevation, distance = SUN_DISTANCE) {
  const az = wrapAzimuth(azimuth, 34) * DEG2RAD;
  const el = clamp(elevation, MIN_ELEVATION, MAX_ELEVATION, 51) * DEG2RAD;
  const y = Math.sin(el) * distance;
  const horizontal = Math.cos(el) * distance;
  return {
    x: Math.cos(az) * horizontal,
    y,
    z: Math.sin(az) * horizontal,
  };
}

// Default rig — matches the prior hard-coded look (sun ≈ (60,90,40), warm key +
// cool sky fill + haze tied to the grass distance).
export function defaultLighting() {
  return {
    sun: { color: "#fff1d8", intensity: 2.6, azimuth: 34, elevation: 51, castShadow: true },
    hemisphere: { skyColor: "#bfe0ff", groundColor: "#4a5236", intensity: 0.85 },
    fog: { color: "#9fc4d8", near: 70, far: 225, enabled: true },
  };
}
