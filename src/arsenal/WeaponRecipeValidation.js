// Weapon recipe validation — the boundary the WORLD calls on an untrusted recipe
// (from the localStorage handoff queue or a pasted "world asset JSON"). Returns a NEW
// safe recipe, or null if it can't yield a valid weapon. Every part dimension is forced
// positive and the part count is capped, so a hostile recipe can never produce a
// degenerate (zero/negative) geometry or an unbounded mesh set. Pure (no THREE).

import { clamp } from "../utils/math.js";
import { ARSENAL_LIMITS, WEAPON_TYPES, RARITIES } from "./WeaponConfig.js";

const SHAPES = new Set(["box", "cyl", "ring", "prism", "capsule"]);
const ROLES = new Set(["alloy", "energy"]);

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function vec3(value, fallback) {
  return Array.isArray(value) && value.length >= 3
    ? [num(value[0], fallback[0]), num(value[1], fallback[1]), num(value[2], fallback[2])]
    : [...fallback];
}

function sizeVec3(value) {
  // Force every dimension positive + bounded — no degenerate geometry from a hostile size.
  return vec3(value, [1, 1, 1]).map((n) => clamp(Math.abs(n), 0.001, 1000));
}

function hex(value) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : null;
}

/**
 * @param {unknown} recipe untrusted recipe
 * @returns {object|null} a sanitized recipe, or null if invalid
 */
export function sanitizeWeaponRecipe(recipe) {
  if (!recipe || typeof recipe !== "object") return null;

  const partsIn = Array.isArray(recipe.parts) ? recipe.parts.slice(0, ARSENAL_LIMITS.MAX_PARTS) : [];
  const parts = [];
  for (const p of partsIn) {
    if (!p || typeof p !== "object" || !SHAPES.has(p.shape) || !ROLES.has(p.role)) continue;
    parts.push({
      shape: p.shape,
      role: p.role,
      pos: vec3(p.pos, [0, 0, 0]),
      size: sizeVec3(p.size),
      rot: vec3(p.rot, [0, 0, 0]),
      color: hex(p.color),
    });
  }
  if (!parts.length) return null; // a weapon with no valid parts is not a weapon

  const m = recipe.material && typeof recipe.material === "object" ? recipe.material : {};
  const energy = parts.filter((p) => p.role === "energy").length;
  return {
    seed: typeof recipe.seed === "string" ? recipe.seed.slice(0, 64) : "imported",
    type: WEAPON_TYPES.includes(recipe.type) ? recipe.type : "sidearm",
    family: typeof recipe.family === "string" ? recipe.family.slice(0, 48) : "imported",
    rarity: RARITIES.includes(recipe.rarity) ? recipe.rarity : "common",
    body: {
      length: clamp(num(recipe.body?.length, 2), 0.1, 12),
      bulk: clamp(num(recipe.body?.bulk, 0.4), 0.01, 4),
      asymmetry: clamp(num(recipe.body?.asymmetry, 0), 0, 1),
    },
    material: {
      energyColor: hex(m.energyColor) ?? "#46d6ff",
      energyHue: clamp(num(m.energyHue, 0.55), 0, 1),
      coreIntensity: clamp(num(m.coreIntensity, 1.1), 0, 4),
      glassIOR: clamp(num(m.glassIOR, 1.4), 1, 2),
      refractionStrength: clamp(num(m.refractionStrength, 0.18), 0, 1),
      pulseRate: clamp(num(m.pulseRate, 1.4), 0, 6),
      scanlineDensity: clamp(num(m.scanlineDensity, 90), 1, 400),
    },
    parts,
    counts: { parts: parts.length, energy, alloy: parts.length - energy },
  };
}
