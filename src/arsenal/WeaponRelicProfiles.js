// Weapon relic profiles (Arsenal v5) — PURE: the relic-tier VISUAL LANGUAGE + classification
// layered on top of the derived identity. No THREE, no Math.random — emits hex colour strings
// + numbers the world/presentation layer turns into materials. (Naming is fully procedural and
// lives in WeaponIdentity; this module is presentation, not an authored-name table.)
//
// A weapon's profile is derived from its identity tier. The FP-1 objective relic passes
// relicGrade:true so it ALWAYS presents at the top tier (gold "Relic" aura) regardless of the
// tier its rolled rarity earns — while its name stays a pure function of its recipe.

import { weaponIdentity } from "./WeaponIdentity.js";

// Energy-tech tier palette (steel → charged cyan → violet → amber → relic gold). Tier 5 gold
// matches the objective's existing relic-marker colour so the trophy reads consistently.
export const RELIC_TIER_COLORS = Object.freeze({
  1: "#9fb0a8",
  2: "#5bc8ff",
  3: "#b07bff",
  4: "#ffb020",
  5: "#ffe070",
});

const TIER_LABELS = Object.freeze({ 1: "Tier I", 2: "Tier II", 3: "Tier III", 4: "Tier IV", 5: "Relic" });

function clampTier(tier) {
  const t = Math.round(Number(tier) || 1);
  return t < 1 ? 1 : t > 5 ? 5 : t;
}

/** Hex colour string for a tier (clamped to 1..5). */
export function tierColor(tier) {
  return RELIC_TIER_COLORS[clampTier(tier)];
}

/** Human-readable tier label; the top tier reads "Relic". */
export function tierLabel(tier) {
  return TIER_LABELS[clampTier(tier)];
}

/**
 * Presentation profile for a weapon. With relicGrade, the tier/colour/label are forced to the
 * top (the objective relic always reads relic-grade); otherwise they derive from the recipe.
 * @param {object} recipe
 * @param {{ relicGrade?: boolean }} [opts]
 * @returns {{ identity:object, tier:number, color:string, label:string, auraIntensity:number }}
 */
export function relicProfile(recipe, { relicGrade = false } = {}) {
  const base = weaponIdentity(recipe);
  const tier = relicGrade ? 5 : clampTier(base.tier);
  // Keep identity.tier consistent with the (possibly forced) presentation tier so a consumer
  // reading either sees the same value.
  const identity = relicGrade ? { ...base, tier } : base;
  return {
    identity,
    tier,
    color: tierColor(tier),
    label: tierLabel(tier),
    auraIntensity: 0.45 + 0.11 * tier, // 0.56 (tier 1) → 1.0 (tier 5)
  };
}
