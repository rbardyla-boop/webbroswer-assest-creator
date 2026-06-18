// Deterministic, biome-aware mote placement — the spawn set is a pure function of
// (seed, region, active TerrainProfile). Mirrors the wildlife/flock mulberry32(hash2i(...))
// candidate→gate→accept idiom. Mote DENSITY derives from the terrain profile's wetness +
// meadow masks (thinning to the snowline) — motes are the FIRST runtime consumer of
// getWetness, concentrating along the wet meadow + waterside. No Math.random.

import {
  getHeight,
  getSlope,
  getWaterLevel,
  getWetness,
  getGrassDensityFactor,
  getActiveTerrainProfile,
} from "../../terrain/terrainSampling.js";
import { clamp } from "../../utils/math.js";
import { mulberry32, hash2i } from "../../utils/random.js";
import { AMBIENT_SPECIES } from "./AmbientSpecies.js";

// Where a mote's HOME anchor may sit — terrain authority only. Rejects submerged ground
// (the hover solver still keeps the mote above the water surface) and sheer cliffs. Lax by
// design: motes don't need flat meadow, density handles where they concentrate. Auto-
// degrades on rolling (waterLevel -Infinity → never submerged).
export function habitatOK(x, z, species) {
  const h = getHeight(x, z);
  if (h < getWaterLevel(x, z)) return false; // anchor not on submerged ground
  if (getSlope(x, z) > species.slopeLimit) return false; // sheer rock
  return true;
}

// Biome density at a point (0..1): concentrate along wet meadow + waterside (wetness +
// meadow), thinning to 0 at/above the snowline. On rolling (wetness 0, snowline +Infinity)
// this degrades to meadow-only with no special-casing.
export function densityAt(x, z, species) {
  const h = getHeight(x, z);
  const wet = getWetness(x, z); // 0..1, peaks at the shoreline (0 when submerged / dry profile)
  const meadow = getGrassDensityFactor(x, z); // 0..1 meadow mask
  const snow = getActiveTerrainProfile().snowlineAt(x, z); // +Infinity on rolling
  const snowFactor = Number.isFinite(snow) ? clamp((snow - h) / species.snowFalloff, 0, 1) : 1;
  const base = clamp(species.wetWeight * wet + species.meadowWeight * meadow, 0, 1);
  return base * snowFactor;
}

// Deterministically place every enabled mote species for one region cell. Returns plain
// descriptors (no THREE, no closures) so the set is directly comparable across re-runs.
export function placeRegion(rx, rz, config, seed) {
  const size = config.regionSize;
  const originX = rx * size;
  const originZ = rz * size;
  const out = [];

  for (const species of AMBIENT_SPECIES) {
    if (!species.enabled) continue;
    if (config.species?.[species.id]?.enabled === false) continue; // disabled by the document

    const rng = mulberry32(hash2i(rx ^ seed, rz + seed) ^ species.rngSalt);
    const [hLo, hHi] = species.hoverBand;
    const candidates = Math.max(0, Math.round(species.motesPerRegion * (config.density ?? 1)));

    let accepted = 0;
    for (let i = 0; i < candidates && accepted < species.regionMemberCap; i++) {
      const x = originX + rng() * size;
      const z = originZ + rng() * size;
      const roll = rng(); // density acceptance draw
      if (!habitatOK(x, z, species)) continue;
      if (roll >= densityAt(x, z, species)) continue; // probabilistic thinning by biome density

      const hoverOffset = hLo + rng() * (hHi - hLo);
      const motionSeed = (hash2i((accepted * 131) ^ seed, hash2i(rx, rz)) ^ 0x70e5b1) >>> 0;
      out.push({
        speciesId: species.id,
        home: { x, z },
        x,
        z,
        hoverOffset,
        motionSeed,
      });
      accepted++;
    }
  }

  return out;
}
