// Weapon materials. Two shared materials per weapon (so many parts = few draws):
//   - ALLOY: a metallic MeshStandardMaterial driven by per-part vertex colors —
//     gets the studio lighting + shadows for free.
//   - ENERGY: a hand-written ShaderMaterial (modeled on GrassMaterial) giving the
//     identity — Fresnel rim, emissive pulse, scanlines, and flowing energy. Self-lit,
//     so it reads as glowing crystal/plasma rather than a shaded surface.
// Both expose update(elapsed) / dispose(); the generator toggles glow + wireframe.

import * as THREE from "three";

export function createAlloyMaterial() {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    color: 0xffffff, // albedo comes from the vertex colors
    metalness: 0.62,
    roughness: 0.38,
    side: THREE.FrontSide,
  });
}

const energyVertex = /* glsl */ `
  attribute vec3 color;
  varying vec3 vColor;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying vec3 vWPos;
  void main() {
    vColor = color;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWPos = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewW = cameraPosition - wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const energyFragment = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uCoreIntensity;
  uniform float uFresnelPower;
  uniform float uPulseRate;
  uniform float uScanlineDensity;
  uniform float uRefractionStrength;
  varying vec3 vColor;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying vec3 vWPos;
  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(vViewW);
    float fres = pow(clamp(1.0 - abs(dot(N, V)), 0.0, 1.0), uFresnelPower);
    float pulse = 0.5 + 0.5 * sin(uTime * uPulseRate);
    float scan = 0.5 + 0.5 * sin(vWPos.x * uScanlineDensity + uTime * 2.0);
    float flow = 0.5 + 0.5 * sin(vWPos.x * 6.0 - uTime * 3.0 + vWPos.y * 4.0);
    vec3 base = vColor;
    vec3 core = base * (0.55 + 0.85 * pulse) * uCoreIntensity;
    vec3 rim = mix(base, vec3(1.0), 0.6) * fres * 1.4;
    float shimmer = mix(0.85, 1.18, scan * flow);
    vec3 col = core * shimmer + rim;
    // Fake refraction sparkle: extra light where grazing angle + flow align.
    col += base * fres * flow * uRefractionStrength * 3.0;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class WeaponEnergyMaterial {
  /** @param {object} mat recipe.material */
  constructor(mat = {}) {
    this._baseIntensity = mat.coreIntensity ?? 1.1;
    this.material = new THREE.ShaderMaterial({
      vertexShader: energyVertex,
      fragmentShader: energyFragment,
      uniforms: {
        uTime: { value: 0 },
        uCoreIntensity: { value: this._baseIntensity },
        uFresnelPower: { value: 2.4 },
        uPulseRate: { value: mat.pulseRate ?? 1.4 },
        uScanlineDensity: { value: mat.scanlineDensity ?? 90 },
        uRefractionStrength: { value: mat.refractionStrength ?? 0.18 },
      },
    });
  }

  update(elapsed) {
    this.material.uniforms.uTime.value = elapsed;
  }

  setGlow(on) {
    this.material.uniforms.uCoreIntensity.value = on ? this._baseIntensity : 0.12;
  }

  dispose() {
    this.material.dispose();
  }
}
