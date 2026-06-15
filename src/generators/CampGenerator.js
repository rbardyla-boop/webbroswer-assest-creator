// Camp / outpost generator (Stage 18). Pure: (seed, config) → a layout of plain
// descriptors; the emitter turns it into NORMAL WorldDocument objects. Same
// boundary as the city generator — no THREE, no scene authority, deterministic
// mulberry32 only, every loop hard-capped.
//
// This is the "engine becomes a game-builder" generator: besides scenery (tents,
// crates, a fire pit), it emits DATA-ONLY gameplay objects — a sign, a named spawn
// point, an entrance trigger volume, and optional pickups — all via the existing
// Stage 12 interaction schema. Tents can be prefab-backed; everything falls back to
// primitives.

import { mulberry32 } from "../utils/random.js";
import { GENERATOR_LIMITS, stringToSeed } from "./GeneratorConfig.js";
import { getHeight } from "../terrain/terrainSampling.js";
import { PRIMITIVE_BASE, primitiveDescriptor, prefabFitScale, createEmitter } from "./emitHelpers.js";

const TAU = Math.PI * 2;
const CUBE = PRIMITIVE_BASE.cube;
const CYL_R = PRIMITIVE_BASE.cylRadius;
const CYL_H = PRIMITIVE_BASE.cylHeight;

const TENT_COLOR = "#9a7b4f";
const CRATE_COLOR = "#6e5234";
const FIRE_COLOR = "#2c1d16";
const SIGN_COLOR = "#5b4a33";
const PICKUP_COLOR = "#e0c850";

const STYLE_TUNE = {
  outpost: { tents: 1.0, spread: 1.0 },
  camp: { tents: 1.4, spread: 0.9 },
  watch: { tents: 0.6, spread: 1.3 },
};

export function generateCampLayout(config) {
  const rng = mulberry32(stringToSeed(`${config.seed}:${config.style}`));
  const { size, density, origin, style } = config;
  const cx = origin.x;
  const cz = origin.z;
  const tune = STYLE_TUNE[style] ?? STYLE_TUNE.outpost;
  const ringR = 6 + size * 2.4;

  // Tents ringed around the fire, each facing inward.
  const tentCount = Math.min(
    GENERATOR_LIMITS.MAX_TENTS,
    Math.max(2, Math.round((2 + size * (0.8 + density)) * tune.tents))
  );
  const tents = [];
  for (let i = 0; i < tentCount; i++) {
    const a = (i / tentCount) * TAU + (rng() - 0.5) * 0.35;
    const rr = ringR * tune.spread * (0.82 + rng() * 0.3);
    const x = cx + Math.cos(a) * rr;
    const z = cz + Math.sin(a) * rr;
    const yaw = Math.atan2(cx - x, cz - z); // face the fire (yaw about +Y)
    tents.push({ x, z, yaw, w: 2.4 + rng() * 1.1, d: 2.8 + rng() * 1.3, h: 1.9 + rng() * 0.9 });
  }

  // Crates clustered beside random tents.
  const crateCount = Math.min(GENERATOR_LIMITS.MAX_CRATES, Math.round(size * density * 2.5));
  const crates = [];
  for (let i = 0; i < crateCount; i++) {
    const t = tents[Math.floor(rng() * tents.length)] ?? { x: cx, z: cz };
    const a = rng() * TAU;
    const off = 1.2 + rng() * 1.6;
    crates.push({ x: t.x + Math.cos(a) * off, z: t.z + Math.sin(a) * off, s: 0.7 + rng() * 0.6, yaw: rng() * TAU });
  }

  const fire = { x: cx, z: cz, r: 0.9 + size * 0.08 };

  // Entrance on the -Z side: sign + trigger out front, spawn just inside.
  const entranceA = -Math.PI / 2;
  const ex = cx + Math.cos(entranceA) * (ringR + 2.5);
  const ez = cz + Math.sin(entranceA) * (ringR + 2.5);
  const sign = { x: ex + 1.4, z: ez, yaw: entranceA + Math.PI, text: `Camp - ${style}` };
  const trigger = { x: ex, z: ez, radius: Math.min(250, ringR * 0.9), event: "camp-enter" };
  const spawn = {
    x: cx + Math.cos(entranceA) * (ringR * 0.35),
    z: cz + Math.sin(entranceA) * (ringR * 0.35),
    name: "camp-spawn",
  };

  // Optional pickup placeholders near tents.
  const pickupCount = Math.min(GENERATOR_LIMITS.MAX_INTERACTIONS, Math.round(density * size));
  const pickups = [];
  for (let i = 0; i < pickupCount; i++) {
    const t = tents[Math.floor(rng() * tents.length)] ?? { x: cx, z: cz };
    const a = rng() * TAU;
    const off = 0.8 + rng() * 1.2;
    pickups.push({ x: t.x + Math.cos(a) * off, z: t.z + Math.sin(a) * off, event: "supply-collected" });
  }

  const pad = ringR + 4;
  return {
    center: { x: cx, z: cz },
    fire,
    tents,
    crates,
    spawn,
    sign,
    trigger,
    pickups,
    bounds: { minX: cx - pad, maxX: cx + pad, minZ: cz - pad, maxZ: cz + pad },
    counts: { tents: tents.length, crates: crates.length, pickups: pickups.length },
  };
}

