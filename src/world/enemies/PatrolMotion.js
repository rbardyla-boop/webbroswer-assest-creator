// Enemy-1 patrol motion. PURE — deterministic given (motion, resolved patrol, dt): no THREE, no scene,
// no wall-clock, no randomness. The runtime owns the motion state object and calls advancePatrol each
// frame; the EncounterRuntime owns the resolved patrol (grounded, terrain-safe, radius-bounded points).
//
// The body walks the route at the patrol's ground speed, dwells `pauseSec` at each point, then advances:
// ping-pong along the line (loop:false) or cycles (loop:true). Y is interpolated linearly between the two
// grounded endpoints — the resolve gate keeps points on walkable, low-slope ground, so the seam stays on
// the surface. Because every reported position is a convex blend of two in-zone points, motion is provably
// BOUNDED to the encounter radius (a disk is convex).

/** Initial motion state. Starts moving from point 0 toward point 1, no dwell. */
export function createPatrolMotion() {
  return { i: 0, t: 0, dir: 1, pauseLeft: 0 };
}

function planarDist(a, b) {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function lerp(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

// The next index to walk toward from `i`. loop:true cycles forward; otherwise ping-pong in `dir` (the
// caller flips dir at the ends on arrival). The clamps are defense in depth — with dir managed, i+dir
// stays in range.
function nextIndex(i, dir, n, loop) {
  if (loop) return (i + 1) % n;
  let j = i + dir;
  if (j >= n) j = n - 2;
  if (j < 0) j = 1;
  return j;
}

/**
 * Advance one frame. Returns a NEW motion state + the current position (fresh objects — never mutates the
 * inputs). Fewer than 2 points → holds at the only point. A non-finite/negative dt is treated as 0 (a bad
 * frame never writes NaN). The returned position is always on or between two resolved points.
 * @param {{i:number,t:number,dir:number,pauseLeft:number}} motion
 * @param {{points:Array<{x:number,y:number,z:number}>, speed:number, pauseSec:number, loop:boolean}} resolved
 * @param {number} dt
 * @returns {{ motion: object, position: {x:number,y:number,z:number} }}
 */
export function advancePatrol(motion, resolved, dt) {
  const pts = resolved?.points;
  if (!Array.isArray(pts) || pts.length === 0) {
    return { motion, position: { x: 0, y: 0, z: 0 } };
  }
  const n = pts.length;
  const i = Number.isInteger(motion?.i) && motion.i >= 0 && motion.i < n ? motion.i : 0;
  if (n < 2) return { motion: { i: 0, t: 0, dir: 1, pauseLeft: 0 }, position: { ...pts[0] } };

  const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
  let { t, dir, pauseLeft } = motion;
  t = Number.isFinite(t) ? t : 0;
  dir = dir === -1 ? -1 : 1;
  pauseLeft = Number.isFinite(pauseLeft) ? pauseLeft : 0;

  // Dwelling at the current point.
  if (pauseLeft > 0) {
    return { motion: { i, t: 0, dir, pauseLeft: Math.max(0, pauseLeft - step) }, position: { ...pts[i] } };
  }

  const target = nextIndex(i, dir, n, resolved.loop === true);
  const from = pts[i];
  const to = pts[target];
  const segLen = planarDist(from, to) || 1e-6;
  const speed = Number.isFinite(resolved.speed) && resolved.speed > 0 ? resolved.speed : 0;
  const nt = t + (speed * step) / segLen;

  if (nt >= 1) {
    // Arrived at the target: snap there, arm the dwell, advance the index (flip dir at the ends).
    let ndir = dir;
    if (resolved.loop !== true) {
      if (target === n - 1) ndir = -1;
      else if (target === 0) ndir = 1;
    }
    const pause = Number.isFinite(resolved.pauseSec) && resolved.pauseSec > 0 ? resolved.pauseSec : 0;
    return { motion: { i: target, t: 0, dir: ndir, pauseLeft: pause }, position: { ...pts[target] } };
  }

  return { motion: { i, t: nt, dir, pauseLeft: 0 }, position: lerp(from, to, nt) };
}
