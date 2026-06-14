# Three.js Skill Adoption Layer

Status: local operating manual and verification harness for the current Grass World prototype. This file maps the external Three.js skill-pack concepts onto this codebase without replacing the existing engine architecture.

## Non-negotiable boundary

The current engine remains the source of truth. Skill-pack prompts and generated artifacts may guide implementation, review, QA, and asset production, but they must not rewrite the runtime wholesale.

Do not introduce a new framework, scene graph owner, entity system, renderer wrapper, or build stack unless a later stage explicitly approves it.

## Current engine baseline

The project is a Vite + Three.js browser prototype with this runtime shape:

- `src/main.js`: composition root and frame loop.
- `src/core/`: renderer, scene, camera, lights, input.
- `src/terrain/`: deterministic height/slope/normal sampling and visible terrain mesh.
- `src/grass/`: streaming instanced grass, GPU wind, patch LOD, frustum culling.
- `src/player/`: capsule avatar, grounded movement, first/third-person camera.
- `src/debug/`: runtime debug HUD.
- `src/editor/`: image/drawing-to-3D relief editor.
- `src/utils/`: deterministic random and math helpers.

The uploaded source was reconstructed into this tree because `index.html` imports `/src/main.js`.

## Skill-to-engine map

| Skill area | Adopt as | Current modules | Gate posture |
| --- | --- | --- | --- |
| `threejs-gameplay-systems` | Movement, jump, terrain grounding, camera feel, future collision contract | `src/player/Player.js`, `src/player/PlayerController.js`, `src/player/PlayerCameraController.js`, `src/core/input.js`, `src/terrain/terrainSampling.js` | Required for movement/camera. Collision is currently terrain-grounding only; obstacle/volume collision remains a tracked gap. |
| `threejs-aaa-graphics-builder` | Renderer tuning, lighting, fog, terrain materials, grass shader, LOD/streaming budgets | `src/core/renderer.js`, `src/core/scene.js`, `src/core/lights.js`, `src/terrain/Terrain.js`, `src/grass/*` | Required. Must stay modular and measurable. |
| `threejs-debug-profiler` | Runtime visibility into FPS, draw calls, grass patch/blade counts, LOD, player position | `src/debug/DebugPanel.js`, `src/main.js`, `src/grass/GrassSystem.js` | Required. Any new high-cost system must expose counters. |
| `threejs-qa-release` | Static source gates, build gate, browser smoke, screenshot/canvas sanity, viewport checks | `scripts/threejs-skill-gates.mjs`, `scripts/browser-smoke.mjs`, `qa/threejs-skill-gates.config.json` | Required before claiming a stage complete. Browser gate is optional unless Playwright is installed. |
| `threejs-3d-generator` | Optional asset-generation pipeline for hero assets, creatures, props, GLB/FBX validation | `docs/ASSET_IMPORT_GATE.md`, future `src/assets/` and loader integration | Optional. Generated assets are not runtime dependencies until inspected and accepted. |
| `threejs-image-generator` | Optional skybox, texture-reference, icon, UI concept pipeline | `docs/IMAGE_GENERATION_GATE.md`, future texture/art folders | Optional. Generated images require license/provenance and compression review. |
| `threejs-audio-generator` | Deferred audio pipeline | `docs/AUDIO_GENERATION_GATE.md`, future `src/audio/` | Deferred until core gameplay loop is worth scoring. |

## Adoption rules

1. Keep generated work additive. No mass rewrites of `src/main.js`, renderer creation, terrain sampling, or grass streaming.
2. Preserve deterministic terrain sampling. Terrain mesh, grass placement, and player grounding must continue to use the same terrain source.
3. Keep GPU grass animation GPU-side. Do not move per-blade wind into per-frame CPU loops.
4. Maintain one renderer and one primary scene. Editor sub-renderers are allowed only for isolated tools such as the relief editor.
5. Every new runtime subsystem must have a debug/profiling surface or a measurable gate.
6. Asset generation is an offline/content-pipeline concern, not a client-side dependency.
7. A passed build is not enough. Stage completion requires static gates plus browser/runtime evidence where available.

## Gameplay systems gate

