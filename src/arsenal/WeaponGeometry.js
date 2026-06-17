// Weapon geometry — recipe part descriptors → THREE.BufferGeometry parts. Each part
// is a primitive (box / cylinder / torus ring / scaled-octahedron prism / capsule)
// centered at its own origin; the returned transform places it. Per-part color is
// baked into a vertex-color attribute so all alloy parts can share ONE material and
// all energy parts another (few draws), while staying separate meshes for exploded
// view. Pure construction — works headless in Node (no GL context needed to BUILD
// geometry), so the determinism test can exercise it. Bounded by a vertex budget.

import * as THREE from "three";
import { ARSENAL_LIMITS } from "./WeaponConfig.js";

// Modest segment counts keep the whole weapon well under the vertex budget.
function primitive(shape, size) {
  const [a, b = a, c = a] = size ?? [1, 1, 1];
  if (shape === "cyl") return new THREE.CylinderGeometry(a, a, b, 16);
  if (shape === "ring") return new THREE.TorusGeometry(a, b, 8, 22);
  if (shape === "prism") {
    const g = new THREE.OctahedronGeometry(0.5, 0);
    g.scale(a, b, c);
    g.computeVertexNormals(); // non-uniform scale invalidates the built-in normals
    return g;
  }
  if (shape === "capsule") return new THREE.CapsuleGeometry(a, b, 4, 12);
  return new THREE.BoxGeometry(a, b, c);
}

function setVertexColor(geometry, hex) {
  const col = new THREE.Color(hex || "#808890"); // THREE parses sRGB hex → linear r/g/b
  const n = geometry.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = col.r;
    arr[i * 3 + 1] = col.g;
    arr[i * 3 + 2] = col.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(arr, 3));
}

/**
 * @param {object} recipe from generateWeaponRecipe
 * @returns {{ parts: Array<{geometry:THREE.BufferGeometry, role:"alloy"|"energy",
 *            position:number[], rotation:number[], axis:number[]}>, vertexCount:number }}
 */
export function buildWeaponParts(recipe) {
  const parts = [];
  let vertexCount = 0;
  const energyFallback = recipe?.material?.energyColor ?? "#46d6ff";
  for (const p of recipe?.parts ?? []) {
    const geometry = primitive(p.shape, p.size);
    const vc = geometry.attributes.position.count;
    // Vertex budget backstop — drop the rest rather than build an unbounded mesh set.
    if (vertexCount + vc > ARSENAL_LIMITS.MAX_VERTICES) {
      geometry.dispose();
      break;
    }
    vertexCount += vc;
    const role = p.role === "energy" ? "energy" : "alloy";
    setVertexColor(geometry, role === "energy" ? p.color ?? energyFallback : p.color ?? "#7a8088");
    const pos = p.pos ?? [0, 0, 0];
    const d = Math.hypot(pos[0], pos[1], pos[2]);
    const axis = d > 1e-3 ? [pos[0] / d, pos[1] / d, pos[2] / d] : [0, 1, 0];
    parts.push({ geometry, role, position: pos, rotation: p.rot ?? [0, 0, 0], axis });
  }
  return { parts, vertexCount };
}
