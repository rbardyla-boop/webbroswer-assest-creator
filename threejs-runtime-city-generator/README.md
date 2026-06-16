# Runtime City Generator — Three.js Demo

A clean Vite + Three.js prototype foundation that combines:

- a large procedural terrain field;
- animated instanced grass with GPU wind;
- patch/chunk grass streaming, culling, and LOD;
- a simple controllable capsule character;
- first-person and third-person camera modes;
- a reusable seeded runtime city/region generator;
- city-builder style zones: downtown, residential, industrial, parks, village, rural, military outpost, science campus, drilling site, and small airport;
- local save/load for generated city documents;
- debug instrumentation for FPS, grass patches, city chunks, draw calls, player position, zone, and camera mode.

## Run

```bash
npm install
npm run dev
```

Open the Vite URL, usually `http://localhost:5173`.

Production check:

```bash
npm run build
npm run preview
```

Verification:

```bash
npm run verify
```

## Controls

| Action | Control |
|---|---|
| Move | `W` `A` `S` `D` / arrows |
| Sprint | `Shift` |
| Jump | `Space` |
| Look | click canvas to capture mouse, `Esc` to release |
| Toggle first/third person | `V` |
| Toggle debug panel | `H` |
| Generate city | toolbar style + seed + Generate |
| Save/load city | toolbar Save Layout / Load Layout |

## Architecture

```text
src/
  main.js
  core/
    renderer.js
    scene.js
    camera.js
    lights.js
    input.js
  terrain/
    Terrain.js
    terrainSampling.js
  grass/
    GrassSystem.js
    GrassPatch.js
    GrassGeometry.js
    GrassMaterial.js
    GrassPlacement.js
    GrassConfig.js
  city/
    CitySystem.js
    CityChunk.js
    CityGenerator.js
    CityDocument.js
    CityConfig.js
    CityLabels.js
  player/
    Player.js
    PlayerController.js
    PlayerCameraController.js
  debug/
    DebugPanel.js
  editor/
    ReliefEditor.js
  utils/
    math.js
    random.js
```

## Runtime city generator

The city system is data-first. `CityGenerator.js` produces a deterministic `CityDocument` from a style and seed. The same seed/style pair reproduces the same layout exactly; a different seed or style produces a materially different region. `CityDocument.js` serializes and validates the generated data for localStorage save/load.

`CitySystem.js` turns that document into runtime meshes. `CityChunk.js` batches roads, sidewalks, zone overlays, buildings, and props into `THREE.InstancedMesh` objects, then `CitySystem` performs chunk-level frustum and distance visibility. This keeps the demo bounded after loading instead of adding one mesh per building.

Available styles:

- `showcase`: city core plus residential, industrial, park, village edge, outpost, science campus, drilling pad, and small airport.
- `urban`: denser city grid with downtown/residential/industrial emphasis.
- `outpost`: military/science/drilling/logistics/airstrip frontier layout.
- `village`: rural village, farms, commons, resource pad, and grass airfield.

## Grass system

The grass renderer uses instanced patches. Per-blade attributes include offset, rotation, scale, tilt, bend, tint, and wind phase. A custom `ShaderMaterial` animates wind on the GPU. Patch-level streaming, frustum culling, distance LOD, and build budgets keep the large grass field responsive.

## Player and camera

The player is a simple `CapsuleGeometry` avatar. Movement is camera-relative, grounded with `getHeight()`, and separated from camera behavior. `PlayerCameraController` supports first-person eye-level mode and smoothed third-person follow mode, toggled with `V`.

## Verification philosophy

The verifier checks structure, deterministic generation, seed variation, save/load round-trip, instancing, patch/chunk visibility, GPU wind shader presence, terrain sampling reuse, player/camera behavior, debug instrumentation, and bounded city counts.
