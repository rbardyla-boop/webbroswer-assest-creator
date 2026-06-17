# Visual-1 — Glacial Water & Atmosphere Depth

Visual-1 adds glacial **water** and **atmosphere depth** to the alpine valley, both
derived entirely from the active `TerrainProfile` established in Visual-0. There is no
second terrain truth: the water level and the fog modulation read through the same
`getHeight` / profile the mesh, placement, and grounding already use.

## Water lives in the profile contract

Water is part of the `TerrainProfile` contract, mirroring `snowlineAt`:

| member | meaning |
|---|---|
| `waterLevelAt(x,z) -> Y` | world Y of the glacial water table. `-Infinity` = dry world. A point is **submerged** where `height(x,z) < waterLevelAt(x,z)`. |
| `wetnessAt(x,z) -> 0..1` | shoreline dampness band just **above** the waterline (0 if submerged or dry). |
| `hasWater: boolean` | gates building the derived water mesh (rolling → false → no mesh). |
| `visual.waterlineY` | representative scalar level for UI/debug (`-1e6` when none). |

`terrainSampling.js` exposes `getWaterLevel(x,z)` / `getWetness(x,z)` wrappers that
delegate to the active profile (just like `getHeight`/`getGrassDensityFactor`).
`dryProfileWater()` in `TerrainProfile.js` is the no-water default the rolling profile
spreads.

### The alpine water table (broad glacial wetland)

```
waterLevelAt(x,z) = ALPINE.floor − z*ALPINE.flow + WATER_RISE      // WATER_RISE = −1.0
```

- **Bare `ALPINE.floor`, never `floor*amp`.** The flat valley floor in `wallHeight()`
  is `lerp(floor, top, wall)` = `floor` at the axis (only the wall *top* scales with
  amplitude). A `floor*amp` table would drain the valley dry at `heightAmplitude > 14`
  and flood it at `< 14`. The bare-floor table is amplitude-stable: `waterLevelAt(0,0)`
  is `−6` for every amplitude (asserted by `test:water`).
- The `−z*flow` term keeps the table parallel to the mean floor; its ±1.5u contribution
  is cosmetic, not a usable directional gradient.
- The valley floor is broad and flat (`floorFlat:0.16`, noise within ~2u of `floor`), so
  the result is a **shallow braided wetland** filling the trough lowline plus tarns where
  the floor dips — ~9–11% of the trough band is submerged (max depth ~2u), and the ridge
  walls (|x| ≈ 240) are always dry (water never climbs them). This is the intended
  "broad glacial wetland" character, not a narrow river.
- `wetnessAt = clamp(1 − smoothstep(0, WET_BAND, height − waterLevelAt), 0, 1)`
  (`WET_BAND = 2.0`), returning 0 once submerged so it marks only the damp shoreline.
  Alpine `grassDensity` adds `+0.15 * wetnessAt` so grass thickens along the shore.

## Water render — one derived surface mesh

`src/world/water/GlacialWater.js` builds a plane exactly like `Terrain._build()`: each
vertex `Y = getWaterLevel(x,z)` and a per-vertex `aDepth = getWaterLevel − getHeight`.
`GlacialWaterMaterial.js` upgrades a **transparent** `MeshStandardMaterial` via
`onBeforeCompile` (so fog + lighting + shadow chunks stay auto-injected) and:

- **`discard`s where `aDepth <= 0`** (dry land) — so river + lakes + tarns all fall out
  of this ONE sheet with no River/Lake/Mask sub-systems.
- shallow→deep depth tint, a Schlick fresnel rim, `uTime`-scrolled procedural value-noise
  shimmer (no texture), and shoreline foam. `depthWrite:false` (single transparent pass;
  grass is opaque, so it sorts cleanly underneath).

The `water` block in the world document is **render config only** (colors/flow/opacity/
foam); the level/mask is profile-derived and intentionally not stored there. The loader
builds the mesh only when `profile.hasWater` is true (never feeds `-Infinity` Y into
geometry).

## Atmosphere — camera-relative fog modulation

The world fog is a single global linear `THREE.Fog` from the lighting block; true
volumetric height-fog is a non-goal. `src/world/atmosphere/ValleyAtmosphere.js` gives it
depth by modulating it from where the camera sits (read from the profile):

- `computeValleyFog(cameraPos, profile, baseFog, cfg)` (pure, Node-tested): basin/low
  camera → smaller `near` (thicker); ridge/high camera → push out; a cold-mist color
  shift near the water surface or above the snowline. Guarantees `near < far`.
- The class eases `scene.fog.near/far/color` toward the target each runtime frame
  (frame-rate independent) and re-syncs the grass fog uniforms (via
  `GrassSystem.syncLighting({ fog: {...} })`) only when the eased value actually moved.
- Construction order: built right after `applyLighting` and `applyBase(scene)` captures
  the lighting fog **before** grass is built; `attachFogConsumer(grass)` runs after grass.
  Modulation runs in the **runtime loop only** (the editor keeps the static base look so
  it never fights live lighting edits).

## Vegetation & spawn

- **Grass**: `canPlaceGrass` rejects submerged points first (then slope/snowline/density).
- **Trees / bushes**: a per-point floor gate `if (y < getWaterLevel(x,z)) continue;`
  (accurate, not a flat scalar; inert on rolling because `-Infinity`).
- **Spawn**: `resolveSpawn` in `main.js` relocates a submerged spawn to `findGoodSpawn()`
  (which now rejects submerged candidates) before grounding — the default `{0,0,0}` lands
  in the trough's deepest pool, so this keeps the player on dry ground without floating.

## Tests / debug

- `test:water` (Node) — profile water masks, amplitude stability, derived-mesh agreement
  (`Y == getWaterLevel`, `aDepth == level − height`), `canPlaceGrass` rejects submerged.
- `test:atmosphere` (Node) — `computeValleyFog` determinism, basin thicker than ridge,
  never inverts, mist near water/snow.
- `test:visual1` (SwiftShader, ports 5221/9355) — water shader compiles in real WebGL,
  water pools in the trough, no grass underwater, player not submerged, zero console
  errors.
- DEV hooks: `window.__WATER_DEBUG__()`, `__ATMOSPHERE_DEBUG__()`, `__VISUAL1_DEBUG__()`.
