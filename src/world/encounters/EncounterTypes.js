// Encounter Editor-0 value types + normalization. PURE data — no THREE, no scene, no wall-clock, no RNG.
//
// An "encounter" is an AUTHORED combat beat: a placed descriptor that, in play, projects ONE reactive
// enemy (Enemy-0) the player defeats via the Combat-0 hitscan to complete it. This module is the
// validation boundary the world calls on an untrusted `encounters` block (from a save file): it
// whitelists type/id/position/radius/enemyType/enemyCount/completed/persistCompletion and DROPS anything
// that can't yield a valid encounter. A non-finite position REJECTS the encounter rather than relocating
// it to the origin (mirrors the objective cache rule); an enemyType outside the Enemy-0 allow-list
// REJECTS it (the editor must never author an enemy the runtime can't spawn). It is NOT an encounter
// system: one beat type, exactly one enemy, no waves / loot / AI / scripting.

import { ENEMY_TYPES } from "../enemies/EnemyTypes.js";

export const ENCOUNTER_TYPE = "combat-beat.v0"; // the single Encounter-0 beat type
export const ENCOUNTER_TYPES = Object.freeze([ENCOUNTER_TYPE]); // allow-list (one kind)
export const MAX_ENCOUNTERS = 16; // defense in depth; far above any real Encounter-0 count (the proof uses 1)

export const RADIUS_MIN = 1;
export const RADIUS_MAX = 40;
export const DEFAULT_RADIUS = 6;
// Encounter-0 projects EXACTLY one enemy. Stored as a field so a future "waves" bump is one line,
// but clamped to 1 here — this clamp IS the no-waves gate.
export const ENEMY_COUNT = 1;

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Clamp an untrusted radius to the sane authoring range, defaulting when non-finite. */
export function clampRadius(value) {
  return Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, num(value, DEFAULT_RADIUS)));
}

/** Clamp the authored enemy count to EXACTLY one — the Encounter-0 no-waves invariant. */
export function clampCount(_value) {
  return ENEMY_COUNT;
}

// A finite {x,y,z} or null. A null position DROPS the encounter — it is never silently relocated to the
// origin, which would make an authored beat appear in the wrong place.
function finiteVec3(value) {
  if (!value || typeof value !== "object") return null;
  const x = num(value.x, NaN);
  const y = num(value.y, NaN);
  const z = num(value.z, NaN);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { x, y, z } : null;
}

function sanitizeId(value, fallback) {
  if (typeof value === "string") {
    const cleaned = value.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64);
    if (cleaned.length) return cleaned;
  }
  return fallback;
}

/**
 * Normalize one untrusted encounter descriptor, or null if it can't yield a valid encounter.
 * Whitelists exactly { type, id, position, radius, enemyType, enemyCount, completed, persistCompletion };
 * unknown keys are dropped.
 * @param {unknown} item
 */
export function normalizeEncounterDescriptor(item) {
  if (!item || typeof item !== "object" || !ENCOUNTER_TYPES.includes(item.type)) return null;
  const position = finiteVec3(item.position);
  if (!position) return null; // non-finite transform → drop the encounter (never relocate to origin)
  // The enemy the beat projects must be one Enemy-0 can actually spawn; otherwise the beat is
  // uncompletable, so drop it (consistent with the unknown-type reject).
  if (!ENEMY_TYPES.includes(item.enemyType)) return null;
  return {
    type: item.type,
    id: sanitizeId(item.id, item.type),
    position,
    radius: clampRadius(item.radius),
    enemyType: item.enemyType,
    enemyCount: clampCount(item.enemyCount),
    // Booleans — ALWAYS emit the key so `false` survives save→load (read back on reload). `completed`
    // restores the cleared phase; `persistCompletion` (default true) decides whether completion is
    // written to disk at all. Never `item.x ?? ...` / conditional emission.
    completed: item.completed === true,
    persistCompletion: item.persistCompletion !== false,
  };
}
