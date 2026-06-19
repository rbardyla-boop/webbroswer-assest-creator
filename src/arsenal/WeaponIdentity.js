// Weapon identity (Arsenal v5) — PURE: (recipe) → deterministic { id, name, type, family,
// rarity, tier, hash }. No THREE, no Math.random. Every field is recomputed from data the
// recipe ALREADY carries (and that sanitizeWeaponRecipe preserves: seed/type/family/rarity/
// material/parts/counts), so identity is byte-stable across a save/load round-trip WITHOUT
// any persisted field — recompute it on load and it matches. The name is seeded off the
// canonical recipeHash so it's stable under the persistence path's 3-decimal part rounding.
//
// Aesthetic: arcane / energy-tech. Same recipe → same name; different seed → different name.

import { clamp } from "../utils/math.js";
import { createRng } from "./WeaponSeed.js";
import { recipeHash, weaponAssetId } from "./WeaponRecipe.js";
import { WEAPON_TYPES, RARITIES } from "./WeaponConfig.js";

// Energy-part count at/above which a weapon reads as "charged" and earns a tier bump.
const ENERGY_HIGH = 6;
const RARITY_FLOOR = { common: 1, rare: 2, epic: 3, mythic: 4 };

// Arcane / energy-tech vocabulary. Pools are keyed by type so the name flavours the
// silhouette family; the modifier + designation carry the per-seed entropy.
const PREFIX = ["Ion", "Pulse", "Arc", "Flux", "Volt", "Surge", "Plasma", "Void", "Aether", "Rime", "Ember", "Halo", "Glacier", "Quartz"];
const CORE = {
  sidearm: ["Spark", "Bolt", "Pulse", "Sigil"],
  longarm: ["Beam", "Coil", "Lance", "Aether"],
  heavy: ["Rail", "Storm", "Siege", "Ion"],
  exotic: ["Prism", "Gravity", "Aether", "Void"],
};
const SUFFIX = {
  sidearm: ["Sidearm", "Derringer", "Pistol", "Sigil"],
  longarm: ["Carbine", "Rifle", "Marksman", "Lance"],
  heavy: ["Railgun", "Cannon", "Launcher", "Storm"],
  exotic: ["Staff", "Fork", "Caster", "Focus"],
};
// Grand "<Noun> of the <Adj> <Core>" form, used for high-tier weapons.
const GRAND_NOUN = ["Sigil", "Aegis", "Heart", "Oath", "Eye", "Crown", "Vow", "Relic"];
const GRAND_ADJ = ["Frozen", "Glacial", "Eternal", "Hollow", "Radiant", "Sundered", "Rimebound", "First"];
const GRAND_CORE = ["Core", "Vault", "Star", "Storm", "Ember", "Tide", "Vector", "Wake"];

function safeType(recipe) {
  return WEAPON_TYPES.includes(recipe?.type) ? recipe.type : "sidearm";
}

function safeRarity(recipe) {
  return RARITIES.includes(recipe?.rarity) ? recipe.rarity : "common";
}

/**
 * Power tier 1..5 — the rarity floor plus a bump for a charged (high-energy) build.
 * Deterministic from preserved fields (rarity + counts.energy).
 * @param {object} recipe
 * @returns {number} integer in [1,5]
 */
export function weaponTier(recipe) {
  const floor = RARITY_FLOOR[safeRarity(recipe)] ?? 1;
  const energy = Number(recipe?.counts?.energy) || 0;
  return clamp(floor + (energy >= ENERGY_HIGH ? 1 : 0), 1, 5);
}

/**
 * Deterministic arcane/energy-tech display name for a weapon recipe. High-tier weapons
 * lean to the grand "<Noun> of the <Adj> <Core>" form; the rest get "<Prefix> <Core>
 * <Suffix> Mk.N", where N (and every pick) is derived from the recipe hash for stability
 * and collision-tolerant distinctness.
 * @param {object} recipe
 * @returns {string}
 */
export function weaponName(recipe) {
  const type = safeType(recipe);
  const hash = recipeHash(recipe);
  const tier = weaponTier(recipe);
  const rng = createRng(hash);
  const grand = tier >= 4 || (tier >= 3 && rng.chance(0.2));
  if (grand) {
    return `${rng.pick(GRAND_NOUN)} of the ${rng.pick(GRAND_ADJ)} ${rng.pick(GRAND_CORE)}`;
  }
  const prefix = rng.pick(PREFIX);
  const core = rng.pick(CORE[type] ?? CORE.sidearm);
  const suffix = rng.pick(SUFFIX[type] ?? SUFFIX.sidearm);
  const mk = (hash % 49) + 1; // designation keeps near-collisions readably distinct
  return `${prefix} ${core} ${suffix} Mk.${mk}`;
}

/**
 * Full derived identity for a weapon recipe. Reuses the canonical id/hash from
 * WeaponRecipe — there is exactly one asset-id scheme.
 * @param {object} recipe
 * @returns {{ id:string, name:string, type:string, family:string, rarity:string, tier:number, hash:number }}
 */
export function weaponIdentity(recipe) {
  return {
    id: weaponAssetId(recipe),
    name: weaponName(recipe),
    type: safeType(recipe),
    family: typeof recipe?.family === "string" ? recipe.family : "",
    rarity: safeRarity(recipe),
    tier: weaponTier(recipe),
    hash: recipeHash(recipe),
  };
}
