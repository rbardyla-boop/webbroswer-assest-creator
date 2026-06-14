// Applies a sanitized lighting document to the live THREE rig (directional sun,
// hemisphere fill, scene fog + background). Used at world load and on every
// editor lighting edit. THREE-aware but DOM-free.

import * as THREE from "three";
import { computeSunOffset } from "./LightingTypes.js";

/**
 * Mutate the live lights/scene to match `lighting`. Stores the derived sun offset
 * on `lights.sunOffset` (a THREE.Vector3) so the shadow rig that follows the
 * player can reuse it, and updates `lights.sunDirection` for shaders that read it.
 * Returns the offset.
 *
 * @param {{ lights: object, scene: THREE.Scene }} rig
 * @param {object} lighting  sanitized lighting (see LightingValidation)
 */
export function applyLighting({ lights, scene } = {}, lighting) {
  if (!lighting) return null;

  const offset = computeSunOffset(lighting.sun.azimuth, lighting.sun.elevation);

  if (lights?.sun) {
    lights.sun.color.set(lighting.sun.color);
    lights.sun.intensity = lighting.sun.intensity;
    lights.sun.castShadow = lighting.sun.castShadow;
  }
  if (lights) {
    lights.sunOffset = new THREE.Vector3(offset.x, offset.y, offset.z);
    lights.sunDirection?.set(offset.x, offset.y, offset.z).normalize();
  }
  if (lights?.hemi) {
    lights.hemi.color.set(lighting.hemisphere.skyColor);
    lights.hemi.groundColor.set(lighting.hemisphere.groundColor);
    lights.hemi.intensity = lighting.hemisphere.intensity;
  }

  if (scene) {
    if (lighting.fog.enabled) {
      if (scene.fog) {
        scene.fog.color.set(lighting.fog.color);
        scene.fog.near = lighting.fog.near;
        scene.fog.far = lighting.fog.far;
      } else {
        scene.fog = new THREE.Fog(lighting.fog.color, lighting.fog.near, lighting.fog.far);
      }
    } else {
      scene.fog = null;
    }
    if (scene.background?.isColor) scene.background.set(lighting.fog.color);
    else scene.background = new THREE.Color(lighting.fog.color);
  }

  return offset;
}
