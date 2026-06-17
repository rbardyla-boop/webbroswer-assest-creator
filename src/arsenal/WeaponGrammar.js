// Weapon grammar — PURE: (config) → recipe of plain part descriptors. No THREE, no
// scene, no Math.random; deterministic from the seed. This is where silhouette
// IDENTITY lives: each base type has profile rules so it reads at a glance —
// sidearm = compact, longarm = directional, heavy = massive, exotic = impossible.
// The recipe is JSON the geometry stage turns into BufferGeometry; capped so a
// hostile config can never emit unbounded parts.
//
// Convention: the weapon lies along +X (muzzle toward +X), grip toward -Y, centered
// near the origin. A part = { shape, role, pos:[x,y,z], size:[...], rot:[x,y,z], color }.

import { clamp, lerp, TAU } from "../utils/math.js";
import { createRng } from "./WeaponSeed.js";
import { createWeaponConfig, ARSENAL_LIMITS } from "./WeaponConfig.js";

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

// --- shared part kit ---------------------------------------------------------------

function receiver(ctx, len, h, thick) {
  ctx.push({ shape: "box", role: "alloy", pos: [0, 0, 0], size: [len, h, thick], color: ctx.alloyOf() });
}

function barrels(ctx, xStart, len, r, count, color) {
  const n = clamp(Math.round(count), 1, ARSENAL_LIMITS.MAX_BARRELS);
  const spread = n > 1 ? r * 1.3 : 0;
  for (let i = 0; i < n; i++) {
    const off = n > 1 ? lerp(-spread, spread, i / (n - 1)) : 0;
    ctx.push({ shape: "cyl", role: "alloy", pos: [xStart + len / 2, 0, off], size: [r, len, r], rot: [0, 0, Math.PI / 2], color });
  }
}

function coilRings(ctx, x0, x1, r, count, color) {
  const n = clamp(Math.round(count), 0, ARSENAL_LIMITS.MAX_COIL_RINGS);
  for (let i = 0; i < n; i++) {
    const x = n > 1 ? lerp(x0, x1, i / (n - 1)) : (x0 + x1) / 2;
    ctx.push({ shape: "ring", role: "energy", pos: [x, 0, 0], size: [r * 1.35, r * 0.28, 1], rot: [0, Math.PI / 2, 0], color });
  }
}

function reactorCore(ctx, x, r, len, color) {
  ctx.push({ shape: "cyl", role: "energy", pos: [x, 0, 0], size: [r, len, r], rot: [0, 0, Math.PI / 2], color });
}

function grip(ctx, x, h, color) {
  const a = -0.32; // rake back
  ctx.push({ shape: "box", role: "alloy", pos: [x, -h / 2 - 0.05, 0], size: [0.34, h, 0.46], rot: [0, 0, a], color });
}

function topSight(ctx, x, color) {
  ctx.push({ shape: "box", role: "alloy", pos: [x, 0.32, 0], size: [0.5, 0.14, 0.16], color });
}

function fins(ctx, x, count, span, color) {
  const n = clamp(Math.round(count), 0, ARSENAL_LIMITS.MAX_FINS);
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0.5;
    const ang = lerp(-span, span, t);
    ctx.push({ shape: "box", role: "alloy", pos: [x - i * 0.06, Math.sin(ang) * 0.05, 0], size: [0.1, 0.5, 0.04], rot: [ang, 0, 0], color });
  }
}

function sidePlates(ctx, x, len, h, thick, color) {
  for (const s of [-1, 1]) {
    ctx.push({ shape: "box", role: "alloy", pos: [x, 0, s * thick], size: [len, h, 0.1], color });
  }
}

// --- per-type silhouettes ----------------------------------------------------------

function buildSidearm(ctx) {
  const { length, bulk, energyColor, energyHi, alloyOf } = ctx;
  const len = length * 0.7;
  const h = bulk * 1.5;
  receiver(ctx, len, h, bulk * 1.4);
  barrels(ctx, len / 2 - 0.05, len * 0.5, bulk * 0.42, ctx.config.barrelCount, alloyOf());
  reactorCore(ctx, -len * 0.1, bulk * 0.5, len * 0.5, energyColor);
  grip(ctx, -len * 0.28, h * 1.05, alloyOf());
  topSight(ctx, len * 0.1, alloyOf());
  coilRings(ctx, len * 0.15, len * 0.55, bulk * 0.42, Math.min(4, ctx.config.coilRings), energyHi);
  // floating holo-sight dot
  ctx.push({ shape: "ring", role: "energy", pos: [len * 0.12, h * 0.8, 0], size: [0.12, 0.04, 1], rot: [0, 0, 0], color: energyHi });
}

