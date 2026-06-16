import * as THREE from "three";

// A simple outdoor lighting rig: a warm key sun (casts shadows over the play
// area) plus a hemisphere fill so shadowed grass keeps a sky/ground tint.
export function createLights(scene) {
  const sun = new THREE.DirectionalLight(0xfff1d8, 2.6);
  sun.position.set(60, 90, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 260;
  const s = 90;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0xbfe0ff, 0x4a5236, 0.85);
  scene.add(hemi);

  // Direction the grass shader uses for its cheap diffuse term.
  const sunDirection = new THREE.Vector3().copy(sun.position).normalize();

  return { sun, hemi, sunDirection };
}
