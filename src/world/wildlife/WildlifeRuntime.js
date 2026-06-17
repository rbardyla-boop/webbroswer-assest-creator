// Per-animal behaviour — a tiny state machine (idle / graze / wander / flee) with
// HABITAT-CLAMPED movement. The single most important rule: every proposed step is
// re-checked against the SAME `habitatOK` predicate used at spawn, including flee, so
// a moving animal can never enter water, climb a cliff, or cross the snowline — it
// turns instead. Grounding tracks getHeight (the terrain single source). Seeded RNG
// only (per-animal, from the placement motionSeed); no Math.random / Date.now.

import { getHeight } from "../../terrain/terrainSampling.js";
import { habitatOK } from "./WildlifePlacement.js";
import { speciesById } from "./WildlifeSpecies.js";
import { mulberry32 } from "../../utils/random.js";

const TURN_KICK = 0.9; // radians to veer when a step is rejected
const MAX_STEP = 0.5; // hard cap on horizontal travel per frame (anti-tunnel)
const TAU = Math.PI * 2;

// Turn a placement descriptor into a live animal. Skips invalid descriptors (defensive
// — a NaN/garbage spawn would poison the instance matrix) by returning null.
export function spawnAnimal(descriptor) {
  const species = speciesById(descriptor.speciesId);
  if (!species) return null;
  if (!Number.isFinite(descriptor.x) || !Number.isFinite(descriptor.z) || !Number.isFinite(descriptor.y)) return null;
  return {
    speciesId: descriptor.speciesId,
    species,
    home: descriptor.home,
    x: descriptor.x,
    z: descriptor.z,
    y: descriptor.y,
    heading: descriptor.heading,
    state: "graze",
    stateTimer: 0,
    rng: mulberry32(descriptor.motionSeed >>> 0),
  };
}

// Advance one animal by dt seconds. `threatX/threatZ` = the viewer (camera) world
// position; an animal within panicDistance flees directly away from it.
export function updateAnimal(animal, dt, threatX, threatZ) {
  const s = animal.species;

  // --- state machine -------------------------------------------------------
  const dxT = animal.x - threatX;
  const dzT = animal.z - threatZ;
  const threatDistSq = dxT * dxT + dzT * dzT;
  const fleeing = threatDistSq < s.panicDistance * s.panicDistance;

  if (fleeing) {
    animal.state = "flee";
    const away = Math.atan2(dzT, dxT); // directly away from the threat
    // Adopt the straight-away heading ONLY if that step is open. If it's blocked
    // (water/cliff), keep the current heading so the per-step veer below wall-follows
    // out of the corner — re-aiming into the wall every frame would freeze the animal.
    const step = Math.min(MAX_STEP, s.speed.flee * dt);
    if (step <= 0 || habitatOK(animal.x + Math.cos(away) * step, animal.z + Math.sin(away) * step, s)) {
      animal.heading = away;
    }
  } else {
    if (animal.state === "flee") animal.stateTimer = 0; // just calmed down → re-pick promptly
    animal.stateTimer -= dt;
    if (animal.stateTimer <= 0) {
      const r = animal.rng();
      animal.state = r < 0.45 ? "graze" : r < 0.7 ? "idle" : "wander";
      animal.stateTimer = 1.5 + animal.rng() * 3.5;
      if (animal.state === "wander") {
        // Wander somewhere new, but steer home if we've strayed past idleRadius.
        const strayed = Math.hypot(animal.x - animal.home.x, animal.z - animal.home.z) > s.idleRadius;
        animal.heading = strayed
          ? Math.atan2(animal.home.z - animal.z, animal.home.x - animal.x)
          : animal.rng() * TAU;
      }
    }
  }

  // --- habitat-clamped movement -------------------------------------------
  const speed = s.speed[animal.state] ?? 0;
  if (speed > 0) {
    const subSteps = animal.state === "flee" ? 2 : 1; // sub-step flee against tunnelling
    const stepDist = Math.min(MAX_STEP, speed * dt) / subSteps;
    for (let i = 0; i < subSteps; i++) {
      const nx = animal.x + Math.cos(animal.heading) * stepDist;
      const nz = animal.z + Math.sin(animal.heading) * stepDist;
      if (habitatOK(nx, nz, s)) {
        animal.x = nx;
        animal.z = nz;
      } else {
        // Reject the step and veer — NEVER advance into a forbidden cell (even fleeing).
        animal.heading += (animal.rng() < 0.5 ? -1 : 1) * TURN_KICK;
        break;
      }
    }
  }

  // --- ground on the terrain single source --------------------------------
  animal.y = getHeight(animal.x, animal.z);
}
