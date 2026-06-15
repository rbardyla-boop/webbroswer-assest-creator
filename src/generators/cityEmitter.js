// City emitter (Stage 17C / 19): turns a deterministic CityLayout into NORMAL
// WorldDocument object descriptors. Each item is either a host primitive (default)
// or — when a resolved prefab definition is supplied for its category (Stage 19) —
// the EXPANSION of that prefab via worldObjectsFromPrefab. Either way the output is
// plain WorldDocument data placed through the manager; the generator owns no scene
// graph. Prefab-backed objects carry prefabRef (and any asset deps of the prefab
// parts), so worldpack/build asset collection picks them up automatically.

import { getHeight } from "../terrain/terrainSampling.js";
import { worldObjectsFromPrefab } from "../prefabs/PrefabSerializer.js";
import { GENERATOR_LIMITS } from "./GeneratorConfig.js";

// Base dimensions of the host primitives (createPrimitiveMesh).
const CUBE = 1.8;
const PLANE = 2.4;
const CYL_R = 0.8;
const CYL_H = 1.6;
const STREET_COLOR = "#3a3d42";
const TREE_COLOR = "#3f7a3a";
const STREET_LIFT = 0.04;

/**
 * @param {object} layout            from generateCityLayout
 * @param {string} generatorId       owning generator instance id
 * @param {object} [sources]         { buildingPrefab, propPrefab } RESOLVED prefab
 *                                   definitions (or null → primitive fallback)
 */
export function cityLayoutToWorldObjects(layout, generatorId = "gen-city", { buildingPrefab = null, propPrefab = null } = {}) {
  const out = [];
  const push = (desc) => {
    if (out.length < GENERATOR_LIMITS.MAX_TOTAL_OBJECTS) out.push(desc);
  };
  // Expand a prefab atomically (never a partial prefab past the cap).
  const pushPrefab = (prefab, position, yaw, scale) => {
    const children = worldObjectsFromPrefab(prefab, { position, yaw, scale });
    if (!children.length || out.length + children.length > GENERATOR_LIMITS.MAX_TOTAL_OBJECTS) return false;
    for (const child of children) {
      child.generatorId = generatorId;
      out.push(child);
    }
    return true;
  };

  for (const r of layout?.roads ?? []) {
    const y = getHeight(r.x, r.z) + STREET_LIFT;
    push(
      primitive("plane", "Street", STREET_COLOR, generatorId, {
        pos: [r.x, y, r.z],
        rot: [0, r.yaw ?? 0, 0],
        scale: [(r.w ?? PLANE) / PLANE, 1, (r.d ?? PLANE) / PLANE],
        collider: "none",
        castShadow: false,
        receiveShadow: true,
        excludeGrass: true,
        excludeTrees: true,
      })
    );
  }

  for (const b of layout?.buildings ?? []) {
    const base = getHeight(b.x, b.z);
    // Prefab-backed building, or primitive fallback when no/invalid prefab.
    if (buildingPrefab && pushPrefab(buildingPrefab, { x: b.x, y: base, z: b.z }, b.yaw ?? 0, prefabFitScale(buildingPrefab, b.w, b.d))) {
      continue;
    }
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
    if (propPrefab && pushPrefab(propPrefab, { x: p.x, y: base, z: p.z }, 0, prefabFitScale(propPrefab, p.r * 2, p.r * 2))) {
      continue;
    }
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

// Uniform scale that fits a prefab's horizontal footprint to a target lot size.
function prefabFitScale(prefab, targetW, targetD) {
  const bounds = prefab?.metadata?.bounds;
  if (!bounds?.min || !bounds?.max) return 1;
  const ext = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z);
  if (!(ext > 0.01)) return 1;
  return Math.min(6, Math.max(0.3, Math.min(targetW, targetD) / ext));
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