Required evidence:

- `Input` owns DOM input, pointer lock, movement axes, and consume-on-read edge presses.
- `PlayerController` derives movement from active camera yaw.
- Jump uses a bounded gravity model and lands on terrain height.
- Sprint has an explicit speed path.
- `PlayerCameraController` supports first/third-person mode, pointer-look yaw/pitch, third-person smoothing, and terrain-safe camera height.

Known gap:

- Current collision is terrain grounding only. There is no prop/obstacle/volume collision module yet. The gate reports this as a warning, not a failure, until solid objects or gameplay props are introduced.

## Graphics builder gate

Required evidence:

- Renderer uses high-performance WebGL settings, capped device pixel ratio, SRGB output, tone mapping, and shadows.
- Scene owns sky color and fog.
- Lights include directional sun with shadows plus hemisphere fill.
- Terrain uses deterministic height sampling, slope-aware vertex color, normals, and receives shadows.
- Grass uses instanced patch geometry, deterministic placement, GPU wind, LOD, frustum culling, lazy build queue, and far-patch disposal.

## Debug/profiler gate

Required evidence:

- FPS reported in the DOM HUD.
- Renderer draw calls passed from `renderer.info.render.calls`.
- Grass visible/active patch counts reported.
- Visible blade count reported.
- LOD distribution reported.
- Player position and grounded state reported.

## QA/release gate

Required evidence:

- Source tree exists and imports resolve.
- JavaScript syntax checks pass.
- `npm run build` passes when dependencies are installed.
- Browser smoke opens the game with no page errors when Playwright is available.
- Browser smoke checks that a canvas exists and that WebGL pixels are not fully blank where browser access allows it.
- Desktop and mobile viewport checks run through the same smoke script.

## Asset gate posture

Generated assets are accepted only after inspection. The default answer to “can this generated model enter runtime?” is no until the GLB/FBX gate passes.

See:

- `docs/ASSET_IMPORT_GATE.md`
- `docs/IMAGE_GENERATION_GATE.md`
- `docs/AUDIO_GENERATION_GATE.md`

## Commands

```bash
npm run qa:skills      # no-dependency static adoption gates
npm run qa:browser     # optional Playwright browser smoke gate
npm run qa             # static gates + Vite build + optional browser smoke
```

## Project adoption status (wired into the working engine)

This harness is now wired into the root project (`npm run qa:skills`, `qa:browser`,
`qa`). Status against the current engine:

- `npm run qa:skills` → **32 pass, 0 warn, 0 fail**. Every required-evidence check
  (gameplay, graphics, debug/profiler, QA, asset gates) is satisfied by the live
  engine with no gate adaptation needed.
- The earlier **collision known-gap is resolved**: the engine now has a real
  collider system (`src/physics/ColliderSystem.js`, `ColliderProxy.js`,
  `capsuleCollision.js`), which the gameplay gate detects — terrain grounding is
  no longer the only collision path.
- **Browser evidence**: `qa:browser` runs the Playwright smoke and skips cleanly
  when Playwright is absent (per the optional-browser posture). This project's
  actual browser evidence comes from the headless **SwiftShader CDP** proof suite,
  which needs no Playwright: `npm run test:browser` (boot smoke) plus the
  per-stage proofs `test:anim`, `test:undo`, `test:interaction`, `test:lighting`,
  `test:particles`, `test:vegetation`.
- New runtime subsystems added since the baseline each expose a debug surface
  (`__ANIM_RUNTIME__`, `__INTERACTION_RUNTIME__`, `__PARTICLE_RUNTIME__`,
  `__LIGHTING_DEBUG__`, `__GRASS_DEBUG__`; all DEV-gated, stripped from production)
  and a Node regression block, satisfying adoption rule 5.

## Stage-completion rule

A future Three.js stage may be called complete only when:

1. The implementation is additive and preserves the current engine owner boundaries.
2. `npm run qa:skills` passes.
3. `npm run build` passes in an installed environment.
4. Browser smoke evidence is captured, or the absence of browser tooling is explicitly recorded.
5. Any warnings are either resolved or carried forward as named follow-up gaps.
