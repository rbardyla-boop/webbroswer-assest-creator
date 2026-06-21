// Enemy-3 light proximity response — PURE math. No THREE, no scene, no wall-clock, no RNG (so a fixed
// input yields an identical result, compared directly in the regression).
//
// Enemies feel AWARE of the player — orient/lean toward the player, bias the hover drift — WITHOUT any
// combat escalation: no attacks, damage, chase, pathfinding, navmesh, waves, or director. Every output is
// BOUNDED (turn ≤ maxStep, bias ≤ maxBias, lean ≤ maxLean) and is a presentation/motion overlay: the runtime
// writes it to the animated TRANSFORM only, never to logical state, so the deterministic snapshot is
// unaffected. The response is dormant unless the enemy is alive, inside its encounter zone, and not mid
// hit-react — `proximityActive` is the single gate, so a world without encounters (no zone) gets nothing.

const TWO_PI = Math.PI * 2;
const BIAS_RANGE = 4; // metres — the falloff scale for the hover bias (closer ⇒ stronger, always ≤ maxBias)

/** Yaw (radians) pointing from (fromX,fromZ) toward (toX,toZ). Matches the runtime's atan2(dx,dz) facing. */
export function bearingTo(fromX, fromZ, toX, toZ) {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return 0;
  if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return 0; // coincident → no defined bearing
  return Math.atan2(dx, dz);
}

/** Signed shortest angular difference (target - current), wrapped to (-π, π]. */
function angleDelta(current, target) {
  let d = (target - current) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d <= -Math.PI) d += TWO_PI;
  return d;
}

/**
 * Turn `currentYaw` toward `targetYaw` along the SHORTEST angular path, clamped to `maxStep` radians per
 * call (the max turn rate). Idempotent once within `maxStep` of the target (snaps, never overshoots/spins).
 * A non-finite input or non-positive maxStep is a safe no-op (returns currentYaw, or 0 if that is non-finite).
 */
export function stepYaw(currentYaw, targetYaw, maxStep) {
  if (!Number.isFinite(currentYaw)) return 0;
  if (!Number.isFinite(targetYaw)) return currentYaw;
  const step = Number.isFinite(maxStep) && maxStep > 0 ? maxStep : 0;
  const d = angleDelta(currentYaw, targetYaw);
  if (Math.abs(d) <= step) return targetYaw; // within reach → snap (idempotent at the target)
  return currentYaw + Math.sign(d) * step;
}

/**
 * A bounded planar bias the hover drift adds relative to the player: a gentle "keep its distance" push AWAY
 * from the player, scaled by proximity (stronger when closer), with magnitude PROVABLY ≤ `maxBias` (the
 * falloff factor `BIAS_RANGE/(d+BIAS_RANGE)` ∈ (0,1]). Returns {x:0,z:0} when coincident/non-finite or
 * `maxBias` ≤ 0. The runtime adds this BEFORE its zone clamp, so the total offset still stays in-zone.
 */
export function hoverBias(actorX, actorZ, playerX, playerZ, maxBias) {
  const cap = Number.isFinite(maxBias) && maxBias > 0 ? maxBias : 0;
  const dx = actorX - playerX; // away from the player
  const dz = actorZ - playerZ;
  const d = Math.hypot(dx, dz);
  if (cap === 0 || !Number.isFinite(d) || d < 1e-6) return { x: 0, z: 0 };
  const strength = cap * (BIAS_RANGE / (d + BIAS_RANGE)); // ∈ (0, cap] — closer ⇒ stronger, capped
  return { x: (dx / d) * strength, z: (dz / d) * strength };
}

/** Forward-lean scalar ∈ [0, maxLean]: 0 at/beyond the zone edge, growing as the player nears the centre. */
export function leanAmount(distance, radius, maxLean) {
  const cap = Number.isFinite(maxLean) && maxLean > 0 ? maxLean : 0;
  if (cap === 0 || !Number.isFinite(distance) || !Number.isFinite(radius) || radius <= 0) return 0;
  const t = 1 - Math.max(0, Math.min(1, distance / radius)); // 1 at the centre, 0 at the edge
  return cap * t;
}

/**
 * The single dormancy gate. Respond only when the enemy CAN (has an encounter zone), the player is in that
 * zone, the enemy is alive, and it is not mid hit-react (so combat feedback always wins). A world without
 * encounters has no zone → never active.
 */
export function proximityActive({ hasZone = false, inZone = false, defeated = false, reacting = false } = {}) {
  return !!hasZone && !!inZone && !defeated && !reacting;
}
