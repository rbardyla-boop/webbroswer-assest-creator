// Snow + scree pixel bands for the terrain material — the shader-side companion to
// ValleyColorBands (which colors the mesh vertices). Layered onto the existing
// terrain material-v2 onBeforeCompile pass AFTER its macro/rock/height body, reusing
// its vTerrainWPos / vTerrainNrm varyings. Snow blends in above the snowline; scree
// greys the steep ground just below it. A profile whose snowlineY is far above any
// terrain (the rolling profile) gets snowT≈0 → the material behaves exactly as before.

import * as THREE from "three";

/** Build the snow/scree uniforms from a profile.visual config. */
export function snowScreeUniforms(visual) {
  return {
    uTerrainSnowColor: { value: new THREE.Color(visual.snowColor) },
    uTerrainScreeColor: { value: new THREE.Color(visual.screeColor) },
    uTerrainSnowlineY: { value: visual.snowlineY },
    uTerrainSnowBlend: { value: Math.max(0.001, visual.snowBlend) },
    uTerrainScreeSlope: { value: new THREE.Vector2(visual.screeSlope[0], visual.screeSlope[1]) },
    uTerrainScreeY: { value: new THREE.Vector2(visual.screeY[0], visual.screeY[1]) },
  };
}

// Uniform declarations only — the varyings (vTerrainWPos/vTerrainNrm) are already
// declared by the base terrain head, so we must NOT redeclare them.
export const SNOW_SCREE_FRAG_HEAD = /* glsl */ `
  uniform vec3  uTerrainSnowColor;
  uniform vec3  uTerrainScreeColor;
  uniform float uTerrainSnowlineY;
  uniform float uTerrainSnowBlend;
  uniform vec2  uTerrainScreeSlope;
  uniform vec2  uTerrainScreeY;
`;

export const SNOW_SCREE_FRAG_BODY = /* glsl */ `
  {
    float snowH = vTerrainWPos.y;
    vec3 sn = vTerrainNrm;
    float snLen = length(sn);
    vec3 snn = snLen > 1e-5 ? sn / snLen : vec3(0.0, 1.0, 0.0);
    float snSlope = clamp(1.0 - snn.y, 0.0, 1.0);

    float snowT = smoothstep(uTerrainSnowlineY - uTerrainSnowBlend, uTerrainSnowlineY + uTerrainSnowBlend, snowH);
    // Scree greys steep, high ground that isn't yet under snow.
    float screeT = smoothstep(uTerrainScreeSlope.x, uTerrainScreeSlope.y, snSlope)
                 * smoothstep(uTerrainScreeY.x, uTerrainScreeY.y, snowH)
                 * (1.0 - snowT);
    diffuseColor.rgb = mix(diffuseColor.rgb, uTerrainScreeColor, screeT * 0.6);
    diffuseColor.rgb = mix(diffuseColor.rgb, uTerrainSnowColor, snowT);
    diffuseColor.rgb = clamp(diffuseColor.rgb, 0.0, 1.0);
  }
`;
