// Configuration for the Visibility + Streaming Kernel (Stage 17A): guard-banded
// frustum culling + streaming + LOD hysteresis. Every field is clamped so an
// untrusted world document can't request a degenerate or unbounded policy.
//
// Bands (multipliers on the frustum / distance):
//   visible  : inside the real camera frustum
//   warm     : inside the frustum expanded by `guardBand`, OR within `nearRadius`
//   sleeping : inside the frustum expanded by `unloadBand`
//   unloaded : beyond that
// `minKeepSeconds` holds a recently-awake agent at `warm` after it leaves the
// guard band (time hysteresis → no thrash, no pop on a quick turn-back).

export const VISIBILITY_DEFAULTS = Object.freeze({
  enabled: true,
  guardBand: 1.2, // +20% frustum margin for the warm tier
  unloadBand: 1.6, // larger margin before an agent is allowed to fully unload/sleep
  nearRadius: 28, // agents within this distance stay >= warm regardless of facing (anti-pop)
  minKeepSeconds: 1.0, // hold warm this long after leaving the guard band
  // RESERVED (not yet enforced): a budget for adapters whose wake transition has
  // real build cost (procedural/voxel streaming in a later stage). The current
  // animation adapter wakes in O(1), so the kernel does not throttle it — that
  // would only delay the anti-pop guarantee for no benefit. Sanitized + round-
  // tripped now so the policy is authorable before those adapters land.
  maxWakesPerFrame: 3,
});

const LIMITS = Object.freeze({
  guardBand: [1, 4],
  unloadBand: [1, 8],
  nearRadius: [0, 5000],
  minKeepSeconds: [0, 30],
  maxWakesPerFrame: [1, 256],
});

export function createVisibilityConfig(overrides = {}) {
  const src = overrides && typeof overrides === "object" ? overrides : {};
  const guardBand = clamp(num(src.guardBand, VISIBILITY_DEFAULTS.guardBand), ...LIMITS.guardBand);
  // unloadBand must be at least guardBand so the tiers never invert.
  const unloadBand = Math.max(guardBand, clamp(num(src.unloadBand, VISIBILITY_DEFAULTS.unloadBand), ...LIMITS.unloadBand));
  return {
    enabled: src.enabled !== false,
    guardBand,
    unloadBand,
    nearRadius: clamp(num(src.nearRadius, VISIBILITY_DEFAULTS.nearRadius), ...LIMITS.nearRadius),
    minKeepSeconds: clamp(num(src.minKeepSeconds, VISIBILITY_DEFAULTS.minKeepSeconds), ...LIMITS.minKeepSeconds),
    maxWakesPerFrame: Math.round(clamp(num(src.maxWakesPerFrame, VISIBILITY_DEFAULTS.maxWakesPerFrame), ...LIMITS.maxWakesPerFrame)),
  };
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}
