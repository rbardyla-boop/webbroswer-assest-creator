// Builds a visible ground mesh by displacing a plane through terrainSampling.
// Vertex colors come from height + slope so the ground reads as grass / dirt /
// rock without needing textures.
//
// Stage 14C — Terrain Material v2: the base color stays vertex-color driven, but
// a MeshStandardMaterial.onBeforeCompile pass layers macro color noise + extra
// height/slope definition on top. We keep MeshStandardMaterial (NOT a
// ShaderMaterial swap) so Three.js still auto-injects the fog, shadow, and
// lighting chunks — the upgrade only edits `diffuseColor` before those run, so
// 13A lighting edits, shadows, and scene fog keep working untouched.

import * as THREE from "three";
import { getHeight, getSlope } from "./terrainSampling.js";
import { clamp, smoothstep } from "../utils/math.js";

const COLOR_GRASS = new THREE.Color(0x4f6b34);
const COLOR_DIRT = new THREE.Color(0x6b5836);
const COLOR_ROCK = new THREE.Color(0x6a6660);
const COLOR_LOW = new THREE.Color(0x3c5530); // damp lowland

// Material-v2 defaults. Every field is a 0..1 intensity except macroScale (a
// world-space frequency). Conservative so the ground reads richer, not noisy.
export const DEFAULT_TERRAIN_MATERIAL = {
  macroIntensity: 0.35, // strength of the large-scale color blotching
  macroScale: 0.015, // world frequency of the macro noise (small = large blotches)
  slopeRock: 0.5, // extra rock tint pushed onto steep slopes
  heightTint: 0.3, // gentle value shift by world height (high lighter, low darker)
  detailIntensity: 0.25, // near small-scale break-up, faded out by distance (no far shimmer)
};

// Upper bound on the macro frequency so an untrusted document can't request a
// shimmer-inducing high-frequency field that the distance fade won't cover.
const MAX_MACRO_SCALE = 0.2;

export class Terrain {
  /**
   * @param {object} opts
   * @param {number} opts.size   world size of the terrain (square, centered at origin)
   * @param {number} opts.segments  grid resolution per side
   * @param {object} [opts.material]  material-v2 settings (see DEFAULT_TERRAIN_MATERIAL)
   */
  constructor({ size = 600, segments = 220, material = {} } = {}) {
    this.size = size;
    this.segments = segments;
    this.materialSettings = sanitizeTerrainMaterial(material);
    this._uniforms = null;
    this.mesh = this._build();
  }

  _build() {
    const { size, segments } = this;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2); // lay flat: XZ plane, Y up

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = getHeight(x, z);
      pos.setY(i, h);

      const slope = getSlope(x, z);
      // Blend ground color by height band, then push toward rock on steep slope.
      const lowT = smoothstep(-8, 2, h);
      c.copy(COLOR_LOW).lerp(COLOR_GRASS, lowT);
      c.lerp(COLOR_DIRT, smoothstep(0.18, 0.4, slope));
      c.lerp(COLOR_ROCK, smoothstep(0.42, 0.62, slope));

