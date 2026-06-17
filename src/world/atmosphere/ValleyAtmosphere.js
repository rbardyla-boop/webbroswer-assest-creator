// Valley atmosphere depth. The world's fog is a single global linear THREE.Fog set by
// the lighting block; true volumetric height-fog is out of scope. This system gives
// the flat fog a sense of depth by MODULATING it from where the camera sits in the
// valley — thicker (near pulled in) deep on the basin floor, thinner up on the ridges,
// shifted toward a cold mist near the water surface or above the snowline. The basin/
// mist signals are read from the active TerrainProfile (terrain authority), eased so
// the change is smooth, and pushed into the grass fog uniforms so grass agrees.

import * as THREE from "three";
import { clamp, smoothstep } from "../../utils/math.js";
import { getActiveTerrainProfile } from "../../terrain/terrainSampling.js";
import { sanitizeAtmosphere } from "./AtmosphereValidation.js";

/**
 * Pure target-fog from the camera's position in the valley. Node-safe (no THREE).
 * @param {{x:number,y:number,z:number}} cameraPos
 * @param {object} profile  active TerrainProfile (height / waterLevelAt / snowlineAt)
 * @param {{near:number, far:number}} baseFog  lighting-defined base fog distances
 * @param {object} cfg  sanitized atmosphere config
 * @returns {{near:number, far:number, mist:number}}  mist is a 0..1 color-shift amount
 */
export function computeValleyFog(cameraPos, profile, baseFog, cfg) {
  const { x, y, z } = cameraPos;
  const water = profile.waterLevelAt(x, z);
  const ground = profile.height(x, z);
  const snowline = profile.snowlineAt(x, z);

  // Low reference = the valley floor (water table if present, else local ground).
  const lowRef = Number.isFinite(water) ? water : ground;
  const highRef = lowRef + cfg.ridgeSpan;

  // basinT: 1 deep on the valley floor, 0 high on the ridges — by ABSOLUTE altitude,
  // so standing on a ridge crest reads thin even though it's near its own local ground.
  const basinT = clamp(1 - smoothstep(lowRef, highRef, y), 0, 1);

  // Thicker fog in the basin: pull the fog ONSET (`near`) in by basinFogBoost. `far`
  // stays at the lighting-authored base — the vista depth / distance haze is owned by
  // the lighting block, and pulling `far` in would pop distant geometry. So atmosphere
  // modulates onset + mist color only, never the far plane the author set.
  const near = baseFog.near * (1 - cfg.basinFogBoost * basinT);
  const far = Math.max(near + 1, baseFog.far);

  // Cold mist hugging the water surface or settling above the snowline.
  const nearWater = Number.isFinite(water) ? 1 - clamp(Math.abs(y - water) / cfg.mistBand, 0, 1) : 0;
  const aboveSnow = y > snowline ? clamp((y - snowline) / cfg.mistBand, 0, 1) : 0;
  const mist = clamp(cfg.mistStrength * Math.max(nearWater, aboveSnow), 0, 1);

  return { near, far, mist };
}

export class ValleyAtmosphere {
  constructor(config = {}) {
    this.cfg = sanitizeAtmosphere(config);
    this.scene = null;
    this.grass = null;
    this._base = null; // {near, far, color: THREE.Color} captured from the lighting fog
    this._mistColor = new THREE.Color(this.cfg.mistColor);
    this._targetColor = new THREE.Color();
    this._lastSyncNear = -1;
    this._lastSyncFar = -1;
  }

  // Capture the lighting-applied base fog. Called AFTER applyLighting and BEFORE grass
  // is built, so grass captures a coherent fog. Does NOT change scene.fog — modulation
  // eases from this base each runtime frame (the editor keeps the static base look).
  applyBase(scene) {
    this.scene = scene;
    if (!scene?.fog) return; // fog disabled → atmosphere is a no-op
    this._base = { near: scene.fog.near, far: scene.fog.far, color: scene.fog.color.clone() };
  }

  // The grass material captures fog at construction; give us its handle so the eased
  // fog can be pushed back into the grass shader each frame it changes.
  attachFogConsumer(grass) {
    this.grass = grass;
  }

  update(cameraPos, dt) {
    if (!this.cfg.enabled || !this.scene?.fog || !this._base) return;
    const profile = getActiveTerrainProfile();
    const { near, far, mist } = computeValleyFog(cameraPos, profile, this._base, this.cfg);
    this._targetColor.copy(this._base.color).lerp(this._mistColor, mist);

    // Frame-rate-independent ease toward the target.
    const k = 1 - Math.exp(-this.cfg.easeRate * Math.max(dt, 0));
    const fog = this.scene.fog;
    fog.near += (near - fog.near) * k;
    fog.far += (far - fog.far) * k;
    fog.color.lerp(this._targetColor, k);
    if (this.scene.background?.isColor) this.scene.background.lerp(this._targetColor, k);

    // Re-sync grass fog only when the eased value actually moved (avoid needless work).
    if (this.grass && (Math.abs(fog.near - this._lastSyncNear) > 0.05 || Math.abs(fog.far - this._lastSyncFar) > 0.05)) {
      this.grass.syncLighting({ fog: { enabled: true, near: fog.near, far: fog.far, color: fog.color } });
      this._lastSyncNear = fog.near;
      this._lastSyncFar = fog.far;
    }
  }

  dispose() {
    this.scene = null;
    this.grass = null;
    this._base = null;
  }
}
