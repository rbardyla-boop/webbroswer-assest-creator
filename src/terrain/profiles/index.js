// Terrain profile selector. Alpine is the world's default identity; rolling is the
// legacy / comparison profile (used by the single-source + faithfulness tests).

import { createAlpineProfile } from "./AlpineTerrainProfile.js";
import { createRollingProfile } from "./RollingProfile.js";

export const PROFILE_IDS = Object.freeze(["alpine", "rolling"]);

const CREATORS = { alpine: createAlpineProfile, rolling: createRollingProfile };

/**
 * Build the active terrain profile from a world `terrain` config block.
 * Unknown/missing profile → alpine (the default identity).
 */
export function createTerrainProfile(terrainConfig = {}) {
  const id = PROFILE_IDS.includes(terrainConfig?.profile) ? terrainConfig.profile : "alpine";
  return (CREATORS[id] ?? createAlpineProfile)(terrainConfig);
}
