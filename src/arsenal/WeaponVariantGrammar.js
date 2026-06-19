// Weapon variant grammar (Arsenal v5) — the strengthened per-type silhouette kit.
// PURE: no THREE, no scene, no Math.random; deterministic from ctx.rng. Lifted out of
// WeaponGrammar so the orchestration (config → ctx → dispatch → recipe) stays small while
// the silhouettes get richer and read more distinctly at a glance:
//   sidearm = compact & blocky · longarm = long & directional · heavy = massive & layered
//   · exotic = impossible (floating, radial, not-a-gun).
//
// Convention (unchanged): the weapon lies along +X (muzzle toward +X), grip toward -Y,
// centered near the origin. A part = { shape, role, pos:[x,y,z], size:[...], rot:[x,y,z], color }.
// ctx = { rng, config, length, bulk, energyColor, energyHi, alloyOf, push } (built by
// generateWeaponRecipe). INVARIANTS every builder must hold (the marker anchors + the
// determinism test depend on them): push >=1 role:"energy" part (the `core` anchor), keep a
// sensible lowest-Y hold part for the `equip` anchor (the grip on the gun types; the haft on
// the exotic, kept lowest by fanning its blades to non-negative Y), and stay within the
// part/vertex caps (the shared push() already drops parts past MAX_PARTS).

import { clamp, lerp, TAU } from "../utils/math.js";
import { ARSENAL_LIMITS } from "./WeaponConfig.js";

// --- shared part kit ---------------------------------------------------------------

function receiver(ctx, len, h, thick) {
  ctx.push({ shape: "box", role: "alloy", pos: [0, 0, 0], size: [len, h, thick], color: ctx.alloyOf() });
}

