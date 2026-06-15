// Deterministic city layout generator (Stage 17C). Pure: (seed, config) → a layout
// of plain descriptors (roads / buildings / props). No THREE, no scene, no RNG
// beyond the seeded mulberry32 — same seed+style+config always yields an identical
// layout. Counts are hard-capped per category (and the emitter caps the total), so
// generation can never spin an unbounded loop or emit an unbounded object set.
//
// Host-authored from scratch (informed by the Stage 17B audit, not copied): a grid
// of city blocks, streets along block boundaries, buildings packed into lots, and
// occasional trees / small parks.

import { mulberry32 } from "../utils/random.js";
import { GENERATOR_LIMITS, stringToSeed } from "./GeneratorConfig.js";

export function generateCityLayout(config) {
  const rng = mulberry32(stringToSeed(`${config.seed}:${config.style}`));
  const { blocks, blockSize, density, origin, style } = config;
  const roadWidth = Math.min(8, blockSize * 0.22);
  const span = blocks * blockSize;
  const x0 = origin.x - span / 2;
  const z0 = origin.z - span / 2;

  const roads = [];
  const buildings = [];
  const props = [];

  // Streets: one strip along each of the (blocks+1) boundaries, both axes.
  for (let i = 0; i <= blocks; i++) {
    if (roads.length < GENERATOR_LIMITS.MAX_ROADS) {
      roads.push({ x: origin.x, z: z0 + i * blockSize, w: span + roadWidth, d: roadWidth, yaw: 0 });
    }
    if (roads.length < GENERATOR_LIMITS.MAX_ROADS) {
      roads.push({ x: x0 + i * blockSize, z: origin.z, w: roadWidth, d: span + roadWidth, yaw: 0 });
    }
  }

  const pad = roadWidth * 0.5 + 1.5; // keep lots off the street
  for (let bz = 0; bz < blocks; bz++) {
    for (let bx = 0; bx < blocks; bx++) {
      const bxMin = x0 + bx * blockSize + pad;
      const bzMin = z0 + bz * blockSize + pad;
      const inner = blockSize - 2 * pad;
      if (inner <= 2) continue;

      // Some blocks are small parks (trees, no buildings).
      const parkChance = style === "village" ? 0.28 : 0.12;
      if (rng() < parkChance) {
        const treeCount = Math.round(2 + rng() * 4 * density);
        for (let t = 0; t < treeCount; t++) {
          if (props.length >= GENERATOR_LIMITS.MAX_PROPS) break;
          props.push(tree(bxMin + rng() * inner, bzMin + rng() * inner, rng));
        }
        continue;
      }

      // Otherwise split the block into a small lot grid and fill with buildings.
      const lots = style === "grid" ? 2 : 1 + (rng() < density ? 1 : 0);
      const lotSize = inner / lots;
      for (let lz = 0; lz < lots; lz++) {
        for (let lx = 0; lx < lots; lx++) {
          if (buildings.length >= GENERATOR_LIMITS.MAX_BUILDINGS) break;
          // Density thinning, but always keep at least the first lot populated.
          if (rng() > density && !(lx === 0 && lz === 0)) continue;
          const margin = lotSize * (0.12 + rng() * 0.12);
          const w = lotSize - 2 * margin;
          const d = lotSize - 2 * margin;
          if (w < 2 || d < 2) continue;
          const floors = 1 + Math.floor(rng() * (style === "grid" ? 8 : 4));
          const h = 3 + floors * (2.6 + rng() * 0.8);
          buildings.push({
            x: bxMin + (lx + 0.5) * lotSize,
            z: bzMin + (lz + 0.5) * lotSize,
            w,
            d,
            h,
            yaw: 0,
            tint: buildingTint(rng, style),
          });
        }
      }

      // Occasional street tree.
      if (props.length < GENERATOR_LIMITS.MAX_PROPS && rng() < 0.4 * density) {
        props.push(tree(bxMin + rng() * inner, bzMin + rng() * inner, rng));
      }
    }
  }

  return {
    roads,
    buildings,
    props,
    bounds: { minX: x0 - roadWidth, maxX: x0 + span + roadWidth, minZ: z0 - roadWidth, maxZ: z0 + span + roadWidth },
    counts: { roads: roads.length, buildings: buildings.length, props: props.length },
  };
}

function tree(x, z, rng) {
  return { x, z, r: 0.8 + rng() * 0.9, h: 3 + rng() * 4 };
}

const PALETTES = {
  town: [[200, 195, 185], [180, 170, 160], [170, 160, 150], [150, 140, 130], [190, 180, 175]],
  grid: [[150, 160, 175], [130, 140, 155], [170, 178, 190], [110, 120, 140]],
  village: [[200, 180, 150], [185, 160, 130], [170, 150, 120], [160, 170, 140]],
};

function buildingTint(rng, style) {
  const pal = PALETTES[style] ?? PALETTES.town;
  const base = pal[Math.floor(rng() * pal.length)];
  const j = 0.85 + rng() * 0.3; // brightness jitter
  return rgbToHex(clamp255(base[0] * j), clamp255(base[1] * j), clamp255(base[2] * j));
}

function clamp255(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}
