// Weapon runtime builder — recipe → a live THREE.Group for ONE weapon. This is the
// reusable seam: both the Arsenal Lab workbench AND the world placement runtime build
// weapons through buildWeaponFromRecipe(recipe), so there is exactly one recipe→mesh
// path. Pure of any UI / config / workbench dependency (the world imports THIS, never
// the workbench). Owns geometry + the two shared materials + named anchor markers, and
// the full lifecycle (update/explode/wireframe/glow/dispose).

import * as THREE from "three";
import { buildWeaponParts } from "./WeaponGeometry.js";
import { createAlloyMaterial, WeaponEnergyMaterial } from "./WeaponMaterial.js";

const MARKER_NAMES = ["muzzle", "core", "equip", "socket"];

export class WeaponRuntime {
  /** @param {object} recipe a validated weapon recipe */
  constructor(recipe) {
    this.group = new THREE.Group();
    this.group.name = "weapon";
    this.recipe = recipe;
    this.parts = []; // { mesh, restPos: Vector3, axis: Vector3 }
    this.markers = { muzzle: [0, 0, 0], core: [0, 0, 0], equip: [0, 0, 0], socket: [0, 0, 0] };
    this._markerObjs = [];
    this._alloy = null;
    this._energy = null;
    this._exploded = 0;
    this.stats = { parts: 0, energy: 0, triangles: 0, vertices: 0 };
    this._build(recipe);
  }

  _build(recipe) {
    const { parts, vertexCount } = buildWeaponParts(recipe);
    this._alloy = createAlloyMaterial();
    this._energy = new WeaponEnergyMaterial(recipe?.material ?? {});

    let triangles = 0;
    let energy = 0;
    let maxX = -Infinity;
    let sumY = 0;
    let sumZ = 0;
    let minY = Infinity;
    let equipPos = null;
    const energyPos = [];
    for (const p of parts) {
      const mesh = new THREE.Mesh(p.geometry, p.role === "energy" ? this._energy.material : this._alloy);
      mesh.castShadow = p.role === "alloy";
      mesh.receiveShadow = p.role === "alloy";
      mesh.position.set(p.position[0], p.position[1], p.position[2]);
      mesh.rotation.set(p.rotation[0], p.rotation[1], p.rotation[2]);
      mesh.userData.role = p.role;
      this.group.add(mesh);
      triangles += (p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count) / 3;
      if (p.role === "energy") {
        energy++;
        energyPos.push(p.position);
      }
      this.parts.push({ mesh, restPos: mesh.position.clone(), axis: new THREE.Vector3(p.axis[0], p.axis[1], p.axis[2]) });
      maxX = Math.max(maxX, p.position[0]);
      sumY += p.position[1];
      sumZ += p.position[2];
      if (p.position[1] < minY) {
        minY = p.position[1];
        equipPos = p.position;
      }
    }
    this.stats = { parts: parts.length, energy, triangles: Math.round(triangles), vertices: vertexCount };

    // Named anchor markers (Stage 21B): empty Object3Ds + a plain {name:[x,y,z]} map.
    // muzzle = forward-most (+X); core = energy centroid; equip = lowest part (grip
    // mount); socket = origin (attach root). All finite (origin fallback when empty).
    const n = parts.length || 1;
    this.markers = {
      muzzle: parts.length ? [maxX, sumY / n, sumZ / n] : [0, 0, 0],
      core: energyPos.length ? centroid(energyPos) : [0, 0, 0],
      equip: equipPos ? [equipPos[0], equipPos[1], equipPos[2]] : [0, 0, 0],
      socket: [0, 0, 0],
    };
    for (const name of MARKER_NAMES) {
      const m = new THREE.Object3D();
      m.name = name;
      const pos = this.markers[name];
      m.position.set(pos[0], pos[1], pos[2]);
      this.group.add(m);
      this._markerObjs.push(m);
    }
    this.group.userData.markers = this.markers;
  }

  update(elapsed) {
    this._energy?.update(elapsed);
  }

  setExploded(t) {
    this._exploded = Math.max(0, Math.min(2, Number(t) || 0));
    for (const p of this.parts) p.mesh.position.copy(p.restPos).addScaledVector(p.axis, this._exploded);
  }

  setWireframe(on) {
    if (this._alloy) this._alloy.wireframe = !!on;
    if (this._energy) this._energy.material.wireframe = !!on;
  }

  setGlow(on) {
    this._energy?.setGlow(on);
  }

  dispose() {
    for (const p of this.parts) {
      p.mesh.geometry.dispose();
      this.group.remove(p.mesh);
    }
    for (const m of this._markerObjs) this.group.remove(m);
    this.parts = [];
    this._markerObjs = [];
    this._alloy?.dispose();
    this._energy?.dispose();
    this._alloy = null;
    this._energy = null;
  }
}

export function buildWeaponFromRecipe(recipe) {
  return new WeaponRuntime(recipe);
}

function centroid(points) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
    z += p[2];
  }
  const n = points.length;
  return [x / n, y / n, z / n];
}
