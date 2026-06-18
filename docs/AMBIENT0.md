# Ambient-0 — Streamed Environmental Micro-Actors (`alpine_motes`)

Ambient-0 adds tiny biome-aware environmental motes — firefly-like glowing specks that drift
over the glacial valley's wet meadow and waterside. It is the **third streamed runtime
consumer** of the shared `RegionStreamer` (after grounded `WildlifeSystem` and aloft
`AloftWildlife`), and the **first runtime consumer of `getWetness`** (the Visual-1
shoreline-dampness signal). Its purpose is to prove the Wildlife-2 streamer abstraction
generalizes to a new actor class — **with zero changes to the streamer** and **no change to
wildlife behavior**. This is a small, visually-additive feature, not a refactor.

## What it is

Deterministic fields of `alpine_motes` that drift gently on the valley wind, twinkle, and
scatter softly from the player — rendered as instanced additive-glow octahedra. Everything
re-derives from `(seed, region, active TerrainProfile)`; only the config + seed persist (the
`ambient` block round-trips untouched like `lighting`/`wildlife`).

- **Look:** firefly-like glow — `MeshBasicMaterial` (self-lit), `AdditiveBlending`,
  `depthWrite:false`, `fog:true`, warm amber against the cold valley.
- **Habitat:** wet meadow & waterside — density concentrates where the biome is lushest,
  thinning out toward the snowline.

## The streamer is REUSED, never copied or mutated

`AmbientSystem` constructs its **own** `RegionStreamer` instance with its **own** budget
(`MAX_ACTIVE_MOTES`), exactly as the two wildlife systems do — `buildRegion`/`countItems`/
distance getters, aliases `this.regions = streamer.regions`, keeps its own raw-centre
simulate/render gate. No method or field is added to `RegionStreamer`/`RegionMetrics`/
`RegionKey`. `test:ambient` source-scans `src/world/ambient/` to assert it re-implements no
region-streaming math and that `AmbientSystem` imports `RegionStreamer`.

## Biome-aware density (the first `getWetness` consumer)

`AmbientPlacement.densityAt(x,z)`:

```
wet   = getWetness(x,z)            // 0..1, peaks at the shoreline (0 when submerged / dry)
meadow= getGrassDensityFactor(x,z) // 0..1 meadow mask
snow  = snowlineAt(x,z)            // +Infinity on rolling
snowFactor = isFinite(snow) ? clamp01((snow - getHeight(x,z)) / snowFalloff) : 1
density = clamp01(wetWeight*wet + meadowWeight*meadow) * snowFactor
```

A candidate is accepted with the grass probabilistic-thinning idiom (`rng() < density`), so
motes concentrate along the wet meadow + shoreline and thin to zero at the snowline. On the
rolling profile (`wet ≡ 0`, `snow ≡ +∞`) this auto-degrades to meadow-only with no
special-casing.

## Bounded drift (copied verbatim from the flock discipline)

`AmbientRuntime.updateMote` is structurally bounded: `dt` clamped first, velocity = wind +
seeded wander (`fbm2D` of a per-mote phase), clamped to `maxSpeed`, per-step displacement
capped to `MAX_STEP`, then the position is **hard-projected back inside `tetherRadius`** of the
spawn anchor every step (non-finite → snap home). The optional player scatter is a heading-only
push away (NaN-threat-safe). Twinkle is a scale pulse `baseScale*(1 + amp*sin(phase))` with
`amp < 1` so the factor stays in `(0,2)` and never collapses to 0.

`solveHoverY` is the flock **floor-after-band** solver: `y = max(getHeight + hoverOffset,
getHeight + minClearance, isFinite(water) ? water + minClearance : -∞)`, finite-guarded — so a
mote is never below the terrain or at the water surface (the alpine water table can sit above
terrain in the trough). The mote contract is a strict subset of the proven bird contract.

## Files

- `src/world/ambient/AmbientSpecies.js` / `AmbientConfig.js` / `AmbientValidation.js` — pure
  data + the sanitized `ambient` document block.
- `src/world/ambient/AmbientPlacement.js` — deterministic biome-aware `placeRegion` +
  `habitatOK` + `densityAt`.
- `src/world/ambient/AmbientRuntime.js` — `spawnMote` + `updateMote` + `solveHoverY`.
- `src/world/ambient/AmbientMaterial.js` — octahedron geometry + additive-glow material.
- `src/world/ambient/AmbientSystem.js` — owns the `RegionStreamer`; instanced render; finite-
  guard pos **and** scale before `setMatrixAt`; `debugSnapshot`.

Wired into `WorldDocument`/`WorldValidation`/`WorldRuntimeLoader`/`main.js` mirroring the
wildlife lifecycle exactly (one `ambient` handle, ticked after wildlife in both loops). Caps:
`MAX_ACTIVE_MOTES = 2000`, `MAX_INSTANCES_PER_SPECIES = 4096`; `mesh.count` gates draw.

## Verification

- `npm run test:ambient` — determinism, biome bias (motes' mean density ≫ uniform; some on wet
  ground; none above the snowline), hover-above-terrain+water across the valley incl. the
  deepest trough, bounded under a 5000-step hostile sim (absurd wind + NaN threat + a `dt=1e6`
  frame), rolling auto-degrade, streamer-reused + no-`Math.random` scans.
- `npm run test:ambient0` — SwiftShader: motes instanced + rendered + on-band (none below
  ground/water/above snowline), **the grounded + flock wildlife counters UNCHANGED in the same
  scene** (no drift), player unaffected, zero console errors.
- Full regression sweep (wildlife/flock/streamer counts byte-identical; Family-B grass/bush/tree
  untouched) + build + qa green.

## Non-goals

No weather system, no particle editor, no combat/projectiles/status/inventory/loot, no
flock-behavior changes, no Family-B streamer extraction, no `RegionStreamer` mutation.
