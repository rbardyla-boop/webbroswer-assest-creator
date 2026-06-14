// Custom ShaderMaterial for the grass. All blade animation happens on the GPU:
// per-instance attributes (set by GrassPatch) describe each blade's transform
// and variation, and the vertex shader bends + sways them against a wind field.
//
// ShaderMaterial auto-injects `position`, `uv`, `normal`, the matrix uniforms,
// and `cameraPosition`; we only declare our own instanced attributes/uniforms.

import * as THREE from "three";

const vertexShader = /* glsl */ `
  attribute vec3 aOffset;   // world-space base position of the blade
  attribute float aRot;     // yaw rotation
  attribute vec2 aScale;    // (width, height)
  attribute float aTilt;    // random pitch lean
  attribute float aBend;    // static forward bend
  attribute float aTint;    // color variation [-1, 1]
  attribute float aPhase;   // per-blade wind phase [0, 1]

  uniform float uTime;
  uniform vec2  uWindDir;
  uniform float uWindStrength;
  uniform float uWindFreq;
  uniform float uWindScale;
  uniform float uWindGust;
  uniform float uFogNear;
  uniform float uFogFar;

  varying float vHeight;
  varying float vTint;
  varying vec3  vNormalW;
  varying float vFog;

  mat2 rot2(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
  }

  void main() {
    float h = uv.y; // 0 root .. 1 tip

    // Local blade space, scaled per-instance.
    vec3 p = vec3(position.x * aScale.x, position.y * aScale.y, 0.0);

    // Static lean grows toward the tip.
    float lean = aBend * h * h + aTilt * h;
    p.z += lean;

    // Wind: a travelling gust field sampled by world position, offset per blade.
    float phase = dot(aOffset.xz, uWindDir * uWindScale)
                + uTime * uWindFreq
                + aPhase * 6.2831853;
    float sway = sin(phase) + uWindGust * sin(phase * 2.3 + 1.7);
    float windAmt = sway * uWindStrength * h * h;

    // Yaw the blade around Y.
    vec2 xz = rot2(aRot) * vec2(p.x, p.z);
    vec3 bladed = vec3(xz.x, p.y, xz.y);

    // Displace along the world wind direction.
    bladed.x += uWindDir.x * windAmt;
    bladed.z += uWindDir.y * windAmt;

    vec3 worldPos = aOffset + bladed;

    // Cheap normal: facing direction rotated by yaw, biased upward.
    vec2 faceXZ = rot2(aRot) * vec2(0.0, 1.0);
    vNormalW = normalize(vec3(faceXZ.x, 0.9, faceXZ.y));

    vHeight = h;
    vTint = aTint;

    vec4 mv = modelViewMatrix * vec4(worldPos, 1.0);
    vFog = smoothstep(uFogNear, uFogFar, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uAmbientSky;
  uniform vec3 uAmbientGround;
  uniform vec3 uColorBase;
  uniform vec3 uColorTip;
  uniform vec3 uColorDry;
  uniform vec3 uFogColor;

  varying float vHeight;
  varying float vTint;
  varying vec3  vNormalW;
  varying float vFog;

  void main() {
    vec3 N = normalize(vNormalW);
    if (!gl_FrontFacing) N = -N;

    float ndl = max(dot(N, uSunDir), 0.0);
    float hemi = 0.5 + 0.5 * N.y;
    vec3 ambient = mix(uAmbientGround, uAmbientSky, hemi);

    vec3 col = mix(uColorBase, uColorTip, vHeight);
    col = mix(col, uColorDry, clamp(vTint * 0.5 + 0.15, 0.0, 1.0) * 0.35);

    float ao = mix(0.55, 1.0, vHeight); // darker at the root
    vec3 lit = col * (ambient * ao + uSunColor * ndl * 0.9);
    lit += uColorTip * pow(vHeight, 3.0) * 0.12; // tip translucency hint

    vec3 finalColor = mix(lit, uFogColor, vFog);
    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

// Fog distances that push the grass fade past any view distance (fog disabled).
const NO_FOG_NEAR = 1e6;
const NO_FOG_FAR = 1e6 + 1;

export class GrassMaterial {
  constructor(cfg, lights, fog) {
    this.cfg = cfg;
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      side: THREE.DoubleSide,
      fog: false, // handled manually for full control
      uniforms: {
        uTime: { value: 0 },
        uWindDir: { value: cfg.wind.direction.clone() },
        uWindStrength: { value: cfg.wind.strength },
        uWindFreq: { value: cfg.wind.frequency },
        uWindScale: { value: cfg.wind.scale },
        uWindGust: { value: cfg.wind.gustiness },
        uFogNear: { value: fog ? fog.near : NO_FOG_NEAR },
        uFogFar: { value: fog ? fog.far : NO_FOG_FAR },
        uFogColor: { value: fog ? fog.color.clone() : new THREE.Color(0x9fc4d8) },
        uSunDir: { value: lights.sunDirection.clone() },
        uSunColor: { value: new THREE.Color(0xfff1d8) },
        uAmbientSky: { value: new THREE.Color(0x9fc8ff).multiplyScalar(0.9) },
        uAmbientGround: { value: new THREE.Color(0x3a4a28) },
        uColorBase: { value: cfg.colorBase.clone() },
        uColorTip: { value: cfg.colorTip.clone() },
        uColorDry: { value: cfg.colorDry.clone() },
      },
    });
  }

  update(elapsed) {
    this.material.uniforms.uTime.value = elapsed;
  }

  // Re-read wind values from config (lets a UI tweak wind live).
  syncWind() {
    const u = this.material.uniforms;
    u.uWindDir.value.copy(this.cfg.wind.direction);
    u.uWindStrength.value = this.cfg.wind.strength;
    u.uWindFreq.value = this.cfg.wind.frequency;
    u.uWindScale.value = this.cfg.wind.scale;
    u.uWindGust.value = this.cfg.wind.gustiness;
  }

  // Push live lighting into the (manually-fogged) grass shader so editor lighting
  // edits show on grass too. Fog disabled → push the fade out of range.
  syncLighting(lighting, sunDirection = null) {
    if (!lighting) return;
    const u = this.material.uniforms;
    const fog = lighting.fog;
    if (fog?.enabled) {
      u.uFogNear.value = fog.near;
      u.uFogFar.value = fog.far;
      u.uFogColor.value.set(fog.color);
    } else if (fog) {
      u.uFogNear.value = NO_FOG_NEAR;
      u.uFogFar.value = NO_FOG_FAR;
    }
    if (lighting.sun?.color) u.uSunColor.value.set(lighting.sun.color);
    if (lighting.hemisphere?.skyColor) u.uAmbientSky.value.set(lighting.hemisphere.skyColor);
    if (lighting.hemisphere?.groundColor) u.uAmbientGround.value.set(lighting.hemisphere.groundColor);
    if (sunDirection) u.uSunDir.value.copy(sunDirection);
  }

  dispose() {
    this.material.dispose();
  }
}
