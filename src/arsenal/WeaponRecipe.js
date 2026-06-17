// Weapon recipe helpers — a recipe is the deterministic, persistable identity of a
// weapon (plain JSON, no THREE). recipeHash gives a stable 32-bit fingerprint over the
// identity-bearing fields, used both as a deterministic asset id and as the determinism
// check (same recipe → same hash → same geometry).

import { hashSeed } from "./WeaponSeed.js";

function roundArr(arr) {
  return Array.isArray(arr) ? arr.map((n) => Math.round(Number(n) * 1000) / 1000).join(",") : "";
}

/** Stable 32-bit hash of a recipe's identity (FNV-1a over a canonical string). */
export function recipeHash(recipe) {
  if (!recipe || typeof recipe !== "object") return 0;
  const parts = Array.isArray(recipe.parts) ? recipe.parts : [];
  const partStr = parts
    .map((p) => `${p.shape}|${p.role}|${roundArr(p.pos)}|${roundArr(p.size)}|${roundArr(p.rot)}|${p.color ?? ""}`)
    .join(";");
  const canonical = [
    recipe.seed,
    recipe.type,
    recipe.family,
    recipe.rarity,
    recipe.material?.energyColor ?? "",
    partStr,
  ].join("|");
  return hashSeed(canonical);
}

/** Deterministic asset id derived from the recipe hash (e.g. "wpn-3f9k2a"). */
export function weaponAssetId(recipe) {
  return `wpn-${recipeHash(recipe).toString(36)}`;
}
