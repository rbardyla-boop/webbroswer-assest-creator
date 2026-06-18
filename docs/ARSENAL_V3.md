# Arsenal v3 — Click-to-Place & Equip-to-Hand

Arsenal v3 makes the generated weapons of Arsenal v1/v2 **interactable**: place them onto the
terrain in the editor, and equip them onto the player in runtime. It is a minimal interaction
layer — NOT gameplay (no combat, damage, projectiles, inventory, loot, crafting, economy). It
preserves the v2 recipe boundary, the `runtimeAssets` persistence, the marker contract, and the
isolated `/arsenal.html` workbench.

## Click-to-place (editor)

The editor arms a freshly-rolled weapon recipe; terrain clicks drop generated weapons via the
same `placeWeapon` → `PlacedAssetStore` → `PlacedWeaponRuntime` path the runtime uses.

- **Arm:** press **B** in the editor (toggles weapon placement; Escape disarms). Each placement
  re-rolls so weapons are distinct (and get unique ids). Mutually exclusive with prefab placement.
- The recipe comes from a default `WEAPON_PRESETS` roll (`generateWeaponRecipe(rollConfig(seed,
  type))`) — NOT the workbench handoff queue, which is drained+deleted before the editor opens.
- The editor imports only PURE arsenal modules (`WeaponPresets`/`WeaponConfig`/`WeaponGrammar`) —
  no workbench UI; the world↔arsenal boundary stays recipe-only.
- Placed weapons persist in `runtimeAssets` (the v2 path) and survive reload.

`PlacedWeaponRuntime` gained CRUD for interactive placement: `add(descriptor)` / `remove(id)` /
`getEntry(id)`, sharing one `_instantiate(item)` body with `load()`. **`clear()`/`remove()` detach
via `group.removeFromParent()`** (not `scene.remove`) so a weapon currently parented to the player
is never orphaned on reload.

## Equip-to-hand (runtime)

`WeaponEquipRuntime` reparents a placed weapon's group onto the player at its `equip` marker.

- **F** — equip the nearest placed weapon (within range) / drop the held one back to the world.
- **G** — store (hide) the held weapon.
- Markers are **position-only** (no orientation), so the attach transform is simply
  `group.position = handLocal − equipLocal` at identity orientation: the `equip` marker then sits
  at the player's hand. The weapon follows the player automatically (it's a child of `player.mesh`,
  which `syncMesh()` updates each frame). No firing — just attachment.
- The equip marker → transform is the one path with no validator between data and the scene graph,
  so it is **finite-guarded**: a non-finite marker or result refuses the equip and leaves the
  weapon placed.

### Unequip — both outcomes

- **drop** → detach, ground at the player's feet (`getHeight + FLOAT_HEIGHT`), `state:"idle"`,
  visible; re-equippable. The grounded transform is written back so the drop persists.
- **store** → hide (`group.visible = false`), `state:"stored"`, `visible:false`; a terminal
  "put away" that persists hidden.

### Persistence — both modes

A `persistEquip` flag (default **transient**) gates whether `equip()` WRITES `state:"equipped"`
to the descriptor:

- **transient** — equip is session-only; reload puts the weapon back on the ground.
- **persist** — `equip()` writes `state:"equipped"` + `owner:"player"`; on the next world load the
  equip runtime **re-attaches it to the player**.

`load()` re-attaches equipped items **unconditionally** — the document (`state:"equipped"`) is the
source of truth, not the session flag (a transient equip never wrote that state, so it simply isn't
there). No schema change: `equipped`/`stored`/`owner`/`visible` already exist in the v2 `runtime`
block.

## Architecture / boundaries

- Extends the canonical `src/world/placement/` (`PlacedWeaponRuntime` + new `WeaponEquipRuntime`) —
  not a parallel `src/world/arsenal/`. The equip runtime is owned in `main.js` (it needs the player
  + input + the per-load store), not `WorldRuntimeLoader` (which has no player and is rebuilt per
  load). `WorldRuntimeLoader.updateDocumentFromRuntime` is untouched.
- `WeaponEquipRuntime` imports no arsenal module at all (reads `group.userData.markers` off the
  placed entry) → the boundary grep stays green. `/arsenal.html` stays a separate Vite entry.
- DEV hooks: `__ARSENAL_WORLD__` (v2 placed snapshot), `__ARSENAL_EQUIP__` (placed count, equipped
  id/type, marker world positions, persist mode), `__ARSENAL_EQUIP_DO__` (deterministic
  place/equip/unequip/toggleNearest/setPersist/save drivers for the proof).

## Verification

- `npm run test:arsenal-placement` (Node, headless THREE) — CRUD; the equip-marker reparent math
  (group at `handLocal − equipLocal`, marker coincides with the hand in world space, finite);
  drop/store/persist descriptor states; persisted-equipped re-attaches on a fresh load; hostile
  descriptor + poisoned marker rejected; isolation grep over `src/world` + `src/editor`.
- `npm run test:arsenal-v3` (SwiftShader) — place → equip (parented to the Player, markers finite)
  → drop → store → persist-equip + save → **reload re-attaches**; player/wildlife/ambient
  unaffected; zero console errors.
- The v2 `test:arsenal-world-proof` + the full regression sweep stay green; `npm run build` + qa
  green (boundary grep green, `/arsenal.html` builds as its own entry).

## Non-goals

No combat, damage, projectiles, inventory, rarity, loot/drops, economy, crafting, stats; no merging
the workbench into the world app; no `runtimeAssets`/recipe schema change.
