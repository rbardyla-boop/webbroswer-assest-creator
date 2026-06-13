# Grass World — Three.js Prototype

A reusable, high-performance **instanced grass system** for the browser, with a
controllable **capsule character**, **first/third-person cameras**, and an
in-browser **World Builder** for placing reusable assets into the playable scene.

Built on Vite + Three.js, structured as a serious prototype foundation —
modular, configurable, and optimized for a real-time game rather than a one-off
visual experiment.

![third-person](docs/preview.png)

## Run

```bash
npm install
npm run dev      # http://localhost:5173
# production
npm run build && npm run preview
```

## Controls

| Action | Key |
| --- | --- |
| Move | `W` `A` `S` `D` / arrows |
| Sprint | `Shift` |
| Jump | `Space` |
| Look | click to capture mouse, `Esc` to release |
| Toggle first / third person | `V` |
| Toggle debug panel | `H` |
| Open World Builder | toolbar button (top-right) |

The debug panel shows FPS, visible vs. active patches, approximate visible blade
count, LOD distribution, draw calls, player position, and the camera mode.

## Architecture

```
src/
  main.js                     # wires everything into one update/render loop
  core/
    renderer.js               # WebGLRenderer setup (tone mapping, shadows, DPR cap)
    scene.js                  # scene + sky color + distance fog
    camera.js                 # shared perspective camera
    lights.js                 # sun (shadow) + hemisphere fill
    input.js                  # keyboard / mouse-look / pointer-lock (consume-on-read edges)
  terrain/
    terrainSampling.js        # getHeight / getNormal / getSlope / canPlaceGrass / findGoodSpawn
    Terrain.js                # displaced, vertex-colored ground mesh
  grass/
    GrassConfig.js            # every tunable knob (density, LOD, wind, size, debug…)
    GrassGeometry.js          # base blade meshes per LOD (tapered strips)
    GrassMaterial.js          # custom ShaderMaterial — GPU wind + per-instance variation
    GrassPlacement.js         # deterministic per-patch instance data via placement rules
    GrassPatch.js             # one chunk: instanced attributes + per-LOD geometries
    GrassSystem.js            # streaming, frustum cull, LOD assignment, stats
  player/
    Player.js                 # capsule avatar + state
    PlayerController.js        # input → grounded movement
    PlayerCameraController.js  # first/third-person framing + toggle
  debug/
    DebugPanel.js             # on-screen HUD
  editor/
    WorldEditor.js            # live world-building shell over the playable scene
    AssetLibrary.js           # local list of placeable primitive/imported/generated assets
    ColliderInspector.js      # selected-object collider type + debug wireframe toggle
    SceneSerializer.js        # localStorage save/load for placed object transforms
    ReliefAssetTool.js        # 2D drawing / photo → placeable relief asset
  physics/
    ColliderProxy.js          # simple authored collider metadata and footprints
    ColliderSystem.js         # runtime support heights, side blocking, grass exclusion
    capsuleCollision.js       # capsule-vs-proxy horizontal resolution helpers
  world/
    PlacedObject.js           # primitive mesh factories + placed object wrapper
    WorldObjectManager.js     # add/remove/duplicate/save/load placed objects
  utils/
    math.js                   # clamp, lerp, damp, angle helpers
    random.js                 # seeded PRNG + value-noise fbm
```

### Grass system

- **Instanced.** Each patch is one `InstancedBufferGeometry` draw call. Per-blade
  attributes (`aOffset`, `aRot`, `aScale`, `aTilt`, `aBend`, `aTint`, `aPhase`)
  give natural variation in height, width, rotation, tint, bend, and wind phase.
- **Patch/chunk based.** The world is a grid of square patches. Visibility,
  distance culling, and LOD all happen at patch granularity.
- **Streaming.** Patches build lazily around the camera within a per-frame
  budget and dispose past a hysteresis distance, so memory stays bounded and the
  field feels endless.
- **GPU wind.** A custom vertex shader sways blades against a travelling gust
  field — no per-frame CPU work touches the blades.
- **LOD.** Distance bands select both blade detail (height segments) and density
  (instance count), thinning far grass while keeping the near field lush.
- **Placement rules.** Blades are placed through `terrainSampling` — never on
  steep slopes, clustered by a meadow mask, always grounded on the terrain.

### Player & camera

- Simple capsule kept grounded every frame via `getHeight`.
- Movement is built from the active camera yaw, so `W` always goes where the
  camera faces. Third-person turns the body toward movement; first-person aligns
  it to the look direction (and hides the body).
- Third-person is a smoothed follow rig that stays above the terrain;
  first-person sits at eye height. `V` toggles between them.

### World Builder

Open the World Builder from the top-right toolbar. Choose a primitive asset
(cube, sphere, cylinder, plane, ramp), import a GLB/GLTF for the current session,
or create a relief asset from a drawing/photo. Click the terrain to place the
selected asset. Click placed objects to select them, then move, rotate, scale,
duplicate, delete, save, and load from localStorage.

Placed objects have separate collider proxies (`box`, `cylinder`, `ramp`,
`plane`, `trigger`, `none`). Runtime collision uses those simple proxies rather
than the visual mesh: boxes/cylinders block the player, planes and boxes provide
walkable support, and ramps provide sloped support. Solid/walkable colliders also
suppress grass in their footprints when patches rebuild. The collider inspector
can toggle wireframe debug boxes.

Relief creation is now a tool inside the builder: luminance becomes height and
color is sampled per vertex, but the result is added to the asset library for
placement in the actual grass world instead of living only in a separate preview.

## Configuration

Everything is driven from [`src/grass/GrassConfig.js`](src/grass/GrassConfig.js).
Pass overrides to `createGrassConfig({ ... })` in `main.js`:

```js
createGrassConfig({
  density: 7,                 // blades per square unit (pre-thinning)
  patchSize: 24,              // chunk size
  visibleDistance: 165,       // streaming / cull radius
  lodDistances: [55, 110],    // LOD band edges
  grassSize: { width: 0.12, height: 1.05 },
  wind: { strength: 0.32, frequency: 1.7, scale: 0.06, gustiness: 0.55 },
  debug: true,
});
```

## Notes

- The single large JS chunk is just Three.js; code-split if you ship this.
- Verified with a headless smoke test (renders, streams grass, moves, toggles
  camera, opens the editor — no shader or runtime errors).