      // Subtle per-vertex value variation for life.
      const v = 0.92 + 0.16 * fract(Math.sin((x * 12.9 + z * 78.2)) * 43758.5);
      colors[i * 3 + 0] = clamp(c.r * v, 0, 1);
      colors[i * 3 + 1] = clamp(c.g * v, 0, 1);
      colors[i * 3 + 2] = clamp(c.b * v, 0, 1);
    }

    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.0,
    });
    this._applyMaterialUpgrade(mat);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "Terrain";
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false; // static
    mesh.updateMatrix();
    return mesh;
  }

  // Layer macro noise + height/slope definition onto the standard material via
  // onBeforeCompile. Uniforms are shared (held on this._uniforms and assigned by
  // reference into shader.uniforms) so live editor edits mutate `.value` WITHOUT
  // a recompile. The injected source is identical every compile, so Three.js can
  // recompile freely (e.g. when fog toggles) without a feedback loop.
  _applyMaterialUpgrade(mat) {
    const s = this.materialSettings;
    const uniforms = {
      uTerrainMacroIntensity: { value: s.macroIntensity },
      uTerrainMacroScale: { value: s.macroScale },
      uTerrainSlopeRock: { value: s.slopeRock },
      uTerrainHeightTint: { value: s.heightTint },
      uTerrainDetailIntensity: { value: s.detailIntensity },
      // Rock tint target is intentionally fixed (matches the baked vertex rock
      // band) — not a live setting, so syncMaterial/getMaterialSettings omit it.
      uTerrainRockColor: { value: COLOR_ROCK.clone() },
    };
    this._uniforms = uniforms;

    mat.onBeforeCompile = (shader) => {
      // Share the SAME uniform objects so syncMaterial() edits land live.
      Object.assign(shader.uniforms, uniforms);

      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 vTerrainWPos;\nvarying vec3 vTerrainNrm;"
        )
        .replace(
          "#include <beginnormal_vertex>",
          // WORLD-space normal for the slope calc (its .y must mean world-up). The
          // terrain is static + unscaled, so mat3(modelMatrix) is exact (and the
          // fragment re-normalizes). Do NOT swap to `normalMatrix` — that is the
          // inverse-transpose of the modelVIEW matrix, i.e. view space, which would
          // make slope camera-dependent.
          "#include <beginnormal_vertex>\nvTerrainNrm = mat3(modelMatrix) * objectNormal;"
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvTerrainWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;"
        );

      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${TERRAIN_FRAG_HEAD}`)
        .replace("#include <color_fragment>", `#include <color_fragment>\n${TERRAIN_FRAG_BODY}`);
    };

    // Give the upgraded material its own program-cache identity so it can never
    // collide with a vanilla MeshStandardMaterial in the renderer's cache.
    mat.customProgramCacheKey = () => "terrain-material-v2";
  }

  // Live editor tuning: clamp, merge, push values into the shared uniforms. No
  // material.needsUpdate (that would force a recompile every edit).
  syncMaterial(settings = {}) {
    this.materialSettings = sanitizeTerrainMaterial({ ...this.materialSettings, ...settings });
    const u = this._uniforms;
    if (u) {
      const s = this.materialSettings;
      u.uTerrainMacroIntensity.value = s.macroIntensity;
      u.uTerrainMacroScale.value = s.macroScale;
      u.uTerrainSlopeRock.value = s.slopeRock;
      u.uTerrainHeightTint.value = s.heightTint;
      u.uTerrainDetailIntensity.value = s.detailIntensity;
    }
    return this.materialSettings;
  }

  getMaterialSettings() {
    return { ...this.materialSettings };
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

// Fragment helpers + uniform/varying declarations. A cheap, deterministic value
// noise (no texture, no derivatives) — finite for all inputs, so no NaN risk.
const TERRAIN_FRAG_HEAD = /* glsl */ `
  varying vec3 vTerrainWPos;
  varying vec3 vTerrainNrm;
  uniform float uTerrainMacroIntensity;
  uniform float uTerrainMacroScale;
  uniform float uTerrainSlopeRock;
  uniform float uTerrainHeightTint;
  uniform float uTerrainDetailIntensity;
  uniform vec3  uTerrainRockColor;

  float terrainHash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  float terrainValueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = terrainHash21(i);
    float b = terrainHash21(i + vec2(1.0, 0.0));
    float c = terrainHash21(i + vec2(0.0, 1.0));
    float d = terrainHash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
`;

const TERRAIN_FRAG_BODY = /* glsl */ `
  {
    // Slope from the interpolated world normal, guarded against a zero vector.
    vec3 tn = vTerrainNrm;
    float tnLen = length(tn);
    vec3 nrm = tnLen > 1e-5 ? tn / tnLen : vec3(0.0, 1.0, 0.0);
    float tSlope = clamp(1.0 - nrm.y, 0.0, 1.0);

    vec2 wxz = vTerrainWPos.xz;
    float macro = terrainValueNoise(wxz * uTerrainMacroScale);
    float detail = terrainValueNoise(wxz * uTerrainMacroScale * 6.37);

    // Macro break-up centered at 0 so average brightness is preserved.
    diffuseColor.rgb *= (1.0 + (macro - 0.5) * uTerrainMacroIntensity);

    // Steep ground reads more rocky (reinforces the baked vertex rock band).
    float rockMix = smoothstep(0.32, 0.7, tSlope) * uTerrainSlopeRock;
    diffuseColor.rgb = mix(diffuseColor.rgb, uTerrainRockColor, rockMix);

    // Gentle height value shift: ridges lighter, hollows darker. 28 ~= the
    // world height half-range (heightAmplitude 14 + detail), so hFactor lands in
    // roughly [-1,1] for typical terrain; the clamp bounds any outlier.
    float hFactor = clamp(vTerrainWPos.y / 28.0, -1.0, 1.0);
    diffuseColor.rgb *= (1.0 + hFactor * uTerrainHeightTint * 0.16);

    // Near small-scale break-up, faded out with distance so the far field can't
    // shimmer (procedural noise has no mipmaps; full far-detail is a later stage).
    float camDist = length(cameraPosition - vTerrainWPos);
    float detailFade = 1.0 - smoothstep(45.0, 130.0, camDist);
    diffuseColor.rgb *= (1.0 + (detail - 0.5) * uTerrainDetailIntensity * detailFade);

    diffuseColor.rgb = clamp(diffuseColor.rgb, 0.0, 1.0);
  }
`;

// Clamp every field to a safe range. Defense in depth — WorldValidation also
// sanitizes, but Terrain is constructed directly (tests, future callers) too.
export function sanitizeTerrainMaterial(material = {}) {
  const src = material && typeof material === "object" ? material : {};
  return {
    macroIntensity: clamp01(num(src.macroIntensity, DEFAULT_TERRAIN_MATERIAL.macroIntensity)),
    macroScale: clamp(num(src.macroScale, DEFAULT_TERRAIN_MATERIAL.macroScale), 1e-4, MAX_MACRO_SCALE),
    slopeRock: clamp01(num(src.slopeRock, DEFAULT_TERRAIN_MATERIAL.slopeRock)),
    heightTint: clamp01(num(src.heightTint, DEFAULT_TERRAIN_MATERIAL.heightTint)),
    detailIntensity: clamp01(num(src.detailIntensity, DEFAULT_TERRAIN_MATERIAL.detailIntensity)),
  };
}

function num(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function fract(n) {
  return n - Math.floor(n);
}
