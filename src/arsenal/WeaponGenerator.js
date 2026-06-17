// Weapon generator (workbench shell). Turns a CONFIG into a recipe, then builds it
// through the shared WeaponRuntime (the same recipe→mesh path the world uses). Keeps a
// STABLE outer group (the workbench adds it to the scene once) and swaps the inner
// WeaponRuntime on each rebuild, so config-side concerns stay here and the recipe→mesh
// code lives in exactly one place.

import * as THREE from "three";
import { generateWeaponRecipe } from "./WeaponGrammar.js";
import { createWeaponConfig } from "./WeaponConfig.js";
import { buildWeaponFromRecipe } from "./WeaponRuntime.js";

export class WeaponGenerator {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = "weapon-root";
    this.recipe = null;
    this._weapon = null; // WeaponRuntime
    this._exploded = 0;
    this.stats = { parts: 0, energy: 0, triangles: 0, vertices: 0 };
  }

  /** Build (or rebuild) the weapon from a config. Returns the recipe. */
  build(config) {
    const cfg = createWeaponConfig(config);
    const recipe = generateWeaponRecipe(cfg);
    this._setWeapon(buildWeaponFromRecipe(recipe));
    this.recipe = recipe;
    return recipe;
  }

  _setWeapon(weapon) {
    if (this._weapon) {
      this.group.remove(this._weapon.group);
      this._weapon.dispose();
    }
    this._weapon = weapon;
    this.group.add(weapon.group);
    this.stats = weapon.stats;
    weapon.setExploded(this._exploded);
  }

  update(elapsed) {
    this._weapon?.update(elapsed);
  }

  setExploded(t) {
    this._exploded = Math.max(0, Math.min(2, Number(t) || 0));
    this._weapon?.setExploded(this._exploded);
  }

  setWireframe(on) {
    this._weapon?.setWireframe(on);
  }

  setGlow(on) {
    this._weapon?.setGlow(on);
  }

  dispose() {
    if (this._weapon) {
      this.group.remove(this._weapon.group);
      this._weapon.dispose();
    }
    this._weapon = null;
  }
}
