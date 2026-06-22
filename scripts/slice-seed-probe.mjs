// slice:probe — a deterministic terrain-seed report for authoring the next slice.
//
// The alpine profile is seed-sensitive, so a different terrain.seed relocates findGoodSpawn → a different
// relic/cache axis. But many seeds DON'T move the spawn (findGoodSpawn snaps to a 10-unit grid), and a moved
// spawn may land submerged / on a cliff with a too-short carry. This CLI probes candidate seeds against the
// already-used slices' spawns (seed 0 = Relic Overlook, seed 137 = The Ice Chapel) and prints which are USABLE
// (all sites walkable, a real carry, and a distinct place). Pure + deterministic — no RNG, no clock.
//
//   npm run slice:probe                 # a default candidate set
//   npm run slice:probe -- 7 11 99 251  # specific candidate seeds

import { probeSliceSeed, probeSliceSeeds } from "../src/world/slice/SliceSeedProbe.js";

const DEFAULT_SEEDS = [0, 7, 11, 13, 17, 23, 42, 99, 137, 251, 777, 1013];

const args = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
const seeds = args.length ? args : DEFAULT_SEEDS;

// Baselines = the spawns of the slices already in the game, so "distinct" means "a genuinely new place".
const baselineSpawns = [probeSliceSeed(0).spawn, probeSliceSeed(137).spawn];

const { reports, recommended } = probeSliceSeeds(seeds, { baselineSpawns });

const yn = (b) => (b ? "Y" : "·");
const pad = (s, n) => String(s).padStart(n);

console.log("\n  baselines: Relic Overlook (seed 0) + The Ice Chapel (seed 137)\n");
console.log("  seed | spawn            | carry | sep   | spawn relic cache | usable");
console.log("  -----+------------------+-------+-------+-------------------+-------");
for (const r of reports) {
  const spawn = `(${pad(r.spawn.x.toFixed(0), 4)},${pad(r.spawn.z.toFixed(0), 4)})`;
  const sep = r.minSeparation == null ? "  -  " : pad(r.minSeparation.toFixed(0), 5);
  console.log(`  ${pad(r.seed, 4)} | ${pad(spawn, 16)} | ${pad(r.carry.toFixed(0), 5)} | ${sep} |   ${yn(r.spawnWalkable)}    ${yn(r.relicWalkable)}    ${yn(r.cacheWalkable)}   | ${r.usable ? "USABLE" : "no"}`);
}
console.log("");
if (recommended) console.log(`  → recommended: seed ${recommended.seed} (spawn (${recommended.spawn.x.toFixed(0)},${recommended.spawn.z.toFixed(0)}), ${recommended.minSeparation.toFixed(0)}m from the nearest existing slice, carry ${recommended.carry.toFixed(0)}m)`);
else console.log("  → no candidate seed is usable (all-walkable + real carry + distinct from existing slices)");
console.log("");
