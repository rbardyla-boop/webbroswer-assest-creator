# Review Fix Report — v0.2.1

## Checks used

This review is correct if:

- `npm run verify` passes all checks.
- `npm run build` completes.
- `npm run dev` serves the browser entry page.
- City chunk surfaces use correct shadow flags: translucent zone overlays do not cast or receive shadows; roads/sidewalks/runways receive shadows but do not cast them; buildings and props cast shadows.
- City update code avoids avoidable per-frame allocation for draw-call estimation.
- Original success criteria remain intact: Vite project, terrain, lighting, GPU animated instanced grass, chunked grass, capsule player, FP/TP camera, city-builder zones, special sites, seed variation, save/load, and debug panel.

This output is wrong if:

- Any verifier check fails.
- Build fails.
- The city system regresses to independent meshes per object.
- Shadow flags make roads/zones cast unnecessary shadows.
- Save/load or deterministic seeded generation breaks.

## Issues found and fixed

1. `CityChunk._addMesh()` overwrote shadow settings for flat city meshes.
   - Problem: `_buildZones()` and `_buildFlat()` attempted to disable shadow casting, but `_addMesh()` always set `mesh.castShadow = true`.
   - Fix: `_addMesh()` now accepts explicit `{ castShadow, receiveShadow }` options. Zone overlays no longer cast/receive shadows. Roads, sidewalks, and runways receive shadows but do not cast them. Buildings and props still cast shadows.
   - Verification: Added and passed `City chunk render flags avoid flat-overlay shadow artifacts`.

2. `CitySystem.update()` allocated with `chunk.meshes.filter(...)` every frame.
   - Problem: Small, but unnecessary frame-loop allocation.
   - Fix: Added `CityChunk.visibleDrawCount`, implemented as a simple loop, and used that in `CitySystem.update()`.
   - Verification: Added a verifier assertion that `CitySystem.js` does not contain `meshes.filter`.

## Commands run

```bash
npm install --no-audit --no-fund
npm run verify
npm run build
npm run dev -- --host 127.0.0.1 --port 5190
curl http://127.0.0.1:5190
```

## Results

- `npm run verify`: PASS, 13/13 checks.
- `npm run build`: PASS. Vite emitted the standard Three.js chunk-size warning only.
- `npm run dev` + curl smoke: PASS, browser entry HTML served.
- Headless Chromium GPU smoke: not counted. Chromium in this sandbox failed to initialize EGL/SwiftShader reliably under headless/Xvfb, which is an environment limitation rather than a project build failure.

## Confidence

High for code structure, build, deterministic generation, save/load, and runtime architecture. Medium for actual FPS because this environment could not run a reliable WebGL browser performance capture.
