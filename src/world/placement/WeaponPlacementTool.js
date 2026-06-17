// Weapon placement service. Grounds a weapon recipe on the terrain at a world (x,z) and
// records it in the PlacedAssetStore. Pure service — no editor UI, no scene; the store
// normalizes the descriptor (recipe sanitized, id derived). Reuses the single terrain
// source (getHeight) so a placed weapon agrees with the ground like everything else.

import { getHeight } from "../../terrain/terrainSampling.js";

// Lift the weapon's centre above the ground so its body floats clear (it is centred on
// its own origin), reading as a pickup rather than a half-sunk mesh.
const FLOAT_HEIGHT = 1.0;

/**
 * @param {import("../assets/PlacedAssetStore.js").PlacedAssetStore} store
 * @param {object} recipe weapon recipe (sanitized by the store on add)
 * @param {{x?:number, z?:number, yaw?:number, id?:string|null, runtime?:object|null}} [at]
 * @returns the stored descriptor, or null
 */
export function placeWeapon(store, recipe, { x = 0, z = 0, yaw = 0, id = null, runtime = null } = {}) {
  const y = getHeight(x, z) + FLOAT_HEIGHT;
  return store.add({
    kind: "generated.weapon",
    id,
    recipe,
    transform: { position: { x, y, z }, rotation: { x: 0, y: yaw, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    runtime: runtime ?? undefined,
  });
}

// Deterministic auto-layout: place dropped weapons in a tidy grid in front of a spawn
// point, so the handoff queue lands somewhere visible without overlapping.
export function autoPlacementPoint(spawn, index) {
  const cols = 5;
  const gap = 2.4;
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: (spawn?.x ?? 0) + (col - (cols - 1) / 2) * gap,
    z: (spawn?.z ?? 0) + 5 + row * gap,
  };
}
