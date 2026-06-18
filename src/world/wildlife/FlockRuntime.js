// Flock behaviour — a FLOCK-level state machine (circle / drift / scatter / regroup) with
// BOUNDED cohesion. The whole flock is one unit: the centre moves, members hold bounded
// offsets around it, and every bird's Y comes from `flockAltitudeAt` (never below terrain
// or water). Boundedness is structural, not hoped-for:
//   • centre step ≤ min(maxSpeed*dt, MAX_STEP)   (a frame hitch can't teleport the flock)
//   • centre is hard-projected back inside maxTetherRadius of home every step (a leash)
//   • member offset radius is clamped ≤ maxSpread
//   • heading change ≤ maxTurnRate*dt
// → every bird stays within (maxTetherRadius + maxSpread) of home, always (triangle
// inequality), and nothing can reach NaN/Infinity under a hostile config. Seeded RNG only.

import { flockAltitudeAt } from "./FlockPlacement.js";
import { speciesById } from "./WildlifeSpecies.js";
import { clamp } from "../../utils/math.js";
import { mulberry32 } from "../../utils/random.js";

const MAX_DT = 0.1; // clamp a hostile/hitched dt before it scales any step
const MAX_STEP = 0.5; // dt-independent hard cap on centre travel per frame
const SCATTER_EASE = 2.5; // how fast scatterScale eases toward its target (per second)
const HALF_PI = Math.PI / 2;
const TAU = Math.PI * 2;

// Descriptor → live flock. Defensive: any non-finite field makes the whole flock null
// (a NaN would poison every member's instance matrix). Resolves initial member positions
// so a freshly-spawned, not-yet-simulated flock still renders.
export function spawnFlock(descriptor) {
  const species = speciesById(descriptor.speciesId);
  if (!species) return null;
  const c = descriptor.center;
  const h = descriptor.home;
  if (!finite2(c) || !finite2(h) || !Number.isFinite(descriptor.heading)) return null;
  if (!Array.isArray(descriptor.members) || descriptor.members.length === 0) return null;

  const members = [];
  for (const m of descriptor.members) {
    if (!Number.isFinite(m.baseAngle) || !Number.isFinite(m.baseRadius) || !Number.isFinite(m.altitudeOffset)) {
      return null;
    }
    members.push({ baseAngle: m.baseAngle, baseRadius: m.baseRadius, altitudeOffset: m.altitudeOffset, x: 0, y: 0, z: 0 });
  }

  const flock = {
    speciesId: descriptor.speciesId,
    species,
    home: { x: h.x, z: h.z },
    center: { x: c.x, z: c.z },
    heading: descriptor.heading,
    state: "circle",
    stateTimer: 0,
    driftHeading: descriptor.heading,
    circlePhase: descriptor.heading,
    scatterScale: 1,
    calmTimer: 0,
    rng: mulberry32(descriptor.motionSeed >>> 0),
    members,
  };
  resolveMembers(flock); // initial pose
  return flock;
}

