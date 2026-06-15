// City emitter (Stage 17C / 18 / 19): turns a deterministic CityLayout into NORMAL
// WorldDocument object descriptors. Each item is either a host primitive (default)
// or — when a resolved prefab definition is supplied for its category (Stage 19) —
// the EXPANSION of that prefab via worldObjectsFromPrefab. Either way the output is
// plain WorldDocument data placed through the manager; the generator owns no scene
// graph. Prefab-backed objects carry prefabRef (and any asset deps of the prefab
// parts), so worldpack/build asset collection picks them up automatically.
//
// Stage 18: the primitive builder, terrain-fit prefab scale, and capped/atomic
// emitter buffer are now shared with the camp/ruin/forest emitters via emitHelpers.

import { getHeight } from "../terrain/terrainSampling.js";
import { GENERATOR_LIMITS } from "./GeneratorConfig.js";
import { PRIMITIVE_BASE, primitiveDescriptor, prefabFitScale, createEmitter } from "./emitHelpers.js";

const CUBE = PRIMITIVE_BASE.cube;
const PLANE = PRIMITIVE_BASE.plane;
const CYL_R = PRIMITIVE_BASE.cylRadius;
const CYL_H = PRIMITIVE_BASE.cylHeight;
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
  const { out, push, pushPrefab } = createEmitter(generatorId, GENERATOR_LIMITS.MAX_TOTAL_OBJECTS);

  for (const r of layout?.roads ?? []) {
    const y = getHeight(r.x, r.z) + STREET_LIFT;
    push(
      primitiveDescriptor("plane", "Street", STREET_COLOR, generatorId, {
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
      primitiveDescriptor("cube", "Building", b.tint, generatorId, {
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
      primitiveDescriptor("cylinder", "Tree", TREE_COLOR, generatorId, {
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
