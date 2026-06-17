// Terrain color bands — pure, THREE-free vertex coloring shared by every terrain
// profile. A band config maps (height, slope) to a linear RGB triple: low/damp →
// ground/meadow by height, → dirt/rock by slope, then optional scree + snow by
// height. Profiles supply the colors + thresholds; the rolling profile leaves snow
// disabled so it reproduces the original terrain coloring exactly.

import { smoothstep } from "../../utils/math.js";

// sRGB 24-bit hex int → LINEAR [r,g,b], matching THREE.Color's parsing under the
// default ColorManagement (so vertex colors agree with material/shader colors).
export function srgbHexToLinear(hex) {
  return [s2l(((hex >> 16) & 255) / 255), s2l(((hex >> 8) & 255) / 255), s2l((hex & 255) / 255)];
}

function s2l(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function lerp3(out, a, b, t) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

/**
 * Compute the linear RGB band color at (height, slope).
 * @param {number} h world height
 * @param {number} slope 0..1
 * @param {object} cfg band config: { low, ground, rock, dirt?, snow?, scree? (linear [r,g,b]),
 *   lowY0, lowY1, dirtSlope0?, dirtSlope1?, rockSlope0, rockSlope1,
 *   snowY0?, snowY1?, screeSlope0?, screeSlope1? }
 * @param {number[]} out length-3 scratch
 * @returns {number[]} out
 */
export function bandColorAt(h, slope, cfg, out) {
  // Height: damp low ground → meadow/grass ground.
  lerp3(out, cfg.low, cfg.ground, smoothstep(cfg.lowY0, cfg.lowY1, h));
  // Slope: optional dirt, then rock.
  if (cfg.dirt) lerp3(out, out, cfg.dirt, smoothstep(cfg.dirtSlope0, cfg.dirtSlope1, slope));
  lerp3(out, out, cfg.rock, smoothstep(cfg.rockSlope0, cfg.rockSlope1, slope));
  // Snow (and scree just below it) by height — disabled when cfg.snow is absent.
  if (cfg.snow) {
    const snowT = smoothstep(cfg.snowY0, cfg.snowY1, h);
    if (cfg.scree) {
      const screeT = smoothstep(cfg.screeSlope0, cfg.screeSlope1, slope) * (1 - snowT);
      lerp3(out, out, cfg.scree, screeT * 0.7);
    }
    lerp3(out, out, cfg.snow, snowT);
  }
  return out;
}