// Advance one flock by dt. `threatX/threatZ` = the viewer (camera) world position.
export function updateFlock(flock, dt, threatX, threatZ) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  dt = Math.min(dt, MAX_DT);
  const s = flock.species;
  const c = flock.center;

  // --- threat + FSM transitions -------------------------------------------
  const dcx = c.x - threatX;
  const dcz = c.z - threatZ;
  const panicked = dcx * dcx + dcz * dcz < s.panicDistance * s.panicDistance;

  if (panicked) {
    flock.state = "scatter";
    flock.calmTimer = 0;
  } else if (flock.state === "scatter") {
    flock.calmTimer += dt;
    if (flock.calmTimer >= s.calmTime) flock.state = "regroup";
  } else if (flock.state === "regroup") {
    const homeNearSq = (s.idleRadius * 0.5) * (s.idleRadius * 0.5);
    if (distSq(c, flock.home) < homeNearSq && flock.scatterScale < 1.05) {
      flock.state = "circle";
      flock.stateTimer = 4 + flock.rng() * 6;
    }
  } else {
    // circle / drift — flip on a seeded timer for variety
    flock.stateTimer -= dt;
    if (flock.stateTimer <= 0) {
      flock.state = flock.rng() < 0.6 ? "circle" : "drift";
      flock.stateTimer = 4 + flock.rng() * 6;
      if (flock.state === "drift") flock.driftHeading = flock.rng() * TAU;
    }
  }

  // --- desired heading + speed per state ----------------------------------
  let desired = flock.heading;
  let speed = s.speed.wander;
  if (flock.state === "circle") {
    flock.circlePhase += s.circleAngularSpeed * dt;
    const orbitR = s.idleRadius * 0.8;
    const tx = flock.home.x + Math.cos(flock.circlePhase) * orbitR;
    const tz = flock.home.z + Math.sin(flock.circlePhase) * orbitR;
    desired = Math.atan2(tz - c.z, tx - c.x);
  } else if (flock.state === "drift") {
    desired = distSq(c, flock.home) > s.idleRadius * s.idleRadius
      ? Math.atan2(flock.home.z - c.z, flock.home.x - c.x) // tethered: steer home if strayed
      : flock.driftHeading;
  } else if (flock.state === "scatter") {
    speed = s.speed.flee;
    desired = scatterHeading(flock, threatX, threatZ, speed * dt, s);
  } else {
    // regroup
    desired = Math.atan2(flock.home.z - c.z, flock.home.x - c.x);
  }

  // --- move the centre (bounded + leashed) --------------------------------
  flock.heading = steerHeading(flock.heading, desired, s.maxTurnRate * dt);
  const step = Math.min(speed * dt, MAX_STEP);
  let nx = c.x + Math.cos(flock.heading) * step;
  let nz = c.z + Math.sin(flock.heading) * step;
  const leashed = projectToLeash(nx, nz, flock.home, s.maxTetherRadius);
  nx = leashed.x;
  nz = leashed.z;

  if (Number.isFinite(nx) && Number.isFinite(nz)) {
    c.x = nx;
    c.z = nz;
  } else {
    // Poisoned centre → snap back to home (never propagate NaN into member matrices).
    c.x = flock.home.x;
    c.z = flock.home.z;
    flock.heading = 0;
  }

  // --- ease the scatter spread, then resolve members ----------------------
  const targetScale = flock.state === "scatter" ? s.scatterFactor : 1;
  flock.scatterScale = clamp(
    flock.scatterScale + (targetScale - flock.scatterScale) * Math.min(1, dt * SCATTER_EASE),
    1,
    s.scatterFactor
  );
  resolveMembers(flock);
}

// Write each member's world (x,y,z) from the flock centre + its bounded offset; Y from
// the single-source altitude solver. Member offset radius is hard-clamped ≤ maxSpread.
function resolveMembers(flock) {
  const s = flock.species;
  const c = flock.center;
  for (const m of flock.members) {
    const r = clamp(m.baseRadius * flock.scatterScale, 0, s.maxSpread);
    const mx = c.x + Math.cos(m.baseAngle) * r;
    const mz = c.z + Math.sin(m.baseAngle) * r;
    m.x = mx;
    m.z = mz;
    m.y = flockAltitudeAt(mx, mz, s, m.altitudeOffset); // ≥ terrain/water + clearance, finite
  }
}

// Scatter heading: directly away from the threat (computed from the CENTRE so the flock
// flees as one body). If a full away-step would break the leash, steer along the leash
// TANGENT toward the threat-distant side instead — so a cornered flock slides around the
// boundary rather than freezing against it (the aloft analog of the grounded wall-follow).
function scatterHeading(flock, threatX, threatZ, stepLen, s) {
  const c = flock.center;
  const away = Math.atan2(c.z - threatZ, c.x - threatX);
  const ax = c.x + Math.cos(away) * stepLen;
  const az = c.z + Math.sin(away) * stepLen;
  if (distSq({ x: ax, z: az }, flock.home) <= s.maxTetherRadius * s.maxTetherRadius) {
    return away; // away keeps us leashed — take it
  }
  // At/near the leash boundary and away points outward → pick the tangent side closer to `away`.
  const radial = Math.atan2(c.z - flock.home.z, c.x - flock.home.x);
  const t1 = radial + HALF_PI;
  const t2 = radial - HALF_PI;
  return Math.abs(wrapAngle(away - t1)) <= Math.abs(wrapAngle(away - t2)) ? t1 : t2;
}

// Hard radial leash: if (x,z) is past `radius` from home, project it back onto the leash
// circle. This is the structural boundedness guarantee — the centre is NEVER outside it.
function projectToLeash(x, z, home, radius) {
  const dx = x - home.x;
  const dz = z - home.z;
  const d = Math.hypot(dx, dz);
  if (!Number.isFinite(d) || d <= radius) return { x, z };
  const k = radius / d;
  return { x: home.x + dx * k, z: home.z + dz * k };
}

function steerHeading(current, target, maxDelta) {
  return current + clamp(wrapAngle(target - current), -maxDelta, maxDelta);
}

function wrapAngle(a) {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a < -Math.PI) a += TAU;
  return a;
}

function distSq(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function finite2(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.z);
}
