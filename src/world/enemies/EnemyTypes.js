// Enemy value types + constants. PURE data — no THREE, no scene, no wall-clock, no RNG.
// An enemy is a reactive COMBAT TARGET with a tiny finite state machine (idle / hit-react /
// defeated). Its state is a plain, finite-guarded, immutable snapshot so summaries are
// deterministic under fixed input/state (compared directly in the regression). An enemy consumes
// the Combat-0 StrikeEvent — it is NOT an AI: no chase, attacks, loot, waves, inventory, or
// projectiles.
//
// Enemy-2 adds a SECOND archetype (`frost_wisp`) beside the original `glacial_sentinel`. The two
// share the same FSM, the same Combat-0 hit path, and the same encounter projection — they differ
// only in DATA: health, movement profile, silhouette, and feedback. That data lives in
// ENEMY_ARCHETYPES below (pure — colours are hex numbers, sizes are scalars; the THREE mesh +
// material are built by EnemyRuntime from this data, never here).

export const ENEMY_TYPE = "glacial_sentinel"; // the original (heavier, grounded) type
export const SENTINEL_TYPE = ENEMY_TYPE; // explicit alias for archetype call-sites
export const WISP_TYPE = "frost_wisp"; // Enemy-2: the lighter, floating type
export const ENEMY_TYPES = Object.freeze([SENTINEL_TYPE, WISP_TYPE]); // allow-list (sentinel first, order stable)
export const MAX_ENEMIES = 8; // defense in depth; far above any real encounter count (the proofs use 1–2)

export const DEFAULT_MAX_HEALTH = 3; // strikes to defeat the sentinel (the heavier archetype)
export const MIN_MAX_HEALTH = 1;
export const MAX_MAX_HEALTH = 50; // bound a hostile/corrupt save's health
export const HIT_DAMAGE = 1; // damage one strike deals
export const HIT_REACT_TIME = 0.3; // seconds the hit-react state lasts before returning to idle

// Movement profile an archetype's idle motion overlay uses (EnemyRuntime dispatches on this):
//   "ground" — grounded; idle bob in place; supports an authored ground patrol (Enemy-1).
//   "hover"  — floats; bounded deterministic drift around home; the wisp. Ignores ground patrol.
export const MOVEMENT_GROUND = "ground";
export const MOVEMENT_HOVER = "hover";

// Per-archetype DATA — the single source of truth for health / movement / silhouette / feedback.
// PURE: feedback colours are hex numbers, sizes are scalars; EnemyRuntime/EnemyFeedback consume it.
// The sentinel's feedback values are EXACTLY the legacy EnemyFeedback constants, so the original
// enemy stays byte-identical (a regression pins this). `flickerAmp:0` means no idle shimmer.
export const ENEMY_ARCHETYPES = Object.freeze({
  [SENTINEL_TYPE]: Object.freeze({
    type: SENTINEL_TYPE,
    maxHealth: DEFAULT_MAX_HEALTH, // heavier (3 strikes)
    movement: MOVEMENT_GROUND,
    silhouette: "sentinel", // EnemyRuntime mesh-builder key
    feedback: Object.freeze({
      baseEmissive: 0.25, // == legacy BASE_EMISSIVE_INTENSITY
      flashIntensity: 1.5, // == legacy FLASH_INTENSITY
      defeatColor: 0x39424d, // == legacy DEFEAT_COLOR
      defeatEmissive: 0.12, // == legacy DEFEAT_EMISSIVE_INTENSITY
      flickerAmp: 0, // no idle flicker (byte-stable)
      flickerSpeed: 0,
    }),
  }),
  [WISP_TYPE]: Object.freeze({
    type: WISP_TYPE,
    maxHealth: 2, // lighter (2 strikes)
    movement: MOVEMENT_HOVER,
    silhouette: "wisp",
    feedback: Object.freeze({
      baseEmissive: 0.9, // glows brighter at rest than the sentinel
      flashIntensity: 2.4, // a sharper "burst" on a strike
      defeatColor: 0x223044, // cold, near-extinguished
      defeatEmissive: 0.04, // dims out on defeat (vs the sentinel's desaturated slump)
      flickerAmp: 0.28, // idle shimmer (a living spirit-light)
      flickerSpeed: 7.0,
    }),
    // Bounded hover overlay (EnemyRuntime owns the motion; these are the envelope constants).
    hover: Object.freeze({
      radius: 1.4, // metres of planar drift around home (provably bounded below this)
      height: 1.6, // metres the body floats above the grounded spawn
      bobAmp: 0.35, // metres of vertical bob
      driftSpeed: 0.6, // drift angular rate
    }),
  }),
});

/** The archetype descriptor for a type, falling back to the sentinel for any unknown type. */
export function archetypeFor(type) {
  return ENEMY_ARCHETYPES[type] ?? ENEMY_ARCHETYPES[SENTINEL_TYPE];
}

/** The authored default max-health for a type (the archetype's value; sentinel=3, wisp=2). */
export function defaultMaxHealthFor(type) {
  return archetypeFor(type).maxHealth;
}

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

/**
 * Clamp an untrusted maxHealth to a sane finite integer range, defaulting when non-finite. The
 * fallback defaults to DEFAULT_MAX_HEALTH (existing callers unchanged); the validator passes the
 * per-archetype default so an authored wisp without a health field is lighter, not sentinel-heavy.
 */
export function clampMaxHealth(value, fallback = DEFAULT_MAX_HEALTH) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
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
