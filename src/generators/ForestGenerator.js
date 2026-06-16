// Forest grove generator (Stage 18). Pure + deterministic + hard-capped. Natural
// cover: trees scattered (area-uniform) in an annulus around a kept central
// clearing, plus scattered rocks. Trees can be prefab-backed (propPrefab, e.g. the
// built-in tree cluster); the primitive fallback is a trunk + canopy pair kept
// atomic against the cap. No THREE, no scene authority.

import { mulberry32 } from "../utils/random.js";
import { GENERATOR_LIMITS, stringToSeed } from "./GeneratorConfig.js";
import { getHeight } from "../terrain/terrainSampling.js";
import { PRIMITIVE_BASE, primitiveDescriptor, prefabFitScale, createEmitter } from "./emitHelpers.js";

const TAU = Math.PI * 2;
const CYL_R = PRIMITIVE_BASE.cylRadius;
const CYL_H = PRIMITIVE_BASE.cylHeight;
const SPH = PRIMITIVE_BASE.sphere;

const TRUNK_COLOR = "#6b4a2f";
const LEAF_COLOR = "#356b2e";
const ROCK_COLOR = "#7c7a74";

const STYLE_DENSITY = { grove: 1.0, dense: 1.5, sparse: 0.6 };
const STYLE_CLEARING = { grove: 0.34, dense: 0.28, sparse: 0.2 };

export function generateForestLayout(config) {
  const rng = mulberry32(stringToSeed(`${config.seed}:${config.style}`));
  const { size, density, origin, style } = config;
  const cx = origin.x;
  const cz = origin.z;
  const radius = 10 + size * 4;
  const clearingR = radius * (STYLE_CLEARING[style] ?? 0.3);
  const styleDensity = STYLE_DENSITY[style] ?? 1.0;

  // Target tree count scales with area × density, hard-capped. Rejection-sample
  // area-uniform points and keep those outside the clearing; the attempt count is
  // bounded so the loop always terminates.
  const target = Math.min(GENERATOR_LIMITS.MAX_TREES, Math.round(radius * radius * density * styleDensity * 0.02));
  const trees = [];
  const maxAttempts = target * 4 + 16;
  for (let i = 0; i < maxAttempts && trees.length < target; i++) {
    const a = rng() * TAU;
    const rr = Math.sqrt(rng()) * radius; // area-uniform radial distribution
    if (rr < clearingR) continue;
    const x = cx + Math.cos(a) * rr;
    const z = cz + Math.sin(a) * rr;
    trees.push({ x, z, trunkR: 0.22 + rng() * 0.18, trunkH: 2.4 + rng() * 2.2, canopyR: 1.1 + rng() * 1.0 });
  }

  const rocks = [];
  const rockCount = Math.min(GENERATOR_LIMITS.MAX_ROCKS, Math.round(size * density * 3));
  for (let i = 0; i < rockCount; i++) {
    const a = rng() * TAU;
    const rr = Math.sqrt(rng()) * radius;
    rocks.push({ x: cx + Math.cos(a) * rr, z: cz + Math.sin(a) * rr, s: 0.5 + rng() * 0.9, yaw: rng() * TAU });
  }

  const pad = radius + 4;
  return {
    center: { x: cx, z: cz },
    clearingR,
    trees,
    rocks,
    bounds: { minX: cx - pad, maxX: cx + pad, minZ: cz - pad, maxZ: cz + pad },
    counts: { trees: trees.length, rocks: rocks.length },
  };
}

export function forestLayoutToWorldObjects(layout, generatorId = "gen-forest", { propPrefab = null } = {}) {
  const cap = GENERATOR_LIMITS.MAX_TOTAL_OBJECTS;
  const { out, push, pushPrefab } = createEmitter(generatorId, cap);

  for (const t of layout?.trees ?? []) {
    const base = getHeight(t.x, t.z);
    if (propPrefab && pushPrefab(propPrefab, { x: t.x, y: base, z: t.z }, 0, prefabFitScale(propPrefab, t.canopyR * 2, t.canopyR * 2), "vegetation")) {
      continue;
    }
    // Primitive tree = trunk + canopy. Keep the pair atomic against the cap so a
    // tree is never half-emitted.
    if (out.length + 2 > cap) break;
    push(
      primitiveDescriptor("cylinder", "Trunk", TRUNK_COLOR, generatorId, {
        pos: [t.x, base + t.trunkH / 2, t.z],
        rot: [0, 0, 0],
        scale: [t.trunkR / CYL_R, t.trunkH / CYL_H, t.trunkR / CYL_R],
        collider: "cylinder",
        castShadow: true,
        receiveShadow: true,
        excludeGrass: true,
        excludeTrees: false,
        layoutRole: "vegetation",
      })
    );
    push(
      primitiveDescriptor("sphere", "Canopy", LEAF_COLOR, generatorId, {
        pos: [t.x, base + t.trunkH + t.canopyR * 0.6, t.z],
        rot: [0, 0, 0],
        scale: [t.canopyR / SPH, t.canopyR / SPH, t.canopyR / SPH],
        collider: "none",
        castShadow: true,
        receiveShadow: false,
        excludeGrass: true,
        excludeTrees: false,
        layoutRole: "vegetation",
      })
    );
  }

  for (const rk of layout?.rocks ?? []) {
    const base = getHeight(rk.x, rk.z);
    push(
      primitiveDescriptor("sphere", "Rock", ROCK_COLOR, generatorId, {
        pos: [rk.x, base + rk.s * 0.4, rk.z],
        rot: [0, rk.yaw, 0],
        scale: [rk.s / SPH, (rk.s * 0.7) / SPH, rk.s / SPH],
        collider: "box",
        castShadow: true,
        receiveShadow: true,
        excludeGrass: true,
        excludeTrees: true,
        layoutRole: "prop",
      })
    );
  }

  return out;
}
