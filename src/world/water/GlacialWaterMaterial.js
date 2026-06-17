// Glacial water material. A TRANSPARENT MeshStandardMaterial upgraded via
// onBeforeCompile (NOT a ShaderMaterial swap) so Three.js keeps auto-injecting the
// fog, lighting, and shadow chunks — distant water hazes into the glacial fog and
// catches the sun for free; the upgrade only edits `diffuseColor` (rgb + a) before
// those chunks run. Mirrors Terrain._applyMaterialUpgrade exactly:
//  - per-vertex `aDepth` (waterLevel - terrainHeight) drives shallow→deep tint and a
//    hard `discard` on dry land (aDepth <= 0), so river + lakes + tarns all fall out
//    of ONE surface mesh with no second terrain truth.
//  - a uTime-scrolled procedural value-noise gives surface shimmer (NO texture).
//  - a Schlick-style fresnel rim + shoreline foam complete the glacial read.
// depthWrite:false so the single transparent pass never occludes itself; grass is
// opaque, so it sorts cleanly underneath.

import * as THREE from "three";

/**
 * @param {object} cfg  sanitized water render config (see WaterConfig / WaterValidation)
 * @returns {{ material: THREE.MeshStandardMaterial, uniforms: object }}
 */
export function createGlacialWaterMaterial(cfg) {
  const uniforms = {
    uTime: { value: 0 },
    uShallow: { value: new THREE.Color(cfg.shallowColor) },
    uDeep: { value: new THREE.Color(cfg.deepColor) },
    uFoamColor: { value: new THREE.Color(cfg.foamColor) },
    uDepthRange: { value: cfg.depthRange },
    uFoamBand: { value: cfg.foamBand },
    uFresnel: { value: cfg.fresnel },
    uFlowSpeed: { value: cfg.flowSpeed },
    uMaxAlpha: { value: cfg.opacity },
  };

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.16, // glassy — catches a sun glint
    metalness: 0.0,
    transparent: true,
    depthWrite: false, // a single transparent sheet; never occlude itself
  });

  mat.onBeforeCompile = (shader) => {
    // Share the SAME uniform objects so update()'s uTime write lands live.
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float aDepth;\nvarying float vWaterDepth;\nvarying vec3 vWaterWPos;"
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvWaterDepth = aDepth;\nvWaterWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;"
      );

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${WATER_FRAG_HEAD}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${WATER_FRAG_BODY}`);
  };

  // Own program-cache identity so it can never collide with a vanilla standard mat.
  mat.customProgramCacheKey = () => "glacial-water-v1";

  return { material: mat, uniforms };
}

// Cheap deterministic value noise (no texture, no derivatives) — finite for all
// inputs, so no NaN risk under SwiftShader. Same construction as Terrain's noise.
const WATER_FRAG_HEAD = /* glsl */ `
  uniform float uTime;
  uniform vec3  uShallow;
  uniform vec3  uDeep;
  uniform vec3  uFoamColor;
  uniform float uDepthRange;
  uniform float uFoamBand;
  uniform float uFresnel;
  uniform float uFlowSpeed;
  uniform float uMaxAlpha;
  varying float vWaterDepth;
  varying vec3  vWaterWPos;

  float waterHash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  float waterNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = waterHash21(i);
    float b = waterHash21(i + vec2(1.0, 0.0));
    float c = waterHash21(i + vec2(0.0, 1.0));
    float d = waterHash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
`;

const WATER_FRAG_BODY = /* glsl */ `
  {
    if (vWaterDepth <= 0.0) discard; // dry land — no water surface here

    float d = clamp(vWaterDepth / max(uDepthRange, 0.001), 0.0, 1.0);
    vec3 tint = mix(uShallow, uDeep, d);

    // uTime-scrolled procedural shimmer (two octaves drifting apart). No texture.
    float n  = waterNoise(vWaterWPos.xz * 0.15 + vec2(uTime * uFlowSpeed, uTime * uFlowSpeed * 0.6));
    float n2 = waterNoise(vWaterWPos.xz * 0.37 - vec2(uTime * uFlowSpeed * 0.5, 0.0));
    tint += (n * 0.6 + n2 * 0.4 - 0.5) * 0.10;

    // Schlick-style fresnel rim — grazing views brighten toward the foam color.
    vec3 V = normalize(cameraPosition - vWaterWPos);
    float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0);
    tint = mix(tint, uFoamColor, fres * uFresnel);

    // Shoreline foam where the water is shallow, broken up by the noise field.
    float foam = (1.0 - smoothstep(0.0, max(uFoamBand, 0.001), vWaterDepth)) * (0.5 + 0.5 * n);
    tint = mix(tint, uFoamColor, foam * 0.6);

    diffuseColor.rgb = clamp(tint, 0.0, 1.0);
    diffuseColor.a = mix(0.5, uMaxAlpha, d); // shallow water reads more transparent
  }
`;
