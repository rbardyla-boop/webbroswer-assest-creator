# Wildlife-0 — Biome-Aware Ambient Wildlife

Wildlife-0 adds non-combat ambient animals that spawn, graze/wander, and flee the
viewer — and that respect the math biome contract (Visual-0 + Visual-1) **while moving**,
not just at spawn. It is the proof that the `TerrainProfile` contract can host a living
runtime system, not just visuals. No second terrain/water/nav truth; no combat, drops,
inventory, pathfinding monolith, or hand-placed meshes.

## Two grounded species (a third is staged)

`src/world/wildlife/WildlifeSpecies.js` is pure data. Wildlife-0 ships two **grounded**
grazers; `snow_finch` (a flying flock) is present but `enabled:false` — its aloft contract
is promoted in Wildlife-1, so the data + code path stay warm without adding a second
grounding contract to this stage.

| species | slope ≤ | altitude band (Y) | water clearance | herds/region × members |
|---|---|---|---|---|
| `alpine_hare` | 0.35 | −8 .. 38 | 1.5 | 0..2 × 3..6 (skittish, panic 12) |
| `ibex` | 0.6 | −8 .. 40 | 1.0 | 0..1 × 3..6 (grazer, panic 18) |
| `snow_finch` *(staged)* | — | 30 .. 70 | — | aloft flock → Wildlife-1 |

## Habitat contract — the SAME gate at spawn AND every step

`WildlifePlacement.habitatOK(x, z, species)` reads only terrain authority — `getHeight`,
`getSlope`, `getWaterLevel`, and `getActiveTerrainProfile().snowlineAt` (there is no
`getSnowline` wrapper) — and rejects: submerged / too near shore (`h < waterLevel + clearance`),
above the snowline (`h > snowlineAt − snowMargin`), too steep (`slope > slopeLimit`), or
outside the species' altitude band. On the **rolling** profile (waterLevel −∞, snowline +∞)
it auto-degrades to slope + band — dry worlds stay safe with no special-casing.

This same predicate gates **movement**: `WildlifeRuntime.updateAnimal` proposes a step,
commits it **only if `habitatOK`**, else turns (seeded) and does not advance. **Flee runs
the identical gate** (heading = away from the viewer, then habitat-tested → it wall-follows
water/cliffs instead of swimming) and sub-steps ×2 against tunnelling. So a wandering or
fleeing animal can never enter water, climb scree, or cross the snowline. Grounding tracks
`getHeight(x,z)` (the terrain single source — NOT `getSupportHeight`, which is O(colliders);
ambient meadow animals don't stand on crates).

## Determinism

The **spawn set** is a pure function of `(seed, region, active profile)`:
`placeRegion(rx, rz, config, seed)` seeds `mulberry32(hash2i(rx^seed, rz+seed) ^ speciesSalt)`
(the tree/bush idiom), decides herd count, finds habitat-valid centres + members, and
returns plain descriptors — re-running yields an identical set (asserted twice-equal).
Live **motion** is seeded per-animal (from a placement `motionSeed`); it is not
reproducible run-to-run but uses **zero `Math.random`/`Date.now`** (a source scan enforces
this). Per-animal state is never persisted — only the `wildlife` config block (seed +
species toggles + streaming distances) round-trips, like `lighting`.

## Streaming + render + bounded count

`WildlifeSystem` mirrors `BushSystem`: a region grid keyed `rx,rz`, built within
`visibleDistance` (140), dropped beyond `keepDistance` (180, hysteresis). The per-animal
FSM runs only within `simulateDistance` (90) — active-but-far regions render a frozen pose
(simulation LOD). Each enabled species renders through ONE `THREE.InstancedMesh`
(`DynamicDrawUsage`, `frustumCulled:false`, capacity 1024); per frame it writes
`setMatrixAt` for active animals, sets `mesh.count`, and flags `instanceMatrix.needsUpdate`.
Hard caps: `regionMemberCap` per species, `MAX_INSTANCES_PER_SPECIES` 1024,
`MAX_ACTIVE_WILDLIFE` 1500. `dispose()` removes + disposes each species mesh and clears the
region map (mirrors `BushSystem.dispose`), so world reloads don't leak.

`load(document, scene)` is a **pure no-op when disabled/empty** — it never mutates the
scene — so a thrown exception can't red the shared console-error gate of every other proof.

## Wiring

`WorldDocument` gains a `wildlife: createWildlifeConfig()` block; `WorldValidation` runs
`sanitizeWildlife` (clamps every numeric, allow-lists the species map). `WorldRuntimeLoader`
constructs/returns/disposes the system beside grass/trees/bushes/water/atmosphere; `main.js`
reassigns the module var via the single `applyLoadedWorld` choke point, ticks
`wildlife?.update(dt, camera)` in both loop sites (camera world pos drives streaming + the
flee threat, in editor and runtime), prewarms at load, and exposes `__WILDLIFE_DEBUG__`.

## Tests / debug

- `test:wildlife` (Node) — determinism (twice-equal), spawn legality (no submerged / above
  snowline / over slope / out of band), bounded per-region, **movement legality** (2000
  steps of relentless flee in every direction → never enters a forbidden cell / never
  submerges), rolling safety, source scan (no `Math.random`/`Date.now`).
- `test:wildlife0` (SwiftShader, ports 5223/9357) — animals present + instanced, grounded
  animals on the terrain (`groundedFloating/Submerged/aboveSnowline === 0`), player still
  grounded, zero console errors.
- DEV hook: `window.__WILDLIFE_DEBUG__()`.
