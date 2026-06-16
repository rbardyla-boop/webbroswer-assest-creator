# Implementation Checklist

This output is correct if all checks below pass:

- The project has `npm install`, `npm run dev`, `npm run build`, and `npm run verify` paths.
- The browser demo wires terrain, lighting, animated instanced grass, capsule player, FP/TP cameras, city generator UI, save/load, and debug panel.
- Grass uses instanced geometry, patch-level visibility/distance management, GPU shader wind, per-blade variation, and configurable density/patch/LOD/wind/debug settings.
- Terrain placement uses reusable height/normal/slope/placement functions.
- Player is a capsule, moves with keyboard, stays grounded on sampled terrain, and uses camera-relative movement.
- Camera toggles first/third person with `V`, uses eye height in first person, and smooth follow in third person.
- City generator produces labeled city-builder zones and special sites: parks, village/rural, military, science, drilling, small airport.
- Same seed/style gives identical city document signatures; different seed or style gives a different layout.
- Save/load round-trips the full city document.
- City runtime uses instanced meshes and chunk-level culling/LOD so it does not become one mesh per object.
- City zone overlays and road/runway/sidewalk plates do not cast shadows; buildings and props still cast shadows.
- City draw-call estimation avoids per-frame array allocation in `CitySystem.update()`.
- Debug panel shows FPS, visible grass patches, visible blades, LOD distribution, estimated draw calls, player position, camera mode, city chunks, and active zone.

Wrong if any of these are observed:

- Missing city zones or special sites.
- Runtime city objects created as hundreds of independent meshes instead of instanced batches.
- No deterministic seed behavior.
- No save/load path.
- No first-person/third-person toggle.
- Grass wind handled on CPU per blade instead of shader uniforms/attributes.
- Debug panel missing performance counters.
- Verification script fails.

## Review pass additions

- `npm run verify` must report 13/13 checks.
- The `City chunk render flags avoid flat-overlay shadow artifacts` check must pass.
- `CitySystem.js` must not contain `meshes.filter` inside the frame update path.
