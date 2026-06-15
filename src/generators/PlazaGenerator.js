// Plaza / town-square generator (Stage 18B). Pure + deterministic + hard-capped. A
// paved hub: a paving surface, props ringed around it (benches/stalls → propPrefab,
// else primitives), and DATA-ONLY anchors — a central spawn, a welcome sign, and an
// entrance trigger — so a plaza is a real meeting/landmark node, not just scenery.
// No THREE, no scene authority.

import { mulberry32 } from "../utils/random.js";
import { GENERATOR_LIMITS, stringToSeed } from "./GeneratorConfig.js";
import { getHeight } from "../terrain/terrainSampling.js";
import { PRIMITIVE_BASE, primitiveDescriptor, prefabFitScale, createEmitter } from "./emitHelpers.js";

const TAU = Math.PI * 2;
const CUBE = PRIMITIVE_BASE.cube;
const PLANE = PRIMITIVE_BASE.plane;

const PAVING_COLOR = "#6f6a60";
const PROP_COLOR = "#7c6a4f";
const SIGN_COLOR = "#5b4a33";

export function generatePlazaLayout(config) {
  const rng = mulberry32(stringToSeed(`${config.seed}:${config.style}`));
  const { size, density, origin, style } = config;
  const cx = origin.x;
  const cz = origin.z;
  const radius = 6 + size * 2;

  const paving = { x: cx, z: cz, w: radius * 2, d: radius * 2 };

  // Props ringed around the square (market style packs more).
  const factor = style === "market" ? 4 : 2.5;
  const propCount = Math.min(GENERATOR_LIMITS.MAX_PLAZA_PROPS, Math.round(3 + size * density * factor));
  const props = [];
  for (let i = 0; i < propCount; i++) {
    const a = (i / Math.max(1, propCount)) * TAU + (rng() - 0.5) * 0.2;
    const rr = radius * (0.68 + rng() * 0.24);
    props.push({ x: cx + Math.cos(a) * rr, z: cz + Math.sin(a) * rr, s: 0.8 + rng() * 0.7, yaw: a + Math.PI });
  }

  const spawn = { x: cx, z: cz, name: "plaza-spawn" };
  const sign = { x: cx, z: cz - radius * 0.6, yaw: 0, text: `Plaza - ${style}` };
  // radius ≤ 22 (size-clamped); the interaction validator bounds it to [0.1, 250].
  const trigger = { x: cx, z: cz - radius - 1.5, radius, event: "plaza-enter" };

  const pad = radius + 4;
  return {
    center: { x: cx, z: cz },
    paving,
    props,
    spawn,
    sign,
    trigger,
    radius,
    bounds: { minX: cx - pad, maxX: cx + pad, minZ: cz - pad, maxZ: cz + pad },
    counts: { props: props.length },
  };
}

export function plazaLayoutToWorldObjects(layout, generatorId = "gen-plaza", { propPrefab = null } = {}) {
  const { out, push, pushPrefab } = createEmitter(generatorId, GENERATOR_LIMITS.MAX_TOTAL_OBJECTS);

  // Paving: one flat receive-only plane.
  if (layout?.paving) {
    const p = layout.paving;
    const base = getHeight(p.x, p.z) + 0.03;
    push(
      primitiveDescriptor("plane", "Plaza Floor", PAVING_COLOR, generatorId, {
        pos: [p.x, base, p.z],
        rot: [0, 0, 0],
        scale: [p.w / PLANE, 1, p.d / PLANE],
        collider: "none",
        castShadow: false,
        receiveShadow: true,
        excludeGrass: true,
        excludeTrees: true,
      })
    );
  }

  for (const pr of layout?.props ?? []) {
    const base = getHeight(pr.x, pr.z);
    if (propPrefab && pushPrefab(propPrefab, { x: pr.x, y: base, z: pr.z }, pr.yaw, prefabFitScale(propPrefab, pr.s, pr.s))) {
      continue;
    }
    push(
      primitiveDescriptor("cube", "Plaza Prop", PROP_COLOR, generatorId, {
        pos: [pr.x, base + pr.s / 2, pr.z],
        rot: [0, pr.yaw, 0],
        scale: [pr.s / CUBE, (pr.s * 0.6) / CUBE, pr.s / CUBE],
        collider: "box",
        castShadow: true,
        receiveShadow: true,
        excludeGrass: true,
        excludeTrees: true,
      })
    );
  }

  // Central spawn (invisible marker).
  if (layout?.spawn) {
    const sp = layout.spawn;
    const base = getHeight(sp.x, sp.z);
    push(
      primitiveDescriptor("cube", "Plaza Spawn", null, generatorId, {
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

  // Welcome sign.
  if (layout?.sign) {
    const s = layout.sign;
    const base = getHeight(s.x, s.z);
    push(
      primitiveDescriptor("cube", "Plaza Sign", SIGN_COLOR, generatorId, {
        pos: [s.x, base + 1.0, s.z],
        rot: [0, s.yaw, 0],
        scale: [1.6 / CUBE, 0.9 / CUBE, 0.16 / CUBE],
        collider: "none",
        castShadow: false,
        receiveShadow: false,
        excludeGrass: true,
        excludeTrees: true,
        interaction: { role: "sign", text: s.text, showRadius: 7 },
      })
    );
  }

  // Entrance trigger volume (invisible).
  if (layout?.trigger) {
    const tr = layout.trigger;
    const base = getHeight(tr.x, tr.z);
    push(
      primitiveDescriptor("sphere", "Plaza Trigger", null, generatorId, {
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

  return out;
}
