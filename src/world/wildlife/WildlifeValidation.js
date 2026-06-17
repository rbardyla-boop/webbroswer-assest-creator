// Sanitizer for the world's `wildlife` block. Invalid values are repaired to defaults
// or clamped, never fatal. Pure and Node-safe. Reuses the canonical number/bool
// validators from the lighting types. Caps the species map to the KNOWN ids so an
// untrusted document can neither request an unbounded sim nor inject unknown species.

import { clamp, boolOr, numberOr } from "../../lighting/LightingTypes.js";
import { DEFAULT_WILDLIFE, createWildlifeConfig } from "./WildlifeConfig.js";
import { WILDLIFE_SPECIES } from "./WildlifeSpecies.js";

const KNOWN_SPECIES = WILDLIFE_SPECIES.map((s) => s.id);

export function sanitizeWildlife(input) {
  const d = DEFAULT_WILDLIFE;
  if (!input || typeof input !== "object" || Array.isArray(input)) return createWildlifeConfig();

  const visibleDistance = clamp(input.visibleDistance, 16, 600, d.visibleDistance);
  const keepDistance = Math.max(visibleDistance, clamp(input.keepDistance, 16, 800, d.keepDistance));
  const simulateDistance = Math.min(visibleDistance, clamp(input.simulateDistance, 8, 600, d.simulateDistance));

  // Only the known species survive — unknown ids are dropped (allow-list).
  const species = {};
  for (const id of KNOWN_SPECIES) {
    const def = d.species[id] ?? { enabled: false };
    species[id] = { enabled: boolOr(input.species?.[id]?.enabled, def.enabled) };
  }

  return {
    enabled: boolOr(input.enabled, d.enabled),
    seed: Math.floor(numberOr(input.seed, d.seed)),
    density: clamp(input.density, 0, 3, d.density),
    regionSize: clamp(input.regionSize, 16, 256, d.regionSize),
    visibleDistance,
    keepDistance,
    simulateDistance,
    species,
  };
}
