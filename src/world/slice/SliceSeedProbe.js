// Slice Authoring Kit-1 — the seed probe. Formalizes the throwaway terrain-seed scan used while authoring The
// Ice Chapel into a pure, deterministic report so the next slice picks a seed by evidence, not guesswork.
//
// The alpine profile is seed-sensitive (so = seed*0.013 offsets the noise field), so a different terrain.seed
// relocates findGoodSpawn → a different relic/cache axis while keeping the glacial identity. But: findGoodSpawn
// snaps to a 10-unit grid so many seeds DON'T move the spawn, and a moved spawn may land submerged / on a cliff
// with a too-short carry. This probe reports exactly that, so a candidate seed is validated before it is used.
//
// Pure + Node-safe: terrain sampling + deriveSites/isWalkable only (no RNG, no clock, no THREE/DOM).

import { sliceLayout } from "./SliceKit.js";
import { getSlope, getWaterLevel } from "../../terrain/terrainSampling.js";
import { deriveSites, isWalkable } from "../objectives/RelicWeaponObjective.js";

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const CARRY_MIN = 20; // a real carry needs relic + cache meaningfully apart
const DISTINCT_MIN = 20; // a "different place" needs the spawn far from every baseline slice's spawn

/**
 * Probe one candidate terrain seed. Activates the seeded alpine profile, derives the layout, and reports
 * walkability + carry + distinctness from the supplied baseline spawns (the already-authored slices' spawns,
 * passed as plain {x,z} so probing never re-activates another slice's profile).
 *
 * @param {number} seed
 * @param {{ baselineSpawns?: Array<{x:number,z:number}> }} opts
 * @returns {{
 *   seed:number, spawn:{x,z}, relic:{x,z}, cache:{x,y,z}, crossing:{x,z},
 *   carry:number, spawnToCache:number,
 *   spawnWalkable:boolean, relicWalkable:boolean, cacheWalkable:boolean, crossingWalkable:boolean,
 *   walkable:boolean, distinct:boolean, minSeparation:number|null, usable:boolean
 * }}
 */
export function probeSliceSeed(seed, { baselineSpawns = [] } = {}) {
  const layout = sliceLayout({ seed }); // activates the seed profile; spawn/relic/cache from the seeded field
  const { spawn, relic, cache, crossing } = layout;
  const sites = deriveSites(spawn); // == layout.relic/cache (the runtime objective derives the same)

  const spawnWalkable = isWalkable(spawn.x, spawn.z);
  const relicWalkable = isWalkable(relic.x, relic.z);
  const cacheWalkable = isWalkable(cache.x, cache.z);
  const crossingWalkable = isWalkable(crossing.x, crossing.z);
  const walkable = spawnWalkable && relicWalkable && cacheWalkable;

  const carry = dist(sites.relic, sites.cache);
  const spawnToCache = dist(spawn, cache);

  const minSeparation = baselineSpawns.length ? Math.min(...baselineSpawns.map((b) => dist(spawn, b))) : null;
  const distinct = minSeparation == null ? true : minSeparation > DISTINCT_MIN;

  return {
    seed,
    spawn: { x: spawn.x, z: spawn.z },
    relic: { x: relic.x, z: relic.z },
    cache: { x: cache.x, y: cache.y, z: cache.z },
    crossing: { x: crossing.x, z: crossing.z },
    carry,
    spawnToCache,
    spawnSlope: getSlope(spawn.x, spawn.z),
    waterLevel: getWaterLevel(spawn.x, spawn.z),
    spawnWalkable,
    relicWalkable,
    cacheWalkable,
    crossingWalkable,
    walkable,
    distinct,
    minSeparation,
    usable: walkable && carry > CARRY_MIN && distinct,
  };
}

/**
 * Probe a list of candidate seeds and return the reports plus the first USABLE one (all sites walkable, a real
 * carry, and distinct from the baselines) as `recommended` (null if none qualify).
 */
export function probeSliceSeeds(seeds, opts = {}) {
  const reports = seeds.map((seed) => probeSliceSeed(seed, opts));
  const recommended = reports.find((r) => r.usable) ?? null;
  return { reports, recommended };
}
