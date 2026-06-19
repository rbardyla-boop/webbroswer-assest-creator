// Relic presentation (Arsenal v5) — the seam where the objective's relic gains its derived
// identity in the UI: a name-enriched banner and a tier-coloured trophy style. PURE glue —
// no THREE and no nondeterministic time/random calls (this directory is scanned for them).
// Imports ONLY the PURE arsenal identity modules (never the studio UI), so the recipe-only
// world↔arsenal boundary holds.

import { bannerText } from "./RelicWeaponObjective.js";
import { relicProfile } from "../../arsenal/WeaponRelicProfiles.js";

/**
 * Banner copy with the relic's procedural name + tier folded into the canonical phase line.
 * Falls back to the plain phase copy when no recipe is available.
 * @param {string} phase find|carry|atCache|complete
 * @param {object} [recipe] the relic's weapon recipe
 * @param {{ relicGrade?: boolean }} [opts]
 * @returns {string}
 */
export function relicBannerText(phase, recipe, opts = {}) {
  const base = bannerText(phase);
  if (!recipe) return base;
  const p = relicProfile(recipe, opts);
  const tag = `${p.label} · ${p.identity.name}`;
  return base.replace(/^Relic Objective/, tag);
}

/**
 * Tier-driven trophy style for the objective markers/aura, plus the identity fields the
 * debug snapshot surfaces. Colour is a hex string; the THREE-side caller converts to 0x.
 * @param {object} [recipe] the relic's weapon recipe
 * @param {{ relicGrade?: boolean }} [opts]
 * @returns {{ name:string, hash:number, tier:number, label:string, color:string, auraIntensity:number }}
 */
export function relicTrophyStyle(recipe, opts = {}) {
  const p = relicProfile(recipe, opts);
  return {
    name: p.identity.name,
    hash: p.identity.hash,
    tier: p.tier,
    label: p.label,
    color: p.color,
    auraIntensity: p.auraIntensity,
  };
}
