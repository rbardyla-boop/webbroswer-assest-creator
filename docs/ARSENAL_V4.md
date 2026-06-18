# Arsenal v4 — Oriented Equip Slots & Multi-Slot Attachment

Arsenal v3 attached a generated weapon to the player **position-only** (`group.position =
handLocal − equipLocal`, identity rotation, one attach point). v4 strengthens the **attachment
contract** before weapon variety or combat depend on it: markers expose a full finite transform,
attachment becomes a single compose rule, and the player has three explicit slots
(rightHand / back / hip). It is still NOT gameplay — no firing, damage, ammo, inventory, loot,
crafting, or animation beyond static slot attachment.

## The attachment rule

```
weaponLocal = slotMatrix(slot) × inverse(equipMatrix(markers))
```

The weapon is reparented onto `player.mesh` with `weaponLocal` as its local transform, so its
`equip` marker coincides with the chosen slot **in world space, oriented**. The weapon stays a
**direct child of `player.mesh`** (slots are transforms composed into the weapon's player-local
matrix, not intermediate scene nodes) — so `syncMesh()` carries it with the player and the v3
`equippedParentIsPlayer` invariant holds.

- `src/world/placement/WeaponMarkerTransforms.js` — the marker-transform **contract**. Lifts the
  weapon's position-only `userData.markers` arrays into full `{position, rotation}` transforms,
  finite-guarded. `equipMatrix(markers)` returns the equip marker's local Matrix4 (identity
  rotation — the weapon's model grip frame) or `null` for a poisoned marker.
- `src/world/placement/WeaponEquipSlots.js` — the player slot table `PLAYER_SLOTS`
  (`{bone, localPosition, localRotation}` each) + `slotMatrix(name)` (normalized) + the cycle
  helpers. `bone` is a forward-looking hook for skeletal attachment (null today). The meaningful
  per-attach orientation lives in the **slot** rotations: rightHand keeps the weapon in its model
  frame (identity), back lays it up along the spine, hip angles it down.

Because `rightHand.localRotation` is identity and `rightHand.localPosition` equals the v3
`handLocal` exactly, the rightHand compose **reduces bit-for-bit to the v3 result** — so the
v1/v2/v3 tests stay green unchanged. (The arsenal source is untouched: markers stay position-only
arrays at the source, which the v1/v2 tests require; the transform upgrade lives entirely in
`src/world/placement/`.)

## Slots & controls

One weapon is equipped at a time; **R** cycles it `rightHand → back → hip → rightHand`
(`cycleSlot`). **F** equips the nearest placed weapon / drops the held one; **G** stores (hides)
it — the v3 bindings, unchanged. The general primitive is `equip(weaponId, player, slot)`; cycle
re-runs it with the next slot (reparent is a no-op when already on the player).

The equip marker → transform is the one path with no validator between data and the scene graph,
so it is **finite-guarded**: the equip matrix, the slot matrix, and the decomposed result are all
checked, and on any non-finite value the equip is refused and the weapon is left placed.

## Persistence — including which slot

The chosen slot persists. `runtime.slot` was added to the descriptor's runtime block and, crucially,
**to the whitelist in `RuntimeAssetTypes.normalizeRuntimeAssetDescriptor`** (the sanitizer rebuilds
the runtime block from a fixed key list and drops unknown keys — without the whitelist entry `slot`
would be silently lost on every save→load). An unknown slot sanitizes to `null`.

- `equip()` in persist mode writes `state:"equipped"`, `owner:"player"`, `slot:<name>`.
- `unequip("drop")` / `unequip("store")` clear `slot` back to `null`.
- `load()` re-attaches the `state==="equipped"` item to `runtime.slot ?? "rightHand"`
  **unconditionally** (the document is the source of truth; a legacy/transient save with no slot
  falls back to rightHand — so a v3-persisted equip still re-attaches correctly).

No schema change beyond the additive `slot` field; the recipe JSON remains the only asset handoff
and no geometry is persisted.

## Architecture / boundaries

- All new code is under `src/world/placement/` (the user-scoped home); `src/arsenal/`,
  `/arsenal.html`, and `src/editor/` are untouched. The new modules import only THREE (+ terrain in
  the runtime), so the arsenal isolation grep (`src/world` + `src/editor` must not import the
  workbench UI) stays green.
- `WeaponEquipRuntime` is owned in `main.js` (it needs the player + input + the per-load store).
- DEV hooks: `__ARSENAL_EQUIP__` (richer `debugSnapshot`: `equippedSlot`, `slotsFinite`,
  `markerTransformsFinite` alongside the v3 fields) and `__ARSENAL_EQUIP_DO__`
  (`equip(id, slot)` / `cycle` / `selectSlot` / `unequip` / `setPersist` / `save`).

## Verification

- `npm run test:arsenal-equip-slots` (Node, headless THREE) — marker/slot transforms finite; the
  core invariant `equipMarkerWorld == slotWorld` (oriented) for **each** of rightHand/back/hip;
  rightHand reduces to v3; `cycleSlot` walks the three; `runtime.slot` round-trips the sanitizer and
  the document; drop/store clear it; a persisted equipped@hip re-attaches to the hip on a fresh load;
  poisoned marker + unknown slot refused (weapon stays placed); isolation.
- `npm run test:arsenal-v4` (SwiftShader) — place → equip rightHand → cycle to back → cycle to hip
  (each oriented + parented + finite) → persist-equip a second weapon on the hip + save → **reload
  re-attaches it to the hip**; player/wildlife/ambient unaffected; zero console errors.
- The v1/v2/v3 arsenal tests + the full environment regression sweep stay green; `npm run build` +
  `npm run qa` green.

## Non-goals

No firing, damage, ammo, recoil, inventory grid, rarity, loot, crafting, enemies, or animation
beyond static slot attachment; no holster / multi-occupant carry (one weapon at a time — deferred);
no `src/arsenal/` or `/arsenal.html` changes; no recipe-schema change.
