// Ruin cluster generator (Stage 18). Pure + deterministic + hard-capped, like the
// other generators. An exploration landmark: toppled walls scattered on a ring, a
// broken colonnade (columns → propPrefab, or primitive cylinders), rubble, a low
// central platform fragment, and a data-only sign. No THREE, no scene authority.

import { mulberry32 } from "../utils/random.js";
import { GENERATOR_LIMITS, stringToSeed } from "./GeneratorConfig.js";
import { getHeight } from "../terrain/terrainSampling.js";
import { PRIMITIVE_BASE, primitiveDescriptor, prefabFitScale, createEmitter } from "./emitHelpers.js";

const TAU = Math.PI * 2;
const CUBE = PRIMITIVE_BASE.cube;
const CYL_R = PRIMITIVE_BASE.cylRadius;
const CYL_H = PRIMITIVE_BASE.cylHeight;
const SPH = PRIMITIVE_BASE.sphere;

const STONE = "#8d8a82";
const DARK_STONE = "#6f6c64";

export function generateRuinLayout(config) {
  const rng = mulberry32(stringToSeed(`${config.seed}:${config.style}`));
  const { size, density, origin, style } = config;
  const cx = origin.x;
  const cz = origin.z;
  const radius = 8 + size * 3;

  // Toppled walls scattered around a ring, tangentially oriented and broken short.
  const walls = [];
  const wallCount = Math.min(GENERATOR_LIMITS.MAX_RUBBLE, Math.max(4, Math.round(5 + size * 1.6)));
  for (let i = 0; i < wallCount; i++) {
    const a = (i / wallCount) * TAU + (rng() - 0.5) * 0.4;
    const rr = radius * (0.7 + rng() * 0.35);
    const x = cx + Math.cos(a) * rr;
    const z = cz + Math.sin(a) * rr;
    const yaw = a + Math.PI / 2 + (rng() - 0.5) * 0.5; // roughly tangent
    const broken = 0.35 + rng() * 0.6; // ruined height fraction
    const tilt = (rng() - 0.5) * 0.22; // slight lean about X
    walls.push({ x, z, yaw, tilt, w: 2.5 + rng() * 3, h: (2.5 + rng() * 2) * broken, d: 0.5 + rng() * 0.3 });
  }

  // Broken colonnade: 1–2 rows (temple → 2), some columns snapped short.
  const columns = [];
  const colCount = Math.min(GENERATOR_LIMITS.MAX_COLUMNS, Math.max(2, Math.round(3 + size * 1.4)));
  const rows = style === "temple" ? 2 : 1;
  const perRow = Math.max(1, Math.round(colCount / rows));
  const spacing = (radius * 1.2) / Math.max(1, perRow - 1);
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < perRow; i++) {
      if (columns.length >= colCount) break;
      const x = cx - radius * 0.6 + i * spacing;
      const z = cz + (rows === 1 ? 0 : r === 0 ? -1 : 1) * radius * 0.3;
      const h = (2 + rng() * 3) * (rng() < 0.4 ? 0.5 : 1); // some broken short
      columns.push({ x, z, r: 0.4 + rng() * 0.25, h });
    }
  }

  // Rubble scatter.
  const rubble = [];
  const rubbleCount = Math.min(GENERATOR_LIMITS.MAX_RUBBLE, Math.round(size * density * 6));
  for (let i = 0; i < rubbleCount; i++) {
    const a = rng() * TAU;
    const rr = rng() * radius;
    rubble.push({
      x: cx + Math.cos(a) * rr,
      z: cz + Math.sin(a) * rr,
      s: 0.4 + rng() * 0.8,
      kind: rng() < 0.5 ? "cube" : "sphere",
      yaw: rng() * TAU,
    });
  }

  const platform = { x: cx, z: cz, w: radius * 0.7, d: radius * 0.5, h: 0.4 };
  const sign = { x: cx, z: cz - radius - 2, yaw: 0, text: "Ruins" };

  const pad = radius + 4;
  return {
    center: { x: cx, z: cz },
    platform,
    walls,
    columns,
    rubble,
    sign,
    bounds: { minX: cx - pad, maxX: cx + pad, minZ: cz - pad, maxZ: cz + pad },
    counts: { walls: walls.length, columns: columns.length, rubble: rubble.length },
  };
}

