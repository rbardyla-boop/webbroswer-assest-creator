// Road / path generator (Stage 18B). Pure + deterministic + hard-capped. Stamps a
// self-contained run of road-plane segments from the origin — a winding path, a
// straight avenue, or a crossroad — with optional lamp posts (propPrefab, else a
// primitive). Connective scenery that ties areas together. No THREE, no scene authority.

import { mulberry32 } from "../utils/random.js";
import { GENERATOR_LIMITS, stringToSeed } from "./GeneratorConfig.js";
import { getHeight } from "../terrain/terrainSampling.js";
import { PRIMITIVE_BASE, primitiveDescriptor, prefabFitScale, createEmitter } from "./emitHelpers.js";
import { emitRoadPath, pointsBounds } from "./roadHelpers.js";

const TAU = Math.PI * 2;
const CYL_R = PRIMITIVE_BASE.cylRadius;
const CYL_H = PRIMITIVE_BASE.cylHeight;

const ROAD_COLOR = "#3a3d42";
const LAMP_COLOR = "#2b2f36";

// Road width is a function of the style (reachable via the Style dropdown) rather
// than a separate, hard-to-surface knob.
const ROAD_WIDTHS = { path: 3, avenue: 8, crossroad: 5 };

// Evenly spaced points along a line a→b, inclusive (segments = n).
function linePoints(x0, z0, x1, z1, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t });
  }
  return pts;
}

export function generateRoadLayout(config) {
  const rng = mulberry32(stringToSeed(`${config.seed}:${config.style}`));
  const { size, density, origin, style } = config;
  const width = ROAD_WIDTHS[style] ?? 4;
  const cx = origin.x;
  const cz = origin.z;
  const segLen = 8 + size * 1.5;
  const segs = Math.min(GENERATOR_LIMITS.MAX_WAYPOINTS, Math.max(2, Math.round(3 + size * 1.5)));

  const paths = [];
  if (style === "crossroad") {
    const half = (segs * segLen) / 2;
    paths.push(linePoints(cx - half, cz, cx + half, cz, segs));
    paths.push(linePoints(cx, cz - half, cx, cz + half, segs));
  } else if (style === "avenue") {
    paths.push(linePoints(cx, cz, cx + segs * segLen, cz, segs));
  } else {
    // Winding path: each step turns by a small seeded amount.
    const pts = [];
    let x = cx;
    let z = cz;
    let dir = rng() * TAU;
    for (let i = 0; i <= segs; i++) {
      pts.push({ x, z });
      dir += (rng() - 0.5) * 0.8;
      x += Math.cos(dir) * segLen;
      z += Math.sin(dir) * segLen;
    }
    paths.push(pts);
  }

  // Lamp posts along the main path at intervals, offset to one side.
  const lamps = [];
  const main = paths[0] ?? [];
  const step = density > 0.66 ? 1 : density > 0.33 ? 2 : 3;
  for (let i = 0; i < main.length; i += step) {
    if (lamps.length >= GENERATOR_LIMITS.MAX_LAMPS) break;
    const p = main[i];
    lamps.push({ x: p.x + width * 0.6, z: p.z + width * 0.2, h: 2.4 });
  }

  const allPts = paths.flat();
  const segCount = paths.reduce((n, p) => n + Math.max(0, p.length - 1), 0);
  return {
    paths,
    lamps,
    width,
    bounds: pointsBounds(allPts),
    counts: { segments: segCount, lamps: lamps.length },
  };
}

export function roadLayoutToWorldObjects(layout, generatorId = "gen-road", { propPrefab = null } = {}) {
  const { out, push, pushPrefab } = createEmitter(generatorId, GENERATOR_LIMITS.MAX_TOTAL_OBJECTS);

  for (const path of layout?.paths ?? []) {
    emitRoadPath(push, path, { width: layout.width, color: ROAD_COLOR, generatorId, name: "Road" });
  }

  for (const lamp of layout?.lamps ?? []) {
    const base = getHeight(lamp.x, lamp.z);
    if (propPrefab && pushPrefab(propPrefab, { x: lamp.x, y: base, z: lamp.z }, 0, prefabFitScale(propPrefab, 1, 1), "prop")) {
      continue;
    }
    push(
      primitiveDescriptor("cylinder", "Lamp Post", LAMP_COLOR, generatorId, {
        pos: [lamp.x, base + lamp.h / 2, lamp.z],
        rot: [0, 0, 0],
        scale: [0.18 / CYL_R, lamp.h / CYL_H, 0.18 / CYL_R],
        collider: "cylinder",
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
