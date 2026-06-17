// Weapon generator — orchestrates config → grammar → geometry + materials → a
// THREE.Group of part meshes. Parts stay separate meshes (so exploded view can offset
// them) but share two materials (alloy / energy) for few draws. Owns the full
// lifecycle: build() tears down the previous weapon first (no leaks), update() drives
// the energy shader, and explode/wireframe/glow are live toggles.

import * as THREE from "three";
import { generateWeaponRecipe } from "./WeaponGrammar.js";
import { buildWeaponParts } from "./WeaponGeometry.js";
import { createAlloyMaterial, WeaponEnergyMaterial } from "./WeaponMaterial.js";
import { createWeaponConfig } from "./WeaponConfig.js";

export class WeaponGenerator {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = "weapon";
    this.recipe = null;
    this.parts = []; // { mesh, restPos: Vector3, axis: Vector3 }
    this._alloy = null;
    this._energy = null;
    this._exploded = 0;
    this.stats = { parts: 0, energy: 0, triangles: 0, vertices: 0 };
  }

  /** Build (or rebuild) the weapon from a config. Returns the recipe. */
  build(config) {
    this.dispose();
    const cfg = createWeaponConfig(config);
    this.recipe = generateWeaponRecipe(cfg);
    const { parts, vertexCount } = buildWeaponParts(this.recipe);
    this._alloy = createAlloyMaterial();
    this._energy = new WeaponEnergyMaterial(this.recipe.material);

    let triangles = 0;
    let energy = 0;
    for (const p of parts) {
      const mesh = new THREE.Mesh(p.geometry, p.role === "energy" ? this._energy.material : this._alloy);
      mesh.castShadow = p.role === "alloy";
      mesh.receiveShadow = p.role === "alloy";
      mesh.position.set(p.position[0], p.position[1], p.position[2]);
      mesh.rotation.set(p.rotation[0], p.rotation[1], p.rotation[2]);
      mesh.userData.role = p.role;
      this.group.add(mesh);
      const idx = p.geometry.index;
      triangles += (idx ? idx.count : p.geometry.attributes.position.count) / 3;
      if (p.role === "energy") energy++;
      this.parts.push({ mesh, restPos: mesh.position.clone(), axis: new THREE.Vector3(p.axis[0], p.axis[1], p.axis[2]) });
    }
    this.stats = { parts: parts.length, energy, triangles: Math.round(triangles), vertices: vertexCount };
    this.setExploded(this._exploded);
    return this.recipe;
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
    this.parts = [];
    this._alloy?.dispose();
    this._energy?.dispose();
    this._alloy = null;
    this._energy = null;
  }
}
