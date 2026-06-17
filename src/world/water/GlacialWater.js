// Glacial water surface — a DERIVED mesh, not a second terrain truth. Built exactly
// like Terrain._build(): a flat plane whose every vertex Y is sampled from the active
// profile's water table (getWaterLevel) and whose per-vertex `aDepth` attribute is
// (waterLevel - getHeight). The material discards where aDepth <= 0, so the dry land
// drops out and river + lakes + tarns all emerge from this ONE sheet. Both Y and
// aDepth read straight through terrainSampling, so the water can never disagree with
// the ground it sits in.

import * as THREE from "three";
import { getHeight, getWaterLevel } from "../../terrain/terrainSampling.js";
import { createGlacialWaterMaterial } from "./GlacialWaterMaterial.js";
import { sanitizeWater } from "./WaterValidation.js";

export class GlacialWater {
  /**
   * @param {object} config  water render config (sanitized defensively here too)
   * @param {object} opts
   * @param {number} opts.size   world size (square, centered) — match the terrain
   * @param {number} opts.segments  grid resolution per side
   */
  constructor(config = {}, { size = 700, segments = 240 } = {}) {
    this.config = sanitizeWater(config);
    this.size = size;
    this.segments = segments;
    const { material, uniforms } = createGlacialWaterMaterial(this.config);
    this.material = material;
    this._uniforms = uniforms;
    this.mesh = this._build();
  }

  _build() {
    const { size, segments } = this;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2); // lay flat: XZ plane, Y up

    const pos = geo.attributes.position;
    const depth = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const level = getWaterLevel(x, z);
      pos.setY(i, level); // surface follows the profile's water table
      depth[i] = level - getHeight(x, z); // > 0 submerged depth; <= 0 dry → discarded
    }

    geo.setAttribute("aDepth", new THREE.BufferAttribute(depth, 1));
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, this.material);
    mesh.name = "GlacialWater";
    mesh.receiveShadow = true;
    mesh.renderOrder = 1; // draw after opaque terrain/grass (it is the only transparent)
    mesh.matrixAutoUpdate = false; // static surface
    mesh.updateMatrix();
    return mesh;
  }

  // Advance the procedural surface flow. `elapsed` is the same cumulative-seconds
  // clock the grass wind uses, so motion stays in step across the scene.
  update(elapsed) {
    if (this._uniforms) this._uniforms.uTime.value = elapsed;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
