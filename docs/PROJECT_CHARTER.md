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

---

## ADR-012 — Data-only interaction / trigger objects (Stage 12)

**Decision.** Add declarative, data-only interactions to placed objects via a new
`src/interaction/` layer, mirroring the Stage 10 animation pattern (metadata on
object → validation → runtime → editor panel → round-trip). An object carries an
`interaction` block with a `role`: **trigger**, **door**, **sign**, **pickup**,
or **spawn**. Triggers emit named events on a channel; doors/responders listen
for named events; signs show text on proximity; pickups collect on proximity and
emit; spawns are named teleport targets (a trigger may `teleportTo` one). The
connective tissue is an `EventBus` (channel + name pub/sub).

**No-code guarantee (the core constraint).** Events are plain strings matched by
equality. Behaviors are the `InteractionRuntime`'s OWN fixed methods, keyed by
`role` and bound to events at load time by matching the declarative name lists.
No part of world/mod data is ever interpreted or executed:
- `sanitizeInteraction` builds ONLY the allowlisted fields per role; unknown keys
  (`script`, `code`, `onEnter`, `fn`, …) are never read, copied, or stored.
- Tokens (channel/event/spawn names) are length-capped and restricted to
  `[A-Za-z0-9_.-]`; event lists are de-duplicated and capped (16); sign text is
  capped (280) and rendered with `textContent` (never `innerHTML`).
This extends the same "controlled, manifest-based, no-eval" doctrine as the mod
system — interactions are safe to ride inside worldpacks and mod packages.

**Runtime-only, deterministic.** `InteractionRuntime` runs in runtime mode only
(the editor never runs it, so authoring never fires gameplay). It is THREE-math
only / DOM-free (the sign overlay is a separate injected `onMessage` consumer);
given the player position and dt it tests volumes, routes events, animates doors,
and teleports — deterministic and Node-testable. Indexed once after world load by
scanning `objectManager.objects` (no per-object registration needed).

**Round-trip.** `interaction` is threaded through `WorldObjectManager` serialize +
`_attachInteraction`, and `WorldValidation` sanitizes it on every load, so it
rides worldpacks and mod packages automatically (the worldpack world IS the
validated WorldDocument).

**Observability.** `window.__INTERACTION_RUNTIME__` is exposed in RUNTIME mode
only (mirrors `__ANIM_RUNTIME__`); `npm run test:interaction` authors a world in
the editor and proves trigger→door / pickup / sign in a SwiftShader browser.

**Deferred (not in v1).** Collider sync for moving doors (doors are visual +
event-driven; collision is not repositioned); multi-step sequences / conditions /
timers beyond emit→listen; per-interaction undo (property edits, like collider/
animation, are outside the Stage 11 undo scope).

---

## ADR-013A — Data-driven global lighting rig (Stage 13A, Lighting Lab)

**Decision.** Make the world's global lighting rig data-driven and authorable via
a new `src/lighting/` layer and a `lighting` block in WorldDocument v2:
- **sun** — color, intensity, azimuth/elevation (degrees → world offset), shadow.
- **hemisphere** — sky/ground color, intensity.
- **fog** — color, near, far, enabled (also drives `scene.background`).

The sun is authored as azimuth/elevation (not a raw position) so it reads
naturally and stays stable across saves; `computeSunOffset` derives the
world-space offset the player-following shadow rig uses (`lights.sunOffset`).
`applyLighting` mutates the live THREE rig + scene fog/background; it runs at
world load (before grass is built, so the grass material captures correct fog)
and on every editor edit (live preview). `sanitizeLighting` repairs/clamps every
field (color → `#rrggbb`, intensity/elevation/fog clamped, `far` forced above
`near`), so untrusted worlds/mods are safe. The lighting block round-trips through
WorldValidation → worldpack → mod automatically.

The editor's `LightingPanel` writes edits into `worldLoader.document.lighting`
(the live doc) and applies them live; save/export preserve it via
`updateDocumentFromRuntime`. `window.__LIGHTING_DEBUG__` (DEV-only) reads the live
rig for `npm run test:lighting`.

