import * as THREE from "three";

// The world's sky color and matching distance fog. The fog far plane is tied to
// the grass visible distance so blades fade into the haze instead of popping.
export const SKY_COLOR = new THREE.Color(0x9fc4d8);

export function createScene({ fogNear = 60, fogFar = 240 } = {}) {
  const scene = new THREE.Scene();
  scene.background = SKY_COLOR.clone();
  scene.fog = new THREE.Fog(SKY_COLOR.clone(), fogNear, fogFar);
  return scene;
}
