// Weapon config — the tunable surface the workbench exposes and the grammar consumes.
// Every numeric field is clamped (defense in depth, like GeneratorConfig): an out-of-
// range or hostile value can never produce degenerate geometry or an unbounded build.
// PARAM_RANGES doubles as the data-driven spec for the workbench sliders.

import { clamp } from "../utils/math.js";
import { createRng } from "./WeaponSeed.js";

export const WEAPON_TYPES = Object.freeze(["sidearm", "longarm", "heavy", "exotic"]);
export const RARITIES = Object.freeze(["common", "rare", "epic", "mythic"]);

// Hard caps on what a single weapon may emit — the backstop against a hostile config.
export const ARSENAL_LIMITS = Object.freeze({
  MAX_BARRELS: 4,
  MAX_COIL_RINGS: 12,
  MAX_FINS: 16,
  MAX_PARTS: 96, // assembled meshes per weapon
  MAX_VERTICES: 80000, // total vertex budget across all parts
});

// Each tunable param: range + step + default + whether it is integer. The grammar
// reads these values; the workbench renders a slider per entry.
export const PARAM_RANGES = Object.freeze({
  length: { label: "Length", min: 0.3, max: 1.0, step: 0.02, default: 0.6 },
  bulk: { label: "Bulk", min: 0.3, max: 1.0, step: 0.02, default: 0.5 },
  asymmetry: { label: "Asymmetry", min: 0, max: 1, step: 0.02, default: 0.3 },
  barrelCount: { label: "Barrels", min: 1, max: ARSENAL_LIMITS.MAX_BARRELS, step: 1, default: 1, int: true },
  coilRings: { label: "Coil rings", min: 0, max: ARSENAL_LIMITS.MAX_COIL_RINGS, step: 1, default: 4, int: true },
  fins: { label: "Fins", min: 0, max: ARSENAL_LIMITS.MAX_FINS, step: 1, default: 6, int: true },
  energyHue: { label: "Energy hue", min: 0, max: 1, step: 0.01, default: 0.55 },
  coreIntensity: { label: "Core glow", min: 0, max: 2, step: 0.05, default: 1.1 },
  refractionStrength: { label: "Refraction", min: 0, max: 0.5, step: 0.01, default: 0.18 },
  pulseRate: { label: "Pulse rate", min: 0, max: 3, step: 0.05, default: 1.4 },
  glassIOR: { label: "Glass IOR", min: 1.2, max: 1.8, step: 0.01, default: 1.4 },
});

const PARAM_KEYS = Object.keys(PARAM_RANGES);

function clampParam(key, value) {
  const r = PARAM_RANGES[key];
  const n = Number(value);
  const v = clamp(Number.isFinite(n) ? n : r.default, r.min, r.max);
  return r.int ? Math.round(v) : v;
}

/**
 * Normalize an arbitrary (possibly untrusted) override object into a valid config.
 * @param {object} [overrides]
 */
export function createWeaponConfig(overrides = {}) {
  const src = overrides && typeof overrides === "object" ? overrides : {};
  const config = {
    seed: sanitizeSeed(src.seed),
    type: WEAPON_TYPES.includes(src.type) ? src.type : "sidearm",
    rarity: RARITIES.includes(src.rarity) ? src.rarity : "common",
  };
  for (const key of PARAM_KEYS) config[key] = clampParam(key, src[key] ?? PARAM_RANGES[key].default);
  return config;
}

function sanitizeSeed(value) {
  const s = String(value ?? "arsenal-1").slice(0, 64);
  const cleaned = s.replace(/[^A-Za-z0-9_.\- ]/g, "");
  return cleaned.length ? cleaned : "arsenal-1";
}

// Per-type bias so a rolled weapon already reads like its archetype before the
// grammar's silhouette profile is applied. Values are multipliers/offsets on the
// rolled 0..1 draw, then re-clamped.
const TYPE_BIAS = {
  sidearm: { length: [0.30, 0.55], bulk: [0.35, 0.6], barrelCount: [1, 1], coilRings: [0, 4], fins: [0, 5] },
  longarm: { length: [0.65, 1.0], bulk: [0.4, 0.65], barrelCount: [1, 2], coilRings: [2, 8], fins: [2, 9] },
  heavy: { length: [0.7, 1.0], bulk: [0.75, 1.0], barrelCount: [1, 4], coilRings: [4, 12], fins: [4, 14] },
  exotic: { length: [0.45, 0.9], bulk: [0.4, 0.85], barrelCount: [1, 3], coilRings: [3, 11], fins: [6, 16] },
};

const RARITY_BY_ROLL = ["common", "common", "rare", "rare", "epic", "mythic"];

/**
 * Roll a fully seed-derived config for a type — used by the workbench "Randomize".
 * The user can then tweak any slider; the grammar re-derives the recipe from the
 * resulting config either way.
 * @param {string} seed
 * @param {string} type
 */
export function rollConfig(seed, type) {
  const t = WEAPON_TYPES.includes(type) ? type : "sidearm";
  const rng = createRng(`${seed}:${t}:roll`);
  const bias = TYPE_BIAS[t];
  const ranged = (key) => {
    const [lo, hi] = bias[key] ?? [PARAM_RANGES[key].min, PARAM_RANGES[key].max];
    return rng.float(lo, hi);
  };
  return createWeaponConfig({
    seed,
    type: t,
    rarity: rng.pick(RARITY_BY_ROLL),
    length: ranged("length"),
    bulk: ranged("bulk"),
    asymmetry: rng.float(0, 0.7),
    barrelCount: Math.round(ranged("barrelCount")),
    coilRings: Math.round(ranged("coilRings")),
    fins: Math.round(ranged("fins")),
    energyHue: rng.float(0, 1),
    coreIntensity: rng.float(0.7, 1.8),
    refractionStrength: rng.float(0.08, 0.32),
    pulseRate: rng.float(0.8, 2.4),
    glassIOR: rng.float(1.3, 1.6),
  });
}
