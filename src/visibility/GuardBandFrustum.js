import * as THREE from "three";

// A camera frustum plus the guard-band classification used by the visibility
// kernel. The "expansion" of the frustum is done by inflating the test sphere's
// radius — inflating a sphere by margin m is exactly equivalent to pushing every
// frustum plane outward by m (THREE.Frustum.intersectsSphere tests
// distanceToPlane < -radius), so it needs no extra matrices and stays cheap.
//
// The guard/unload margins are proportional to the agent's distance from the
// camera (dist * (band - 1)), so a 1.2 guard band means "20% of the way to the
// object" — a margin that grows with distance, which is what keeps fast turns
// from popping distant objects.

const _scratch = new THREE.Sphere();

export class GuardBandFrustum {
  constructor() {
    this.frustum = new THREE.Frustum();
    this.cameraPosition = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._invWorld = new THREE.Matrix4();
  }

  setFromCamera(camera) {
    camera.updateMatrixWorld();
    // Derive the view matrix from matrixWorld directly — the renderer's cached
    // matrixWorldInverse can be stale when the kernel runs before render, and is
    // absent headless. This stays correct in both cases.
    this._invWorld.copy(camera.matrixWorld).invert();
    this._m.multiplyMatrices(camera.projectionMatrix, this._invWorld);
    this.frustum.setFromProjectionMatrix(this._m);
    camera.getWorldPosition(this.cameraPosition);
    return this;
  }

  /**
   * Classify a world-space bounding sphere into a visibility tier.
   * @param {THREE.Sphere} sphere
   * @param {object} config  sanitized visibility config
   * @returns {"visible"|"warm"|"sleeping"|"unloaded"}
   */
  classify(sphere, config) {
    const inFrustum = this.frustum.intersectsSphere(sphere);
    if (inFrustum) return "visible";

    const dist = this.cameraPosition.distanceTo(sphere.center);
    // Anti-pop floor: anything close stays at least warm regardless of facing,
    // so a fast 180° turn never reveals a cold/unloaded nearby object.
    if (dist <= config.nearRadius) return "warm";

    if (this._intersectsInflated(sphere, dist * (config.guardBand - 1))) return "warm";
    if (this._intersectsInflated(sphere, dist * (config.unloadBand - 1))) return "sleeping";
    return "unloaded";
  }

  _intersectsInflated(sphere, margin) {
    if (margin <= 0) return this.frustum.intersectsSphere(sphere);
    _scratch.center.copy(sphere.center);
    _scratch.radius = sphere.radius + margin;
    return this.frustum.intersectsSphere(_scratch);
  }
}
