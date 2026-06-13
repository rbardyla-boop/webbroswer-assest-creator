import * as THREE from "three";
import { getHeight, getSlope } from "../terrain/terrainSampling.js";
import { hash2i, mulberry32 } from "../utils/random.js";
import { TAU } from "../utils/math.js";
import { patchCandidateCount } from "./TreeConfig.js";

const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler();
const _color = new THREE.Color();

export function generateTreePatchData(gx, gz, cfg, exclusionSystem = null) {
  const size = cfg.patchSize;
  const originX = gx * size;
  const originZ = gz * size;
  const rng = mulberry32(hash2i(gx ^ cfg.seed, gz + cfg.seed) ^ 0x51f15e);
  const candidates = patchCandidateCount(cfg);

  const instances = [];
  const trunks = [];
  const canopies = [];
  const trunkColors = [];
  const canopyColors = [];
  const trunkColliders = [];
  let minY = Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < candidates; i++) {
    const x = originX + rng() * size;
    const z = originZ + rng() * size;
    if (getSlope(x, z) > cfg.slopeLimit) continue;
    if (cfg.respectExclusions && (exclusionSystem?.isTreeExcluded?.(x, z) ?? exclusionSystem?.isGrassExcluded?.(x, z))) continue;

    const y = getHeight(x, z);
    const height = cfg.treeSize.height * (1 + (rng() * 2 - 1) * cfg.variation.height);
    const trunkRadius =
      cfg.treeSize.trunkRadius * (1 + (rng() * 2 - 1) * cfg.variation.trunkRadius);
    const canopyRadius =
      cfg.treeSize.canopyRadius * (1 + (rng() * 2 - 1) * cfg.variation.canopy);
    const trunkHeight = height * (0.52 + rng() * 0.08);
    const lean = (rng() * 2 - 1) * cfg.variation.lean;
    const rot = rng() * TAU;
    const species = Math.floor(rng() * cfg.canopyColors.length);
    const tint = (rng() * 2 - 1) * cfg.variation.tint;
    const treeMaxY = y + trunkHeight + canopyRadius * 1.75;
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, treeMaxY);

    composeTreeMatrices({
      x,
      y,
      z,
      rot,
      lean,
      trunkHeight,
      trunkRadius,
      trunkOut: _mat,
    });
    trunks.push(_mat.clone());

    composeCanopyMatrix({
      x,
      y,
      z,
      rot,
      lean,
      trunkHeight,
      canopyRadius,
      height,
      out: _mat,
    });
    canopies.push(_mat.clone());

    trunkColors.push(_color.copy(cfg.trunkColor).lerp(cfg.trunkDark, rng() * 0.5).clone());
    canopyColors.push(_color.copy(cfg.canopyColors[species]).offsetHSL(0, 0, tint).clone());
    instances.push({ x, y, z });

    if (cfg.trunkCollision) {
      trunkColliders.push({ x, z, yMin: y, yMax: y + trunkHeight, radius: trunkRadius * 1.35 });
    }
  }

  if (instances.length === 0) return { count: 0 };

  return {
    count: instances.length,
    trunks,
    canopies,
    trunkColors,
    canopyColors,
    trunkColliders,
    bounds: { minY, maxY },
    center: { x: originX + size * 0.5, z: originZ + size * 0.5 },
  };
}

function composeTreeMatrices({ x, y, z, rot, lean, trunkHeight, trunkRadius, trunkOut }) {
  _pos.set(x, y + trunkHeight * 0.5, z);
  _euler.set(Math.sin(rot) * lean, rot, Math.cos(rot) * lean);
  _quat.setFromEuler(_euler);
  _scale.set(trunkRadius, trunkHeight, trunkRadius);
  trunkOut.compose(_pos, _quat, _scale);
}

function composeCanopyMatrix({ x, y, z, rot, lean, trunkHeight, canopyRadius, height, out }) {
  _pos.set(
    x + Math.sin(rot) * lean * height * 0.42,
    y + trunkHeight + canopyRadius * 0.54,
    z + Math.cos(rot) * lean * height * 0.42
  );
  _euler.set(Math.sin(rot) * lean * 0.7, rot, Math.cos(rot) * lean * 0.7);
  _quat.setFromEuler(_euler);
  _scale.set(canopyRadius * 1.08, canopyRadius * 0.92, canopyRadius * 1.08);
  out.compose(_pos, _quat, _scale);
}
