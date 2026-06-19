// Beacon-trail modifier — the pure derivation behind Procedural Authoring-1's one
// modifier. Given a (validated) modifier + its spline + optional mask, it samples the
// spline path, gates the samples by the mask, and returns marker transforms + an
// optional ground ring. It is PURE + deterministic: same (modifier, spline, mask) →
// identical output every load. Randomness is seeded only (mulberry32 over the modifier
// seed) and adds bounded jitter that never collapses a marker. No THREE, no scene, no
// wall-clock — the AuthoringRuntime turns this layout into geometry.

import { mulberry32 } from "../../utils/random.js";
import { stringToSeed } from "../../generators/GeneratorConfig.js";

const MARKER_CLEARANCE = 0.05; // lift markers off the ground so they never z-fight terrain

/**
 * Derive the beacon-trail layout for one modifier.
 * @param {object} modifier normalized modifier descriptor (type "beacon-trail")
 * @param {object} spline   normalized spline descriptor the modifier references
 * @param {object|null} mask normalized mask descriptor (or null — ungated)
 * @param {{ getHeight?: (x:number,z:number)=>number }} [deps]
 * @returns {{ markers: Array<{x:number,y:number,z:number,scale:number}>, ring: {x:number,y:number,z:number,radius:number}|null, count:number }|null}
 */
export function deriveBeaconTrail(modifier, spline, mask = null, { getHeight = null } = {}) {
  if (!modifier || !spline || !Array.isArray(spline.points) || spline.points.length < 2) return null;
  const ground = typeof getHeight === "function" ? getHeight : null;
  const rng = mulberry32(stringToSeed(modifier.seed ?? modifier.id ?? "beacon-trail"));
  const count = Math.max(1, Math.min(64, Math.round(modifier.markerCount ?? 8)));
  const closed = spline.closed === true;

  const markers = [];
  for (let i = 0; i < count; i++) {
    // Even parameterization across the path. A single marker sits at the start.
    const t = count === 1 ? 0 : closed ? i / count : i / (count - 1);
    const p = sampleCatmullRom(spline.points, t, closed);
    const influence = mask ? maskInfluence(mask, p.x, p.z) : 1;
    // A jitter draw is consumed for EVERY sample (even rejected ones) so the seeded
    // stream stays stable regardless of which samples the mask gates out.
    const jitter = 0.85 + 0.3 * rng();
    if (influence <= 0) continue; // outside the mask → no marker here
    const y = (ground ? ground(p.x, p.z) : p.y) + MARKER_CLEARANCE;
    if (!Number.isFinite(y)) continue;
    // Markers shrink toward the mask edge (falloff) but never to zero (min factor > 0).
    const scale = (modifier.markerScale ?? 1) * (0.6 + 0.4 * influence) * jitter;
    if (!Number.isFinite(scale) || scale <= 0) continue;
    markers.push({ x: p.x, y, z: p.z, scale });
  }

  const ring = deriveRing(modifier, mask, ground);
  return { markers, ring, count: markers.length };
}

function deriveRing(modifier, mask, ground) {
  if (modifier.ring === false || !mask) return null;
  const radius = mask.shape === "box" ? Math.max(mask.half?.x ?? 1, mask.half?.z ?? 1) : Math.max(0.5, mask.radius ?? 1);
  const y = (ground ? ground(mask.center.x, mask.center.z) : mask.center.y) + MARKER_CLEARANCE;
  if (!Number.isFinite(radius) || !Number.isFinite(y)) return null;
  return { x: mask.center.x, y, z: mask.center.z, radius };
}

// Influence in [0,1]: 1 in the core, ramping to 0 across the falloff band at the edge,
// 0 outside. falloff=0 → hard edge; falloff=1 → full gradient from center to edge.
function maskInfluence(mask, x, z) {
  const fall = Math.max(0, Math.min(1, mask.falloff ?? 0));
  if (mask.shape === "box") {
    const dx = Math.abs(x - mask.center.x);
    const dz = Math.abs(z - mask.center.z);
    const hx = mask.half?.x ?? 1;
    const hz = mask.half?.z ?? 1;
    if (dx >= hx || dz >= hz) return 0;
    return Math.min(axisInfluence(dx, hx, fall), axisInfluence(dz, hz, fall));
  }
  const r = mask.radius ?? 1;
  const d = Math.hypot(x - mask.center.x, z - mask.center.z);
  if (d >= r) return 0;
  return axisInfluence(d, r, fall);
}

function axisInfluence(d, extent, fall) {
  const core = extent * (1 - fall);
  if (d <= core) return 1;
  if (extent <= core) return 1;
  return Math.max(0, 1 - (d - core) / (extent - core));
}

// Uniform Catmull-Rom position at global t∈[0,1]. Open paths clamp the end tangents by
// duplicating the endpoints; closed paths wrap. Deterministic and allocation-light.
function sampleCatmullRom(points, t, closed) {
  const n = points.length;
  if (n === 1) return { ...points[0] };
  const segs = closed ? n : n - 1;
  const tt = Math.max(0, Math.min(1, t)) * segs;
  let seg = Math.floor(tt);
  if (seg >= segs) seg = segs - 1;
  const u = tt - seg;

  const p1 = points[idx(seg, n, closed)];
  const p0 = points[idx(seg - 1, n, closed)];
  const p2 = points[idx(seg + 1, n, closed)];
  const p3 = points[idx(seg + 2, n, closed)];

  return {
    x: catmull(p0.x, p1.x, p2.x, p3.x, u),
    y: catmull(p0.y, p1.y, p2.y, p3.y, u),
    z: catmull(p0.z, p1.z, p2.z, p3.z, u),
  };
}

function idx(i, n, closed) {
  if (closed) return ((i % n) + n) % n;
  return Math.max(0, Math.min(n - 1, i)); // clamp (duplicate endpoints) for open paths
}

function catmull(p0, p1, p2, p3, u) {
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}
