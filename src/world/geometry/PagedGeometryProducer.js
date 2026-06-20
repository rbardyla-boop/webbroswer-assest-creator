// PagedGeometryProducer — Geometry Stream Gate-0 reference producer.
//
// A synthetic terrain-detail stress producer: a rows x cols height grid split into row
// bands, each band a single page bounded to <= maxVerticesPerChunk vertices. It is the
// ONLY producer this stage ships, and NO runtime system constructs it — it exists for the
// gate (the Node regression + the DEV __PAGED__ proof) so the streaming contract is proven
// before any real PCG system (grass/terrain) is asked to page its geometry.
//
// Deterministic by construction: page ids/order/counts/bounds are pure functions of the
// inputs, and per-vertex height comes from the seeded mulberry32/hash2i PRNG (not the
// platform random source), so the same { rows, cols, seed } always yields identical geometry.

import * as THREE from "three";

import { mulberry32, hash2i } from "../../utils/random.js";
import { MAX_VERTICES_PER_CHUNK } from "./PagedGeometryTypes.js";

// FNV-1a over the seed string → a stable 32-bit integer to mix into the per-vertex hash.
function hashSeedString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Build one band's BufferGeometry. Positions/normals/uvs/index are all deterministic; the
// index references only vertices inside this band (0 .. vertexCount-1, always < 65536 under
// the 64k cap, so a Uint16 index is safe).
function buildBand({ startRow, bandRows, cols, cellSize, seedInt, amplitude }) {
  const vertexCount = bandRows * cols;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  let p = 0;
  let u = 0;
  for (let r = 0; r < bandRows; r++) {
    const globalRow = startRow + r;
    for (let c = 0; c < cols; c++) {
      const y = mulberry32(hash2i(globalRow ^ seedInt, c))() * amplitude;
      positions[p] = c * cellSize;
      positions[p + 1] = y;
      positions[p + 2] = globalRow * cellSize;
      normals[p] = 0;
      normals[p + 1] = 1;
      normals[p + 2] = 0;
      p += 3;
      uvs[u] = cols > 1 ? c / (cols - 1) : 0;
      uvs[u + 1] = bandRows > 1 ? r / (bandRows - 1) : 0;
      u += 2;
    }
  }

  const quadRows = Math.max(0, bandRows - 1);
  const quadCols = Math.max(0, cols - 1);
  const index = new Uint16Array(quadRows * quadCols * 6);
  let k = 0;
  for (let r = 0; r < quadRows; r++) {
    for (let c = 0; c < quadCols; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      index[k++] = a; index[k++] = d; index[k++] = b;
      index[k++] = b; index[k++] = d; index[k++] = e;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}

/**
 * Emit page descriptors for a rows x cols terrain-detail grid. Each page is a band of full
 * rows sized to stay within the per-chunk vertex cap. `build` is lazy — descriptors are
 * comparable (id/order/counts/bounds) without realizing any geometry.
 *
 * @param {{ rows:number, cols:number, maxVerticesPerChunk?:number, seed?:string, cellSize?:number, amplitude?:number }} opts
 * @returns {Array<{ id:string, bounds:{min:number[],max:number[]}, vertexCount:number, indexCount:number, build:()=>THREE.BufferGeometry }>}
 */
export function createSyntheticTerrainProducer({ rows, cols, maxVerticesPerChunk = MAX_VERTICES_PER_CHUNK, seed = "paged", cellSize = 1, amplitude = 2 } = {}) {
  const totalRows = Math.max(1, Math.floor(rows));
  const totalCols = Math.max(1, Math.floor(cols));
  const cap = Math.max(1, Math.floor(maxVerticesPerChunk));
  if (totalCols > cap) {
    throw new Error(`PagedGeometryProducer: a single grid row (${totalCols} verts) exceeds the per-chunk cap (${cap})`);
  }
  const rowsPerPage = Math.max(1, Math.floor(cap / totalCols)); // rowsPerPage * cols <= cap by construction
  const seedInt = hashSeedString(String(seed));

  const pages = [];
  let startRow = 0;
  let index = 0;
  while (startRow < totalRows) {
    const bandRows = Math.min(rowsPerPage, totalRows - startRow);
    const vertexCount = bandRows * totalCols;
    const quadRows = Math.max(0, bandRows - 1);
    const quadCols = Math.max(0, totalCols - 1);
    const params = { startRow, bandRows, cols: totalCols, cellSize, seedInt, amplitude };
    pages.push({
      id: `${seed}:page:${index}`,
      bounds: {
        min: [0, 0, startRow * cellSize],
        max: [(totalCols - 1) * cellSize, amplitude, (startRow + bandRows - 1) * cellSize],
      },
      vertexCount,
      indexCount: quadRows * quadCols * 6,
      build: () => buildBand(params),
    });
    startRow += bandRows;
    index++;
  }
  return pages;
}
