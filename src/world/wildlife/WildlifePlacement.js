// Deterministic, seeded wildlife placement — the core that makes the spawn set a pure
// function of (seed, region, active TerrainProfile). Mirrors the tree/bush
// candidate→gate→accept idiom exactly (mulberry32(hash2i(...))). The SAME `habitatOK`
// predicate gates spawns here AND every movement step in the runtime, so a wandering
// or fleeing animal can never end up somewhere it could not have spawned. No Math.random.

import { getHeight, getSlope, getWaterLevel, getGrassDensityFactor, getActiveTerrainProfile } from "../../terrain/terrainSampling.js";
import { mulberry32, hash2i } from "../../utils/random.js";
import { WILDLIFE_SPECIES } from "./WildlifeSpecies.js";

const MAX_CENTER_TRIES = 12; // bounded attempts to find a habitat-valid herd centre
const MAX_MEMBER_TRIES = 6; // bounded attempts per member around the centre

// Shared habitat predicate — terrain authority only. Reads getHeight/getSlope/
// getWaterLevel + the active profile's snowlineAt; no forked field. On the rolling
// profile (waterLevel -Infinity, snowline +Infinity) this auto-degrades to slope +
// altitude band, so dry worlds stay safe with no special-casing.
export function habitatOK(x, z, species) {
  const h = getHeight(x, z);
  if (h < getWaterLevel(x, z) + species.waterClearance) return false; // submerged / too near shore
  if (h > getActiveTerrainProfile().snowlineAt(x, z) - species.snowMargin) return false; // snow/ice
  if (getSlope(x, z) > species.slopeLimit) return false; // too steep — scree/cliff
  if (h < species.minY || h > species.maxY) return false; // outside the species' altitude band
  if (species.grazeGrassFloor > 0 && getGrassDensityFactor(x, z) < species.grazeGrassFloor) return false; // grazers keep to real meadow, not bare rock
  return true;
}

// Deterministically place every enabled species' herds for one region cell. Returns
// plain descriptors (no THREE, no closures) so the set is directly comparable across
// re-runs — the runtime turns each descriptor into a live animal.
export function placeRegion(rx, rz, config, seed) {
  const size = config.regionSize;
  const originX = rx * size;
  const originZ = rz * size;
  const out = [];

  for (const species of WILDLIFE_SPECIES) {
    if (!species.enabled || species.groundContract !== "support") continue; // grounded only — aloft (snow_finch) is placed by FlockPlacement
    if (config.species?.[species.id]?.enabled === false) continue; // disabled by the document

    const rng = mulberry32(hash2i(rx ^ seed, rz + seed) ^ species.rngSalt);
    const maxHerds = Math.max(0, Math.round(species.herdsPerRegion * (config.density ?? 1)));
    const herdCount = maxHerds > 0 ? Math.floor(rng() * (maxHerds + 1)) : 0;

    let accepted = 0;
    for (let hd = 0; hd < herdCount && accepted < species.regionMemberCap; hd++) {
      // Herd centre: first habitat-valid sample in the region (bounded tries).
      let cx = null;
      let cz = null;
      for (let t = 0; t < MAX_CENTER_TRIES; t++) {
        const x = originX + rng() * size;
        const z = originZ + rng() * size;
        if (habitatOK(x, z, species)) {
          cx = x;
          cz = z;
          break;
        }
      }
      if (cx === null) continue; // no valid centre this region for this herd

      const [mMin, mMax] = species.members;
      const memberCount = mMin + Math.floor(rng() * (mMax - mMin + 1));
      const spread = Math.max(2, species.idleRadius * 0.6);

      for (let m = 0; m < memberCount && accepted < species.regionMemberCap; m++) {
        let mx = null;
        let mz = null;
        for (let t = 0; t < MAX_MEMBER_TRIES; t++) {
          const ang = rng() * Math.PI * 2;
          const rad = rng() * spread;
          const x = cx + Math.cos(ang) * rad;
          const z = cz + Math.sin(ang) * rad;
          if (habitatOK(x, z, species)) {
            mx = x;
            mz = z;
            break;
          }
        }
        if (mx === null) continue;

        // Deterministic per-animal motion seed (drives FSM turns/timers in the runtime).
        const motionSeed = (hash2i((accepted + hd * 97) ^ seed, hash2i(rx, rz)) ^ 0x3ca7b1) >>> 0;
        out.push({
          speciesId: species.id,
          home: { x: mx, z: mz },
          x: mx,
          z: mz,
          y: getHeight(mx, mz), // grounded on the terrain single source
          heading: rng() * Math.PI * 2,
          motionSeed,
        });
        accepted++;
      }
    }
  }

  return out;
}
