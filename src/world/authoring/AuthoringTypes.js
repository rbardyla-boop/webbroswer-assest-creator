// Procedural authoring descriptor types + normalization (Procedural Authoring-1). The
// `authoring` block holds editable SPLINES (a 3..8 point path), MASKS (a circle/box
// influence area), and MODIFIERS that consume a spline (+ optional mask) to derive a
// non-destructive runtime result (currently a beacon trail). This module is the
// validation boundary the world calls on an untrusted `authoring` block (from a save
// file): it whitelists every field, drops anything that can't yield a valid primitive,
// and caps the list sizes. Pure data — no THREE, no scene, no seeded derivation (that
// lives in BeaconTrailModifier). The block is the source of truth; the visuals are
// rebuilt from it each load (the runtimeAssets idiom), never baked into `objects`.

export const MASK_SHAPES = Object.freeze(["circle", "box"]);
export const MODIFIER_TYPES = Object.freeze(["beacon-trail"]);

export const AUTHORING_LIMITS = Object.freeze({
  MAX_SPLINES: 16, // defense in depth; far above any real authored count
  MAX_MASKS: 16,
  MAX_MODIFIERS: 16,
  MIN_SPLINE_POINTS: 3,
  MAX_SPLINE_POINTS: 8,
  MASK_RADIUS_MIN: 0.5,
  MASK_RADIUS_MAX: 200, // ~terrain/3.5; bounds a hostile mask from spanning the world
  MASK_HALF_MIN: 0.5,
  MASK_HALF_MAX: 200,
  MAX_MARKERS: 64, // per modifier; the derived trail can place at most this many markers
  MARKER_SCALE_MIN: 0.1,
  MARKER_SCALE_MAX: 10,
});

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max, fallback) {
  const n = num(value, fallback);
  return Math.max(min, Math.min(max, n));
}

function clamp01(value, fallback = 0) {
  return Math.max(0, Math.min(1, num(value, fallback)));
}

function clampInt(value, min, max, fallback) {
  return Math.max(min, Math.min(max, Math.round(num(value, fallback))));
}

// A finite {x,y,z}, or null. A null vector DROPS the whole descriptor — it is never
// silently relocated to the origin (the same discipline ObjectiveTypes uses for cache).
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

function sanitizeName(value, fallback) {
  return typeof value === "string" && value.trim().length ? value.slice(0, 80) : fallback;
}

/**
 * Normalize one untrusted spline descriptor, or null if it can't yield a valid path.
 * Drops the spline if ANY point is non-finite; enforces the 3..8 point count (too many
 * points are clamped to the first MAX, too few drops the spline).
 * @param {unknown} item
 */
export function normalizeSplineDescriptor(item) {
  if (!item || typeof item !== "object") return null;
  const rawPoints = Array.isArray(item.points) ? item.points : [];
  const points = rawPoints.map(finiteVec3);
  // Any non-finite point poisons the path → drop the whole spline (no silent repair).
  if (points.some((p) => p === null)) return null;
  if (points.length < AUTHORING_LIMITS.MIN_SPLINE_POINTS) return null;
  const capped = points.slice(0, AUTHORING_LIMITS.MAX_SPLINE_POINTS);
  return {
    id: sanitizeId(item.id, "spline"),
    name: sanitizeName(item.name, "Spline"),
    // ALWAYS emit the booleans so falsey survives save→load (never conditional emission).
    enabled: item.enabled !== false,
    locked: item.locked === true,
    points: capped,
    tension: clamp01(item.tension, 0.5),
    closed: item.closed === true,
  };
}

/**
 * Normalize one untrusted mask descriptor, or null if it can't yield a valid area.
 * Circle requires a finite center + positive radius; box requires finite center +
 * positive half-extents. Non-finite geometry drops the mask.
 * @param {unknown} item
 */
export function normalizeMaskDescriptor(item) {
  if (!item || typeof item !== "object") return null;
  const center = finiteVec3(item.center);
  if (!center) return null; // non-finite center → drop the mask
  const shape = MASK_SHAPES.includes(item.shape) ? item.shape : "circle";
  if (shape === "circle") {
    const radius = num(item.radius, NaN);
    if (!Number.isFinite(radius) || radius <= 0) return null; // a zero/negative radius is no area
  } else {
    const hx = num(item.half?.x, NaN);
    const hz = num(item.half?.z, NaN);
    if (!Number.isFinite(hx) || !Number.isFinite(hz) || hx <= 0 || hz <= 0) return null;
  }
  return {
    id: sanitizeId(item.id, "mask"),
    name: sanitizeName(item.name, "Mask"),
    enabled: item.enabled !== false,
    locked: item.locked === true,
    shape,
    center,
    radius: clamp(item.radius, AUTHORING_LIMITS.MASK_RADIUS_MIN, AUTHORING_LIMITS.MASK_RADIUS_MAX, AUTHORING_LIMITS.MASK_RADIUS_MIN),
    half: {
      x: clamp(item.half?.x, AUTHORING_LIMITS.MASK_HALF_MIN, AUTHORING_LIMITS.MASK_HALF_MAX, AUTHORING_LIMITS.MASK_HALF_MIN),
      z: clamp(item.half?.z, AUTHORING_LIMITS.MASK_HALF_MIN, AUTHORING_LIMITS.MASK_HALF_MAX, AUTHORING_LIMITS.MASK_HALF_MIN),
    },
    // 0 = hard edge, 1 = full gradient from center to edge (consumed by the modifier).
    falloff: clamp01(item.falloff, 0),
  };
}

