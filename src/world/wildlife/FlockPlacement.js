// Deterministic, seeded ALOFT-flock placement — the sky-life analog of WildlifePlacement.
// A flock's spawn set is a pure function of (seed, region, active TerrainProfile): same
// inputs → identical plain descriptors. Mirrors the grounded mulberry32(hash2i(...)) idiom.
//
// The load-bearing piece is `flockAltitudeAt` — the SINGLE source for a bird's flight Y
// (the aloft analog of grounded `y = getHeight`). It is used at placement AND at every
// runtime step, so a flying bird can never be solved below the terrain or at the water
// surface. No Math.random / Date.now.

import { getHeight, getWaterLevel, getActiveTerrainProfile } from "../../terrain/terrainSampling.js";
import { clamp } from "../../utils/math.js";
import { mulberry32, hash2i } from "../../utils/random.js";
import { WILDLIFE_SPECIES } from "./WildlifeSpecies.js";

const FLOCK_CENTER_CANDIDATES = 8; // FIXED K (constant rng draws) → argmax getHeight, determinism-stable
const MAX_CENTER_FALLBACK_TRIES = 6; // bounded first-valid fallback if no candidate passes the gate
const TAU = Math.PI * 2;

// THE single source for a bird's flight altitude. Returns a FINITE Y that is always at
// least `minClearance` above BOTH the terrain and the water table (the alpine water table
// is computed independently of height and can sit ABOVE terrain in the trough — so the
// water term is real, not redundant). `offset` is the bird's preferred clearance band.
//
// Ordering matters: the absolute [minY,maxY] band is a SOFT preference, but the
// terrain/water clearance `floor` is INVIOLABLE — so `floor` is re-applied AFTER the
// band clamp. Over a high ridge crest (terrain > maxY−clearance) birds rise above maxY
// rather than clip the mountain. getWaterLevel / snowlineAt enter only `max`/`min`,
// never a multiply/divide, so the rolling profile's ±Infinity degrades cleanly.
export function flockAltitudeAt(x, z, species, offset) {
  const g = getHeight(x, z);
  const w = getWaterLevel(x, z); // -Infinity on dry/rolling profiles
  const floor = Math.max(g + species.minClearance, Number.isFinite(w) ? w + species.minClearance : -Infinity);

  let y = Math.max(floor, g + offset); // preferred band, tracking the terrain
  const snow = getActiveTerrainProfile().snowlineAt(x, z); // +Infinity on rolling
  if (Number.isFinite(snow)) {
    // Ridge/snowline attraction: don't climb far past the snowline (snowMargin<0 lets the
    // band reach above it). Never let this cap drop below the inviolable floor.
    y = Math.min(y, Math.max(floor, snow - species.snowMargin));
  }
  y = clamp(y, species.minY, species.maxY); // soft absolute band
  y = Math.max(y, floor); // floor ALWAYS wins — clearance is inviolable
  return Number.isFinite(y) ? y : floor;
}

// Aloft habitat gate — where a flock CENTRE may sit. Birds fly over water and cliffs, so
// (unlike the grounded gate) this rejects neither slope nor submersion: legality is the
// solvable altitude. Auto-degrades on rolling (snowline +Infinity → the band term is inert).
export function flockHabitatOK(x, z, species) {
  if (!Number.isFinite(getHeight(x, z))) return false;
  // The solved altitude must respect the absolute ceiling with clearance — i.e. terrain
  // here is not so high that a bird would have to punch through maxY by more than the
  // band. (Over extreme crests the flock simply prefers lower neighbours.)
  const g = getHeight(x, z);
  if (g + species.minClearance > species.maxY + species.maxSpread) return false; // wall too tall to clear cleanly
  return true;
}

// Place every enabled ALOFT species' flocks for one region cell. Returns plain flock
// descriptors (no THREE, no closures, no live y) so the set is directly deep-equal-able.
export function placeFlockRegion(rx, rz, config, seed) {
  const size = config.regionSize;
  const originX = rx * size;
  const originZ = rz * size;
  const out = [];

  for (const species of WILDLIFE_SPECIES) {
    if (!species.enabled || species.groundContract !== "aloft") continue; // aloft only
    if (config.species?.[species.id]?.enabled === false) continue; // disabled by the document

    const rng = mulberry32(hash2i(rx ^ seed, rz + seed) ^ species.rngSalt);
    const maxHerds = Math.max(0, Math.round(species.herdsPerRegion * (config.density ?? 1)));
    const herdCount = maxHerds > 0 ? Math.floor(rng() * (maxHerds + 1)) : 0;

    for (let hd = 0; hd < herdCount; hd++) {
      const centre = pickHighTerrainCentre(rng, originX, originZ, size, species);
      if (centre === null) continue; // no legal centre this region for this herd

      const [mMin, mMax] = species.members;
      const memberCount = Math.min(species.regionMemberCap, mMin + Math.floor(rng() * (mMax - mMin + 1)));
      const members = [];
      for (let m = 0; m < memberCount; m++) {
        members.push({
          baseAngle: rng() * TAU,
          baseRadius: rng() * species.maxSpread, // ≤ maxSpread by construction
          altitudeOffset: species.altitude[0] + rng() * (species.altitude[1] - species.altitude[0]),
        });
      }

      const motionSeed = (hash2i((hd * 131) ^ seed, hash2i(rx, rz)) ^ 0x5f10c3) >>> 0;
      out.push({
        speciesId: species.id,
        center: { x: centre.x, z: centre.z },
        home: { x: centre.x, z: centre.z },
        heading: rng() * TAU,
        motionSeed,
        members,
      });
    }
  }

  return out;
}

// Draw EXACTLY K candidates (each consuming exactly 2 rng() — constant draw count keeps
// the rng stream phase stable for everything downstream) and return the one with the
// greatest terrain height among those passing the aloft gate (strict >, first-wins tie).
// Falls back to the first gate-valid sample, else null. Flocks therefore hug the ridges.
function pickHighTerrainCentre(rng, originX, originZ, size, species) {
  let best = null;
  let bestH = -Infinity;
  let fallback = null;
  for (let i = 0; i < FLOCK_CENTER_CANDIDATES; i++) {
    const x = originX + rng() * size;
    const z = originZ + rng() * size;
    if (!flockHabitatOK(x, z, species)) continue;
    if (fallback === null && i < MAX_CENTER_FALLBACK_TRIES) fallback = { x, z };
    const h = getHeight(x, z);
    if (h > bestH) {
      bestH = h;
      best = { x, z };
    }
  }
  return best ?? fallback;
}
