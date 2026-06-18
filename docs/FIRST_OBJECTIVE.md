# FP-1 — Relic Weapon Objective

FP-1 is the first **player-facing loop that proves the game can be completed**, built from existing
systems only:

```
find the marked relic weapon → equip it (Arsenal v4) → carry it to the cache marker →
deposit it on the pedestal → objective complete (persists across reload)
```

It is NOT a quest engine, combat, inventory, or AI director — one purpose-built objective.

## The loop

- On the first runtime load the objective **auto-spawns** the relic (a deterministic
  `runtimeAssets` weapon with a fixed `RELIC_ID`) and a cache, derived from the resolved player
  spawn onto dry, walkable, below-snowline ground, separated so carrying is required.
- Two in-world **markers**: a gold relic beam (shown until you equip it) and a glowing cache beacon
  (a ring sized to the deposit zone + a pillar) at the cache.
- An **always-on banner** (top-center, runtime only) names the current step: find → carry → atCache
  → complete.
- **Deposit = a visible trophy.** Pressing **G** while holding the relic *in the cache zone* places
  it on the pedestal (visible, idle) and completes the objective; the beacon flips to a "claimed"
  (green) look. Pressing **G** while holding the relic *outside* the zone simply **drops** it
  (visible, re-grabbable) — the relic is never hidden, so there is no soft-lock. (G on any other
  weapon still does the normal Arsenal v4 store.)

## Persistence

A new validated `objectives` document block (`{version, items[]}`, mirroring `runtimeAssets`) holds
one descriptor: `{ kind:"relic-weapon.fp1", id, relicId, cache:{x,y,z}, radius, completed }`. The
runtime mutates the live entry's `completed` in place; `WorldSerializer.save` re-validates and the
sanitizer's whitelist persists it. The relic's deposited pedestal transform is written back to its
`runtimeAssets` descriptor, so reload rebuilds the trophy on the cache and restores `completed`.

Two persistence disciplines (the Arsenal-v4 "B1" lesson):
- `sanitizeObjectivesBlock` / `normalizeObjectiveDescriptor` **explicitly emit every field** —
  `completed: item.completed === true` (a boolean is dropped if not emitted), and a **non-finite
  `cache` drops the whole objective** (no origin fallback, which would make the zone uncompletable).
- The `objectives` block is **additive — `WORLD_DOCUMENT_VERSION` is unchanged (2)** and the
  sanitizer produces zero warnings on an empty block, so existing world/version assertions stay green.

## Architecture / boundaries

- `src/world/objectives/` — `ObjectiveTypes.js` (the validation boundary), `ObjectivePersistence.js`
  (`ObjectiveStore`, the `PlacedAssetStore` analog), `RelicWeaponObjective.js` (pure: recipe + dry-
  ground site derivation + phase + banner copy), `ObjectiveRuntime.js` (owns the markers + the
  deposit; the beacon lifecycle is self-managed so reload doesn't leak/duplicate).
- `ObjectiveRuntime` is owned in `main.js` (runtime-only — it needs the player + the per-load store);
  it loads **after the player is grounded** so its sites derive from the resolved spawn. The relic is
  spawned only if absent (fixed id → idempotent across reloads) and that fresh world is saved once.
- Reuses `placeWeapon`/`PlacedAssetStore`/`PlacedWeaponRuntime` and `WeaponEquipRuntime` (read-only
  API + `unequip`); imports only the PURE arsenal recipe modules — no workbench UI, `/arsenal.html`
  and `src/arsenal/` are untouched. No combat/inventory/quest-engine.

## Verification

- `npm run test:first-objective` (Node, headless THREE) — deterministic relic recipe + dry-ground
  sites; the `objectives` block round-trip (`completed:false` survives as a literal, hostile cache
  dropped, radius clamped, zero warnings empty); `ObjectiveStore` self-heal; `ObjectiveRuntime` spawn-
  if-absent + idempotent reload (no double-spawn, one beacon, markers disposed); `tryDeposit`
  pedestal/drop/no-op; completion + pedestal transform survive save→load; phase truth table.
- `npm run test:first-objective-proof` (SwiftShader) — author empty world → find → equip → carry
  (teleport) → deposit → complete; reload re-attaches the trophy + completion; wildlife/ambient
  unaffected; zero console errors.
- Arsenal v1–v4 + the environment regression sweep stay green; `npm run build` + `npm run qa` green.

## Status in the gate

This is FP-1 in `docs/FIRST_PLAYABLE_BUILD.md`. It does **not** satisfy FP-4 — the
`world-builder-first-playable-v0` tag stays reserved until FP-2 (`test:first-playable-proof`), FP-3
(hidden-issue sweep), and the §7.7 go/no-go review are done.

## Non-goals

No combat, inventory, enemies, dialogue, procedural quest generation, economy, multiple objectives,
generalized objective/quest engine, AI director, or live deployment; no `src/arsenal/` /
`/arsenal.html` / recipe-schema / environment-system changes; no `WORLD_DOCUMENT_VERSION` bump.
