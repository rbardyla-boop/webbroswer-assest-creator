// Relic-weapon objective — pure domain helpers (FP-1). Deterministic relic recipe + relic/cache
// site derivation on dry walkable ground, the live-phase derivation, and the banner copy. No THREE,
// no scene, no document mutation — just functions the ObjectiveRuntime composes. Imports the PURE
// arsenal recipe modules (grammar/config) only — no workbench UI (boundary stays recipe-only).

import { generateWeaponRecipe } from "../../arsenal/WeaponGrammar.js";
import { rollConfig } from "../../arsenal/WeaponConfig.js";
import { getHeight, getWaterLevel, getSlope, getActiveTerrainProfile } from "../../terrain/terrainSampling.js";

export const RELIC_ID = "relic-weapon-fp1"; // fixed id → spawn-if-absent is idempotent across reloads
export const OBJECTIVE_KIND = "relic-weapon.fp1";
const RELIC_SEED = "relic.fp1"; // deterministic recipe seed
const RELIC_TYPE = "heavy"; // a chunky, recognizable silhouette for the relic

const RELIC_DIST = 14; // how far from spawn the relic sits (close enough to find)
const CACHE_DIST = 26; // the cache is further, in a different direction (carrying required)
const CACHE_RADIUS = 4; // deposit zone radius
const SLOPE_LIMIT = 0.45; // walkable-ground slope cap for a site
const RING_STEPS = 16; // deterministic candidate directions around the spawn

/** The relic's deterministic weapon recipe (same every world). */
export function relicRecipe() {
  return generateWeaponRecipe(rollConfig(RELIC_SEED, RELIC_TYPE));
}

/** Dry, walkable, below-snowline ground? (Mirrors canPlaceGrass' legality, slope-relaxed.) */
export function isWalkable(x, z) {
  const profile = getActiveTerrainProfile();
  const h = getHeight(x, z);
  if (h < getWaterLevel(x, z)) return false; // submerged (−Infinity on dry profiles → always false)
  if (getSlope(x, z) > SLOPE_LIMIT) return false; // too steep — cliff/scree
  if (h > profile.snowlineAt(x, z)) return false; // above snowline (+Infinity on rolling → never)
  return true;
}

// Deterministic site search: step around a ring at a fixed distance from the spawn and return the
// first walkable point; if none is walkable (rare near a resolved spawn), fall back to the seed
// direction so the objective still places (the proof + play both resolve a dry spawn first).
function findSite(sx, sz, dist, angle0) {
  for (let i = 0; i < RING_STEPS; i++) {
    const a = angle0 + (i / RING_STEPS) * Math.PI * 2;
    const x = sx + Math.cos(a) * dist;
    const z = sz + Math.sin(a) * dist;
    if (isWalkable(x, z)) return { x, z };
  }
  return { x: sx + Math.cos(angle0) * dist, z: sz + Math.sin(angle0) * dist };
}

/**
 * Derive the relic + cache sites from the player's spawn. Deterministic and on dry walkable ground;
 * the two are separated and roughly opposed so the loop requires carrying.
 * @param {{x:number,z:number}} spawn
 * @returns {{relic:{x:number,z:number}, cache:{x:number,y:number,z:number}, radius:number}}
 */
export function deriveSites(spawn = { x: 0, z: 0 }) {
  const sx = Number.isFinite(spawn?.x) ? spawn.x : 0;
  const sz = Number.isFinite(spawn?.z) ? spawn.z : 0;
  const relic = findSite(sx, sz, RELIC_DIST, 0); // relic ~ +X side
  const c = findSite(sx, sz, CACHE_DIST, Math.PI); // cache ~ opposite side
  return { relic, cache: { x: c.x, y: getHeight(c.x, c.z), z: c.z }, radius: CACHE_RADIUS };
}

/** Live phase from the current world state (re-derived each frame; only `completed` persists). */
export function livePhase({ relicEquipped = false, completed = false, inZone = false } = {}) {
  if (completed) return "complete";
  if (relicEquipped && inZone) return "atCache";
  if (relicEquipped) return "carry";
  return "find";
}

const BANNER = Object.freeze({
  find: "Relic Objective — find the marked relic weapon and equip it (F)",
  carry: "Relic Objective — carry the relic to the glowing cache marker",
  atCache: "Relic Objective — press G to deposit the relic on the cache",
  complete: "Relic Objective — COMPLETE. The relic rests on the cache.",
});

export function bannerText(phase) {
  return BANNER[phase] ?? BANNER.find;
}
