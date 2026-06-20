// Enemy-0 value types + constants. PURE data — no THREE, no scene, no wall-clock, no RNG.
// An enemy is a reactive COMBAT TARGET with a tiny finite state machine (idle / hit-react /
// defeated). Its state is a plain, finite-guarded, immutable snapshot so summaries are
// deterministic under fixed input/state (compared directly in the regression). Enemy-0 is one
// stationary test type that consumes the Combat-0 StrikeEvent — it is NOT an AI: no patrol,
// chase, loot, waves, inventory, or projectiles.

export const ENEMY_TYPE = "glacial_sentinel"; // the single Enemy-0 test type
export const ENEMY_TYPES = Object.freeze([ENEMY_TYPE]); // allow-list (one kind)
export const MAX_ENEMIES = 8; // defense in depth; far above any real Enemy-0 count (the proof uses 1)

export const DEFAULT_MAX_HEALTH = 3; // strikes to defeat the sentinel
export const MIN_MAX_HEALTH = 1;
export const MAX_MAX_HEALTH = 50; // bound a hostile/corrupt save's health
export const HIT_DAMAGE = 1; // damage one strike deals
export const HIT_REACT_TIME = 0.3; // seconds the hit-react state lasts before returning to idle

// The enemy's discrete logical state. The snapshot reports THIS (not the animated transform), so a
// fixed strike/tick sequence yields an identical summary.
export const ENEMY_STATE = Object.freeze({
  IDLE: "idle",
  HIT_REACT: "hit-react",
  DEFEATED: "defeated",
});

export function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

/** Read a {x,y,z}-like into a finite {x,y,z}, or null when any component is non-finite. */
export function finiteVec3(value) {
  if (!value || typeof value !== "object") return null;
  const x = Number(value.x);
  const y = Number(value.y);
  const z = Number(value.z);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { x, y, z } : null;
}

/** Clamp an untrusted maxHealth to a sane finite integer range, defaulting when non-finite. */
export function clampMaxHealth(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_MAX_HEALTH;
  return Math.max(MIN_MAX_HEALTH, Math.min(MAX_MAX_HEALTH, Math.round(n)));
}

// Build the runtime state for one enemy. A non-positive starting health spawns DEFEATED (a downed
// enemy restored from a save); otherwise IDLE at full health. Frozen so callers can't mutate state
// in place — transitions return new objects (immutability).
export function createEnemyState({ health = DEFAULT_MAX_HEALTH, maxHealth = DEFAULT_MAX_HEALTH } = {}) {
  const max = clampMaxHealth(maxHealth);
  const hp = isFiniteNumber(health) ? Math.max(0, Math.min(max, health)) : max;
  return Object.freeze({
    state: hp <= 0 ? ENEMY_STATE.DEFEATED : ENEMY_STATE.IDLE,
    health: hp,
    maxHealth: max,
    reactTimer: 0,
  });
}
