// Sanitizer for a placed-object particle emitter. Invalid input is repaired or
// dropped, never fatal. Pure and Node-safe.
//
// Builds ONLY the allowlisted fields (no passthrough of unknown keys), starting
// from the chosen kind's preset and overriding with clamped values. Returns null
// when there is no (valid) emitter.

import {
  PARTICLE_KINDS,
  KIND_PRESETS,
  clamp,
  sanitizeColor,
  MAX_RATE,
  MAX_PARTICLES,
  MAX_LIFETIME,
  MAX_SIZE,
  MAX_SPEED,
  MAX_GRAVITY,
} from "./ParticleTypes.js";

export function sanitizeParticles(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  // Unknown/absent kind → no emitter (consistent with interaction's unknown-role
  // → null), so a typo or hostile value never silently becomes smoke.
  if (!PARTICLE_KINDS.includes(input.kind)) return null;
  const kind = input.kind;
  const d = KIND_PRESETS[kind];
  return {
    kind,
    rate: clamp(input.rate, 0, MAX_RATE, d.rate),
    max: Math.round(clamp(input.max, 1, MAX_PARTICLES, d.max)),
    lifetime: clamp(input.lifetime, 0.05, MAX_LIFETIME, d.lifetime),
    size: clamp(input.size, 0.01, MAX_SIZE, d.size),
    sizeEnd: clamp(input.sizeEnd, 0, MAX_SIZE, d.sizeEnd),
    color: sanitizeColor(input.color, d.color),
    colorEnd: sanitizeColor(input.colorEnd, d.colorEnd),
    speed: clamp(input.speed, 0, MAX_SPEED, d.speed),
    spread: clamp(input.spread, 0, 1, d.spread),
    gravity: clamp(input.gravity, -MAX_GRAVITY, MAX_GRAVITY, d.gravity),
    emitRadius: clamp(input.emitRadius, 0, MAX_SIZE, d.emitRadius),
    opacity: clamp(input.opacity, 0, 1, d.opacity),
  };
}