function buildLongarm(ctx) {
  const { length, bulk, energyColor, energyHi, alloyOf } = ctx;
  const len = length;
  const h = bulk * 1.25;
  receiver(ctx, len, h, bulk * 1.2);
  // long barrel forward + coil spine over it
  const bx = len / 2 - 0.05;
  const blen = len * 0.55;
  barrels(ctx, bx, blen, bulk * 0.34, ctx.config.barrelCount, alloyOf());
  coilRings(ctx, bx + blen * 0.1, bx + blen * 0.95, bulk * 0.34, ctx.config.coilRings, energyHi);
  // energy tube along the receiver spine
  reactorCore(ctx, -len * 0.05, bulk * 0.34, len * 0.7, energyColor);
  // stock rearward + forward grip + top rail
  ctx.push({ shape: "box", role: "alloy", pos: [-len * 0.62, -h * 0.2, 0], size: [len * 0.32, h * 0.9, bulk * 0.9], rot: [0, 0, 0.06], color: alloyOf() });
  grip(ctx, -len * 0.16, h * 1.1, alloyOf());
  ctx.push({ shape: "box", role: "alloy", pos: [len * 0.18, h * 0.62, 0], size: [len * 0.5, 0.08, 0.14], color: alloyOf() }); // top rail
  fins(ctx, -len * 0.34, Math.min(6, ctx.config.fins), 0.5, alloyOf());
}

function buildHeavy(ctx) {
  const { length, bulk, energyColor, energyHi, alloyOf } = ctx;
  const len = length;
  const h = bulk * 1.9;
  receiver(ctx, len * 0.8, h, bulk * 1.7);
  // oversized core + concentric multi-ring barrel
  reactorCore(ctx, -len * 0.04, bulk * 0.95, len * 0.5, energyColor);
  const bx = len / 2 - 0.1;
  const blen = len * 0.5;
  barrels(ctx, bx, blen, bulk * 0.55, ctx.config.barrelCount, alloyOf());
  coilRings(ctx, bx, bx + blen, bulk * 0.95, ctx.config.coilRings, energyHi);
  // chunky side plates + heat-sink fins + back battery
  sidePlates(ctx, -len * 0.05, len * 0.7, h * 0.9, bulk * 1.5, alloyOf());
  fins(ctx, -len * 0.2, ctx.config.fins, 0.7, alloyOf());
  ctx.push({ shape: "box", role: "alloy", pos: [-len * 0.55, 0, 0], size: [len * 0.3, h * 1.05, bulk * 1.8], color: alloyOf() }); // battery
  ctx.push({ shape: "box", role: "energy", pos: [-len * 0.55, 0, 0], size: [len * 0.12, h * 0.7, bulk * 0.5], color: energyHi }); // battery window
  grip(ctx, -len * 0.1, h * 0.9, alloyOf());
}

function buildExotic(ctx) {
  const { length, bulk, energyColor, energyHi, alloyOf, rng } = ctx;
  // NOT a gun: a haft + prism head + orbiting rings + floating fins around a focus.
  const haft = length * 1.05;
  ctx.push({ shape: "cyl", role: "alloy", pos: [-haft * 0.12, 0, 0], size: [bulk * 0.16, haft, bulk * 0.16], rot: [0, 0, Math.PI / 2], color: alloyOf() });
  // prism focus head at +X
  const hx = haft * 0.42;
  ctx.push({ shape: "prism", role: "energy", pos: [hx, 0, 0], size: [bulk * 1.1, bulk * 1.5, bulk * 1.1], rot: [0, 0, 0], color: energyColor });
  // a cage cradling the prism
  for (const s of [-1, 1]) {
    ctx.push({ shape: "box", role: "alloy", pos: [hx, 0, s * bulk * 0.7], size: [bulk * 1.4, bulk * 1.7, 0.06], rot: [0, 0, rng.jitter(0.15)], color: alloyOf() });
  }
  // orbiting energy rings (floating)
  const rings = clamp(Math.round(ctx.config.coilRings * 0.8) + 2, 2, ARSENAL_LIMITS.MAX_COIL_RINGS);
  for (let i = 0; i < rings; i++) {
    const t = i / Math.max(1, rings - 1);
    ctx.push({ shape: "ring", role: "energy", pos: [hx, 0, 0], size: [bulk * (1.3 + t * 0.7), bulk * 0.12, 1], rot: [rng.float(0, TAU), rng.float(0, TAU), 0], color: energyHi });
  }
  // floating fins fanned around the head (asymmetric). Exotic identity needs ≥3 fins
  // to read as a focus array, so the floor is intentionally above the slider's 0 min.
  const nf = clamp(ctx.config.fins, 3, ARSENAL_LIMITS.MAX_FINS);
  for (let i = 0; i < nf; i++) {
    const a = (i / nf) * TAU + rng.jitter(ctx.config.asymmetry);
    const rr = bulk * (1.6 + rng.jitter(ctx.config.asymmetry * 0.6));
    ctx.push({ shape: "box", role: "alloy", pos: [hx + rng.jitter(0.2), Math.sin(a) * rr, Math.cos(a) * rr], size: [0.5, 0.08, 0.03], rot: [a, 0, 0], color: alloyOf() });
  }
  // a counterweight at the butt
  ctx.push({ shape: "cyl", role: "energy", pos: [-haft * 0.55, 0, 0], size: [bulk * 0.4, bulk * 0.5, bulk * 0.4], rot: [0, 0, Math.PI / 2], color: energyColor });
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
