// Connector / path-between generator (Stage 18B). Pure + deterministic + hard-capped.
// Links two world anchor points (from/to — typically two generated clusters' origins,
// resolved by the panel via landmarkAnchors) with a road path: straight, a curved
// bezier, or a stepped right-angle. Emits road-plane segments + small endpoint
// markers. No THREE, no scene authority; output is plain WorldObject descriptors.

import { mulberry32 } from "../utils/random.js";
import { GENERATOR_LIMITS, stringToSeed } from "./GeneratorConfig.js";
import { getHeight } from "../terrain/terrainSampling.js";
import { PRIMITIVE_BASE, primitiveDescriptor, createEmitter } from "./emitHelpers.js";
import { emitRoadPath, pointsBounds } from "./roadHelpers.js";

const CYL_R = PRIMITIVE_BASE.cylRadius;
const CYL_H = PRIMITIVE_BASE.cylHeight;

const PATH_COLOR = "#46474d";
const MARKER_COLOR = "#c8b568";

export function generateConnectorLayout(config) {
  const { from, to, style, width } = config;
  const rng = mulberry32(stringToSeed(`${config.seed}:${style}:${from.x},${from.z}->${to.x},${to.z}`));

  const points = [];
  if (style === "stepped") {
    // L-shape through a right-angle corner.
    points.push({ x: from.x, z: from.z }, { x: to.x, z: from.z }, { x: to.x, z: to.z });
  } else if (style === "curved") {
    // Quadratic bezier through a perpendicular-offset control point.
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    const px = -dz / len;
    const pz = dx / len;
    const off = (rng() - 0.5) * len * 0.3;
    const ctrl = { x: (from.x + to.x) / 2 + px * off, z: (from.z + to.z) / 2 + pz * off };
    const n = Math.min(GENERATOR_LIMITS.MAX_WAYPOINTS, 12);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      points.push({
        x: u * u * from.x + 2 * u * t * ctrl.x + t * t * to.x,
        z: u * u * from.z + 2 * u * t * ctrl.z + t * t * to.z,
      });
    }
  } else {
    points.push({ x: from.x, z: from.z }, { x: to.x, z: to.z });
  }

  return {
    points,
    width,
    endpoints: { from: { x: from.x, z: from.z }, to: { x: to.x, z: to.z } },
    length: Math.hypot(to.x - from.x, to.z - from.z),
    bounds: pointsBounds(points),
    counts: { segments: Math.max(0, points.length - 1) },
  };
}

export function connectorLayoutToWorldObjects(layout, generatorId = "gen-connector") {
  const { out, push } = createEmitter(generatorId, GENERATOR_LIMITS.MAX_TOTAL_OBJECTS);

  emitRoadPath(push, layout?.points ?? [], { width: layout?.width ?? 3.5, color: PATH_COLOR, generatorId, name: "Path" });

  // Small endpoint markers so the link is legible at each cluster.
  for (const p of [layout?.endpoints?.from, layout?.endpoints?.to]) {
    if (!p) continue;
    const base = getHeight(p.x, p.z);
    push(
      primitiveDescriptor("cylinder", "Path Marker", MARKER_COLOR, generatorId, {
        pos: [p.x, base + 0.6, p.z],
        rot: [0, 0, 0],
        scale: [0.2 / CYL_R, 1.2 / CYL_H, 0.2 / CYL_R],
        collider: "none",
        castShadow: false,
        receiveShadow: true,
        excludeGrass: true,
        excludeTrees: true,
      })
    );
  }

  return out;
}
