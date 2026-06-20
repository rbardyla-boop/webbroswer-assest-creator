// Combat-0 value types + constants. PURE data — no THREE, no scene, no wall-clock, no RNG.
// A StrikeEvent is a plain, finite-guarded snapshot so event summaries are deterministic under
// fixed input/state (compared directly in the regression). The combat seam reads the active
// equipped weapon and emits exactly one of these per use; a future Enemy-0 consumes StrikeEvent.hit.

export const MAX_RANGE = 50; // metres a hitscan strike reaches before it misses
export const USE_WEAPON_INPUT = "Mouse0"; // input edge that fires the active weapon (left mouse button)
export const COMBAT_TARGET_NAME = "combat_target_dummy"; // reserved WorldObject name = an inert hit target

export function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

/** True when `v` is a length-3 array of finite numbers. */
export function isFiniteVec3(v) {
  return Array.isArray(v) && v.length === 3 && v.every(isFiniteNumber);
}

/** Read a THREE.Vector3-like (or array) into a plain finite [x,y,z], or null if non-finite. */
export function toVec3Array(v) {
  if (Array.isArray(v)) return isFiniteVec3(v) ? [v[0], v[1], v[2]] : null;
  if (v && isFiniteNumber(v.x) && isFiniteNumber(v.y) && isFiniteNumber(v.z)) return [v.x, v.y, v.z];
  return null;
}

// Build a finite-guarded StrikeEvent, or null when any required component is non-finite (safety —
// no NaN rays, muzzle, or impact points ever leave this factory). `hit` is null on a miss; a hit
// with any non-finite field rejects the whole event. No timestamp, so identical state → identical
// event (determinism).
export function createStrikeEvent({ weaponId, weaponRecipeId, origin, direction, muzzle, hit }) {
  if (!weaponId) return null;
  const o = toVec3Array(origin);
  const d = toVec3Array(direction);
  const m = toVec3Array(muzzle);
  if (!o || !d || !m) return null;

  let cleanHit = null;
  if (hit) {
    const point = toVec3Array(hit.point);
    const normal = toVec3Array(hit.normal);
    if (!hit.targetId || !point || !normal || !isFiniteNumber(hit.distance)) return null;
    cleanHit = { targetId: hit.targetId, point, normal, distance: hit.distance };
  }

  return {
    weaponId,
    weaponRecipeId: weaponRecipeId ?? null,
    origin: o,
    direction: d,
    muzzle: m,
    hit: cleanHit,
  };
}
