# Arsenal v2 — World Placement, Persistence & Runtime Attachment

Status: a generated weapon (an Arsenal Lab **recipe**) can enter the main world, persist,
reload deterministically, and expose runtime/animation hooks — **without** coupling the
world to the arsenal UI or building combat/inventory. The recipe JSON is the only
hand-off format; baked geometry is never persisted (it is a rebuild cache).

## Dependency direction (strict)

```
arsenal recipe  →  recipe validator  →  world placed asset
```

The world imports the arsenal's **pure** modules only — `WeaponRuntime`
(`buildWeaponFromRecipe`), `WeaponRecipeValidation` (`sanitizeWeaponRecipe`),
`WeaponRecipe` (`recipeHash`/`weaponAssetId`). It NEVER imports `WeaponWorkbench` or
`arsenalMain`. `test:arsenal-world` greps `src/world/**` to enforce this. `/arsenal.html`
stays a separate Vite entry; the two apps share data via a `localStorage` queue, not code.

## Persistence model — the `runtimeAssets` block

A new WorldDocument block (alongside `generators` / `objects`), persisted and round-tripped
by the existing `WorldSerializer` + `validateWorldDocument` (no serializer changes). Each
item stores a recipe + transform + runtime state — **never** geometry/materials:

```jsonc
{
  "kind": "generated.weapon",
  "id": "wpn-19vv6ld",            // deterministic (recipeHash) unless supplied
  "recipe": { "type": "heavy", "parts": [ … ] },   // the Arsenal Lab recipe
  "transform": {
    "position": { "x": 5, "y": 2, "z": -3 },
    "rotation": { "x": 0, "y": 1, "z": 0 },         // EULER radians (world convention)
    "scale":    { "x": 1, "y": 1, "z": 1 }
  },
  "runtime": { "state": "idle", "owner": null, "durability": 1, "visible": true, "castShadow": true, "receiveShadow": true }
}
```

`validateWorldDocument` sanitizes the whole block (`sanitizeRuntimeAssetsBlock`): the list
is capped (`MAX_RUNTIME_ASSETS`), each item's recipe runs through `sanitizeWeaponRecipe`
(part count clamped, dimensions forced positive), and invalid items are dropped. Rotation
is stored as **euler**; a quaternion `{x,y,z,w}` is **accepted** at the boundary and
converted to euler XYZ.

## Pipeline

```
recipe → sanitizeWeaponRecipe → PlacedAssetStore (document.runtimeAssets)
       → PlacedWeaponRuntime.load → RuntimeAssetRegistry → buildWeaponFromRecipe → scene
```

- `src/world/assets/RuntimeAssetTypes.js` — descriptor normalization + the block sanitizer (the validation boundary).
- `src/world/assets/RuntimeAssetRegistry.js` — `kind → builder` (the one world↔arsenal seam; pure builder only).
- `src/world/assets/PlacedAssetStore.js` — owns `runtimeAssets.items` (add/remove/list) + drains the handoff queue.
- `src/world/placement/WeaponPlacementTool.js` — `placeWeapon(store, recipe, {x,z})`: grounds `y` via `getHeight` (the single terrain source), records the descriptor.
- `src/world/placement/PlacedWeaponRuntime.js` — on load, rebuilds every weapon from its recipe, positions + adds to scene, registers with the visibility kernel; each frame advances the energy idle-pulse for **awake** weapons only (far ones sleep, mirroring `AnimationRuntime`). Built in both editor + runtime.

## Handoff — "Send to World"

`/arsenal.html` writes a world-asset JSON to `localStorage["arsenal-export-queue"]`
("Send to World"), or copies it ("Copy world JSON"). On world load the runtime
**drains** the queue, grounds each weapon in a tidy grid near the spawn, records them in
`runtimeAssets`, and persists. Decoupled — just a recipe + transform crosses the boundary.

## Runtime hooks (for later combat — not built here)

Every built weapon exposes four named anchor `Object3D`s + `group.userData.markers`:

- `muzzle` — forward-most (+X) point (VFX / projectile origin),
- `core` — energy-part centroid,
- `equip` — lowest part (the grip mount / hand attach),
- `socket` — origin (attach root).

The idle pulse is the energy `ShaderMaterial`'s `uTime`, advanced by `PlacedWeaponRuntime`.

## Invariants (enforced by `test:arsenal-world` + `…-proof`)

- **Determinism** — same recipe → same hash → same built summary (parts/triangles/markers).
- **Boundary** — only the recipe crosses; baked geometry is never persisted.
- **Safety** — invalid recipes rejected, hostile ones clamped (≤ `MAX_PARTS`, positive dims); the block is capped.
- **Persistence** — a placed weapon survives save → reload (`runtimeAssets` round-trips).
- **Isolation** — `src/world/**` never imports the arsenal UI (grep-enforced); `/arsenal.html` stays a separate entry.
- DEV hook `window.__ARSENAL_WORLD__()` (count + markers) stripped from production.

## Commands

```
npm run test:arsenal-world        # Node: determinism, validation/clamp, round-trip, quat→euler, grounding, isolation
npm run test:arsenal-world-proof  # SwiftShader: weapon renders in world, persists, queue drains, markers present
```

## Scope

v2 is the placement/persistence/runtime BOUNDARY. **Deferred:** combat, loot/rarity
gameplay, inventory, economy, networking, enemy drops, crafting, and an editor
click-to-place tool (placement is via the handoff queue + a placement service this pass).