export function campLayoutToWorldObjects(layout, generatorId = "gen-camp", { buildingPrefab = null, propPrefab = null } = {}) {
  const { out, push, pushPrefab } = createEmitter(generatorId, GENERATOR_LIMITS.MAX_TOTAL_OBJECTS);

  for (const t of layout?.tents ?? []) {
    const base = getHeight(t.x, t.z);
    if (buildingPrefab && pushPrefab(buildingPrefab, { x: t.x, y: base, z: t.z }, t.yaw, prefabFitScale(buildingPrefab, t.w, t.d))) {
      continue;
    }
    push(
      primitiveDescriptor("cube", "Tent", TENT_COLOR, generatorId, {
        pos: [t.x, base + t.h / 2, t.z],
        rot: [0, t.yaw, 0],
        scale: [t.w / CUBE, t.h / CUBE, t.d / CUBE],
        collider: "box",
        castShadow: true,
        receiveShadow: true,
        excludeGrass: true,
        excludeTrees: true,
      })
    );
  }

  for (const c of layout?.crates ?? []) {
    const base = getHeight(c.x, c.z);
    if (propPrefab && pushPrefab(propPrefab, { x: c.x, y: base, z: c.z }, c.yaw, prefabFitScale(propPrefab, c.s, c.s))) {
      continue;
    }
    push(
      primitiveDescriptor("cube", "Crate", CRATE_COLOR, generatorId, {
        pos: [c.x, base + c.s / 2, c.z],
        rot: [0, c.yaw, 0],
        scale: [c.s / CUBE, c.s / CUBE, c.s / CUBE],
        collider: "box",
        castShadow: true,
        receiveShadow: true,
        excludeGrass: true,
        excludeTrees: true,
      })
    );
  }

  // Fire pit: a short dark cylinder with rising ember sparks (data-only particles).
  if (layout?.fire) {
    const f = layout.fire;
    const base = getHeight(f.x, f.z);
    push(
      primitiveDescriptor("cylinder", "Fire Pit", FIRE_COLOR, generatorId, {
        pos: [f.x, base + 0.2, f.z],
        rot: [0, 0, 0],
        scale: [f.r / CYL_R, 0.4 / CYL_H, f.r / CYL_R],
        collider: "cylinder",
        castShadow: false,
        receiveShadow: true,
        excludeGrass: true,
        excludeTrees: true,
        particles: { kind: "spark" },
      })
    );
  }

  // Sign at the entrance (data-only sign interaction; the board is a thin box).
  if (layout?.sign) {
    const s = layout.sign;
    const base = getHeight(s.x, s.z);
    push(
      primitiveDescriptor("cube", "Camp Sign", SIGN_COLOR, generatorId, {
        pos: [s.x, base + 1.0, s.z],
        rot: [0, s.yaw, 0],
        scale: [1.5 / CUBE, 0.9 / CUBE, 0.16 / CUBE],
        collider: "none",
        castShadow: false,
        receiveShadow: false,
        excludeGrass: true,
        excludeTrees: true,
        interaction: { role: "sign", text: s.text, showRadius: 6 },
      })
    );
  }

  // Spawn point: invisible marker the runtime can teleport to by name.
  if (layout?.spawn) {
    const sp = layout.spawn;
    const base = getHeight(sp.x, sp.z);
    push(
      primitiveDescriptor("cube", "Camp Spawn", null, generatorId, {
        pos: [sp.x, base + 0.5, sp.z],
        rot: [0, 0, 0],
        scale: [0.4 / CUBE, 0.4 / CUBE, 0.4 / CUBE],
        collider: "none",
        castShadow: false,
        receiveShadow: false,
        visible: false,
        excludeGrass: true,
        excludeTrees: true,
        interaction: { role: "spawn", name: sp.name },
      })
    );
  }

  // Trigger volume at the entrance: invisible sphere; emits a named event on enter.
  if (layout?.trigger) {
    const tr = layout.trigger;
    const base = getHeight(tr.x, tr.z);
    push(
      primitiveDescriptor("sphere", "Camp Trigger", null, generatorId, {
        pos: [tr.x, base + 1.0, tr.z],
        rot: [0, 0, 0],
        scale: [1, 1, 1],
        collider: "none",
        castShadow: false,
        receiveShadow: false,
        visible: false,
        excludeGrass: true,
        excludeTrees: true,
        interaction: { role: "trigger", shape: "sphere", radius: tr.radius, channel: "default", emitOnEnter: [tr.event], emitOnExit: [], once: false },
      })
    );
  }

  for (const pk of layout?.pickups ?? []) {
    const base = getHeight(pk.x, pk.z);
    push(
      primitiveDescriptor("sphere", "Supply", PICKUP_COLOR, generatorId, {
        pos: [pk.x, base + 0.5, pk.z],
        rot: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
        collider: "none",
        castShadow: false,
        receiveShadow: false,
        excludeGrass: true,
        excludeTrees: true,
        interaction: { role: "pickup", channel: "default", emitOnCollect: [pk.event], radius: 1.5, respawn: false },
      })
    );
  }

  return out;
}
