import * as THREE from "three";

// The single perspective camera shared by both first- and third-person modes.
// The PlayerCameraController moves it; this module only constructs it.
export function createCamera() {
  const camera = new THREE.PerspectiveCamera(
    62, // fov
    window.innerWidth / window.innerHeight,
    0.1,
    600
  );
  camera.position.set(0, 8, 12);
  return camera;
}

export function resizeCamera(camera, width, height) {
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
