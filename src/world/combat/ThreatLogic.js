// Combat-1 enemy threat feasibility — PURE math + a small entry-trigger state machine. No THREE, no scene,
// no wall-clock, no RNG (so a fixed input yields an identical result, compared directly in the regression).
//
// This is the REVERSE direction of CombatRuntime (which owns player→enemy weapon strikes): here an enemy
// puts bounded, readable, reload-safe PRESSURE on the player. The model is deliberately minimal — a
// feasibility seam, NOT a combat system: an enemy telegraphs a danger window (an inner radius of its
// encounter zone); the player CROSSING into that window fires ONE non-lethal feedback event; a cooldown
// blocks re-fire spam; a defeated enemy never fires. There is no health, death, projectile, chase, or wave
// here — this module only decides WHEN a single bounded event fires. The feedback itself (camera shake,
// audio cue, warning overlay, a small terrain-clamped knockback) is the runtime's job; this stays pure.

export const THREAT_DANGER_FACTOR = 0.5; // danger radius = this fraction of the encounter zone (always inside it)
export const THREAT_COOLDOWN = 2.5; // seconds — minimum spacing between two threat events from one enemy
export const THREAT_KNOCKBACK = 0.6; // metres — the capped, terrain-clamped stagger push away from the enemy
export const THREAT_SHAKE = 0.4; // seconds — how long the camera-shake feedback lasts

/**
 * The inner danger radius for an encounter zone: a fixed fraction of the zone radius, so the danger window is
 * always strictly inside the zone (the player can stand in the outer zone safely and SEE the telegraph before
 * crossing in). Bounded 0 ≤ r ≤ zoneRadius; a non-positive/non-finite zone yields 0 (dormant — no window).
 */
export function threatDangerRadius(zoneRadius) {
  if (!Number.isFinite(zoneRadius) || zoneRadius <= 0) return 0;
  return Math.min(zoneRadius, Math.max(0, zoneRadius * THREAT_DANGER_FACTOR));
}

/** Inclusive planar-disk test: is the player within the danger radius? A non-positive radius is never inside. */
export function inDangerWindow(distance, dangerRadius) {
  if (!Number.isFinite(distance) || !Number.isFinite(dangerRadius) || dangerRadius <= 0) return false;
  return distance <= dangerRadius;
}

/** Fresh per-enemy threat state: ready to fire, nothing latched. Transient — never persisted to the document. */
export function createThreatState() {
  return { cooldownLeft: 0, inWindowPrev: false };
}

/**
 * Advance one enemy's threat state by `dt`, given whether the player is in the danger window this frame and
 * whether the enemy is defeated. Returns the next state + a `fired` edge.
 *
 * Rising-edge + cooldown gate: the event fires only on the frame the player CROSSES INTO the window
 * (`inWindow && !inWindowPrev`), only when alive, and only when the cooldown has elapsed. Firing arms the
 * cooldown. Standing inside (`inWindowPrev` stays true) never re-fires; rapid exit/re-entry is blocked by the
 * cooldown; a fresh enter only re-fires once the cooldown has run down. A defeated enemy never fires and never
 * latches in-window (so it can never become "armed"). Every output is finite + bounded [0, THREAT_COOLDOWN].
 */
export function stepThreat(state, { inWindow = false, defeated = false, dt = 0 } = {}) {
  const prevCd = Number.isFinite(state?.cooldownLeft) ? Math.max(0, state.cooldownLeft) : 0;
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const cooldownLeft = Math.max(0, prevCd - step);
  const prevIn = !!state?.inWindowPrev;
  const live = !defeated;
  const fired = live && !!inWindow && !prevIn && cooldownLeft <= 0;
  return {
    next: {
      cooldownLeft: fired ? THREAT_COOLDOWN : cooldownLeft,
      inWindowPrev: live && !!inWindow,
    },
    fired,
  };
}

/**
 * Presentation selection (NOT the threat state machine — it does not gate firing). Among the threatening
 * enemies the player is near, pick the ONE whose danger ring should read as PROMINENT: the nearest alive
 * enemy whose OUTER encounter zone the player is currently in. Returns its id, or null when none qualify
 * (no enemy in zone / all defeated / no finite distance). Deterministic — a tie breaks toward the smaller id
 * so a fixed scene is stable. Lets overlapping danger rings de-noise to a single clear ring at a mixed gate.
 * @param {Array<{id:any, distance:number, inOuterZone:boolean, defeated:boolean}>} entries
 */
export function pickProminent(entries) {
  if (!Array.isArray(entries)) return null;
  let bestId = null;
  let bestDist = Infinity;
  for (const e of entries) {
    if (!e || e.defeated || !e.inOuterZone) continue;
    const d = e.distance;
    if (!Number.isFinite(d)) continue;
    const better = bestId === null || d < bestDist || (d === bestDist && String(e.id) < String(bestId));
    if (better) {
      bestDist = d;
      bestId = e.id;
    }
  }
  return bestId;
}
