// Sanitizer for the world's `ambient` block. Invalid values are repaired to defaults or
// clamped, never fatal. Pure and Node-safe. Reuses the canonical number/bool validators
// from the lighting types. Caps the species map to the KNOWN ids so an untrusted document
// can neither request an unbounded sim nor inject unknown species. Mirrors WildlifeValidation.

import { clamp, boolOr, numberOr } from "../../lighting/LightingTypes.js";
import { DEFAULT_AMBIENT, createAmbientConfig } from "./AmbientConfig.js";
import { AMBIENT_SPECIES } from "./AmbientSpecies.js";

const KNOWN_SPECIES = AMBIENT_SPECIES.map((s) => s.id);
const MAX_WIND_STRENGTH = 5; // a hard ceiling so a hostile document can't gust motes off their leash

export function sanitizeAmbient(input) {
  const d = DEFAULT_AMBIENT;
  if (!input || typeof input !== "object" || Array.isArray(input)) return createAmbientConfig();

  const visibleDistance = clamp(input.visibleDistance, 16, 600, d.visibleDistance);
  const keepDistance = Math.max(visibleDistance, clamp(input.keepDistance, 16, 800, d.keepDistance));
  const simulateDistance = Math.min(visibleDistance, clamp(input.simulateDistance, 8, 600, d.simulateDistance));

  // Only the known species survive — unknown ids are dropped (allow-list).
  const species = {};
  for (const id of KNOWN_SPECIES) {
    const def = d.species[id] ?? { enabled: false };
    species[id] = { enabled: boolOr(input.species?.[id]?.enabled, def.enabled) };
  }

  const wind = {
    angle: numberOr(input.wind?.angle, d.wind.angle), // any finite angle is valid (cos/sin bound it)
    strength: clamp(input.wind?.strength, 0, MAX_WIND_STRENGTH, d.wind.strength),
  };

  return {
    enabled: boolOr(input.enabled, d.enabled),
    seed: Math.floor(numberOr(input.seed, d.seed)),
    density: clamp(input.density, 0, 3, d.density),
    regionSize: clamp(input.regionSize, 16, 256, d.regionSize),
    visibleDistance,
    keepDistance,
    simulateDistance,
    wind,
    species,
  };
}
