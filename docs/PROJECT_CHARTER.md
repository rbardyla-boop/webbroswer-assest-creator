# Project Charter — Architectural Decisions

This file records significant architectural decisions for the World Builder.
Stage verification notes live alongside it (`docs/stage*-*.md`).

## Product line

A local, browser-only **world builder** that exports optimized, playable browser
worlds. Not a server, account, marketplace, or networked engine. Standing hard
constraints across stages: local/browser-only; no cloud/account/networking; no
arbitrary mod scripting / `eval` / dynamic code; no enemies/combat/quests/
inventory; no rigging editor / bone editing / IK / animation-timeline authoring;
no WebGPU. Core systems are extended additively — Asset Library, Mod packages,
WorldDocument v2, Prefab system, and the World Builder are not rewritten.

---

## ADR-011 — Editor undo/redo via object-retention command stack (Stage 11)

**Decision.** Add a bounded, in-memory undo/redo `CommandStack` to the World
Builder covering the spatial authoring path: place, prefab-place, duplicate,
delete, and transform (single + group). Commands operate by **object
retention** — `WorldObjectManager.detach()`/`attach()` move the *same* live
`THREE` object in and out of the scene without disposing it, so undo/redo is
synchronous and restores the exact instance (id, geometry, asset, collider,
animation), with no async asset rebuild at undo time.

**Why object-retention over descriptor-rebuild.** Rebuilding from a serialized
descriptor would make undo async and depend on serialize fidelity for every
asset type. Retaining the object is synchronous, exact, and keeps object ids
stable (so transform commands keep resolving their targets).

**Disposal / memory.** A deleted or undone-then-discarded object is held
(detached, not rendered) so it can be restored. GPU resources are freed via
`disposeObject()` only when the owning command leaves history — evicted past the
size limit (100) or discarded with the redo branch by a new action. Each command
tracks the objects it currently parks (detached), so `dispose()` is always safe
and never frees a live object. Trade-off: deleted objects hold GPU memory until
they leave history; bounded by the history limit.

**History lifetime.** The stack is cleared on every world reload
(`setWorldContext`), because a reloaded world is a fresh object graph and old
commands would reference torn-down objects.

**Observability.** `window.__WORLD_EDITOR__` is exposed in **editor builds only**
(never in runtime/play exports), mirroring `window.__ANIM_RUNTIME__`, so tests
and devtools can drive and inspect the editor + history. Proven by
`npm run test:undo` (real `Delete` / `Ctrl+Z` / `Ctrl+Shift+Z` keyboard wiring).

**Deferred (not in v1).** Property-edit undo (collider/animation inspector
changes); persistence/serialization of history across reloads; "infinite"
compressed history. The stack and command interface are extensible to add these
later without reshaping the editor.