**Deferred (not in v1).** Placed point/spot lights with a shadow budget; exposure
/ tone mapping controls; per-light gizmos. The global rig is the high-impact core.

---

## ADR-013B — Data-only particle / smoke emitters (Stage 13B, Particles Lab)

**Decision.** Objects may carry a data-only `particles` emitter block under
`src/particles/`: a `kind` (spark/dust/smoke — sets blend mode + sensible preset)
plus authorable params (rate, max, lifetime, size→sizeEnd, color→colorEnd, speed,
spread, gravity, emitRadius, opacity). `ParticleRuntime` spawns/ages/recycles
particles into a `THREE.Points` buffer with a point-sprite shader; only point
size + alpha animate (compositor-friendly). It runs in the runtime AND as an
editor preview (particles are ambient VFX, not gameplay, so previewing them in
the editor is fine — unlike the interaction/animation runtimes which stay
runtime-only).

Deterministic (seeded RNG per object id) and resource-bounded: `sanitizeParticles`
clamps every field (rate ≤ 500, max ≤ 2000, etc.), builds only allowlisted fields
(no-code), and drops an unknown `kind` to null; the runtime caps concurrent
emitters at 200 (`MAX_EMITTERS`) and `dt`/spawn-accumulator are clamped, so a
hostile world can't exhaust memory. An O(1) free-list recycles dead slots.
Particles round-trip through WorldValidation → worldpack → mod automatically.

The editor's `ParticlePanel` writes to `object.userData.particles` and reloads the
preview; `window.__PARTICLE_RUNTIME__` (DEV-only) drives the runtime for
`npm run test:particles` (proves editor preview + runtime both spawn within cap).

**Deferred (not in v1).** Soft/depth-fade particles; textured sprites; local
volumetric smoke; per-emitter incremental preview reload (currently full rebuild
on edit). This is the **second half of the Lighting + Particles lab** (with 13A).

---

## ADR-014 — Vegetation v2 (Stage 14A grass + 14B bush layer)

**Decision.** Criterion-2 visual track, committed as narrow sub-stages.

**14A — grass v2:** deterministic procedural clumping (placement thins candidates
outside a position-based `fbm2D` field, gated by a seeded rng draw) + a distance
(reuses the fog factor) and grazing-angle Fresnel bias toward the tip color
(shader). New grass config fields round-trip; `GrassSystem.updateSettings` splits
placement keys (rebuild) from shader keys (`syncVegetation`). Fresnel power is a
fixed shader constant. Editor "Grass" controls; `__GRASS_DEBUG__`; `test:vegetation`.

**14B — bush layer:** a new `src/bushes/` instanced system mirroring the trees
system (BushConfig/Geometry/Material/Placement/Patch/System). One InstancedMesh
per patch per LOD → **one instanced draw call per visible patch** (half the tree
cost). Deterministic seeded placement with clump + slope + height-band +
exclusion filters; distance LOD + frustum/distance culling + lazy build budget +
far-patch disposal. `bushCandidateCount` is capped (MAX_BUSH_CANDIDATES=4096) and
validation caps density/patchSize, so a hostile world can't spin a giant loop.
Round-trips through WorldDocument/worldpack/mod. Editor "Bushes" controls; debug
HUD bush line; `__BUSH_DEBUG__`; `npm run test:bush`.

Both stages: additive (no grass/tree rewrite); `npm run qa` (qa:skills 32/0/0) +
the SwiftShader proof suite green. Reverse-Z / voxels / procedural builds stay in
Stages 15-17; combat/Skybreak stays blocked.

**Deferred from 14B.** A generalized `VegetationLayer` abstraction over
grass/trees/bushes (the systems are intentionally parallel for now, not refactored).
Bush wind/animation; billboard/cross-quad shrubs.

## ADR-QA — Three.js skill-gate adoption

The `.claude/threejs_skills/` skill-adoption harness is wired into the project
(`qa:skills`/`qa:browser`/`qa`). `qa:skills` is a static source gate that maps the
skill-pack's required evidence to the live engine (32/0/0). Stage completion now
requires `qa:skills` + build + browser evidence. The engine is the source of
truth — gate patterns adapt to it, never the reverse. See `THREEJS_SKILL_ADOPTION.md`.
