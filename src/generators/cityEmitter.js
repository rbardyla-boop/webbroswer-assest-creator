// City emitter (Stage 17C): turns a deterministic CityLayout into NORMAL
// WorldDocument object descriptors — primitives placed through the host's
// WorldObjectManager like any hand-placed object. This is the bridge the Stage
// 17B audit required: the generator never owns a scene graph; its output becomes
// plain data that flows through the existing placement / lighting / material /
// collision / visibility systems.
//
// Each descriptor carries the full host metadata (primitive kind, color, transform,
// collider, exclusion, shadow flags, and a generatorId so a generator instance can
// regenerate/clear exactly the objects it owns).

import { getHeight } from "../terrain/terrainSampling.js";
import { GENERATOR_LIMITS } from "./GeneratorConfig.js";

// Base dimensions of the host primitives (createPrimitiveMesh), so we can scale to
// real-world footprints: cube 1.8³, plane 2.4×2.4 (flat XZ), cylinder r0.8 / h1.6.
const CUBE = 1.8;
const PLANE = 2.4;
const CYL_R = 0.8;
const CYL_H = 1.6;
const STREET_COLOR = "#3a3d42";
const TREE_COLOR = "#3f7a3a";
const STREET_LIFT = 0.04; // tiny lift so streets don't z-fight the terrain

export function cityLayoutToWorldObjects(layout, generatorId = "gen-city") {
  const out = [];
  const push = (desc) => {
    if (out.length < GENERATOR_LIMITS.MAX_TOTAL_OBJECTS) out.push(desc);
  };

  for (const r of layout?.roads ?? []) {
    const y = getHeight(r.x, r.z) + STREET_LIFT;
    push(
      primitive("plane", "Street", STREET_COLOR, generatorId, {
        pos: [r.x, y, r.z],
        rot: [0, r.yaw ?? 0, 0],
        scale: [(r.w ?? PLANE) / PLANE, 1, (r.d ?? PLANE) / PLANE],
        collider: "none",
        castShadow: false, // flat ground surface — receive only
        receiveShadow: true,
        excludeGrass: true,
        excludeTrees: true,
      })
    );
  }

  for (const b of layout?.buildings ?? []) {
    const base = getHeight(b.x, b.z);
    push(
      primitive("cube", "Building", b.tint, generatorId, {
        pos: [b.x, base + b.h / 2, b.z],
        rot: [0, b.yaw ?? 0, 0],
        scale: [b.w / CUBE, b.h / CUBE, b.d / CUBE],
        collider: "box",
        castShadow: true,
        receiveShadow: true,
        excludeGrass: true,
        excludeTrees: true,
      })
    );
  }

  for (const p of layout?.props ?? []) {
    const base = getHeight(p.x, p.z);
    push(
      primitive("cylinder", "Tree", TREE_COLOR, generatorId, {
        pos: [p.x, base + p.h / 2, p.z],
        rot: [0, 0, 0],
        scale: [p.r / CYL_R, p.h / CYL_H, p.r / CYL_R],
        collider: "cylinder",
        castShadow: true,
        receiveShadow: true,
        excludeGrass: true,
        excludeTrees: false,
      })
    );
  }

  return out;
}

function primitive(kind, name, color, generatorId, t) {
  return {
    type: "primitive",
    primitive: kind,
    assetRef: null,
    name,
    color,
    generatorId,
    transform: {
      position: { x: t.pos[0], y: t.pos[1], z: t.pos[2] },
      rotation: { x: t.rot[0], y: t.rot[1], z: t.rot[2] },
      scale: { x: t.scale[0], y: t.scale[1], z: t.scale[2] },
    },
    collider: { type: t.collider, dimensions: {}, enabled: t.collider !== "none" },
    exclusion: { grass: t.excludeGrass, trees: t.excludeTrees, radius: 0, bounds: null },
    runtime: { visible: true, static: true, castShadow: t.castShadow, receiveShadow: t.receiveShadow },
  };
}
