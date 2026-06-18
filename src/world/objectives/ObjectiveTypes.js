// Objective descriptor types + normalization (FP-1). An "objective" is a single
// purpose-built gameplay goal the world persists across reload — currently the relic-weapon
// retrieval objective. This module is the validation boundary the world calls on an untrusted
// `objectives` block (from a save file): it whitelists kind/id/relicId/cache/radius/completed
// and drops anything that can't yield a valid objective. It is NOT a quest engine — one
// objective kind. Pure data; no THREE, no scene.

export const OBJECTIVE_KINDS = Object.freeze(["relic-weapon.fp1"]);
export const MAX_OBJECTIVES = 8; // defense in depth; far above any real count (FP-1 uses 1)
const RADIUS_MIN = 1;
const RADIUS_MAX = 40;

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampRadius(value) {
  return Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, num(value, 4)));
}

// A cache point is a finite {x,y,z} or null. A null cache DROPS the whole objective — it is
// never silently relocated to the origin, which would make the zone uncompletable-by-walking.
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
 * Normalize one untrusted objective descriptor, or null if it can't yield a valid objective.
 * @param {unknown} item
 */
export function normalizeObjectiveDescriptor(item) {
  if (!item || typeof item !== "object" || !OBJECTIVE_KINDS.includes(item.kind)) return null;
  const cache = finiteVec3(item.cache);
  if (!cache) return null; // non-finite cache → drop the objective (no origin fallback)
  const relicId = sanitizeId(item.relicId, null);
  if (!relicId) return null; // an objective with no relic link is meaningless
  return {
    kind: item.kind,
    id: sanitizeId(item.id, item.kind),
    relicId,
    cache,
    radius: clampRadius(item.radius),
    // Boolean — ALWAYS emit the key so `false` survives save→load (read back on reload to
    // restore the completed phase). Never `item.completed ?? ...` / conditional emission.
    completed: item.completed === true,
  };
}

/**
 * Sanitize the whole `objectives` block for the WorldDocument validator. Produces ZERO
 * warnings on an empty/default block (existing zero-warning assertions depend on this).
 */
export function sanitizeObjectivesBlock(block, warnings = null) {
  const src = block && typeof block === "object" ? block : {};
  const items = Array.isArray(src.items) ? src.items : [];
  if (items.length > MAX_OBJECTIVES && warnings) {
    warnings.push(`Objectives had ${items.length} items; only the first ${MAX_OBJECTIVES} were kept.`);
  }
  const safe = items.slice(0, MAX_OBJECTIVES).map(normalizeObjectiveDescriptor).filter(Boolean);
  return { version: Math.max(1, Math.floor(num(src.version, 1))), items: safe };
}