/**
 * Normalize one untrusted modifier descriptor, or null if it can't yield a valid result.
 * A modifier MUST reference a spline by id (the path it follows); the mask id is optional
 * (when present it gates the trail to the influence area). Cross-references are validated
 * SYNTACTICALLY here (clean id strings) and RESOLVED at runtime — a dangling reference is
 * skipped by the runtime, not dropped here (the validator can't see the other arrays).
 * @param {unknown} item
 */
export function normalizeModifierDescriptor(item) {
  if (!item || typeof item !== "object" || !MODIFIER_TYPES.includes(item.type)) return null;
  const splineId = sanitizeId(item.splineId, null);
  if (!splineId) return null; // a modifier with no path is meaningless
  return {
    id: sanitizeId(item.id, "modifier"),
    name: sanitizeName(item.name, "Beacon trail"),
    enabled: item.enabled !== false,
    type: item.type,
    splineId,
    maskId: sanitizeId(item.maskId, null), // nullable — optional gating area
    // Stable seed string for the derived layout (FNV-1a hashed at runtime). Falls back to
    // the modifier id so the trail is still deterministic when no explicit seed is set.
    seed: sanitizeId(item.seed, null) ?? sanitizeId(item.id, "modifier"),
    markerCount: clampInt(item.markerCount, 1, AUTHORING_LIMITS.MAX_MARKERS, 8),
    markerScale: clamp(item.markerScale, AUTHORING_LIMITS.MARKER_SCALE_MIN, AUTHORING_LIMITS.MARKER_SCALE_MAX, 1),
    ring: item.ring !== false, // draw the mask ground-ring (default on)
  };
}

/**
 * Sanitize the whole `authoring` block for the WorldDocument validator. Produces ZERO
 * warnings on an empty/default block (the editor + proofs depend on a clean empty world).
 */
export function sanitizeAuthoringBlock(block, warnings = null) {
  const src = block && typeof block === "object" ? block : {};
  const splines = sanitizeList(src.splines, AUTHORING_LIMITS.MAX_SPLINES, normalizeSplineDescriptor, "Splines", warnings);
  const masks = sanitizeList(src.masks, AUTHORING_LIMITS.MAX_MASKS, normalizeMaskDescriptor, "Masks", warnings);
  const modifiers = sanitizeList(src.modifiers, AUTHORING_LIMITS.MAX_MODIFIERS, normalizeModifierDescriptor, "Modifiers", warnings);
  return { version: Math.max(1, Math.floor(num(src.version, 1))), splines, masks, modifiers };
}

function sanitizeList(value, cap, normalize, label, warnings) {
  const items = Array.isArray(value) ? value : [];
  if (items.length > cap && warnings) {
    warnings.push(`Authoring ${label} had ${items.length} items; only the first ${cap} were kept.`);
  }
  return items.slice(0, cap).map(normalize).filter(Boolean);
}

// --- editor factories (single source of default shapes; output passes the normalizers) -----

/** A fresh spline descriptor from the given control points (the editor assigns the id). */
export function createSpline({ id, name, points = [] } = {}) {
  return normalizeSplineDescriptor({
    id,
    name,
    points,
    enabled: true,
    locked: false,
    tension: 0.5,
    closed: false,
  });
}

/** A fresh mask descriptor (circle by default) centered at the given point. */
export function createMask({ id, name, shape = "circle", center = { x: 0, y: 0, z: 0 }, radius = 12, half = { x: 12, z: 12 }, falloff = 0.4 } = {}) {
  return normalizeMaskDescriptor({ id, name, shape, center, radius, half, falloff, enabled: true, locked: false });
}

/** A fresh beacon-trail modifier binding a spline (+ optional mask). */
export function createModifier({ id, name, splineId, maskId = null, seed, markerCount = 8, markerScale = 1, ring = true } = {}) {
  return normalizeModifierDescriptor({
    id,
    name,
    type: "beacon-trail",
    splineId,
    maskId,
    seed,
    markerCount,
    markerScale,
    ring,
    enabled: true,
  });
}
