// Shapes, kind presets, and clamps for data-only particle emitters. Pure and
// Node-safe (no THREE, no DOM).
//
// A placed object may carry a `particles` block: a `kind` (which sets the blend
// mode + sensible defaults) plus authorable numeric/color fields. The runtime
// owns the simulation + rendering; the data only supplies bounded scalars.

export const PARTICLE_KINDS = ["spark", "dust", "smoke"];

// Per-kind defaults + blend mode ("add" = additive glow, "normal" = alpha).
export const KIND_PRESETS = {
  spark: { blend: "add", rate: 40, max: 240, lifetime: 0.8, size: 0.25, sizeEnd: 0.05, color: "#ffcc66", colorEnd: "#ff3300", speed: 4, spread: 0.5, gravity: -6, emitRadius: 0.1, opacity: 1 },
  dust: { blend: "normal", rate: 16, max: 200, lifetime: 2.4, size: 0.5, sizeEnd: 0.7, color: "#cbb892", colorEnd: "#cbb892", speed: 0.6, spread: 0.8, gravity: -0.2, emitRadius: 0.4, opacity: 0.5 },
  smoke: { blend: "normal", rate: 12, max: 180, lifetime: 3.5, size: 0.8, sizeEnd: 2.2, color: "#8a8f99", colorEnd: "#3b3f47", speed: 1.2, spread: 0.4, gravity: 0.8, emitRadius: 0.25, opacity: 0.6 },
};

// Caps that bound the resources one (possibly untrusted) emitter can request.
export const MAX_RATE = 500;
export const MAX_PARTICLES = 2000;
export const MAX_LIFETIME = 30;
export const MAX_SIZE = 50;
export const MAX_SPEED = 100;
export const MAX_GRAVITY = 50;

export function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function clamp(value, min, max, fallback) {
  const n = numberOr(value, fallback);
  return Math.min(max, Math.max(min, n));
}

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

export function blendForKind(kind) {
  return KIND_PRESETS[kind]?.blend ?? "normal";
}
