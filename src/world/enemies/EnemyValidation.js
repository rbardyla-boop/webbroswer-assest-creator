// Enemy-0 validation boundary + pure state transitions. PURE (imports only the enemy value types).
//
// The world calls this on an UNTRUSTED `enemies` block (from a save file): it whitelists
// type/id/position/maxHealth/defeated and DROPS anything that can't yield a valid enemy. A
// non-finite transform rejects the enemy rather than relocating it to the origin (mirrors the
// objective cache rule). The two transitions — applyDamage / advanceState — are pure, finite-guarded,
// and deterministic: a fixed strike/tick sequence yields identical state (no wall-clock, no RNG).

import {
  ENEMY_TYPES,
  ENEMY_STATE,
  MAX_ENEMIES,
  HIT_REACT_TIME,
  isFiniteNumber,
  finiteVec3,
  clampMaxHealth,
} from "./EnemyTypes.js";

function sanitizeId(value, fallback) {
  if (typeof value === "string") {
    const cleaned = value.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64);
    if (cleaned.length) return cleaned;
  }
  return fallback;
}

/**
 * Normalize one untrusted enemy descriptor, or null if it can't yield a valid enemy.
 * Whitelists exactly { type, id, position, maxHealth, defeated }; unknown keys are dropped.
 * @param {unknown} item
 */
export function normalizeEnemyDescriptor(item) {
  if (!item || typeof item !== "object" || !ENEMY_TYPES.includes(item.type)) return null;
  const position = finiteVec3(item.position);
  if (!position) return null; // non-finite transform → drop the enemy (never relocate to origin)
  return {
    type: item.type,
    id: sanitizeId(item.id, item.type),
    position,
    maxHealth: clampMaxHealth(item.maxHealth),
    // Boolean — ALWAYS emit the key so `false` survives save→load (read back on reload to restore
    // the defeated state). Never `item.defeated ?? ...` / conditional emission.
    defeated: item.defeated === true,
  };
}

/**
 * Sanitize the whole `enemies` block for the WorldDocument validator. Produces ZERO warnings on an
 * empty/default block (existing zero-warning assertions depend on this).
 */
export function sanitizeEnemiesBlock(block, warnings = null) {
  const src = block && typeof block === "object" ? block : {};
  const items = Array.isArray(src.items) ? src.items : [];
  if (items.length > MAX_ENEMIES && warnings) {
    warnings.push(`Enemies had ${items.length} items; only the first ${MAX_ENEMIES} were kept.`);
  }
  const version = Number(src.version);
  const safe = items.slice(0, MAX_ENEMIES).map(normalizeEnemyDescriptor).filter(Boolean);
  return { version: Math.max(1, Math.floor(Number.isFinite(version) ? version : 1)), items: safe };
}

/** True when the enemy is in its terminal defeated state. */
export function isDefeated(state) {
  return state?.state === ENEMY_STATE.DEFEATED;
}

// Apply one strike's damage. PURE: returns a new frozen state. A defeated enemy is LATCHED — further
// damage is a no-op (idempotent defeat). Health clamps to [0, maxHealth]; a non-finite damage amount
// does nothing (safety). Reaching 0 health → DEFEATED; otherwise → HIT_REACT with the react timer
// armed. No timestamp/RNG → identical input yields identical output.
export function applyDamage(state, dmg) {
  if (isDefeated(state)) return state; // latched — never re-defeat or mutate a corpse
  // Defense in depth: createEnemyState/applyDamage/advanceState are the only producers and all emit
  // finite states, but guard the incoming numerics at the site so purity holds for any future caller.
  if (!isFiniteNumber(state.health) || !isFiniteNumber(state.maxHealth)) return state;
  const amount = isFiniteNumber(dmg) ? Math.max(0, dmg) : 0;
  if (amount <= 0) return state; // a non-finite / zero strike deals no damage → no reaction (safety)
  const health = Math.max(0, Math.min(state.maxHealth, state.health - amount));
  if (health <= 0) {
    return Object.freeze({ state: ENEMY_STATE.DEFEATED, health: 0, maxHealth: state.maxHealth, reactTimer: 0 });
  }
  return Object.freeze({ state: ENEMY_STATE.HIT_REACT, health, maxHealth: state.maxHealth, reactTimer: HIT_REACT_TIME });
}

// Advance the enemy's logical state by dt. PURE. HIT_REACT decays back to IDLE when its timer runs
// out; DEFEATED and IDLE are stable. A non-finite or negative dt is a no-op (safety) so a bad frame
// can never write a NaN timer.
export function advanceState(state, dt) {
  if (!isFiniteNumber(dt) || dt < 0) return state;
  if (state.state !== ENEMY_STATE.HIT_REACT) return state;
  if (!isFiniteNumber(state.reactTimer)) return state; // defense in depth: never tick a poisoned timer
  const reactTimer = state.reactTimer - dt;
  if (reactTimer <= 0) {
    return Object.freeze({ state: ENEMY_STATE.IDLE, health: state.health, maxHealth: state.maxHealth, reactTimer: 0 });
  }
  return Object.freeze({ state: ENEMY_STATE.HIT_REACT, health: state.health, maxHealth: state.maxHealth, reactTimer });
}