// Barrel run with a muzzle collar at the tip — a stronger forward read than a bare tube.
function barrels(ctx, xStart, len, r, count, color) {
  const n = clamp(Math.round(count), 1, ARSENAL_LIMITS.MAX_BARRELS);
  const spread = n > 1 ? r * 1.3 : 0;
  for (let i = 0; i < n; i++) {
    const off = n > 1 ? lerp(-spread, spread, i / (n - 1)) : 0;
    ctx.push({ shape: "cyl", role: "alloy", pos: [xStart + len / 2, 0, off], size: [r, len, r], rot: [0, 0, Math.PI / 2], color });
    ctx.push({ shape: "cyl", role: "alloy", pos: [xStart + len - 0.04, 0, off], size: [r * 1.25, 0.16, r * 1.25], rot: [0, 0, Math.PI / 2], color });
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

export function buildSidearm(ctx) {
  const { length, bulk, energyColor, energyHi, alloyOf, rng } = ctx;
  const len = length * 0.7;
  const h = bulk * 1.5;
  receiver(ctx, len, h, bulk * 1.4);
  // blocky slide on top — the compact-pistol read
  ctx.push({ shape: "box", role: "alloy", pos: [len * 0.05, h * 0.55, 0], size: [len * 0.9, h * 0.42, bulk * 1.3], color: alloyOf() });
  barrels(ctx, len / 2 - 0.05, len * 0.5, bulk * 0.42, ctx.config.barrelCount, alloyOf());
  reactorCore(ctx, -len * 0.1, bulk * 0.5, len * 0.5, energyColor);
  grip(ctx, -len * 0.28, h * 1.05, alloyOf());
  topSight(ctx, len * 0.1, alloyOf());
  // rear sight notch
  ctx.push({ shape: "box", role: "alloy", pos: [-len * 0.18, h * 0.8, 0], size: [0.12, 0.16, 0.22], color: alloyOf() });
  coilRings(ctx, len * 0.15, len * 0.55, bulk * 0.42, Math.min(4, ctx.config.coilRings), energyHi);
  // floating holo-sight dot
  ctx.push({ shape: "ring", role: "energy", pos: [len * 0.12, h * 0.8, 0], size: [0.12, 0.04, 1], rot: [0, 0, 0], color: energyHi });
  // per-seed compensator vents at the muzzle
  if (rng.chance(0.6)) {
    for (let i = 0; i < 2; i++) ctx.push({ shape: "box", role: "alloy", pos: [len * 0.6, h * (0.1 + i * 0.18), 0], size: [0.14, 0.05, bulk * 0.9], color: alloyOf() });
  }
}

export function buildLongarm(ctx) {
  const { length, bulk, energyColor, energyHi, alloyOf, rng } = ctx;
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
  // stock rearward + grip + top rail
  ctx.push({ shape: "box", role: "alloy", pos: [-len * 0.62, -h * 0.2, 0], size: [len * 0.32, h * 0.9, bulk * 0.9], rot: [0, 0, 0.06], color: alloyOf() });
  grip(ctx, -len * 0.16, h * 1.1, alloyOf());
  ctx.push({ shape: "box", role: "alloy", pos: [len * 0.18, h * 0.62, 0], size: [len * 0.5, 0.08, 0.14], color: alloyOf() }); // top rail
  // scope optic on the rail — a strong directional cue
  ctx.push({ shape: "cyl", role: "alloy", pos: [len * 0.05, h * 0.85, 0], size: [bulk * 0.28, len * 0.3, bulk * 0.28], rot: [0, 0, Math.PI / 2], color: alloyOf() });
  ctx.push({ shape: "ring", role: "energy", pos: [len * 0.2, h * 0.85, 0], size: [bulk * 0.22, 0.05, 1], rot: [0, Math.PI / 2, 0], color: energyHi }); // lens glow
  // foregrip under the barrel (kept above the grip so the grip stays the lowest-Y part)
  ctx.push({ shape: "box", role: "alloy", pos: [len * 0.28, -h * 0.45, 0], size: [0.18, h * 0.7, 0.3], rot: [0, 0, 0.12], color: alloyOf() });
  fins(ctx, -len * 0.34, Math.min(6, ctx.config.fins), 0.5, alloyOf());
  // per-seed muzzle brake
  if (rng.chance(0.7)) ctx.push({ shape: "prism", role: "alloy", pos: [bx + blen + 0.05, 0, 0], size: [bulk * 0.6, bulk * 0.6, bulk * 0.6], color: alloyOf() });
}

export function buildHeavy(ctx) {
  const { length, bulk, energyColor, energyHi, alloyOf, rng } = ctx;
  const len = length;
  const h = bulk * 1.9;
  receiver(ctx, len * 0.8, h, bulk * 1.7);
  // oversized core + a bright inner rod
  reactorCore(ctx, -len * 0.04, bulk * 0.95, len * 0.5, energyColor);
  ctx.push({ shape: "cyl", role: "energy", pos: [-len * 0.04, 0, 0], size: [bulk * 0.4, len * 0.6, bulk * 0.4], rot: [0, 0, Math.PI / 2], color: energyHi });
  // concentric multi-ring barrel + heat shroud
  const bx = len / 2 - 0.1;
  const blen = len * 0.5;
  barrels(ctx, bx, blen, bulk * 0.55, ctx.config.barrelCount, alloyOf());
  coilRings(ctx, bx, bx + blen, bulk * 0.95, ctx.config.coilRings, energyHi);
  ctx.push({ shape: "cyl", role: "alloy", pos: [bx + blen * 0.5, 0, 0], size: [bulk * 0.78, blen * 0.9, bulk * 0.78], rot: [0, 0, Math.PI / 2], color: alloyOf() });
  // chunky side plates + heat-sink fins + back battery
  sidePlates(ctx, -len * 0.05, len * 0.7, h * 0.9, bulk * 1.5, alloyOf());
  fins(ctx, -len * 0.2, ctx.config.fins, 0.7, alloyOf());
  ctx.push({ shape: "box", role: "alloy", pos: [-len * 0.55, 0, 0], size: [len * 0.3, h * 1.05, bulk * 1.8], color: alloyOf() }); // battery
  ctx.push({ shape: "box", role: "energy", pos: [-len * 0.55, 0, 0], size: [len * 0.12, h * 0.7, bulk * 0.5], color: energyHi }); // battery window
  // per-seed ammo drum to one side
  const ds = rng.chance(0.5) ? 1 : -1;
  ctx.push({ shape: "cyl", role: "alloy", pos: [-len * 0.05, -h * 0.1, ds * bulk * 1.2], size: [bulk * 0.85, bulk * 0.5, bulk * 0.85], rot: [Math.PI / 2, 0, 0], color: alloyOf() });
  grip(ctx, -len * 0.1, h * 0.9, alloyOf());
}

export function buildExotic(ctx) {
  const { length, bulk, energyColor, energyHi, alloyOf, rng } = ctx;
  // NOT a gun: a haft + twin prism head + orbiting rings + floating blades around a focus.
  const haft = length * 1.05;
  ctx.push({ shape: "cyl", role: "alloy", pos: [-haft * 0.12, 0, 0], size: [bulk * 0.16, haft, bulk * 0.16], rot: [0, 0, Math.PI / 2], color: alloyOf() });
  // twin prism focus head at +X (stronger energy read)
  const hx = haft * 0.42;
  ctx.push({ shape: "prism", role: "energy", pos: [hx, 0, 0], size: [bulk * 1.1, bulk * 1.5, bulk * 1.1], color: energyColor });
  ctx.push({ shape: "prism", role: "energy", pos: [hx, 0, 0], size: [bulk * 0.6, bulk * 2.0, bulk * 0.6], color: energyHi });
  // a cage cradling the prism
  for (const s of [-1, 1]) {
    ctx.push({ shape: "box", role: "alloy", pos: [hx, 0, s * bulk * 0.7], size: [bulk * 1.4, bulk * 1.7, 0.06], rot: [0, 0, rng.jitter(0.15)], color: alloyOf() });
  }
  // orbiting energy rings (floating)
  const rings = clamp(Math.round(ctx.config.coilRings * 0.8) + 3, 3, ARSENAL_LIMITS.MAX_COIL_RINGS);
  for (let i = 0; i < rings; i++) {
    const t = i / Math.max(1, rings - 1);
    ctx.push({ shape: "ring", role: "energy", pos: [hx, 0, 0], size: [bulk * (1.3 + t * 0.8), bulk * 0.12, 1], rot: [rng.float(0, TAU), rng.float(0, TAU), 0], color: energyHi });
  }
  // floating blades fanned UPWARD into a crown around the head (asymmetric); every third is an
  // energy edge. Biased to non-negative Y so the haft (pushed first, at y=0) stays the lowest-Y
  // part — the equip anchor lands on the haft, not a stray blade. >=3 to read as a focus array.
  const nb = clamp(ctx.config.fins, 3, ARSENAL_LIMITS.MAX_FINS);
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * TAU + rng.jitter(ctx.config.asymmetry);
    const rr = bulk * (1.6 + rng.jitter(ctx.config.asymmetry * 0.6));
    const by = (Math.sin(a) * 0.5 + 0.5) * rr; // [0, rr] — never dips below the haft
    const role = i % 3 === 0 ? "energy" : "alloy";
    ctx.push({ shape: "box", role, pos: [hx + rng.jitter(0.2), by, Math.cos(a) * rr], size: [0.6, 0.08, 0.03], rot: [a, 0, 0], color: role === "energy" ? energyHi : alloyOf() });
  }
  // a counterweight at the butt
  ctx.push({ shape: "cyl", role: "energy", pos: [-haft * 0.55, 0, 0], size: [bulk * 0.4, bulk * 0.5, bulk * 0.4], rot: [0, 0, Math.PI / 2], color: energyColor });
}
