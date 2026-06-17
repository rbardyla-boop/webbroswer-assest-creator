# Visual-0 — Glacial Valley Terrain (single source, profile-backed)

Stage Visual-0 establishes the **visual-world pipeline** correctly: one swappable,
profile-backed terrain source feeds the mesh, placement, and player grounding, and the
world gets a glacial/alpine identity from math alone (no texture assets). The point is the
architecture later visual layers (water, weather, wildlife) build on — a ground truth they
can trust — not a one-off pretty scene.

## The single source

`src/terrain/terrainSampling.js` is a thin **wrapper** over one active `TerrainProfile`:

```
getHeight(x,z)            → activeProfile.height(x,z)        ← THE height source
getGrassDensityFactor     → activeProfile.grassDensity
canPlaceGrass             → slope ≤ grassSlopeLimit && height ≤ snowlineAt && meadow mask
getNormal / getSlope      → central differences over getHeight (unchanged)
findGoodSpawn             → grid scoring over getHeight (unchanged)
setTerrainProfile(p)      → swap the whole world's ground truth
getActiveTerrainProfile() → the mesh/material read colorAt + visual from it
```

Because the normal/slope/spawn helpers are built on `getHeight`, swapping the profile moves
**everything** at once. The mesh (`Terrain.js`) is built by sampling `getHeight` per vertex and
colored by `profile.colorAt` — so mesh, grass, and grounding agree by construction. There is no
second terrain mesh and no forked sampler. Every pre-Visual-0 export is preserved, so all terrain
consumers are untouched.

> Invariant (proved by `test:terrain-source`): for the built mesh, every vertex
> `Y === getHeight(x,z)`; `getSlope == ∂getHeight`; one `setTerrainProfile` changes
> height, slope, and `canPlaceGrass` together.

## The TerrainProfile contract

A profile is **pure, deterministic, seeded math** — Node-safe, no `Math.random`, no THREE:

| Member | Meaning |
|--------|---------|
| `id` | `"alpine"` \| `"rolling"` |
| `params` | resolved numeric config (for serialize-back) |
| `height(x,z)` | world Y — the single source of truth |
| `grassDensity(x,z)` | 0..1 meadow mask |
| `snowlineAt(x,z)` | world Y above which it reads as snow (`Infinity` = none) |
| `grassSlopeLimit` | 0..1 max slope grass tolerates |
| `colorAt(x,z,h,slope,out3)` | linear `[r,g,b]` vertex band color |
| `visual` | material-shader config (hex colors + thresholds) — plain data; the material does the THREE.Color conversion |

`createTerrainProfile(terrainConfig)` selects by `terrainConfig.profile` (default `alpine`).

## Profiles

- **AlpineTerrainProfile** (default everywhere) — a broad U-shaped glacial trough running along
  `+Z` with ridged-multifractal walls rising on either side (`|x|`), domain-warped for natural
  ridgelines, a gently down-flowing floor, a snowline high on the walls, and rock/scree on the
  steeps. `heightAmplitude` scales the overall relief; `seed` perturbs the field.
- **RollingProfile** — the original hills math, transcribed **verbatim**. `test:terrain-profile`
  asserts height-for-height (and grass-for-grass) parity, so the legacy world is provably preserved.
  Selectable via `terrain.profile: "rolling"`; also the comparison baseline for the single-source test.

## Visual identity (math, no textures)

- **`visual/ValleyColorBands.js`** — pure, THREE-free band coloring shared by `profile.colorAt`
  **and** the mesh: low/damp → meadow by height, → rock by slope, then scree + snow by height.
  `srgbHexToLinear` matches THREE's parsing so vertex colors agree with material/shader colors.
- **`visual/SnowRockDirtBlend.js`** — the snow + scree GLSL appended **after** the existing
  terrain material-v2 `onBeforeCompile` body, reusing its `vTerrainWPos`/`vTerrainNrm` varyings.
  Snow blends in above the snowline; scree greys the steep ground just below it. The rolling
  profile's `snowlineY` sits far above any terrain → `snowT ≈ 0` → the material behaves exactly
  as before.
- **`lighting/GlacialAtmosphere.glacialLighting()`** — the default world atmosphere: a low pale
  sun for long raking shadows, a blue-grey sky/ground hemisphere, and denser blue fog reaching
  further so the ridge walls read as a vista. Same shape as `defaultLighting()`, applied through
  the unchanged `LightingRig` — just a different default `lighting` block.

## Placement adaptation

- **Grass** self-limits in `canPlaceGrass` (profile slope limit + snowline) — no grass on snow,
  ice, or steep rock; meadow density follows the valley floor.
- **Trees / bushes** gain a **runtime-only** `snowlineMaxHeight` cap, set by `WorldRuntimeLoader`
  to the profile snowline (`Infinity` for rolling, so no effect). It is kept separate from the
  user's `maxHeight` so authored intent serializes unchanged; trees' existing slope gate handles
  the steeps.

## Persistence + load

- `WorldDocument` defaults `terrain.profile: "alpine"` and `lighting: glacialLighting()`.
- `WorldValidation` allow-lists `terrain.profile` (unknown → `alpine`).
- `WorldRuntimeLoader.applyTerrainSettings` swaps the active profile (the whole-world ground-truth
  switch). It preserves the current profile id + params when the editor applies terrain sliders, so
  an in-editor tweak never silently flips the identity or drops the seed.

## Tests

| Command | What it proves |
|---------|----------------|
| `npm run test:terrain-profile` | profile determinism, rolling parity, alpine masks/colors in range |
| `npm run test:terrain-source` | mesh `Y == getHeight`, `getSlope == ∂getHeight`, one swap moves all |
| `npm run test:visual0` | SwiftShader: alpine profile loads, player grounded on the single source, snow/scree shader compiles (zero console errors), glacial fog applied, grass renders |

`__VISUAL0_DEBUG__` (DEV-only, stripped from prod) reports the active profile id, the player's
grounding against `getHeight`, and the snowline.

## Non-goals (explicitly deferred)

Rivers, water simulation, weather, wildlife, settlement gameplay, inventory, combat, Arsenal v3.
The `TerrainProfile` contract is the seam those later layers extend.