export function ruinLayoutToWorldObjects(layout, generatorId = "gen-ruin", { propPrefab = null } = {}) {
  const { out, push, pushPrefab } = createEmitter(generatorId, GENERATOR_LIMITS.MAX_TOTAL_OBJECTS);

  // Central platform fragment.
  if (layout?.platform) {
    const p = layout.platform;
    const base = getHeight(p.x, p.z);
    push(
      primitiveDescriptor("cube", "Ruin Floor", DARK_STONE, generatorId, {
        pos: [p.x, base + p.h / 2, p.z],
        rot: [0, 0, 0],
        scale: [p.w / CUBE, p.h / CUBE, p.d / CUBE],
        collider: "box",
        castShadow: false,
        receiveShadow: true,
        excludeGrass: true,
        excludeTrees: true,
        layoutRole: "building",
      })
    );
  }

  for (const w of layout?.walls ?? []) {
    const base = getHeight(w.x, w.z);
    push(
      primitiveDescriptor("cube", "Ruined Wall", STONE, generatorId, {
        pos: [w.x, base + w.h / 2, w.z],
        rot: [w.tilt, w.yaw, 0],
        scale: [w.w / CUBE, w.h / CUBE, w.d / CUBE],
        collider: "box",
        castShadow: true,
        receiveShadow: true,
        excludeGrass: true,
        excludeTrees: true,
        layoutRole: "edge",
      })
    );
  }

  for (const c of layout?.columns ?? []) {
    const base = getHeight(c.x, c.z);
    if (propPrefab && pushPrefab(propPrefab, { x: c.x, y: base, z: c.z }, 0, prefabFitScale(propPrefab, c.r * 2, c.r * 2), "prop")) {
      continue;
    }
    push(
      primitiveDescriptor("cylinder", "Column", DARK_STONE, generatorId, {
        pos: [c.x, base + c.h / 2, c.z],
        rot: [0, 0, 0],
        scale: [c.r / CYL_R, c.h / CYL_H, c.r / CYL_R],
        collider: "cylinder",
        castShadow: true,
        receiveShadow: true,
        excludeGrass: true,
        excludeTrees: true,
        layoutRole: "prop",
      })
    );
  }

  for (const rb of layout?.rubble ?? []) {
    const base = getHeight(rb.x, rb.z);
    const kind = rb.kind === "sphere" ? "sphere" : "cube";
    const sBase = kind === "sphere" ? SPH : CUBE;
    push(
      primitiveDescriptor(kind, "Rubble", STONE, generatorId, {
        pos: [rb.x, base + rb.s / 2, rb.z],
        rot: [0, rb.yaw, 0],
        scale: [rb.s / sBase, rb.s / sBase, rb.s / sBase],
        collider: "none",
        castShadow: true,
        receiveShadow: true,
        excludeGrass: true,
        excludeTrees: true,
        layoutRole: "prop",
      })
    );
  }

  if (layout?.sign) {
    const s = layout.sign;
    const base = getHeight(s.x, s.z);
    push(
      primitiveDescriptor("cube", "Ruins Sign", DARK_STONE, generatorId, {
        pos: [s.x, base + 1.0, s.z],
        rot: [0, s.yaw, 0],
        scale: [1.4 / CUBE, 0.9 / CUBE, 0.16 / CUBE],
        collider: "none",
        castShadow: false,
        receiveShadow: false,
        excludeGrass: true,
        excludeTrees: true,
        interaction: { role: "sign", text: s.text, showRadius: 6 },
        layoutRole: "marker",
      })
    );
  }

  return out;
}
