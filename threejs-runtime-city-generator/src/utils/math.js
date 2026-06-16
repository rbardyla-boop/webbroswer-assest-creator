// Small, dependency-free math helpers shared across the prototype.

export const TAU = Math.PI * 2;

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function inverseLerp(a, b, value) {
  if (a === b) return 0;
  return clamp((value - a) / (b - a), 0, 1);
}

export function smoothstep(edge0, edge1, x) {
  const t = inverseLerp(edge0, edge1, x);
  return t * t * (3 - 2 * t);
}

// Frame-rate independent exponential smoothing.
// `rate` is roughly "how fast" (higher = snappier). dt in seconds.
export function damp(current, target, rate, dt) {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

// Shortest signed angular difference, result in (-PI, PI].
export function angleDelta(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

// Angle interpolation that respects wrap-around.
export function dampAngle(current, target, rate, dt) {
  return current + angleDelta(current, target) * (1 - Math.exp(-rate * dt));
}

export function degToRad(deg) {
  return (deg * Math.PI) / 180;
}
