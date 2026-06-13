// Builds a visible ground mesh by displacing a plane through terrainSampling.
// Vertex colors come from height + slope so the ground reads as grass / dirt /
// rock without needing textures.

import * as THREE from "three";
import { getHeight, getSlope } from "./terrainSampling.js";
import { clamp, smoothstep } from "../utils/math.js";

const COLOR_GRASS = new THREE.Color(0x4f6b34);
const COLOR_DIRT = new THREE.Color(0x6b5836);
const COLOR_ROCK = new THREE.Color(0x6a6660);
const COLOR_LOW = new THREE.Color(0x3c5530); // damp lowland

export class Terrain {
  /**
   * @param {object} opts
   * @param {number} opts.size   world size of the terrain (square, centered at origin)
   * @param {number} opts.segments  grid resolution per side
   */
  constructor({ size = 600, segments = 220 } = {}) {
    this.size = size;
    this.segments = segments;
    this.mesh = this._build();
  }

  _build() {
    const { size, segments } = this;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2); // lay flat: XZ plane, Y up

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = getHeight(x, z);
      pos.setY(i, h);

      const slope = getSlope(x, z);
      // Blend ground color by height band, then push toward rock on steep slope.
      const lowT = smoothstep(-8, 2, h);
      c.copy(COLOR_LOW).lerp(COLOR_GRASS, lowT);
      c.lerp(COLOR_DIRT, smoothstep(0.18, 0.4, slope));
      c.lerp(COLOR_ROCK, smoothstep(0.42, 0.62, slope));

      // Subtle per-vertex value variation for life.
      const v = 0.92 + 0.16 * fract(Math.sin((x * 12.9 + z * 78.2)) * 43758.5);
      colors[i * 3 + 0] = clamp(c.r * v, 0, 1);
      colors[i * 3 + 1] = clamp(c.g * v, 0, 1);
      colors[i * 3 + 2] = clamp(c.b * v, 0, 1);
    }

    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.0,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "Terrain";
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false; // static
    mesh.updateMatrix();
    return mesh;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

function fract(n) {
  return n - Math.floor(n);
}
