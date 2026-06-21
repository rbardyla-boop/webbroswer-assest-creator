// Enemy-1 patrol value types + validation. PURE data — no THREE, no scene, no wall-clock, no
// randomness (so a fixed input yields an identical result, compared directly in the regression).
//
// A "patrol" is an AUTHORED bounded route an encounter's sentinel walks: 2–4 points, a ground speed,
// a dwell at each point, a loop/ping-pong flag, and an alert mode. It is NOT pathfinding/navmesh/chase —
// just deterministic motion along authored points, kept INSIDE the encounter zone and ON safe ground.
//
// Two boundaries live here:
//   - normalizePatrol(raw): the STRUCTURAL boundary the WorldDocument validator runs on untrusted save
//     data (whitelists points/speed/pauseSec/loop/alert/enabled; drops anything that can't yield a valid
//     patrol). No terrain here — the validator has no terrain.
//   - resolvePatrol(structural, {center, radius, terrain}): the TERRAIN-SAFE boundary the runtime runs at
//     spawn (with injected terrain samplers). It grounds each point and REJECTS the whole patrol (→ null →
//     the sentinel stays stationary) if any point leaves the zone radius or lands on water/snow/steep
//     ground. Mirrors the wildlife `habitatOK` gate — terrain authority only.

export const PATROL_POINTS_MIN = 2;
export const PATROL_POINTS_MAX = 4; // the "2–4 points max" gate

export const PATROL_SPEED_MIN = 0.1; // m/s — a crawl floor (never frozen-but-"moving")
export const PATROL_SPEED_MAX = 2.0; // m/s — bound a hostile save; a sentinel is not a sprinter
export const PATROL_SPEED_DEFAULT = 0.8;

export const PATROL_PAUSE_MIN = 0;
export const PATROL_PAUSE_MAX = 5.0; // seconds — cap a corrupt huge dwell
export const PATROL_PAUSE_DEFAULT = 1.0;

// Alert behaviour when the player is inside the encounter zone (the runtime reads this; motion is
// otherwise identical). "halt" = stop + face the player (telegraph); "track" = keep walking but face the
// player; "none" = ignore the player and keep patrolling. NO chase in any mode.
export const ALERT_MODES = Object.freeze(["halt", "track", "none"]);
export const ALERT_DEFAULT = "halt";

// Terrain-safety clearances (world-Y metres / slope), constants like the wildlife species gate. A patrol
// point must clear the water table, stay below the snowline, sit on walkable ground, and keep an inner
// margin off the zone ring so the moving body never clips the encounter edge.
export const PATROL_WATER_CLEARANCE = 1.0;
export const PATROL_SNOW_MARGIN = 2.0;
export const PATROL_SLOPE_LIMIT = 0.6;
export const PATROL_RADIUS_MARGIN = 0.5;

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// Read one authored point — an [x,y,z] array OR an {x,y,z} object — into a finite {x,y,z}, or null when
// any component is non-finite (finite positions only).
function finitePoint(p) {
  let x;
  let y;
  let z;
  if (Array.isArray(p)) {
    x = Number(p[0]);
    y = Number(p[1]);
    z = Number(p[2]);
  } else if (p && typeof p === "object") {
    x = Number(p.x);
    y = Number(p.y);
    z = Number(p.z);
  } else {
    return null;
  }
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { x, y, z } : null;
}

/**
 * Normalize one untrusted patrol descriptor, or null when it can't yield a valid patrol (which leaves the
 * sentinel stationary). Whitelists exactly { enabled, points, speed, pauseSec, loop, alert }; unknown keys
 * are dropped. `enabled:false` → null (explicitly off). Fewer than 2 finite points → null. Points beyond
 * the 4-point cap are dropped. Points are canonicalized to {x,y,z}.
 * @param {unknown} raw
 */
export function normalizePatrol(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.enabled === false) return null; // explicitly disabled → no patrol (stationary)

  const src = Array.isArray(raw.points) ? raw.points : [];
  const points = [];
  for (const p of src) {
    if (points.length >= PATROL_POINTS_MAX) break; // cap to the first MAX valid points
    const v = finitePoint(p);
    if (v) points.push(v);
  }
  if (points.length < PATROL_POINTS_MIN) return null; // <2 valid → drop the patrol

  return {
    enabled: true,
    points,
    speed: clamp(num(raw.speed, PATROL_SPEED_DEFAULT), PATROL_SPEED_MIN, PATROL_SPEED_MAX),
    pauseSec: clamp(num(raw.pauseSec, PATROL_PAUSE_DEFAULT), PATROL_PAUSE_MIN, PATROL_PAUSE_MAX),
    loop: raw.loop === true,
    alert: ALERT_MODES.includes(raw.alert) ? raw.alert : ALERT_DEFAULT,
  };
}

/**
 * Resolve a structural patrol against the encounter zone + terrain into a grounded, terrain-safe patrol,
 * or null when ANY point fails (→ the sentinel stays stationary — graceful degradation, never a partial
 * route). `terrain` is an injected sampler bundle { height, waterLevel, slope, snowline }; only `height`
 * is required (the others default to the dry/no-snow/flat case, so a rolling/dry profile auto-passes,
 * exactly like the wildlife gate). Each kept point's Y is snapped to the terrain surface.
 * @param {ReturnType<typeof normalizePatrol>} patrol
 * @param {{ center?: {x:number,z:number}, radius?: number, terrain?: object }} ctx
 */
export function resolvePatrol(patrol, { center, radius, terrain } = {}) {
  if (!patrol) return null;
  if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.z)) return null;
  if (!Number.isFinite(radius) || radius <= 0) return null;
  if (!terrain || typeof terrain.height !== "function") return null;

  const maxR = Math.max(0, radius - PATROL_RADIUS_MARGIN);
  const grounded = [];
  for (const p of patrol.points) {
    const dx = p.x - center.x;
    const dz = p.z - center.z;
    if (Math.hypot(dx, dz) > maxR) return null; // outside the zone → reject the whole patrol

    const h = terrain.height(p.x, p.z);
    if (!Number.isFinite(h)) return null; // can't ground it → reject

    const water = typeof terrain.waterLevel === "function" ? terrain.waterLevel(p.x, p.z) : -Infinity;
    if (h < water + PATROL_WATER_CLEARANCE) return null; // submerged / too near shore

    const snow = typeof terrain.snowline === "function" ? terrain.snowline(p.x, p.z) : Infinity;
    if (h > snow - PATROL_SNOW_MARGIN) return null; // snow / ice

    const slope = typeof terrain.slope === "function" ? terrain.slope(p.x, p.z) : 0;
    if (slope > PATROL_SLOPE_LIMIT) return null; // too steep — scree / cliff

    grounded.push({ x: p.x, y: h, z: p.z });
  }

  return {
    enabled: true,
    points: grounded,
    speed: patrol.speed,
    pauseSec: patrol.pauseSec,
    loop: patrol.loop,
    alert: patrol.alert,
  };
}
