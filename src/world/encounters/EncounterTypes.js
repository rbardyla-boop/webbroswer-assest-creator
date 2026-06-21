// Encounter Editor-0 value types + normalization. PURE data — no THREE, no scene, no wall-clock, no RNG.
//
// An "encounter" is an AUTHORED combat beat: a placed descriptor that, in play, projects ONE reactive
// enemy (Enemy-0) the player defeats via the Combat-0 hitscan to complete it. This module is the
// validation boundary the world calls on an untrusted `encounters` block (from a save file): it
// whitelists type/id/position/radius/enemyType/enemyCount/completed/persistCompletion/label and DROPS
// anything that can't yield a valid encounter. A non-finite position REJECTS the encounter rather than
// relocating it to the origin (mirrors the objective cache rule); an enemyType outside the Enemy-0
// allow-list REJECTS it (the editor must never author an enemy the runtime can't spawn). It is NOT an
// encounter system: one beat type, exactly one enemy, no waves / loot / AI / scripting.
//
// Content-1 adds `label` — an optional authored display string naming the beat's location so the
// presentation banner reads correctly per beat ("guards the crossing" vs "guards the pass"). It is the
// ONLY new field; it changes no combat/runtime behaviour (presentation text only).

import { ENEMY_TYPES } from "../enemies/EnemyTypes.js";
import { normalizePatrol } from "../enemies/PatrolTypes.js";

export const ENCOUNTER_TYPE = "combat-beat.v0"; // the single Encounter-0 beat type
export const ENCOUNTER_TYPES = Object.freeze([ENCOUNTER_TYPE]); // allow-list (one kind)
export const MAX_ENCOUNTERS = 16; // defense in depth; far above any real Encounter-0 count (the proof uses 1)

export const RADIUS_MIN = 1;
export const RADIUS_MAX = 40;
export const DEFAULT_RADIUS = 6;
export const MAX_LABEL_LENGTH = 48; // a banner location label, not prose
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
 * Sanitize the optional authored banner label (display text). Untrusted (it comes from a save file too),
 * so strip — defense in depth, the banner renders via textContent — markup angle-brackets, C0 control
 * chars + DEL, and Unicode bidi-override / zero-width / BOM formatting (which could cosmetically reorder
 * or hide banner text). Then trim + cap length. Empty/non-string → null (the banner falls back to a
 * neutral noun). Ordinary spaces + printable Unicode (e.g. emoji) are preserved.
 */
export function sanitizeLabel(value) {
  if (typeof value !== "string") return null;
  // <> markup · C0 controls + DEL · zero-width/LRM/RLM 200B-200F · bidi embed/override 202A-202E · bidi
  // isolates 2066-2069 · BOM FEFF (all \u escapes → the source stays plain ASCII, never a binary file).
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[<>\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "").trim().slice(0, MAX_LABEL_LENGTH);
  return cleaned.length ? cleaned : null;
}

/**
 * Normalize one untrusted encounter descriptor, or null if it can't yield a valid encounter.
 * Whitelists exactly { type, id, position, radius, enemyType, enemyCount, completed, persistCompletion,
 * label, patrol }; unknown keys are dropped.
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
    // Content-1: the optional banner location label (presentation only). ALWAYS emit the key (a string
    // or null) so the absence round-trips stably; the banner falls back to a neutral noun when null.
    label: sanitizeLabel(item.label),
    // Enemy-1: the optional bounded patrol the beat's sentinel walks (structural validation only — the
    // terrain-safe resolve happens at spawn). ALWAYS emit the key (the normalized object or null) so the
    // absence round-trips stably; null leaves the sentinel stationary (Enemy-0 byte-stable).
    patrol: normalizePatrol(item.patrol),
  };
}
