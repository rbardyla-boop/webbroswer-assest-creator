// Weapon grammar — PURE: (config) → recipe of plain part descriptors. No THREE, no
// scene, no Math.random; deterministic from the seed. Orchestrates the config → recipe
// path; the per-type silhouette builders (where the at-a-glance identity lives — sidearm
// compact, longarm directional, heavy massive, exotic impossible) live in
// WeaponVariantGrammar.js (Arsenal v5). The recipe is JSON the geometry stage turns into
// BufferGeometry; capped so a hostile config can never emit unbounded parts.
//
// Convention: the weapon lies along +X (muzzle toward +X), grip toward -Y, centered
// near the origin. A part = { shape, role, pos:[x,y,z], size:[...], rot:[x,y,z], color }.

import { clamp, lerp } from "../utils/math.js";
import { createRng } from "./WeaponSeed.js";
import { createWeaponConfig, ARSENAL_LIMITS } from "./WeaponConfig.js";
import { buildSidearm, buildLongarm, buildHeavy, buildExotic } from "./WeaponVariantGrammar.js";

// Per-rarity alloy base colors (cool gunmetal → exotic iridium), HSL jittered per part.
const ALLOY_BASE = {
  common: [212, 0.06, 0.42],
  rare: [205, 0.18, 0.46],
  epic: [266, 0.22, 0.5],
  mythic: [44, 0.34, 0.52],
};

const FAMILY = {
  sidearm: ["spark-pistol", "bolt-derringer", "pulse-sidearm"],
  longarm: ["beam-carbine", "coil-rifle", "lance-marksman"],
  heavy: ["prism-rail", "siege-cannon", "storm-launcher"],
  exotic: ["staff-caster", "prism-lance", "gravity-fork"],
};

export function generateWeaponRecipe(input) {
  const config = createWeaponConfig(input);
  const rng = createRng(`${config.seed}:${config.type}`);
  const family = rng.pick(FAMILY[config.type] ?? FAMILY.sidearm);

  const energyColor = hslToHex(config.energyHue, 0.85, 0.6);
  const energyHi = hslToHex(config.energyHue, 0.7, 0.78);
  const [ah, as, al] = ALLOY_BASE[config.rarity] ?? ALLOY_BASE.common;
  const alloyOf = () => hslToHex(((ah + rng.jitter(8)) % 360) / 360, clamp(as + rng.jitter(0.05), 0, 1), clamp(al + rng.jitter(0.06), 0.12, 0.78));

  // Silhouette envelope (world units). Length drives X-extent, bulk drives radius/height.
  const length = lerp(1.6, 4.2, config.length);
  const bulk = lerp(0.18, 0.62, config.bulk);

  const parts = [];
  const cap = ARSENAL_LIMITS.MAX_PARTS;
  const push = (p) => {
    if (parts.length < cap) parts.push({ rot: [0, 0, 0], color: null, ...p });
  };

  const ctx = { rng, config, length, bulk, energyColor, energyHi, alloyOf, push };
  if (config.type === "longarm") buildLongarm(ctx);
  else if (config.type === "heavy") buildHeavy(ctx);
  else if (config.type === "exotic") buildExotic(ctx);
  else buildSidearm(ctx);

  const energy = parts.filter((p) => p.role === "energy").length;
  return {
    seed: config.seed,
    type: config.type,
    family,
    rarity: config.rarity,
    body: { length, bulk, asymmetry: config.asymmetry },
    material: {
      energyColor,
      energyHue: config.energyHue,
      coreIntensity: config.coreIntensity,
      glassIOR: config.glassIOR,
      refractionStrength: config.refractionStrength,
      pulseRate: config.pulseRate,
      scanlineDensity: lerp(40, 140, config.bulk),
    },
    parts,
    counts: { parts: parts.length, energy, alloy: parts.length - energy },
  };
}

// --- color --------------------------------------------------------------------------

// HSL (h in [0,1], s/l in [0,1]) → #rrggbb. Deterministic, no DOM.
export function hslToHex(h, s, l) {
  const hue = ((h % 1) + 1) % 1;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue * 6) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  const seg = Math.floor(hue * 6);
  if (seg === 0) [r, g, b] = [c, x, 0];
  else if (seg === 1) [r, g, b] = [x, c, 0];
  else if (seg === 2) [r, g, b] = [0, c, x];
  else if (seg === 3) [r, g, b] = [0, x, c];
  else if (seg === 4) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v) => clamp(Math.round((v + m) * 255), 0, 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}
