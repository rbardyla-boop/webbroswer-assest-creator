// Runtime asset registry — the single world↔arsenal seam. Maps a runtime-asset kind to
// a PURE builder that turns a (validated) recipe into a live THREE.Group. The world
// depends only on the arsenal's runtime builder here, never on the workbench UI; new
// generated kinds slot in by adding one entry.

import { buildWeaponFromRecipe } from "../../arsenal/WeaponRuntime.js";

const BUILDERS = Object.freeze({
  "generated.weapon": (recipe) => buildWeaponFromRecipe(recipe),
});

export function hasRuntimeAssetKind(kind) {
  return Object.hasOwn(BUILDERS, kind);
}

/**
 * Build a runtime asset's renderable from its recipe.
 * @returns a built object exposing { group, update(elapsed), dispose() }, or null.
 */
export function buildRuntimeAsset(kind, recipe) {
  const builder = BUILDERS[kind];
  return builder ? builder(recipe) : null;
}
