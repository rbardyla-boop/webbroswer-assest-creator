// Per-mote behaviour — gentle BOUNDED drift (wind + seeded wander) with a hard tether to
// the spawn anchor, a twinkle scale-pulse, and an optional gentle scatter from the viewer.
// Boundedness is structural (copied verbatim from the flock discipline): dt clamped FIRST,
// per-step displacement capped, position hard-projected back inside the tether every step,
// non-finite → snap home. The hover Y uses the flock floor-after-band solver so a mote is
// NEVER below the terrain or at the water surface (mote contract ⊂ the proven bird contract).
// Seeded RNG only; no Math.random / Date.now.

import { getHeight, getWaterLevel } from "../../terrain/terrainSampling.js";
import { speciesById } from "./AmbientSpecies.js";
import { mulberry32, fbm2D } from "../../utils/random.js";

const MAX_DT = 0.1; // clamp a hostile/hitched dt before it scales any step
const MAX_STEP = 0.5; // dt-independent hard cap on per-frame displacement (anti-teleport)
const TAU = Math.PI * 2;

// THE single source for a mote's hover altitude — the flock floor-after-band solver. The
// inviolable `floor` (above BOTH terrain and the water table — the alpine table can sit
// above terrain in the trough) is kept even when the preferred band would fall below it.
export function solveHoverY(x, z, species, hoverOffset) {
  const g = getHeight(x, z);
  const w = getWaterLevel(x, z); // -Infinity on dry/rolling profiles
  const floor = Math.max(g + species.minClearance, Number.isFinite(w) ? w + species.minClearance : -Infinity);
  const y = Math.max(floor, g + hoverOffset);
  // y is finite for any finite (x,z) — updateMote snaps position finite before this runs, so
  // this is defensive: guarantee a finite return even if floor itself were poisoned.
  if (Number.isFinite(y)) return y;
  return Number.isFinite(floor) ? floor : g + species.minClearance;
}

// Turn a placement descriptor into a live mote. Rejects non-finite descriptors (a NaN would
// poison the instance matrix) by returning null.
export function spawnMote(descriptor) {
  const species = speciesById(descriptor.speciesId);
  if (!species) return null;
  if (!Number.isFinite(descriptor.x) || !Number.isFinite(descriptor.z) || !Number.isFinite(descriptor.hoverOffset)) return null;
  if (!descriptor.home || !Number.isFinite(descriptor.home.x) || !Number.isFinite(descriptor.home.z)) return null;

  const rng = mulberry32(descriptor.motionSeed >>> 0);
  const mote = {
    speciesId: descriptor.speciesId,
    species,
    home: { x: descriptor.home.x, z: descriptor.home.z },
    x: descriptor.x,
    z: descriptor.z,
    y: 0,
    hoverOffset: descriptor.hoverOffset,
    wanderPhase: rng() * TAU,
    twinklePhase: rng() * TAU,
    seedOff: rng() * 1000, // decorrelate this mote's wander noise field
    sizeBase: 0.7 + rng() * 0.6, // per-mote size variety
    scale: 1,
  };
  mote.y = hoverY(mote);
  mote.scale = mote.sizeBase;
  return mote;
}

// Advance one mote by dt. `wind` = {x,z} world drift (precomputed from angle/strength).
// `threatX/threatZ` = the viewer (camera) world position for the gentle scatter.
export function updateMote(mote, dt, wind, threatX, threatZ) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  dt = Math.min(dt, MAX_DT);
  const s = mote.species;

  // --- velocity: wind + a smoothly-wandering seeded direction ---------------
  mote.wanderPhase += dt * s.drift.wanderRate;
  const angle = fbm2D(mote.wanderPhase, mote.seedOff) * TAU; // deterministic, finite for any finite phase
  let vx = wind.x + Math.cos(angle) * s.drift.wanderAmp;
  let vz = wind.z + Math.sin(angle) * s.drift.wanderAmp;

  // --- optional gentle scatter (heading-only push away; NaN-threat-safe) -----
  const dxT = mote.x - threatX;
  const dzT = mote.z - threatZ;
  if (dxT * dxT + dzT * dzT < s.panicDistance * s.panicDistance) {
    const away = Math.atan2(dzT, dxT);
    vx += Math.cos(away) * s.scatterPush;
    vz += Math.sin(away) * s.scatterPush;
  }

  // --- speed clamp + dt-independent step cap --------------------------------
  const vmag = Math.hypot(vx, vz);
  if (vmag > s.maxSpeed && vmag > 0) {
    const k = s.maxSpeed / vmag;
    vx *= k;
    vz *= k;
  }
  let dispX = vx * dt;
  let dispZ = vz * dt;
  const dmag = Math.hypot(dispX, dispZ);
  if (dmag > MAX_STEP && dmag > 0) {
    const k = MAX_STEP / dmag;
    dispX *= k;
    dispZ *= k;
  }

  // --- move + hard tether projection ----------------------------------------
  let nx = mote.x + dispX;
  let nz = mote.z + dispZ;
  const ldx = nx - mote.home.x;
  const ldz = nz - mote.home.z;
  const ld = Math.hypot(ldx, ldz);
  if (Number.isFinite(ld) && ld > s.tetherRadius) {
    const k = s.tetherRadius / ld;
    nx = mote.home.x + ldx * k;
    nz = mote.home.z + ldz * k;
  }
  if (Number.isFinite(nx) && Number.isFinite(nz)) {
    mote.x = nx;
    mote.z = nz;
  } else {
    mote.x = mote.home.x; // poisoned → snap home (never propagate NaN into the matrix)
    mote.z = mote.home.z;
  }

  // --- twinkle (clamped so the scale factor never collapses to 0) -----------
  mote.twinklePhase += dt * s.twinkle.speed;
  mote.scale = mote.sizeBase * (1 + s.twinkle.amp * Math.sin(mote.twinklePhase)); // amp<1 → factor ∈ (0,2)

  // --- hover on the terrain (above ground AND water) ------------------------
  mote.y = hoverY(mote);
}

// Resolve the live mote's hover Y from its own per-mote hoverOffset.
function hoverY(mote) {
  return solveHoverY(mote.x, mote.z, mote.species, mote.hoverOffset);
}
