// Shared road/path emit helpers (Stage 18B). A path is an ordered list of XZ points;
// each consecutive pair becomes one flat road-plane segment, terrain-snapped at its
// midpoint, oriented along the pair. Reused by the road, connector, and plaza
// generators so they share one canonical, capped segment builder. Pure data; Node-safe.

import { getHeight } from "../terrain/terrainSampling.js";
import { primitiveDescriptor, PRIMITIVE_BASE } from "./emitHelpers.js";
import { GENERATOR_LIMITS } from "./GeneratorConfig.js";

const PLANE = PRIMITIVE_BASE.plane;
const ROAD_LIFT = 0.04; // float the surface just above the terrain to avoid z-fighting

// One flat road-plane segment from a→b (XZ). Returns null for a degenerate (zero or
// non-finite length) segment so a repeated/NaN point never produces a broken object.
export function roadSegment(a, b, width, color, generatorId, name = "Road") {
  if (!a || !b) return null;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (!(len > 0.001)) return null;
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  const y = getHeight(mx, mz) + ROAD_LIFT;
  const yaw = Math.atan2(dx, dz); // align the plane's depth (+Z) axis along a→b
  return primitiveDescriptor("plane", name, color, generatorId, {
    pos: [mx, y, mz],
    rot: [0, yaw, 0],
    scale: [width / PLANE, 1, len / PLANE],
    collider: "none",
    castShadow: false,
    receiveShadow: true,
    excludeGrass: true,
    excludeTrees: true,
  });
}

// Emit road-plane segments along an ordered list of XZ points via the emitter's
// `push`. Hard-capped at MAX_ROAD_SEGMENTS. Returns the number of segments emitted.
export function emitRoadPath(push, points, { width = 4, color = "#3a3d42", generatorId, name = "Road" }) {
  const list = Array.isArray(points) ? points : [];
  let count = 0;
  for (let i = 0; i + 1 < list.length; i++) {
    if (count >= GENERATOR_LIMITS.MAX_ROAD_SEGMENTS) break;
    const seg = roadSegment(list[i], list[i + 1], width, color, generatorId, name);
    if (seg) {
      push(seg);
      count++;
    }
  }
  return count;
}

// Axis-aligned XZ bounds of a point list (for a layout's bounds field).
export function pointsBounds(points, pad = 4) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points ?? []) {
    if (!p) continue;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  if (!Number.isFinite(minX)) return { minX: -pad, maxX: pad, minZ: -pad, maxZ: pad };
  return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
}
