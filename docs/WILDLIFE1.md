# Wildlife-1 — Aloft Flocks & Sky-Life Contract

Wildlife-1 promotes the staged `snow_finch` row into a **live flying flock** — the first
*aloft* consumer of the `TerrainProfile` biome contract. It proves the contract hosts
sky-life (agents that fly but still respect terrain, water, snowline, and region streaming)
as cleanly as Wildlife-0's ground-life, in a genuinely different movement domain. No combat,
loot, inventory, navmesh, or full boids chaos.

## What it is

Deterministic flocks of `snow_finch` that **circle / drift / scatter-from-player / regroup**
high over the glacial valley's ridges, rendered as instanced V-wing silhouettes. Everything
re-derives from `(seed, region, active TerrainProfile)` — only the config + seed persist.

- **Bird marker:** a shallow gull-V chevron (2-triangle `BufferGeometry`, `DoubleSide`), one
  `InstancedMesh` for the species. Sized to read at altitude (`span 1.4`).
- **Flight band:** ridge-hugging high band (Y≈30–70), biased toward ridges / near the snowline
  (`snowMargin` negative → the band reaches above the snowline).
- Flocks fly **by default** in every alpine world.

## The single source for flight altitude (the load-bearing piece)

`flockAltitudeAt(x, z, species, offset)` is the aloft analog of grounded `y = getHeight` —
used at **placement AND every runtime step**, so a bird's Y can never be solved below the
terrain or at the water surface:

```
floor = max(getHeight + minClearance, isFinite(water) ? water + minClearance : -Inf)
y     = max(floor, getHeight + offset)                 // preferred band, tracking terrain
if isFinite(snowline): y = min(y, max(floor, snowline - snowMargin))  // ridge attraction
y     = clamp(y, minY, maxY)                            // SOFT absolute band
y     = max(y, floor)                                   // floor ALWAYS wins (inviolable)
return isFinite(y) ? y : floor
```

Two corrections baked in from the design pressure-test:

1. **The water term is real, not redundant.** The alpine water table (`AlpineTerrainProfile`)
   is computed independently of height, so in the trough the water surface sits *above* the
   terrain. "Clamp above terrain ⇒ above water" is therefore **false**; the solver takes an
   explicit `max(terrain+c, water+c)` floor. (Birds were only incidentally safe before because
   `minY:30` masked it — proven by a test that lowers `minY` below the table and still clears.)
2. **`maxY` is a soft ceiling; clearance is inviolable.** Over a ridge crest taller than
   `maxY − minClearance`, the `clamp(y, minY, maxY)` would pull a bird *below* the mountain, so
   the `floor` is re-applied **after** the clamp — birds rise above the nominal `maxY` rather
   than clip the crest. `getWaterLevel`/`snowlineAt` enter only `max`/`min` (never a
   multiply/divide), so the rolling profile's `±Infinity` degrades cleanly to "fly at the
   terrain floor".

## Bounded cohesion (no NaN, no freeze, no unbounded drift)

`FlockRuntime.updateFlock` is a **flock-level** FSM. Boundedness is structural:

- centre step ≤ `min(maxSpeed·dt, MAX_STEP)` (a frame hitch can't teleport the flock; `dt`
  itself clamped to `MAX_DT`),
- centre **hard-projected back inside `maxTetherRadius`** of home every step (a leash),
- member offset radius clamped ≤ `maxSpread`, heading change ≤ `maxTurnRate·dt`.

By the triangle inequality every bird stays within `maxTetherRadius + maxSpread` of home,
always. **Scatter never freezes:** the flock flees directly away from the threat *computed
from the centre* (so it scatters as one body); if a full away-step would break the leash it
steers along the leash **tangent** instead (the aloft analog of Wildlife-0's wall-follow fix),
so a cornered flock slides around the boundary rather than re-aiming into it and stalling.
Once the threat leaves, a `calmTime` debounce deterministically returns the flock to `regroup`
→ `circle`.

## Architecture — `WildlifeSystem` owns `AloftWildlife` internally

The world threads a single `wildlife` handle through `WorldRuntimeLoader` + `main.js` (7 call
sites). `WildlifeSystem` constructs and owns an internal `AloftWildlife` instance and delegates
`update`/`prewarm`/`dispose`/`debugSnapshot` to it, so **`main.js` and `WorldRuntimeLoader.js`
are untouched** and the "one wildlife handle" invariant holds. The grounded streaming/render
method bodies are byte-identical; only the species filter gains `groundContract === "support"`
and the call sites gain an always-true `if (grounded active)` guard so an aloft-only world
still builds flocks. `AloftWildlife` copies the ~40-line region-streaming skeleton (same
`halfDiag` nearest-corner hysteresis) rather than extracting a shared helper — extracting would
mean editing the proven grounded path; deferred to Wildlife-2 if a third streamed type appears.

`snow_finch` is excluded from grounded placement by `WildlifePlacement.placeRegion`'s
`groundContract !== "support"` skip and routed to `FlockPlacement.placeFlockRegion`.

## Files

- `src/world/wildlife/FlockPlacement.js` — `flockAltitudeAt` (the altitude single source),
  `flockHabitatOK`, `placeFlockRegion` (deterministic, fixed-K argmax-height centres → flocks
  hug ridges).
- `src/world/wildlife/FlockRuntime.js` — `spawnFlock` + `updateFlock` (FSM + bounded cohesion).
- `src/world/wildlife/AloftWildlife.js` — flock region streaming + instanced V-wing render +
  `flockSnapshot()` observability; the V-wing geometry builder.
- `src/world/wildlife/WildlifeSpecies.js` / `WildlifeConfig.js` — `snow_finch` flipped live +
  flock tuning numbers + `vwing` geometry.
- `src/world/wildlife/WildlifeSystem.js` / `WildlifePlacement.js` — minimal additive wiring +
  the grounded-only filter.

## Caps

`MAX_ACTIVE_FLOCK_BIRDS = 1500`, `MAX_INSTANCES_PER_FLOCK_SPECIES = 2048` — a **separate**
aloft budget so a dense ground world can't starve the flock and vice-versa; `mesh.count` gates
the draw.

## Verification

- `npm run test:flock` — determinism (deep-equal twice), altitude-above-terrain+water across
  the valley incl. the deepest trough + steepest ridge **and** the rolling profile, the
  hostile-`minY` water-term proof, bounded cohesion + non-freeze (chase path ≫ 0) + regroup
  over 5000 chased steps, hostile-`dt` finiteness, per-region bird bounds.
- `npm run test:wildlife` — grounded Wildlife-0 placement/movement unchanged.
- `npm run test:wildlife1` — SwiftShader: flocks present + instanced + rendered, **no bird
  below terrain or in water**, grounded animals still pass in the same scene, player
  unaffected, **zero console errors**.
- `npm run build` + `npm run qa` green; full regression sweep (visual-0/1, water, vegetation,
  bush, settlement, procedural, instancing, budget, arsenal-world) unaffected.

## Non-goals

Predators, attacks, damage, drops, inventory, quests, nesting, breeding, migration sim, full
navmesh, full boids chaos, Arsenal v3.
