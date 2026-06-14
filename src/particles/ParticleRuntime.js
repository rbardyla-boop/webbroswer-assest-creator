// Runtime particle/smoke engine. One THREE.Points emitter per placed object that
// carries a `particles` block. CPU integrates position/age into dynamic buffers;
// a point-sprite shader sizes, fades, and tints each particle (compositor-
// friendly: only point size + alpha animate). Deterministic per object (seeded
// RNG), runtime-safe, no DOM. Used in the runtime and as an editor preview.

import * as THREE from "three";
import { mulberry32 } from "../utils/random.js";
import { blendForKind } from "./ParticleTypes.js";

const vertexShader = `
attribute float aAge;
attribute float aLife;
uniform float uSize;
uniform float uSizeEnd;
varying float vT;
void main() {
  float alive = (aLife > 0.0 && aAge < aLife) ? 1.0 : 0.0;
  float t = aLife > 0.0 ? clamp(aAge / aLife, 0.0, 1.0) : 1.0;
  vT = t;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float size = mix(uSize, uSizeEnd, t);
  gl_PointSize = alive * size * (300.0 / max(-mv.z, 0.001));
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = `
uniform vec3 uColor;
uniform vec3 uColorEnd;
uniform float uOpacity;
varying float vT;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;          // round sprite
  float soft = smoothstep(0.25, 0.0, r2);
  float alpha = uOpacity * soft * (1.0 - vT);
  if (alpha <= 0.004) discard;
  gl_FragColor = vec4(mix(uColor, uColorEnd, vT), alpha);
}
`;

// Ceiling on concurrent emitters — bounds buffer/GPU memory from a hostile or
// corrupt world even when each emitter's own params are within range.
const MAX_EMITTERS = 200;

function seedFromId(id) {
  let seed = 0;
  for (const ch of String(id ?? "emitter")) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
  return seed >>> 0;
}

export class ParticleRuntime {
  constructor({ scene } = {}) {
    this.scene = scene;
    this.emitters = [];
    this._scratch = new THREE.Vector3();
  }

  get count() {
    return this.emitters.length;
  }

  load(objectManager) {
    this.clear();
    const objects = objectManager?.objects ? [...objectManager.objects.values()] : [];
    for (const object of objects) {
      const p = object.userData?.particles;
      if (!p) continue;
      if (this.emitters.length >= MAX_EMITTERS) {
        console.warn(`ParticleRuntime: emitter limit (${MAX_EMITTERS}) reached; remaining emitters skipped.`);
        break;
      }
      try {
        this.emitters.push(this._createEmitter(object, p));
      } catch (error) {
        console.warn(`Particle emitter skipped for ${object.userData?.objectId ?? "(unknown)"}`, error);
      }
    }
    return this;
  }

  _createEmitter(object, p) {
    const max = p.max;
    const positions = new Float32Array(max * 3);
    const vels = new Float32Array(max * 3);
    const ages = new Float32Array(max);
    const lifes = new Float32Array(max); // 0 = dead slot

    const geometry = new THREE.BufferGeometry();
    const attrPos = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
    const attrAge = new THREE.BufferAttribute(ages, 1).setUsage(THREE.DynamicDrawUsage);
    const attrLife = new THREE.BufferAttribute(lifes, 1).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", attrPos);
    geometry.setAttribute("aAge", attrAge);
    geometry.setAttribute("aLife", attrLife);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: p.size },
        uSizeEnd: { value: p.sizeEnd },
        uColor: { value: new THREE.Color(p.color) },
        uColorEnd: { value: new THREE.Color(p.colorEnd) },
        uOpacity: { value: p.opacity },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: blendForKind(p.kind) === "add" ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false; // particles span world space, not a tidy bbox
    points.name = "ParticleEmitter";
    this.scene?.add(points);

    const free = [];
    for (let i = max - 1; i >= 0; i--) free.push(i);

    return {
      object,
      objectId: object.userData?.objectId ?? null,
      p,
      max,
      points,
      geometry,
      material,
      positions,
      vels,
      ages,
      lifes,
      free,
      attrPos,
      attrAge,
      attrLife,
      accumulator: 0,
      alive: 0,
      rng: mulberry32(seedFromId(object.userData?.objectId)),
    };
  }

  update(dt) {
    if (!(dt > 0)) return;
    for (const emitter of this.emitters) this._updateEmitter(emitter, Math.min(dt, 0.1));
  }

  _updateEmitter(e, dt) {
    const { p, positions, vels, ages, lifes, free } = e;
    // Age + integrate live particles.
    for (let i = 0; i < e.max; i++) {
      if (lifes[i] <= 0) continue;
      const age = ages[i] + dt;
      if (age >= lifes[i]) {
        lifes[i] = 0;
        free.push(i);
        continue;
      }
      ages[i] = age;
      const i3 = i * 3;
      vels[i3 + 1] += p.gravity * dt;
      positions[i3] += vels[i3] * dt;
      positions[i3 + 1] += vels[i3 + 1] * dt;
      positions[i3 + 2] += vels[i3 + 2] * dt;
    }
    // Spawn new particles at `rate`/sec into free slots.
    e.accumulator = Math.min(e.accumulator + p.rate * dt, e.max);
    const center = e.object.getWorldPosition(this._scratch);
    while (e.accumulator >= 1 && free.length) {
      e.accumulator -= 1;
      this._spawn(e, free.pop(), center);
    }
    e.alive = e.max - free.length;
    e.attrPos.needsUpdate = true;
    e.attrAge.needsUpdate = true;
    e.attrLife.needsUpdate = true;
  }

  _spawn(e, i, center) {
    const r = e.rng;
    const { positions, vels, ages, lifes, p } = e;
    const i3 = i * 3;
    // Position: a random point in the emit-radius sphere.
    const theta = r() * Math.PI * 2;
    const z = r() * 2 - 1;
    const ring = Math.sqrt(Math.max(0, 1 - z * z)) * p.emitRadius;
    positions[i3] = center.x + ring * Math.cos(theta);
    positions[i3 + 1] = center.y + z * p.emitRadius;
    positions[i3 + 2] = center.z + ring * Math.sin(theta);
    // Velocity: an upward cone widened by `spread`.
    const phi = r() * p.spread * (Math.PI / 2);
    const th = r() * Math.PI * 2;
    const speed = p.speed * (0.6 + 0.8 * r());
    const sinPhi = Math.sin(phi);
    vels[i3] = sinPhi * Math.cos(th) * speed;
    vels[i3 + 1] = Math.cos(phi) * speed;
    vels[i3 + 2] = sinPhi * Math.sin(th) * speed;
    ages[i] = 0;
    lifes[i] = p.lifetime * (0.7 + 0.6 * r());
  }

  clear() {
    for (const e of this.emitters) {
      this.scene?.remove(e.points);
      e.geometry.dispose();
      e.material.dispose();
    }
    this.emitters = [];
  }

  // --- observability (debug-safe; no UI) --------------------------------------

  debugSnapshot() {
    return {
      emitters: this.emitters.map((e) => ({ id: e.objectId, kind: e.p.kind, alive: e.alive, max: e.max })),
      totalAlive: this.emitters.reduce((sum, e) => sum + e.alive, 0),
    };
  }
}
