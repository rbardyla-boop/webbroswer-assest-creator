import * as THREE from "three";
import { getHeight, getSlope, getWaterLevel } from "../terrain/terrainSampling.js";
import { hash2i, mulberry32, fbm2D } from "../utils/random.js";
import { TAU } from "../utils/math.js";
import { bushCandidateCount } from "./BushConfig.js";

const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler();
const _color = new THREE.Color();

// Deterministic per-patch placement: seeded RNG (seed XOR patch coords), with
// clump/slope/height/exclusion filtering. Returns instance matrices + colors, or
// { count: 0 } for an empty patch.
export function generateBushPatchData(gx, gz, cfg, exclusionSystem = null) {
  const size = cfg.patchSize;
  const originX = gx * size;
  const originZ = gz * size;
  const rng = mulberry32(hash2i(gx ^ cfg.seed, gz + cfg.seed) ^ 0x2f6b55);
  const candidates = bushCandidateCount(cfg);
  const clumpStrength = Math.min(1, Math.max(0, cfg.clumpStrength ?? 0));
  const clumpScale = cfg.clumpScale > 0 ? cfg.clumpScale : 0.06;

  const matrices = [];
  const colors = [];
  let minY = Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < candidates; i++) {
    const x = originX + rng() * size;
    const z = originZ + rng() * size;

    // Procedural clumping: thin candidates outside the high-density regions of a
    // position-based noise field (deterministic for a fixed config + seed).
    if (clumpStrength > 0) {
      const mask = fbm2D(x * clumpScale, z * clumpScale) * 0.5 + 0.5; // [0,1]
      if (rng() < (1 - mask) * clumpStrength) continue;
    }

    if (getSlope(x, z) > cfg.slopeLimit) continue;
    if (cfg.respectExclusions && (exclusionSystem?.isTreeExcluded?.(x, z) ?? exclusionSystem?.isGrassExcluded?.(x, z))) continue;

    const y = getHeight(x, z);
    if (y < getWaterLevel(x, z)) continue; // below the waterline — submerged, no bushes
    if (y < cfg.minHeight || y > cfg.maxHeight || y > cfg.snowlineMaxHeight) continue;

    const scaleMul = 1 + (rng() * 2 - 1) * cfg.variation.scale;
    const radius = cfg.bushSize.radius * scaleMul;
    const height = cfg.bushSize.height * scaleMul;
    const rot = rng() * TAU;
    const species = Math.floor(rng() * cfg.colors.length);
    const tint = (rng() * 2 - 1) * cfg.variation.tint;

    _pos.set(x, y + height * 0.5, z);
    _euler.set(0, rot, 0);
    _quat.setFromEuler(_euler);
    _scale.set(radius, height, radius); // flattened shrub (height < radius typ.)
    _mat.compose(_pos, _quat, _scale);
    matrices.push(_mat.clone());
    colors.push(_color.copy(cfg.colors[species]).offsetHSL(0, 0, tint).clone());

    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y + height);
  }

  if (matrices.length === 0) return { count: 0 };

  return {
    count: matrices.length,
    matrices,
    colors,
    bounds: { minY, maxY },
    center: { x: originX + size * 0.5, z: originZ + size * 0.5 },
  };
}
