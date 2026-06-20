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

## Build Status Ledger

> Single source of truth for "where are we and is it tested." Every shipped stage is committed
> **and tagged locally** (no push). Each stage's cadence required its gate to pass before tagging,
> so "Tested" means a named regression/proof exists and passed. **Refresh this after every accepted
> stage** using the prompt at the end of this section.

**Health snapshot — as of 2026-06-20 (Content-2 accepted; tag `world-builder-content-2-slice-expansion`).**
- **65 stages shipped** (+ a Gate Repair-0 repair tag). Milestone reached: **Glacial Valley First
  Playable** (`world-builder-first-playable-v0`, FP-4) — find → equip → carry → deposit a generated relic, reload-safe.
- **Build green; qa skills 32/0/0; qa layout 43/0/0.** Latest stage: **Content-2 — Authored Slice Expansion**
  (ADR-054): turns the visual-benchmark corridor into a fuller authored slice using EXISTING systems only — NO new runtime
  code, NO movement AI, NO renderer work. One discoverable off-route moment — a 4-piece **frozen shrine alcove** tucked ~9m
  beside the relic ruin — bundles three beats: EXPLORATION (the shrine structure), READABLE (a data-only **sign** that names
  the place + points on to the cache — wayfinding/objective clarity), ENVIRONMENT (a brooding **fog pocket** smoke emitter on
  the idol), and REWARD (an optional **exotic generated weapon** in a new `runtimeAssets` block, claimed with F). The two
  combat beats + the relic/cache objective are UNCHANGED. NO patrol/chase/attacks/waves/loot/factions/procedural-encounter
  generation/shader-LOD/renderer work.
- **Pure authored DATA + a helper extension.** `InteractionRuntime` / `ParticleRuntime` / `PlacedWeaponRuntime` already load
  their blocks, so the shrine is sample data: 4 `vb-shrine-*` primitives, a `sign` interaction (sanitized at the boundary,
  rendered via `.textContent`), a `smoke` emitter, and one `generated.weapon` runtimeAsset (a deterministic exotic recipe,
  `generateWeaponRecipe(rollConfig(seed,'exotic'))` — the allowed world→arsenal-recipe import, same as RelicWeaponObjective/
  FrozenCacheSlice). `groundedPrimitive` gained an additive `interaction` option (mirrors `particles`). The reward coexists
  with the auto-spawned relic (distinct id; the objective only completes on the relic).
- **BYTE-STABILITY.** `src/main.js` and EVERY runtime system are UNTOUCHED — `EnemyRuntime` / `CombatRuntime` /
  `FrozenCacheSlice` / `SliceCompletion` / the encounters / `placement` / `assets` / `interaction` / `particles` all
  zero-diff. No `WORLD_DOCUMENT_VERSION` bump. The two combat beats + the relic objective axis are byte-stable. The
  frozen-cache + first-playable slices don't load the benchmark → byte-stable. The perf `objects` ceiling was re-locked
  20→24 (a deliberate content-growth re-lock: measured 18 + ~33% headroom; the gate still fails above 24).
- **Content-2 gates GREEN**: `test:content-slice-expansion` (6 Node: the shrine alcove + route band, the save-stable sign,
  the fog emitter + ≥4 emitters, the exotic reward weapon validates + deterministic + distinct-from-relic, the two beats +
  objective axis byte-stable, determinism + budget) + `test:content-slice-expansion-proof` (SwiftShader on `visual-benchmark-1`:
  shrine visible + sign loaded → reach the shrine, the sign surfaces its wayfinding text → the reward is findable + CLAIMED
  (`pickUp()` returns the specific id, carried as active) → BOTH combat beats still complete independently → the relic
  objective still completes → benchmark within the Performance Contract → reload persists the objective + both beats + the
  reward re-instantiates, 0 errors). Existing benchmark/encounter/byte-stability gates all still green (the shrine fits the
  route band, +4 objects under the re-locked ceiling, the 4th emitter keeps ≥3). Fresh-context adversarial review (4
  dimensions: byte-stability/isolation · data-validity/security/determinism · route/perf-relock-honesty · proof/gate-rigor +
  per-finding verify): **0 critical / 0 high / 0 medium / 4 low** — all fixed (a stale `≤20` ceiling comment corrected to the
  re-locked 24; the sign-surface proof made deterministic via a synchronous `interactionRuntime.update(0)` instead of a
  throttled-rAF sleep). One refuted (a "vacuous perf gate" claim — the objects/runtimeAssets metrics are finite + non-zero).
- **Prior stages:** Content-1 (ADR-053, `world-builder-content-1-combat-beats`) — second authored combat beat (repeatable
  encounter composition + per-beat label), no AI/waves. Encounter-1 (ADR-052) — authored combat-beat polish (telegraph +
  gate-light + phase/banner). Environment Polish-1 (ADR-051) — visual benchmark expansion. WebGPU Feasibility Gate-0
  (ADR-050) — feasibility-only, go/no-go = B (WebGPU stays an experimental lab).
- **Next per ADR-039 roadmap: (await operator pick)** — Content-2 proved static/reactive sentinels + authored discovery
  still have room. The evidence-gated fork: more authored content/audio (if the slice feels playable but thin), Enemy-1
  movement/patrol (if it now feels static — the bigger foundational seam: terrain grounding, water avoidance, combat range,
  proximity, state transitions, path validity, reload, performance), or shader/LOD feasibility (only if visuals/perf become
  the constraint). Keep converting the engine into a product surface.
- **Resolved by Gate Repair-0 (`world-builder-gate-repair-visibility-v0`):**
  - ✅ **`test:visibility` (Stage 17A)** — was a STALE test expectation (`expected 2 animated rigs, got 3`), NOT a
    runtime regression. Proven by a throwaway agent dump: the kernel registers 3 agents = the 2 authored rigs +
    `relic-weapon-fp1`, the relic the objective auto-spawns in any runtime world since FP-1 (registered ONCE —
    `relicWeapons:1`, no double-registration). Rebaselined the proof to the intended set and STRENGTHENED it
    (now explicitly asserts the relic agent is registered + `total === 3`). No runtime/visual behavior changed.
  - ✅ **`test:undo`, `test:connectors`, `test:visual0`** — these never had a code defect; they were collateral
    from the *crashing* visibility proof leaving residue in a back-to-back run. With visibility exiting cleanly,
    the full sweep is green. No separate change was needed.
- **Browser proofs (SwiftShader):** `test:arsenal-v6`, `test:frozen-cache-proof`, and
  `test:first-playable-hidden-proof` ran green this session with zero console errors; `qa:browser`
  (Playwright) WARN-skips in this environment (Playwright absent) — acceptable per the gate.
- **Review:** 0 critical / 0 high / 0 medium findings after implementation review and proof-driven fixes.
  Slice-0A human UX validation remains intentionally open; it is validation debt, not a claim of proven usability.

**Stage ledger (chronological by phase; tag = local milestone, gate = primary regression/proof).**

| Phase | Stage | Tag | Primary gate(s) | Status |
|---|---|---|---|---|
| 1 · Editor & World foundation | Perf pass | `…stage1-lag-pass` | (foundation) | ✅ |
| | Trees v0 | `…stage2-trees-v0` | (foundation) | ✅ |
| | WorldDocument v2 | `…stage3-worlddoc-v2` | `test:world` | ✅ |
| | Runtime proof | `…stage3b-runtime-proof` | browser proof | ✅ |
| | Asset Library v1 | `…stage4-assetlib-v1-alpha` / `…stage4b-assetlib-proof` | regression + proof | ✅ |
| | Prefabs v1 | `…stage5-prefabs-v1` | regression | ✅ |
| | Multiselect + Kits | `…stage6a-multiselect` / `…stage6b-kits-v1` | regression | ✅ |
| | Vertical slice v1 | `…stage7-vertical-slice-v1` | regression | ✅ |
| 2 · Runtime / export / editor systems | Playable build (worldpack) | `…stage8-playable-build-v1` | export regression | ✅ |
| | Mod packages | `…stage9-mod-package-v1` | mod regression | ✅ |
| | Rigged runtime | `…stage10-rigged-runtime-v1` / `…stage10b-animation-fixture-v1` | `test:anim` | ✅ |
| | Undo/redo | `…stage11-undo-redo-v1` | `test:undo` | ✅ |
| | Interactions | `…stage12-interactions-v1` | `test:interaction` | ✅ |
| 3 · Visual & spatial systems | Lighting | `…stage13a-lighting-v1` | `test:lighting` | ✅ |
| | Particles | `…stage13b-particles-v1` | `test:particles` | ✅ |
| | Vegetation v2 (grass/bush/terrain) | `…stage14a-grass-v2` / `…stage14b-bush-v1` / `…stage14c-terrain-v2` | `test:vegetation` `test:bush` `test:terrain` | ✅ |
| | Reverse-Z depth | `…stage15-reverse-z` | `test:reversez` | ✅ |
| | Voxel debug lab | `…stage16-voxel-lab` | `test:voxel` | ✅ |
| | Visibility kernel | `…stage17a-visibility-kernel` | `test:visibility` | ✅ (rebaselined, Gate Repair-0) |
| 4 · Procedural generation | Procedural build v1 | `…stage17c-procedural-v1` | `test:procedural` | ✅ |
| | Instancing | `…stage17c2-instancing` | `test:instancing` | ✅ |
| | Prefab generator | `…stage19-prefab-generator` | `test:prefabgen` | ✅ |
| | Generator library | `…stage18-generator-library` | `test:genlib` | ✅ |
| | Connectors (roads/plazas) | `…stage18b-connectors` | `test:connectors` | ✅ |
| | Settlement standard | `…stage18c-settlement-standard` | `test:settlement-layout` | ✅ |
| | Budget HUD | `…stage20a-budget-hud` | `test:budget` | ✅ |
| 5 · Glacial environment & wildlife | Glacial valley (visual-0) | `…visual0-glacial-valley` | `test:terrain-profile` `test:terrain-source` `test:visual0` | ✅ |
| | Glacial water & atmosphere (visual-1) | `…visual1-glacial-water` | `test:water` `test:atmosphere` `test:visual1` | ✅ |
| | Ambient wildlife (wildlife-0) | `…wildlife0-ambient` | `test:wildlife` `test:wildlife0` | ✅ |
| | Aloft flocks (wildlife-1) | `…wildlife1-flocks` | `test:flock` `test:wildlife1` | ✅ |
| | Shared RegionStreamer (wildlife-2) | `…wildlife2-streamer` | `test:streamer` | ✅ |
| | Firefly motes (ambient-0) | `…ambient0-motes` | `test:ambient` `test:ambient0` | ✅ |
| 6 · Arsenal (procedural weapons) | Arsenal Lab v1 | `…arsenal-lab-v1` | `test:arsenal` (+proof) | ✅ |
| | Arsenal v2 (world placement) | `…arsenal-lab-v2` | `test:arsenal-world` (+proof) | ✅ |
| | Arsenal v3 (place + equip) | `…arsenal-v3-equip` | `test:arsenal-placement` `test:arsenal-v3` | ✅ |
| | Arsenal v4 (oriented slots) | `…arsenal-v4-slots` | `test:arsenal-equip-slots` `test:arsenal-v4` | ✅ |
| | Arsenal v5 (relic identity) | `…arsenal-v5` | `test:arsenal-identity` | ✅ |
| | Arsenal v6 (multi-carry + holster/draw) | `…slice0-frozen-cache` | `test:arsenal-carry` `test:arsenal-v6` | ✅ |
| 7 · First Playable gate 🏁 | FP-0 gate doc | `…first-playable-doc-v0.1` | doc | ✅ |
| | FP-1 relic objective | `…first-objective-fp1` | `test:first-objective` (+proof) | ✅ |
| | FP-2 integrated proof | `…first-playable-proof-fp2` | `test:first-playable-proof` | ✅ |
| | FP-3 hidden-issue sweep | `…first-playable-hidden-fp3` | `test:first-playable-hidden` (+proof) | ✅ |
| | **FP-4 go/no-go + tag** | **`…first-playable-v0`** | full gate sweep + review | ✅ **MILESTONE: GAME IS PLAYABLE** |
| 8 · Authored play slices | Slice-0 — The Frozen Cache | `…slice0-frozen-cache` | `test:frozen-cache` `test:frozen-cache-proof` | ✅ |
| | Slice-0A — Human-UX Hardening | `…slice0a-human-ux` | `test:slice0a` | ✅ (ADR-040; reversible) |
| 9 · Editor as the product surface | Editor UX-1 — First Usable Authoring Surface | `…editor-ux1` | `test:editor-ux1-unit` `test:editor-ux1` | ✅ (ADR-041) |
| 10 · Performance & scale | Performance Contract-1 — Performance as a Tested Gate | `…performance-contract-1` | `test:performance-contract` `test:performance-contract-proof` | ✅ (ADR-042) |
| 10 · Performance & scale | Procedural Authoring-1 — Editable Spline / Mask / Modifier | `…procedural-authoring-1` | `test:authoring-procedural` `test:authoring-procedural-proof` | ✅ (ADR-043) |
| 11 · Identity & assets | Asset Pipeline-1 — Validated GLB Budget Gate | `…asset-pipeline-1` | `test:asset-pipeline` `test:asset-pipeline-proof` | ✅ (ADR-044) |
| 12 · Combat & encounters | Combat-0 — Validated Hitscan Strike Seam | `…combat-0` | `test:combat` `test:combat-proof` | ✅ (ADR-045) |
| 12 · Combat & encounters | Enemy-0 — Reactive Combat Target | `…enemy-0` | `test:enemy` `test:enemy-proof` | ✅ (ADR-046) |
| 12 · Combat & encounters | **Encounter Editor-0 — Author One Combat Beat** | **`…encounter-editor-0`** | `test:encounter-editor` `test:encounter-editor-proof` | ✅ **LATEST** (ADR-047) |

(All tags are prefixed `world-builder-`. ADR-NNN entries below give the full decision record per stage.)

**Roadmap ahead (product doctrine in ADR-039 — "Focused Procedural World Editor, not Unreal-in-a-tab"; each
builds ON `…first-playable-v0` + `…slice0-frozen-cache`, does not reopen the gate):**
Slice-0A (human UX hardening) → Editor UX-1 → Performance Contract-1 → Procedural Authoring-1 →
Asset Pipeline-1 → Combat-0 → Enemy-0 → Encounter Editor-0 → Geometry Stream Gate-0 →
Visual Benchmark-1 → WebGPU Feasibility Gate-0 → Environment Polish-1 → Encounter-1 → **(await operator pick)**.

**How to refresh this ledger (reusable prompt — paste verbatim after any accepted stage):**

```text
Update the Build Status Ledger at the top of docs/PROJECT_CHARTER.md to reflect current reality. Do this:
1. List every local tag chronologically: `git tag --sort=creatordate`. Each tag is a shipped stage —
   add any new tag as a row in the correct phase (tag, stage name, primary gate, status).
2. Establish CURRENT test health honestly — do not trust "passed at tag time":
   a. Run every non-browser gate once (the test:* / qa:* scripts that don't invoke a browser proof) and
      record pass/fail.
   b. For EACH failure, re-run it IN ISOLATION. If it passes alone but failed in the sweep, mark the stage
      "✅ (sweep-fragile)" and note it as test-isolation debt (not a code defect). If it fails alone too,
      it is a REAL regression — mark the stage ⚠️, and run it at HEAD~1 to state whether it is pre-existing
      or introduced by the latest stage.
   c. Run `npm run build`, `npm run qa:skills`, `npm run qa:layout` and record the summaries.
3. Rewrite the "Health snapshot" block: stage count, latest stage + commit, milestone reached, the
   build/qa numbers, the Node-sweep pass ratio, and an explicit bullet for EACH known-failing or fragile
   gate (what it asserts, pre-existing vs new, severity, suggested fix). Never silently claim "all green."
4. Update the snapshot date to today's date.
5. Keep the table compact (one row per stage/sub-stage group). Do NOT delete ADR entries; the ledger
   summarizes, the ADRs are the detail. Commit the charter edit locally (no push); do not bundle unrelated
   code changes into that commit.
```

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

## ADR-014C — Terrain Material v2 (Stage 14C)

**Decision.** Upgrade the terrain's visual material in place, keeping the existing
mesh, the baked vertex colors as the base signal, and — critically — the existing
`MeshStandardMaterial`. The upgrade is a `material.onBeforeCompile` pass, NOT a
`ShaderMaterial` swap, so Three.js still auto-injects the fog, shadow, and PBR
lighting chunks. The injection only edits `diffuseColor` *before* lighting runs,
so 13A lighting edits, scene fog, and shadow receipt keep working untouched.

**What it injects.** A world-position varying (`vTerrainWPos`) + world-space normal
varying (`vTerrainNrm`); then in the fragment, after `<color_fragment>` (where
vertex colors are already folded into `diffuseColor`): (1) low-frequency **macro
color noise** (centered at 0 so average brightness is preserved), (2) extra **rock
tint on steep slopes** (reinforces the baked rock band), (3) a gentle **height
value shift**, and (4) a **near detail** break-up that **fades out with camera
distance** so the far field can't shimmer (procedural noise has no mipmaps; full
far-tile/mipmap work is a later terrain-streaming stage, deliberately out of 14C).

**Why onBeforeCompile over a ShaderMaterial.** A ShaderMaterial swap would force us
to re-implement fog, shadow mapping, and the PBR lighting model by hand and would
drop 13A reactivity. Editing the standard material's `diffuseColor` keeps all of
that for free. The cost is the documented onBeforeCompile risks, which are
mitigated explicitly: injected source is byte-identical every compile and gets its
own `customProgramCacheKey` (so the renderer can recompile freely on fog-toggle
without a feedback loop and never collides with a vanilla standard material); the
upgrade uniforms are **shared by reference** into `shader.uniforms`, so live editor
edits mutate `.value` with **no recompile** (`syncMaterial` never touches
`needsUpdate`/defines — proven by a `material.version` invariant in the Node
regression). The world normal uses `mat3(modelMatrix)` (the terrain is static +
unscaled) NOT `normalMatrix` (which is view-space and would make slope
camera-dependent); the slope `normalize` is zero-guarded; macro frequency is capped
so the far field stays alias-free.

**Round-trip + untrusted data.** Settings live in a nested `terrain.material` block
(`macroIntensity`, `macroScale`, `slopeRock`, `heightTint`, `detailIntensity`).
`sanitizeTerrainMaterial` clamps every field (0..1 intensities; `macroScale` to
`[1e-4, 0.2]`) and falls back to defaults on any non-finite/garbage/null input, so
a hostile worldpack/mod can neither push an unclamped value to the GPU nor throw on
load. The block round-trips through WorldValidation → worldpack → mod, read back
from the live `Terrain` instance on export. Editor "Terrain material" controls tune
it live; `window.__TERRAIN_DEBUG__` (DEV-only) drives `npm run test:terrain`, a
SwiftShader proof that the injected GLSL actually compiles and renders with fog/
shadow/vertex-colors intact and zero console errors (the GPU compile is the part
Node can't exercise).

**Review.** Dedicated adversarial shader review (the user flagged onBeforeCompile
fog/light/shadow regression risk) + a security pass on the untrusted boundary: both
0 CRITICAL / 0 HIGH. The one shader MEDIUM ("use normalMatrix") was a wrong premise
(view vs world space) and is rejected with a guarding comment; the one security
MEDIUM (inherited-property read) is unreachable from the JSON boundary and already
neutralized by total clamping. **Stage 14 (Vegetation v2 + Terrain Material v2) is
complete.** Reverse-Z / voxels / procedural builds remain Stages 15-17;
combat/Skybreak stays blocked.

## ADR-QA — Three.js skill-gate adoption

The `.claude/threejs_skills/` skill-adoption harness is wired into the project
(`qa:skills`/`qa:browser`/`qa`). `qa:skills` is a static source gate that maps the
skill-pack's required evidence to the live engine (32/0/0). Stage completion now
requires `qa:skills` + build + browser evidence. The engine is the source of
truth — gate patterns adapt to it, never the reverse. See `THREEJS_SKILL_ADOPTION.md`.

## ADR-016 — Voxel Debug Lab (Stage 16)

**Decision.** Add an editor/debug-only voxelization + ray-traversal inspection tool
under `src/voxels/`, as a proof/inspection surface before any later procedural or
destruction work. It is explicitly NOT a voxel renderer, destructible-terrain
system, or procedural-cave system — those stay later. CPU voxelization + a single
instanced debug mesh; no GPU compute, no SVO, no 3D textures.

**Shape.** `VoxelTypes` (hard caps + `createVoxelConfig`), `VoxelGrid` (bounded
uniform-cell occupancy grid: `Uint8` occupancy + optional `Uint16` ids, fixed
z/y/x iteration), `Voxelizer` (combined world AABB → grid → per-triangle clamped
cell-AABB → triangle-box SAT), `VoxelRaycast` (Amanatides–Woo DDA), `VoxelDebugMesh`
(ONE `InstancedMesh` of unit cubes), `VoxelDebugPanel` (editor panel + controller,
owns a transient debug mesh added directly to the scene, never via the
WorldObjectManager → never serialized or exported).

**Bounds (the core value of the stage).** Every input is capped: resolution clamped
to ≤64 (so ≤64³ = 262144 cells, 256 KB occupancy), selection ≤32 objects, ≤1.5M
source triangles, and a global ≤8M triangle×cell SAT-test budget that aborts both
loops via a labeled break — so a pathological or hostile mesh (huge triangle,
millions of triangles) can never spin an unbounded loop or allocation. Non-finite
geometry (NaN/Infinity vertex coords) is rejected at the boundary (no grid, clean
stats), verified empirically. Occupancy is one capped instanced draw call, never a
Mesh per voxel.

**Determinism + traversal.** Voxelization is deterministic (objects in selection
order, meshes in traversal order, triangles in index order, cells z/y/x,
first-writer-wins ids; no RNG/clock) — asserted byte-identical in the Node
regression. The A–W ray traversal handles every awkward case explicitly: AABB-slab
entry, rays that miss, rays parallel to an axis (zero direction components → no
divide-by-zero), negative directions, rays starting inside the grid, and bounds
exit; the hit reports voxel coord, face/normal (= −sign(dir) on the entry axis),
distance, and source id.

**Runtime inertness.** The lab is imported only by `WorldEditor`, which is
dynamically imported only in non-runtime mode, so the voxel code lands solely in the
lazy editor chunk and is absent from the runtime (index) bundle — verified, and the
browser proof confirms `__WORLD_EDITOR__` (and thus the lab) is undefined under
`?runtime=1`. It is cleared on world reload so it never references torn-down meshes.

**Evidence.** `npm run test:voxel` (SwiftShader) voxelizes a selected mesh (1
instanced draw call, deterministic, stable ray first-hit, clean teardown, zero
console errors) and confirms runtime inertness; the Node regression covers
voxelization determinism/caps + every ray edge case + the non-finite guard. Stage 17
(Procedural Build System v1) can build on this for occupancy/placement validation.
Combat/Skybreak stays blocked.

**Formal review (before load-bearing for 17C).** A 3-dimension adversarial review
(correctness / security-untrusted-bounds / SAT+Amanatides–Woo math), each finding
independently verified in a fresh context: **0 critical / 0 high / 0 medium —
load-bearing-ready.** Correctness + math dimensions APPROVE with zero findings; the
security dimension found only defense-in-depth nits at API boundaries (none a hang/
DoS — the budget/step caps hold; none UI-reachable). All four were hardened anyway,
since 17C points these APIs at procedural geometry: (1) `raycastVoxels` rejects a
non-finite direction up front; (2) the Voxelizer skips a non-finite (possibly
pre-cached) per-mesh bounding box; (3) `triCount` is floored so a non-multiple-of-3
buffer can't attempt an OOB read; (4) `VoxelGrid` fails fast on non-finite bounds.
Regression assertions added for each.

## ADR-015 — Reverse-Z depth gate (Stage 15)

**Decision.** Request a reversed-Z depth buffer for the main renderer (default on),
to spread floating-point depth precision evenly across the view distance instead of
crowding it near the camera — making far outdoor geometry safe from z-fighting
before voxel/procedural systems push scale. Renderer-capability/precision stage
only: no terrain/voxel/world-scale change.

**Version-correct API (the load-bearing detail).** The project pins Three.js
**r0.169**, where the option is the WebGLRenderer **constructor parameter
`reverseDepthBuffer`** (singular "reverse") — NOT the `reversedDepthBuffer` property
that landed in a later release (it does not exist in r169). `createRenderer` passes
`reverseDepthBuffer` at construction (the only moment it can take effect). Three
gates it internally on `extensions.has('EXT_clip_control')`, so on a GPU/driver
without the extension the renderer transparently uses normal depth and
`capabilities.reverseDepthBuffer` reports `false` — that IS the fallback, owned by
Three, never assumed. Three also handles the reverse-Z depth clear (0 not 1), depth
func (GREATER), the `USE_REVERSEDEPTHBUF` shader define, and shadow handling.

**Why custom ShaderMaterials need nothing special.** Verified against the r169
source: reverse-Z is implemented purely by uploading a reversed `projectionMatrix`
uniform — there is NO `reversedepthbuf` GLSL chunk. The grass `GrassMaterial`
(`gl_Position = projectionMatrix * mv`) and the `ParticleRuntime` point shader both
multiply by the auto-injected `projectionMatrix`, so they receive correct reversed
depth automatically. (A ShaderMaterial that reconstructed clip-space *bypassing*
`projectionMatrix` would silently miss reverse-Z — neither of ours does.)
`logarithmicDepthBuffer` is left off (the two are mutually exclusive); shadow maps,
depth-tested particles, and CPU-side raycast/selection are all untouched.

**Status reporting + fallback.** `getReverseDepthStatus(renderer)` reports
`{ requested, extensionAvailable, active, mode }`, with `active` taken from Three's
resolved `capabilities.reverseDepthBuffer` (the authority). The debug HUD shows the
mode (green = reverse-z active, amber = requested-but-unsupported, grey = off);
`window.__RENDER_DEBUG__` (DEV-only) drives the proof. `summarizeReverseDepth` is a
pure helper, Node-unit-tested for the three-state logic.

**Evidence.** `npm run test:reversez` (SwiftShader) renders a near-over-far quad
scene through BOTH a `reverseDepthBuffer:true` renderer and a forced-off renderer:
the front quad occludes the back with zero z-fight in both paths, and the gate
invariant `capabilities.reverseDepthBuffer === EXT_clip_control present` holds.
SwiftShader exposes `EXT_clip_control`, so the proof exercises the **active**
reverse-Z path (not merely the fallback). The runtime boots in `reverse-z` mode with
terrain/grass/bushes rendering and zero console errors, and the **entire prior proof
suite (terrain/bush/vegetation/lighting/particles/interaction/undo/animation) stays
green under the now-active reverse-Z renderer** — direct evidence of no shadow,
particle, raycast, or editor/runtime regression. Reviewed (renderer correctness):
0 CRITICAL / 0 HIGH; the one MEDIUM (a `renderer.userData` naming-collision risk)
was fixed by using a distinct `_reverseDepthRequested` prop.

**Deferred.** Far-tile/mipmap terrain work, a runtime depth-precision visualization,
and any per-material reverse-Z handling remain out of scope. Next: Stage 16 (Voxel
Debug Lab), Stage 17 (Procedural Build System v1). Combat/Skybreak stays blocked.

## ADR-017A — Visibility + Streaming Kernel (Stage 17A)

**Decision.** Add a reusable engine service under `src/visibility/` that classifies
registered agents into tiers — **visible / warm / sleeping / unloaded** — each frame
using a guard-banded camera frustum + distance, with time hysteresis, so the engine
can skip per-frame work for far/off-screen objects before procedural/voxel systems
push object counts. This is "guard-banded frustum culling + streaming + LOD
hysteresis," NOT "delete everything outside the camera."

**The load-bearing invariant: the kernel NEVER hides a mesh.** It never sets
`object3D.visible = false`, never removes from the scene, and never disposes based on
visibility. Three.js already frustum-culls draw calls, so an in-frustum object is
always rendered the same frame; the kernel only gates expensive **per-frame
UPDATES**. That is precisely what keeps it **shadow-safe** (off-screen shadow casters
still render into shadow maps), **light-safe**, and **pop-free** (nothing has to
"appear" on a fast turn — it was never removed). Promotion to awake is immediate;
hysteresis (`minKeepSeconds`) is demotion-only, so a quick turn-back never thrashes,
and a `nearRadius` floor keeps close objects warm regardless of facing so a fast 180°
never reveals a cold nearby object.

**Bands + config.** `visibility` block (round-tripped through validation/worldpack):
`guardBand` (1.2 → +20% frustum margin for warm), `unloadBand` (1.6, forced ≥
guardBand), `nearRadius` (28, anti-pop floor), `minKeepSeconds` (1.0, hysteresis),
`maxWakesPerFrame` (reserved for future build-cost adapters — not enforced yet,
since the only current adapter wakes in O(1)). The guard-band "expansion" is done by
inflating the test sphere radius by `dist*(band-1)` — exactly equivalent to pushing
the frustum planes outward (verified against r169 `Frustum.intersectsSphere`) and
needs no extra matrices. `GuardBandFrustum` derives the view matrix from
`camera.matrixWorld.invert()` directly (the renderer's cached `matrixWorldInverse` is
stale when the kernel runs before render, and absent headless).

**First adapter: animation.** `AnimationRuntime.update(dt, isAwake?)` skips asleep
mixers — their time freezes and resumes seamlessly on wake (a looping clip continues
without stutter; the mesh is never hidden, so no pop, no shadow loss). The kernel
gates ONLY animation; **interaction, collision, and physics run unconditionally** —
off-camera gameplay is never disabled. Runtime-only (the editor shows everything;
`visibilityKernel` is null in editor mode). `__VISIBILITY_DEBUG__` (DEV-only) + a HUD
overlay report tier counts.

**Evidence.** `npm run test:visibility` (SwiftShader) authors a world with a NEAR and
a FAR animated rig and proves end-to-end that the far rig's mixer sleeps (time frozen
at 0) while the near rig animates, with NO mesh hidden and zero console errors. Node
regression covers config caps + round-trip, tier classification (incl. the nearRadius
floor), the demotion-only hysteresis, the no-hide invariant, and the animation
freeze/resume. Reviewed (0 CRITICAL / 0 HIGH); the no-hide invariant was verified
against every changed file.

**Deferred (same kernel, more adapters).** Particle emitters (cull by
EMITTER BOUNDS, not origin), placed lights (keep off-screen lights that affect
visible terrain), procedural/voxel streaming agents (where `maxWakesPerFrame` becomes
load-bearing), and an opt-in render-hide tier for non-shadow-casting decorative
props. Grass/bush/tree already implement their own patch-level culling/LOD/streaming
and are intentionally left as-is (not rewritten).

## ADR-017B — City Generator Intake Audit (Stage 17B)

**Decision.** An external drop, `threejs-runtime-city-generator/` (untracked, never
integrated), was classified by a read-only audit (no execution/install) across four
dimensions — license/provenance, security/quarantine, determinism/bounds, and
architecture/data-emission. Verdict: **candidate-seed for Stage 17C — import NOTHING
as-is.**

**Safety/provenance: GREEN.** Self-authored (same author as this engine), no bundled
assets, MIT-only deps (`three` 0.169 + Vite), no `eval`/`new Function`/`fetch`/
WebSocket/Worker/dynamic-import, no network. Generation is fully seeded (mulberry32 +
FNV-1a), deterministic (`computeLayoutSignature`), and hard-capped (maxBuildings 520,
maxProps 360 enforced at the push site; density clamped). Only runtime authority is
user-initiated `localStorage` of self-generated JSON. Gap: no LICENSE/SPDX field
(`private:true`) — formalize before lifting any code.

**Architecture: RED (the decisive dimension).** It is a **hidden custom runtime scene
graph**: `CityGenerator` produces clean per-object descriptors, but `CityChunk`/
`CitySystem` bake them into opaque `InstancedMesh` batches fed straight to the scene,
bypassing `WorldObjectManager` (independently confirmed: zero host-placement refs in
its `src/`). This violates the engine boundary **generator output → WorldDocument
objects → normal runtime systems**. As baked, Stage 17A visibility and Stage 16
voxel/bounds validation cannot introspect city objects (only chunk-level bounding
spheres exist).

**Why "seed" not "discard."** The violation is a *missing emitter bridge*, not an
intrinsic flaw: `generateCityLayout()` already returns per-object descriptors
(`{id,type,x,z,w,d,h,yaw}`, deterministic, capped) *before* the bake. Reusable core =
`CityGenerator.js` + `CityConfig.js` + `utils/random.js` + the descriptor schema.
Discard-and-replace = `CityChunk.js` + `CitySystem.js` (the baker + hidden
scene-graph/visibility/LOD owner).

**Gate to Stage 17C (all must pass before any city code enters a build path).**
1) License formalized (license:MIT / ownership recorded). 2) A new
`layoutToWorldObjects()` emitter consumes the descriptors (NOT the baked meshes) and
routes through `WorldObjectManager.addWorldObject`; the generator holds zero
runtime/scene authority. 3) Emitted objects carry full host metadata (assetRef/
prefabRef, collider, exclusion.grass/trees, animation/interaction/particles/runtime)
with a zone-type→asset map. 4) Determinism proven in-host (seed+style → byte-stable
WorldDocument). 5) Count caps re-asserted host-side. 6) Stage 16 voxel/bounds
validation passes on converted objects. 7) Stage 17A registers their world bounds and
culls them. 8) `qa:skills` stays 32/0/0 + a SwiftShader browser proof. Until then the
drop stays quarantined as reference/seed material only — no production bundle
inclusion, no copied assets, no runtime authority.

**v0.2.1 reconciliation.** The audited working-tree copy is the fixed v0.2.1: two
operator fixes are confirmed present — explicit per-surface shadow flags in
`CityChunk._addMesh(...,{castShadow,receiveShadow})` and the per-frame
draw-estimation allocation removed (`CitySystem.update` uses `chunk.visibleDrawCount`,
no `meshes.filter`). Neither changes the verdict: the per-frame-allocation concern is
resolved AND moot (CitySystem is in the discard-and-replace set), and the architecture
finding (hidden scene graph → needs an emitter bridge) is unchanged. The shadow
semantics ARE a useful input for the 17C emitter: emitted buildings/props cast
shadows, roads/sidewalks/runways are receive-only, zone overlays neither — the
`layoutToWorldObjects()` bridge should set per-object `castShadow`/`receiveShadow`
accordingly. Runtime FPS confidence stays MEDIUM until a local (non-sandbox) GPU/
browser smoke; build/static/determinism confidence is HIGH.

## ADR-017C — Procedural Build System v1 (Stage 17C)

**Decision.** Add a procedural generator framework under `src/generators/` whose
output is NORMAL `WorldDocument` objects, placed through the existing
`WorldObjectManager` — never a hidden custom scene graph. This satisfies the Stage
17B boundary: **generator output → WorldDocument objects → existing runtime
systems**. The city is the first generator *type*, not a separate runtime.

**Shape.** `GeneratorConfig` (type registry + `createCityConfig`/
`createGeneratorInstance` + `stringToSeed`, all clamped). `CityLayout`
(`generateCityLayout` — pure, seeded `mulberry32`, deterministic; blocks → streets +
building lots + parks/trees; per-category hard caps enforced at the push site).
`cityEmitter` (`cityLayoutToWorldObjects` — maps each layout item to a host primitive
descriptor: kind/transform-scaled-to-footprint, terrain-snapped Y via `getHeight`,
collider, grass/tree exclusion, shadow flags, color, and a `generatorId`;
`MAX_TOTAL_OBJECTS` ceiling). The generator holds **zero scene authority** — it
returns data.

**Editor workflow.** A "Procedural (city)" SYSTEM panel (like Grass/Terrain — applies
directly, not undo-tracked): **Generate**/**Regenerate** emit objects via
`addWorldObjects` tagged with the instance `generatorId`; **Clear** removes that
instance's objects; **Lock** clears the tags so the objects become permanent,
hand-editable, normal objects. The `generators` block (authoring config) round-trips
through validation/worldpack; the emitted objects round-trip via `objects` (carrying
`color`/`generatorId`/shadow flags).

**Additive host extensions (backward-compatible).** `createPrimitiveMesh(kind,
color?)` per-object tint (default unchanged); `serializeWorldObject` now emits
`color`/`generatorId` and the REAL mesh shadow flags (existing objects keep
`true/true`); `_buildPlacedFromDescriptor` applies `runtime.castShadow/receiveShadow`
+ `generatorId`; `addWorldObjects`/`removeWorldObjects` bulk ops fire ONE change
notification for the whole batch (one grass/tree rebuild, not N). `WorldValidation`
clamps the new fields (color to `#rrggbb` or null; `generatorId` allowlisted; generator
instances capped at 16). Per-object color/shadow are general engine features, not
city-specific.

**Cost note.** Each generated object is a real `WorldObject` (its own draw call) — the
price of the boundary vs the discarded InstancedMesh baker. Bounded by the caps;
default cities are towns (tens–low-hundreds of objects). Instanced rendering of
WorldObjects is a later optimization, not v1.

**Review.** Adversarial review (boundary/correctness + security/untrusted, each
finding fresh-context-verified): **0 confirmed findings, load-bearing-ready.** Two LOW
candidates were refuted with code-path evidence (the building-cap break is harmless;
the untrusted load paths bypass `addWorldObjects`). A forward-looking caveat — a
*future* `addWorldObjects` caller wouldn't be guarded by the parse-time
`MAX_PLACED_OBJECTS` cap — was closed by adding an internal live-object ceiling to
`addWorldObjects`. `npm run test:procedural` (editor deterministic generate → real
WorldObjects, streets receive-only, lock persists; runtime renders the city in real
WebGL, zero console errors) + Node regression (determinism/caps/round-trip/
sanitization) + the full 12-proof sweep + qa:skills 32/0/0 all green.

**Deferred (17C-2+).** More generator types; richer asset/material mapping (real
building/road meshes vs primitives); instanced rendering of generated WorldObjects;
generator-driven exclusion-aware placement validation via the Stage 16 voxel tools;
a multi-instance generator UI. The city generator drop stays the reference seed; no
file from it was imported (this generator is host-authored from scratch). Runtime FPS
on a large city stays MEDIUM-confidence until a local GPU smoke.

## ADR-017C-2 — Procedural rendering optimization + placement validation (Stage 17C-2)

**Decision.** Reduce generated-city draw cost WITHOUT touching editor identity, and
add overlap/placement validation. Two new services under `src/generators/`:
`InstancedWorldObjectRenderer` and `PlacementValidator`.

**The load-bearing constraint: a render VIEW over WorldObjects, never a replacement.**
`InstancedWorldObjectRenderer` runs in the RUNTIME ONLY (`runtimeMode` gate). After
load it groups eligible static primitive objects by render class (primitive kind +
cast/receive shadow flags; color is per-instance via `setColorAt`), builds ONE
`InstancedMesh` per class, and hides each source child mesh (`mesh.visible=false`).
The `WorldObject` Groups stay in the manager — selectable, serializable, collidable,
lockable, regenerable. **The editor never instances**, so editor identity is wholly
untouched; the runtime just renders the same data more cheaply. `createPrimitiveGeometry(kind)`
was extracted from `PlacedObject` so the batch uses the SAME base geometry as the
per-object mesh; the Group transform (footprint scale) becomes the instance matrix
(`mesh.matrixWorld`). Eligibility excludes animated / interactive / particle objects
(they need their live mesh). Shadows are preserved: the batch carries the class shadow
flags, the hidden source no longer draws, and the instance casts/receives in its
place (streets receive-only, buildings cast). `clear()` restores every hidden source +
disposes the batches; `rebuild()` is idempotent.

**Known tradeoff (documented):** one batch per class collapses per-object frustum
culling to batch-level (the whole batch draws when any of it is on screen) — the
accepted instancing tradeoff (one draw of N beats N culled draws); per-region batch
partitioning is a later refinement.

**`PlacementValidator`** detects overlaps + invalid placements using a Stage-16
bounded `VoxelGrid` as a broad-phase spatial hash + AABB (Box3) narrow phase. Only
SOLID objects (`collider != none`) are overlap-checked, so the street grid's
intentional intersections aren't false positives; non-finite/empty bounds are
reported as invalid (and filtered before the grid is built). Surfaced as a "Validate"
button in the Procedural panel.

**Identity is preserved everywhere.** Lock/regenerate/clear/select/serialize all
operate on the individual `WorldObject`s (proven in the editor). Instancing is purely
a runtime render layer; if it ever prevented selecting/locking/serializing a generated
object it would be the wrong abstraction — it does not, because the editor never
instances and the runtime keeps the objects in the manager.

**Review.** Adversarial review (render-correctness/identity + system-interactions/
validator, each finding fresh-context-verified): **0 confirmed findings,
load-bearing-ready.** Both dimensions APPROVE with file:line evidence (render
equivalence incl. the r169 white×instanceColor shader path; shadow correctness;
kernel/instancer populations disjoint; collision/interaction unaffected by hiding;
reverse-Z automatic; validator pre-filters NaN bounds). The one verified-low item (the
culling tradeoff) was closed with a clarifying comment. `npm run test:instancing`
(editor = individual selectable objects, no instancing; runtime = a city batched into
a few instanced draws, identity preserved, zero console errors) + Node regression
(grouping/shadow/identity/reversibility + validator overlap detection) + the full
13-proof sweep + qa:skills 32/0/0 all green.

**Deferred (17C-3+).** Per-region batch partitioning (restore per-region culling);
an optional editor "instanced preview" mode (with selection-disabled caveat);
instancing of non-generated repeated objects; validation surfaced at generate time
(auto-warn). Large-city FPS stays MEDIUM-confidence until a local GPU smoke.

## ADR-019 — Asset/Prefab Generator Integration v1 (Stage 19)

**Decision.** Let procedural generators emit PREFAB-backed content (not only
primitive boxes), so every later generator can place proper prefabs/assets — while
keeping the boundary (generator output → WorldDocument objects → existing systems)
and editor identity. The generator output MODEL is upgraded before the generator
LIBRARY is multiplied (Stage 18).

**Shape.** `createCityConfig` gains `buildingPrefab` / `propPrefab` (a prefab id, or
null = primitive — the default + fallback), sanitized by `sanitizePrefabRef` (allow-
list, 64-cap). The emitter `cityLayoutToWorldObjects(layout, generatorId,
{ buildingPrefab, propPrefab })` takes RESOLVED prefab definitions: for a category
with a prefab it expands it via the existing pure `worldObjectsFromPrefab(prefab,
{ position: terrain-snapped, yaw, scale: prefabFitScale })`, tags each child with the
`generatorId`, and pushes ATOMICALLY (never a partial prefab past `MAX_TOTAL_OBJECTS`);
otherwise it emits a primitive. The editor `ProceduralPanel` adds Building/Props
dropdowns (Primitive + the prefab library's list), resolves the id via
`getPrefab(id)` at generate time (missing → null → primitive fallback), and stores
the ids in the generator instance (round-tripped).

**Why it needed almost no new plumbing.** A prefab-expanded object is just a normal
`WorldObject` carrying `prefabRef` + per-part `assetRef` + `generatorId`. So:
selection / lock / regenerate / clear / serialize all work UNCHANGED (they operate on
`objectsByGeneratorId` over the full N-part expansion); **asset-dependency collection
is automatic** (`collectUsedAssetRefs` already scans `document.objects`' external
assetRefs — a prefab wrapping a GLB is collected with no new code); and Stage 17C-2
instancing still batches the expanded PRIMITIVE parts (a gltf-backed part is
non-primitive → individual). Builtin prefabs (hut, tree-cluster) are primitive-based,
so the city looks like a city out of the box; an asset-backed prefab brings real
asset deps along for the build.

**Safety.** `sanitizePrefabRef`'s output is ONLY ever a `Map.get` key into the prefab
library — never a path/URL/eval/`obj[key]` sink — so allowlist residue (`..`,
`__proto__`) is inert (Map.get is prototype-isolated; a missing key → null →
primitive). The runtime never re-resolves generator refs (it loads already-expanded
`document.objects`). Expansion is hard-capped (atomic prefab skip + the per-category
caps + the `addWorldObjects` live-object ceiling).

**Review.** Two independent reviewers (boundary/correctness + security/untrusted):
**0 CRITICAL / 0 HIGH / 0 MEDIUM — APPROVE.** Verified the expanded-set identity
(lock/regenerate over all N parts), the atomic cap, the fallback, the round-trip, the
automatic asset collection, the instancing interplay, and the no-injection prefab-id
path. The only items were LOW documentation nits (the Map-only invariant), closed
with a clarifying comment. `npm run test:prefabgen` (editor: prefab-backed buildings
that are selectable/lockable + missing-prefab fallback; runtime renders, zero console
errors) + Node regression (expansion/generatorId/fallback/asset-dep collection/round-
trip) + the full 14-proof sweep + qa:skills 32/0/0 all green.

**Expected behavior (not a defect).** Asset deps are collected from the EXPANDED
objects, so a worldpack exported with a generator configured but never generated has
no objects (and no deps) to collect — config is authoring intent; objects are content.

**Deferred (Stage 18 now stands on a strong output model).** Generator Library v1
(roads/ruins/camps/forests/plazas, spawn/trigger-aware layouts, prefab-backed props/
buildings); a mix of prefab + primitive per generate; per-category multiple prefab
choices; non-uniform prefab fit to lot footprints.

## ADR-018 — Generator Library v1 (Stage 18)

**Decision.** Multiply the generator catalog beside the original city — adding
**camp / ruin / forest** — now that the Stage 19 output model can emit prefab-backed
content. Each new generator follows the same boundary the city does (generator output
→ WorldDocument objects → existing systems); none owns a Three.js scene graph. The
flagship is the camp: it proves the engine is becoming a *game*-builder, not just
scenery, by emitting DATA-ONLY gameplay objects (a sign, a named spawn point, an
entrance trigger volume, optional pickups) via the Stage-12 interaction schema.

**Shape.** `GeneratorConfig` gains `createCampConfig` / `createRuinConfig` /
`createForestConfig` (each clamps its own fields) and a type-dispatching
`createGeneratorInstance` (a `CONFIG_CREATORS` map; unknown type → city). Per-type
**layout + emitter** live in `CampGenerator.js` / `RuinGenerator.js` /
`ForestGenerator.js` (pure, seeded `mulberry32` only, every loop hard-capped). A new
`GeneratorRegistry` maps each type to `{ styles, amount/source UI metadata,
createConfig, layout, emit }`, and the `ProceduralPanel` is rewritten to be
data-driven off it: a Type dropdown reconfigures the style options, the generic
"amount" dial, and the prefab source slots. Each type owns instance id `gen-<type>`,
so a city and a camp coexist in one world and regenerate/clear independently.

**Reuse over adapters.** The primitive-descriptor builder, terrain-fit prefab scale,
and the capped/atomic emitter buffer were extracted into `emitHelpers.js` and the
city emitter was refactored onto them (behavior-identical — the existing
`test:procedural` / `test:prefabgen` / `test:instancing` proofs are the guard). So all
four generators share one canonical emit path. `WorldValidation` needed **zero
changes**: `sanitizeGenerators` already routes every instance through
`createGeneratorInstance`, which now dispatches config by type — so camp/ruin/forest
instances validate, round-trip, and export in a worldpack for free. The runtime needs
no change either: generated interaction objects and the fire-pit's `spark` particle
emitter are normal `WorldObject` data, so the existing `InteractionRuntime` /
`ParticleRuntime` wire them automatically.

**Safety / bounded.** Every config field is clamped; every layout loop is hard-capped
(incl. the forest rejection sampler, which is also attempt-bounded so it always
terminates); the emitter caps the grand total at `MAX_TOTAL_OBJECTS`; prefab expansion
is atomic (never a partial prefab past the cap). Generated interaction objects are
strictly the declarative Stage-12 schema (no executable keys), and a prefab id is only
ever a `Map.get` key into the library. `getGenerator` uses an `Object.hasOwn` check so
a prototype key (e.g. `constructor`) can never resolve to a non-generator.

**Review.** Adversarial workflow (4 dimensions → fresh-context verify-each-finding):
**0 CRITICAL / 0 HIGH.** Three confirmed LOW/INFO + one uncertain were all fixed:
a forest rock cap promoted to a named `GENERATOR_LIMITS.MAX_ROCKS`; a dead return
dropped from the shared emitter; the `MAX_INTERACTIONS` comment corrected (it caps
pickups — sign/spawn/trigger are singletons); the panel's id-then-type restore
fallback restored (so an externally-authored instance still rehydrates); and the
truthy registry lookups hardened to `Object.hasOwn`. `npm run test:genlib` (camp emits
sign/spawn/trigger/pickup + spark particles + prefab tents; ruin+camp coexist; forest
deterministic prefab+primitive; runtime renders + wires interaction with zero console
errors) + Node regression + the full 15-proof sweep + qa:skills 32/0/0 all green.

**Untracked drop unchanged.** `threejs-runtime-city-generator/` remains reference-only
(Stage 17B audit); nothing was imported from it. The local-GPU FPS validation is still
owed as a non-blocking side report.

## ADR-018B — Roads + Plazas + Layout Connectors (Stage 18B)

**Decision.** Add the connective tissue that turns isolated generator islands into a
navigable authored world. Three new generators — **road** (path network), **plaza**
(paved hub with sign/spawn/trigger anchors), **connector** (a deterministic path
between two clusters) — plus **landmark anchor helpers**. To make connection
meaningful, the panel gains an **origin** so cluster generators can be placed apart
(previously everything stamped at the world origin and overlapped).

**Shape.** `GeneratorConfig` adds `createRoadConfig` / `createPlazaConfig` /
`createConnectorConfig` and dispatches them by type. The connector config carries the
resolved anchor points `from`/`to` plus the source instance ids `fromId`/`toId`
(allowlisted); `clampPoint` bounds the points. `roadHelpers` (`roadSegment` /
`emitRoadPath`, capped at `MAX_ROAD_SEGMENTS`, rejecting degenerate/NaN segments) is
the canonical path→road-plane builder shared by road + connector. `landmarkAnchors`
resolves a generator instance to its `config.origin` anchor — pure, reading only the
document's generators block. Road width is derived from style (path/avenue/crossroad),
so the whole road config surface is panel-reachable.

**Panel.** Still data-driven off the registry, now with two new concepts: an `origin`
row (shown when `usesOrigin`, hidden for the connector) and a source-slot `kind`. A
`"prefab"` slot lists the prefab library; an `"anchor"` slot lists the other generator
instances and resolves the picked id to a world point under `pointKey`. So the
connector's two slots become From/To dropdowns of the clusters to link. The amount dial
now parses as a float (the connector's amount is `width`), and `usesDensity` hides the
density row where it would be inert. Back-compat property names are preserved, so the
Stage 17C/18/19 proofs are unchanged.

**Why it stayed additive.** A connector is a normal generator whose emitter is pure —
the panel resolves anchor ids to points and the emitter just draws road segments
between them. `WorldValidation` again needed **zero changes** (`sanitizeGenerators`
routes road/plaza/connector through `createGeneratorInstance`), and the runtime needs
none (plaza interaction anchors auto-wire). Determinism holds: the connector seeds its
RNG with `seed+style+from+to`, so a fixed pair of clusters yields a fixed path. Every
loop is hard-capped; `from`/`to`/`fromId`/`toId` are clamped/allowlisted; an anchor id
is only ever an `Array.find(i => i.id === id)` key — never a path/eval/property sink.

**Review.** Adversarial workflow (4 dimensions → fresh-context verify-each): **0
CRITICAL / 0 HIGH.** Three confirmed LOW/INFO, all fixed: dropped the connector's
ignored density dial (config + a `usesDensity:false` UI gate); made road width
style-derived instead of an editor-unreachable knob; removed a no-op plaza
trigger-radius clamp. `npm run test:connectors` (editor places a camp@-20 and a
ruin@40 at distinct origins, the connector From/To dropdowns list them, its path runs
between them at midX=10, plaza emits sign/spawn/trigger, lock detaches; runtime renders
the connected world with zero console errors) + Node regression + the full 16-proof
sweep + qa:skills 32/0/0 all green.

**Generator catalog now:** city, camp, ruin, forest, road, plaza, connector. The
local-GPU FPS validation remains the only outstanding (non-blocking) item.

## Performance Validation Side Report (not a stage)

**Decision.** Before adding more optimization features, measure. Added a DEV-only
`window.__PERF__` runtime hook (`snapshot()` = renderer.info draw/triangles/points +
memory + heap + object/instance/patch counts + UNMASKED WebGL renderer string;
`sample()` = time-budgeted frame timing) and `npm run perf:report` (scripts/
perf-report.mjs), which authors a 6-scene matrix and writes docs/perf-report.json +
docs/PERFORMANCE_REPORT.md.

**Honesty boundary.** The headless harness renders with **SwiftShader (software
rasterizer, no GPU)**. The report records the UNMASKED renderer string proving it, and
splits metrics accordingly: STRUCTURAL metrics (draw calls, triangles, memory,
object/instance/patch counts, heap) are GPU-independent and authoritative; frame-time/
FPS are software-raster CPU signals only, **never a GPU claim**. A "reproduce on real
hardware" section documents how to fill the GPU rows. No public performance claim is
made. **Measured headline:** runtime instancing keeps draw calls flat (293 objects → 3
batches → 83 calls); vegetation dominates triangles (930k); JS heap 14–52 MB.

## ADR-020A — Performance Budget Harness (Stage 20A)

**Decision.** Promote the measured metrics into a **live red/yellow/green budget HUD**
so budget pressure is visible while authoring, not just in an offline report. Pure
classification lives in `src/perf/PerformanceBudget.js` (`PERFORMANCE_BUDGETS` frozen
defaults + `classify` / `evaluateBudget`); the overlay lives in `src/debug/BudgetHUD.js`;
main.js wires it into both frame branches behind `import.meta.env.DEV`.

**What it surfaces (the measured story made unmissable).** Budgets: draw calls
(120/180/240), triangles (500k/900k/1.4M), heap MB (80/140/220), generated objects
(300/600/1000), instanced batches (40/80/120), visible vegetation patches
(120/220/320). On the measured scenes this reads exactly as the report found: a
connected generated world is **green**; a dense-vegetation scene goes **red on
triangles** (the real pressure point) while draw calls stay green; a 293-object stress
city stays green on draw calls + batches because instancing collapses it (293 → 3
batches → ~69–83 calls); animation reports **rig/update pressure separately** from draw
calls (its own row, no draw-call cost). Thresholds are documented as **conservative
defaults, not universal truths** — they are structural (GPU-independent), not an FPS
claim.

**Discipline.** Collection is THROTTLED (4 Hz), reads only already-computed counters
into a REUSED scratch object (no per-frame allocation; the 60 Hz path early-returns
below the throttle), reads renderer.info AFTER render, and renders DOM only when
visible (but still collects while hidden so the `__BUDGET__` test hook works in
runtime). DEV-gated: the production bundle is verified clean of `__BUDGET__` /
`__PERF__` / the HUD (grep). `npm run perf:report` still works.

**Review.** Adversarial workflow — the perf-discipline dimension passed with a single
INFO finding (throttle reset-to-0 → minor sample drift), fixed by subtracting the
interval; the other dimensions were cut short by a session token limit but are covered
by deterministic checks: Node regression (classification boundaries, frozen defaults,
unknown-never-worsens), `test:budget` (HUD visible while authoring, collects while
hidden, per-scene statuses, rig separation), the production dist grep, build, and the
full 16-proof sweep + qa:skills 32/0/0 — all green.

**Next (optimization ladder):** 20B regional instancing/batching (split batches
spatially to recover frustum culling; candidate BatchedMesh for mixed-geometry static
props), 20D fake volumetric lighting + height fog (god-rays/height-fog, bounded +
toggleable), 20C KTX2/DRACO texture pipeline, 20E per-frame allocation audit, then a
WebGPU/TSL research branch only (r169/WebGL stays production).

## ADR-018C — Settlement Planning Standards + Layout QA (Stage 18C)

**Decision.** Before any further generator expansion (more types, WFC), install a
**standard** that judges whether a generated settlement has READABLE STRUCTURE — a
center, a visible landmark, a clear spawn, no overlapping buildings, no paths through
buildings, connected anchors, valid markers — not merely "objects exist". The standard
is `docs/SETTLEMENT_LAYOUT_STANDARD.md`; the doctrine mapping planning skills onto the
engine is `docs/GENERATOR_PLANNING_SKILL_ADOPTION.md`; the enforceable subset is the
`npm run qa:layout` gate; readability at runtime is proven by `npm run
test:settlement-layout`. Sequenced deliberately **before** WFC: WFC without a standard
just produces more structured-looking bad output — first define what "good" means.

**The classification data boundary (`layoutRole`).** Settlement role becomes DATA, not
a display-name guess. A new optional `layoutRole` enum (`building | path | prop |
landmark | marker | vegetation | edge`, default `null`) joins the declarative-metadata
family (`generatorId` / `interaction` / `particles`): emitters stamp it via
`primitiveDescriptor` (`emitHelpers`), `WorldValidation.sanitizeLayoutRole` allow-lists
it (hostile values → `null`), and it round-trips through `WorldObjectManager`
(build → `userData.layoutRole`; `serializeWorldObject` → descriptor). So the gate reads
a field, never a string — durable across renames and new generators.

**The gate reuses canonical paths headless.** `qa:layout` (`scripts/layout-gates.mjs`)
is pure Node: it generates canonical scenes (connected village, standalone camp / plaza
/ city) via `generateGeneratorObjects`, validates them, builds the **real** scene graph
(`new THREE.Scene()` → `WorldObjectManager` → `loadWorldObjects` — THREE geometry/
material construct without a GL context, exactly as the Node regression already proves),
and judges with the **canonical `validatePlacement`** + `THREE.Box3`/segment math — **no
bespoke footprint code**. House style mirrors `qa:skills` (PASS/WARN/FAIL + summary +
exit 1). Wired into the `qa` chain.

**Green-now retrofit (the standard caught real defects).** Per "retrofit city/camp/
plaza against that standard", canonical scenes must pass GREEN — which surfaced and
fixed genuine layout bugs: camp **crates overlapping tents** (now round-robined across
tents and pushed clear of the rotated-AABB footprint), **crate↔crate piling**, and city
**street trees punched through buildings** (now placed in the road-side gutter strip
clear of lots). Two missing focal points were added: a **Plaza Well** landmark at center
(plaza spawn moved to the entrance so you arrive facing it across the square) and a
**Town Monument** landmark snapped to the city's central crossroads (building-free for
any block count). `qa:layout` is green at **43/0**.

**Observability.** DEV-only `window.__LAYOUT_DEBUG__()` (runtime) returns the spawn,
landmark world positions, per-role counts, marker sub-counts, and the instanced-batch
count; `test:settlement-layout` authors a village, spawns at the camp entrance, and
asserts a landmark is near the spawn (readability proxy) + paths/buildings/markers
present + instancing active + zero console errors. Production bundle verified clean of
`__LAYOUT_DEBUG__` / `layout-gates` (grep).

**Hard-gated vs. judgment.** `qa:layout` enforces the *checkable* criteria (overlaps,
landmark/center existence, spawn clearance + line-of-sight, anchor connectivity, marker
validity, caps, round-trip). The *qualitative* criteria (silhouette readability,
foreground/midground composition, copy-paste feel, intentional density) remain author +
visual-proof judgment, documented in the standard — the gate is a floor, not a ceiling.

**Next.** WFC layout generator (now that "good" is defined), then resume the
optimization ladder (20B/20D/20C/20E). r169/WebGL stays production.

## ADR-021 — Procedural Arsenal Lab v1 (separate-entry tool)

**Decision.** Lean into the prototype's proven strength — procedural geometry + hand-
written shaders, zero art assets — with a self-contained tool that emits **infinite
fictional sci-fi weapon silhouettes from math**, not imported models. It is a live
browser **workbench** (randomize a seed, pick a base type, tweak sliders, turntable,
exploded/wireframe/glow, copy the recipe JSON), NOT an inventory/world system. Visual-
only fictional props; no real firearm engineering. Docs: `docs/ARSENAL_LAB.md`.

**Separate Vite entry (true isolation).** Added `vite.config.js` (first one — the app was
single-entry) with two inputs, a new `arsenal.html`, and `src/arsenal/arsenalMain.js`
with its OWN studio scene / lights / camera / loop (NOT the world terrain/grass). Build
emits both `index.html` and an isolated `arsenal-*.js` chunk; the world app is unchanged.
The lab reuses only `createRenderer` + `utils/{random,math}` + the established
`ShaderMaterial`/geometry/dispose patterns.

**Data boundary (grammar → geometry → material → group).** Mirrors the layout→emitter
split: `WeaponGrammar` is PURE `(config) → recipe` (plain JSON, no THREE, deterministic
via `mulberry32` — **no `Math.random`**); `WeaponGeometry` turns the recipe into
`BufferGeometry` parts (headless-safe — geometry builds without a GL context, so the
determinism test runs in Node); `WeaponMaterial` gives identity (shared alloy
`MeshStandardMaterial` + a hand-written energy `ShaderMaterial`: Fresnel rim, emissive
pulse, scanlines, flow); `WeaponGenerator` composes a `Group` and owns teardown. Every
config field is clamped and every count capped (`ARSENAL_LIMITS`), so a hostile config
still yields a bounded, finite weapon.

**Silhouette first.** Four base types with strong profile rules so each reads at a glance
— sidearm (compact), longarm (directional), heavy (massive), exotic (impossible, not a
gun). Form before detail before shader.

**Verification.** `npm run build` (both entries clean), `npm run test:arsenal` (Node:
determinism, clamping, ≥1 energy core/type, vertex budget), `npm run test:arsenal-proof`
(SwiftShader: all 4 types render — sidearm 7 meshes/868 tris, longarm 20/3064, heavy
26/1828, exotic 24/2428 — deterministic counts, zero console errors), `npm run qa` green.
DEV hooks (`__ARSENAL_DEBUG__`/`__ARSENAL_REROLL__`) stripped from production.

**Deferred (not in v1).** Placing weapons in the world, persistence/inventory, gameplay
stats, animation (reload/fire). The recipe JSON is the hand-off boundary if those come.

## ADR-022 — Arsenal v2: World Placement, Persistence & Runtime Attachment

**Decision.** Convert the verified recipe-JSON boundary into a world asset system: a
generated weapon can be placed in the main world, persisted (recipe only, never baked
geometry), reloaded deterministically, and given runtime/animation hooks — **without**
combat/inventory or merging the arsenal UI into the world app. Docs: `docs/ARSENAL_WORLD.md`.

**Persistence = a new `runtimeAssets` block** (NOT a new `objects[]` kind), mirroring how
`generators.instances` persists config rather than geometry. Each item is
`{ kind:"generated.weapon", id, recipe, transform(euler), runtime }`. `createWorldDocument`
gains the block; `validateWorldDocument` gains `sanitizeRuntimeAssetsBlock` (caps the list,
sanitizes each recipe via the arsenal validator, drops invalid); `WorldSerializer` is
unchanged (the block round-trips automatically). Rotation is stored euler; a quaternion is
accepted at the boundary and normalized.

**Strict dependency direction (`arsenal recipe → validator → world`).** Extracted the
reusable, UI-free `WeaponRuntime.buildWeaponFromRecipe` (the workbench's `WeaponGenerator`
is now a thin shell over it — one recipe→mesh path), `WeaponRecipeValidation.sanitizeWeaponRecipe`
(the untrusted-input boundary; clamps part count, forces positive dimensions), and
`WeaponRecipe.recipeHash`. The world imports ONLY these pure modules — never
`WeaponWorkbench`/`arsenalMain`. `test:arsenal-world` greps `src/world/**` to enforce it;
`/arsenal.html` stays a separate Vite entry, sharing data via a `localStorage` handoff
queue (not code).

**Placement = service + handoff drop (no editor click-tool this pass).** `WeaponPlacementTool.placeWeapon`
grounds a weapon on the terrain via the single `getHeight` source; `PlacedAssetStore` owns
the block + drains the `arsenal-export-queue` the Lab's "Send to World" writes;
`PlacedWeaponRuntime` rebuilds every persisted weapon from its recipe on load, adds it to
the scene, registers it with the visibility kernel, and advances the energy idle-pulse for
**awake** weapons only. Built in both editor + runtime (visible while authoring + playing).
Each weapon exposes named anchor markers (`muzzle`/`core`/`equip`/`socket`) for later combat.

**Verification.** `npm run test:arsenal-world` (Node: determinism, validation/clamp,
`runtimeAssets` round-trip, quaternion→euler, terrain grounding, finite markers, the
world-imports-no-arsenal-UI grep); `npm run test:arsenal-world-proof` (SwiftShader: a weapon
renders in the world runtime with markers, survives save→reload, the handoff queue drains,
zero console errors); v1 `test:arsenal`/`test:arsenal-proof` + `test:world` + `npm run qa`
green; DEV hook `__ARSENAL_WORLD__` stripped from prod.

**Deferred.** Combat, loot/rarity gameplay, inventory, economy, networking, enemy drops,
crafting, and an editor click-to-place tool. The recipe JSON remains the hand-off boundary.

## ADR-023 — Visual-0: Glacial Valley Visual Layer (single terrain source, profile-backed)

**Decision.** Establish the visual-world pipeline correctly *before* adding water/weather/
wildlife: make `terrainSampling.js` a thin **wrapper over ONE active `TerrainProfile`** and
give the world a glacial/alpine identity from MATH (no texture assets). The goal is the
architecture — a single, swappable ground truth feeding the mesh, placement, and grounding —
not "a pretty valley." Docs: `docs/VISUAL0_TERRAIN.md`.

**Single source, profile-backed.** A `TerrainProfile` is pure, deterministic, seeded math
(Node-safe, no THREE): `height(x,z)`, `grassDensity`, `snowlineAt`, `grassSlopeLimit`,
`colorAt` (linear RGB band color), and `visual` (material snow/scree config). `terrainSampling`
holds `activeProfile` + `setTerrainProfile`/`getActiveTerrainProfile`; `getHeight`/`grassDensity`
delegate, and `getNormal`/`getSlope`/`findGoodSpawn` are unchanged (built on `getHeight`, so they
auto-follow the profile). **Every export is preserved** — all 22 consumers / ~70 call sites are
untouched. No second terrain mesh, no forked sampler. The `terrain-single-source` test builds the
real mesh headless and proves each vertex `Y === getHeight`, `getSlope == ∂getHeight`, and that one
`setTerrainProfile` moves all of them.

**Alpine everywhere.** `AlpineTerrainProfile` (a U-shaped glacial trough with ridged-multifractal
walls, domain warp, a snowline, rock/scree slope masks, and a valley-floor meadow mask) is the
default for every world; `RollingProfile` preserves the original hills math **verbatim** (a test
asserts height-for-height parity) and stays selectable via a persisted `terrain.profile` field
(default `"alpine"`, allow-listed in validation). Visual identity comes from `visual/ValleyColorBands`
(THREE-free vertex band colors, shared by `colorAt` + the mesh) and `visual/SnowRockDirtBlend` (the
snow/scree GLSL appended after the existing material-v2 `onBeforeCompile` body; rolling's snowlineY
is far above terrain → the material behaves exactly as before). Default lighting becomes
`lighting/GlacialAtmosphere.glacialLighting()` (cool sun/sky + denser blue fog reaching further),
applied through the unchanged `LightingRig`.

**Placement adaptation.** Grass self-limits in `canPlaceGrass` (profile slope limit + snowline).
Trees/bushes gain a **runtime-only** `snowlineMaxHeight` cap (set by the loader to the profile
snowline; `Infinity` for rolling) — kept separate from the user's `maxHeight` so intent serializes
unchanged. `WorldRuntimeLoader.applyTerrainSettings` now also swaps the profile (the whole-world
ground-truth switch), preserving the current profile id + params when the editor applies sliders.

**Verification.** `npm run test:terrain-profile` (determinism + rolling parity + alpine masks),
`npm run test:terrain-source` (mesh==getHeight, slope==∂getHeight, one-swap-moves-all),
`npm run test:visual0` (SwiftShader: alpine profile loads, player grounded on the single source,
snow/scree shader compiles with zero console errors, glacial fog applied, grass renders);
`test:world` + the full proof sweep + `npm run qa` green (alpine is now the default terrain every
proof renders on); DEV hook `__VISUAL0_DEBUG__` stripped from prod.

**Deferred (non-goals).** Rivers, water simulation, weather, wildlife, settlement gameplay,
inventory, combat, Arsenal v3. The profile contract is the seam later visual layers extend.

## ADR-024 — Visual-1: Glacial Water & Atmosphere Depth (terrain-authored)

**Decision.** Layer glacial **water** + **atmosphere depth** onto the alpine valley, both
derived entirely from the active `TerrainProfile` (the Visual-0 seam) — no second terrain
truth, no texture assets, no weather/ocean/erosion sim. Docs: `docs/VISUAL1_WATER.md`.

**Water lives in the profile contract.** Mirroring `snowlineAt`, a profile now exposes
`waterLevelAt(x,z)` (glacial water table; `-Infinity` = dry), `wetnessAt(x,z)` (0..1 shoreline
band), `hasWater`, and `visual.waterlineY`; `dryProfileWater()` is the no-water default rolling
spreads. `terrainSampling` adds `getWaterLevel`/`getWetness` wrappers. The alpine table is
`ALPINE.floor − z*flow + WATER_RISE(−1.0)` using the **bare `floor`, never `floor*amp`** — the
flat valley floor is `lerp(floor, top, wall)`=`floor` at the axis, so a `*amp` table would
flood/drain the valley off the default amplitude (`waterLevelAt(0,0)` is amplitude-stable at −6,
asserted by `test:water`). The broad flat floor yields a **shallow braided wetland** (~9–11% of
the trough submerged, ~2u deep) + tarns, with the ridge walls always dry — the chosen
"broad glacial wetland" character (not a narrow river).

**One derived surface mesh.** `src/world/water/GlacialWater.js` builds a plane like
`Terrain._build()`: vertex `Y = getWaterLevel`, per-vertex `aDepth = getWaterLevel − getHeight`.
`GlacialWaterMaterial` upgrades a **transparent** `MeshStandardMaterial` via `onBeforeCompile`
(fog/lighting/shadow stay free), **`discard`s where `aDepth ≤ 0`** (so river + lakes + tarns
fall out of ONE sheet — no River/Lake/Mask sub-systems), with depth tint, fresnel rim,
`uTime` procedural shimmer (no texture), foam, `depthWrite:false`. The world `water` block is
RENDER config only; the loader builds the mesh only when `profile.hasWater` (never feeds
`-Infinity` into geometry).

**Atmosphere = camera-relative fog.** Global linear `THREE.Fog` (volumetric is a non-goal).
`ValleyAtmosphere.computeValleyFog` (pure, Node-tested) thickens fog in the basin / thins it on
the ridge and shifts toward a cold mist near water/snowline; the class eases `scene.fog` each
**runtime** frame (editor keeps the static base so it never fights live lighting edits) and
re-syncs grass fog via `GrassSystem.syncLighting` only when the eased value moves. Built after
`applyLighting` (base captured before grass), `attachFogConsumer(grass)` after grass.

**Vegetation + spawn.** `canPlaceGrass` rejects submerged first; trees/bushes get a per-point
`if (y < getWaterLevel(x,z)) continue;` floor gate (inert on rolling). `resolveSpawn` relocates a
submerged spawn to `findGoodSpawn()` (now guarded to skip submerged candidates) before grounding —
the default `{0,0,0}` lands in the trough's deepest pool, so this keeps the player dry without
floating.

**Verification.** `test:water` (masks/amplitude-stability/derived-mesh agreement/canPlaceGrass),
`test:atmosphere` (determinism/basin>ridge/never-inverts/mist), `test:visual1` (SwiftShader: water
shader compiles, water pools, no grass underwater, player not submerged, zero console errors);
Visual-0 tests + full proof sweep + `qa` green (every alpine world now also builds water +
atmosphere). DEV hooks `__WATER_DEBUG__`/`__ATMOSPHERE_DEBUG__`/`__VISUAL1_DEBUG__` stripped from prod.

**Deferred (non-goals).** Boats/swimming/fishing, weather cycles, erosion, volumetric/raymarched
fog, wildlife, combat, inventory, Arsenal v3.

## ADR-025 — Wildlife-0: Biome-Aware Ambient Wildlife (the contract hosts a living system)

**Decision.** Prove the math biome contract (Visual-0 + Visual-1) can host a **living runtime
system**, not just visuals: non-combat ambient animals that spawn, graze/wander, flee the
viewer, and respect the masks **while moving** — deterministic from seed+region+profile, no
second terrain/water/nav truth. Docs: `docs/WILDLIFE0.md`. Non-goals: predators/enemies/combat,
drops, inventory, taming, quests, breeding, hunger, full navmesh, networked wildlife.

**Two grounded species; a third staged.** `src/world/wildlife/WildlifeSpecies.js` (pure data)
ships `alpine_hare` (meadow floor, skittish) + `ibex` (steeper grazer). A flying `snow_finch`
flock is present but `enabled:false` — its aloft contract (a second grounding model) is promoted
in Wildlife-1, keeping this stage's proof focused on the grounded core.

**The same habitat gate at spawn AND every step.** `WildlifePlacement.habitatOK(x,z,species)`
reads ONLY terrain authority — `getHeight`/`getSlope`/`getWaterLevel` + `getActiveTerrainProfile().
snowlineAt` (there is no `getSnowline` wrapper) — rejecting submerged / above-snowline / too-steep /
out-of-band. `WildlifeRuntime.updateAnimal` commits a proposed step ONLY if `habitatOK`, else
turns; **flee runs the identical gate** (+ ×2 sub-step), so a wandering or fleeing animal can never
enter water, climb scree, or cross the snowline. Grounded on `getHeight` (the single source), NOT
`getSupportHeight` (O(colliders); ambient animals don't stand on crates). On rolling (waterLevel
−∞, snowline +∞) the gate auto-degrades to slope+band.

**Determinism + no persistence of derived state.** The spawn set is a pure function of
`(seed, rx, rz, profile)` via `mulberry32(hash2i(rx^seed, rz+seed) ^ salt)` (the tree/bush idiom) →
identical on re-run (twice-equal test). Motion is seeded per-animal (placement `motionSeed`), uses
zero `Math.random`/`Date.now` (source scan), and is never persisted — only the `wildlife` config
block (seed + toggles + distances) round-trips, like `lighting`.

**Streaming + instanced render + bounded count.** `WildlifeSystem` mirrors `BushSystem`: region
grid keyed `rx,rz`, built within `visibleDistance`, dropped beyond `keepDistance` (hysteresis);
the FSM runs only within `simulateDistance` (LOD; far-active regions render a frozen pose). One
`THREE.InstancedMesh` per species (`DynamicDrawUsage`, capacity 1024, `count` gates draw). Hard caps
(`regionMemberCap`, `MAX_INSTANCES_PER_SPECIES 1024`, `MAX_ACTIVE_WILDLIFE 1500`) bound the active
set; `dispose()` releases each species mesh + clears regions (no reload leak). `load()` is a pure
no-op when disabled/empty — so it can never throw into the shared console-error gate that every
consumer proof depends on.

**Wiring.** `wildlife: createWildlifeConfig()` in `WorldDocument`; `sanitizeWildlife` in
`WorldValidation`; constructed/returned/disposed in `WorldRuntimeLoader` beside the other systems;
`main.js` reassigns the module var via `applyLoadedWorld`, ticks `wildlife?.update(dt, camera)` in
both loop sites, prewarms at load, exposes `__WILDLIFE_DEBUG__`.

**Verification.** `test:wildlife` (determinism, spawn legality, bounded, **movement legality —
2000-step relentless flee never enters water/cliff/snow**, rolling safety, no-Math.random scan);
`test:wildlife0` (SwiftShader: animals instanced + on terrain, none floating/submerged/above
snowline, player unaffected, zero console errors); the full regression sweep stays green (every
alpine world now also builds wildlife). DEV hook stripped from prod.

**Deferred (non-goals).** Predators/enemies/combat, drops, inventory, taming, quests, breeding,
hunger, full navmesh, networked wildlife, the flying flock (staged disabled → Wildlife-1).

## ADR-026 — Wildlife-1: Aloft Flocks & Sky-Life Contract (the contract hosts a second movement domain)

**Decision.** Promote the staged `snow_finch` row into a **live flying flock** — the first *aloft*
consumer of the `TerrainProfile` biome contract. Prove the contract hosts sky-life (agents that fly
but still respect terrain/water/snowline/region-streaming, with flock cohesion + player-scatter) as
cleanly as Wildlife-0's ground-life, deterministic from seed+region+profile, no second terrain truth.
Docs: `docs/WILDLIFE1.md`. User picks: V-wing silhouette marker; ridge-hugging high band (Y≈30–70);
flocks fly by default. Non-goals: combat, drops, inventory, navmesh, full boids chaos, Arsenal v3.

**The altitude solver is the aloft single source — and "water ≤ terrain" is FALSE.** `FlockPlacement.
flockAltitudeAt(x,z,species,offset)` is the aloft analog of grounded `y=getHeight`, used at placement
AND every runtime step. The alpine water table (`AlpineTerrainProfile`) is computed INDEPENDENTLY of
height, so in the trough the water surface sits *above* terrain — "clamp above terrain ⇒ above water"
is unsound. The solver takes an explicit `floor = max(getHeight+minClearance, water+minClearance)`,
then `y = clamp(max(floor, getHeight+offset, snowline-attraction), minY, maxY)`, then **re-applies
`y = max(y, floor)` AFTER the clamp** so a ridge crest taller than `maxY−minClearance` can't pull a
bird below the mountain (maxY is a SOFT ceiling; clearance is inviolable). `getWaterLevel`/`snowlineAt`
enter only `max`/`min`, never a multiply/divide, so the rolling profile's ±∞ degrades to "fly at the
terrain floor" instead of NaN. A test that lowers `minY` below the water table proves the *water* term
(not minY) is what protects.

**Bounded cohesion is structural, not hoped-for.** `FlockRuntime.updateFlock` is a flock-level FSM
(circle/drift/scatter/regroup). Centre step ≤ `min(maxSpeed·dt, MAX_STEP)` (dt clamped to MAX_DT);
centre hard-projected back inside `maxTetherRadius` of home every step; member offset clamped ≤
`maxSpread`; heading change ≤ `maxTurnRate·dt`. By triangle inequality every bird stays within
`maxTetherRadius + maxSpread` of home, always — no NaN/Infinity under hostile dt or NaN threat (a
poisoned centre snaps to home). **Scatter never freezes:** it flees away from the threat computed from
the CENTRE (scatters as one body); if a full away-step would break the leash it steers the leash
TANGENT instead (the aloft analog of Wildlife-0's wall-follow fix), sliding along the boundary. A
`calmTime` debounce deterministically returns the flock to regroup→circle once the threat leaves.

**Architecture — `WildlifeSystem` owns `AloftWildlife` internally.** The world threads ONE `wildlife`
handle (7 call sites in `WorldRuntimeLoader` + `main.js`); internal ownership keeps **both files
untouched** and the grounded streaming/render bodies byte-identical. The only grounded edits: a
`groundContract==="support"` species filter, an always-true `if (grounded active)` guard around the
grounded calls (so an aloft-only world still builds flocks), additive aloft delegation, and the
`placeRegion` `groundContract!=="support"` skip. `AloftWildlife` COPIES the ~40-line region-streaming
skeleton (same halfDiag nearest-corner hysteresis) rather than extracting a shared helper — extracting
would perturb the proven grounded path; deferred to Wildlife-2 if a third streamed type appears.

**Render.** One `THREE.InstancedMesh` per aloft species, a shallow gull-V chevron (2-tri
`BufferGeometry`, `DoubleSide`). Separate aloft budget (`MAX_ACTIVE_FLOCK_BIRDS 1500`,
`MAX_INSTANCES_PER_FLOCK_SPECIES 2048`); `mesh.count` gates draw; **every member position is
finite-checked before `setMatrixAt`** (a NaN matrix would red the shared console-error gate).

**Verification.** `test:flock` (Node: determinism, altitude-above-terrain+water on alpine trough +
steepest ridge + rolling, hostile-minY water-term proof, 5000-step chase stays bounded + non-frozen +
regroups, hostile-dt finiteness); `test:wildlife1` (SwiftShader: flocks instanced + rendered, no bird
below terrain/water, GROUNDED animals still pass in the same scene, player unaffected, zero console
errors); `test:wildlife` unchanged (435 grounded); full regression sweep (10 browser proofs) green.
Fresh-context adversarial review: APPROVE, 0 critical / 0 high.

**Known shared characteristics (not new defects, documented not fixed).** Both `AloftWildlife._render`
and grounded `WildlifeSystem._render` gate on raw region-centre distance while streaming uses the
halfDiag nearest-corner metric — an edge region can be streamed (and simulated) but not rendered;
faithfully copied, kept parallel rather than diverged. A freshly-streamed flock starts `stateTimer=0`
so it picks its first state on frame 1 (deterministic, harmless).

**Deferred (non-goals).** Predators/attacks/damage/drops, inventory, quests, nesting, breeding,
migration sim, full navmesh, full boids chaos, Arsenal v3 (await user pick).

## ADR-027 — Wildlife-2: Shared RegionStreamer Extraction (behavior-preserving refactor)

**Decision.** Extract the region-streaming mechanics duplicated across `WildlifeSystem` (grounded)
and `AloftWildlife` (flocks) — `AloftWildlife` literally copied the loop in Wildlife-1 with a
`TODO(Wildlife-2): extract` marker — into a shared, Node-testable `src/world/streaming/`
(`RegionStreamer` + `RegionMetrics` + `RegionKey`), retiring the copy before a plausible third
streamed actor class makes the duplication doctrine. **This is a refactor: the bar is PARITY** —
identical determinism, identical SwiftShader proof counts (tolerance = 0), identical public APIs.
No `docs/WILDLIFE2.md` (structural hygiene; this ADR is the record).

**Scope = the two wildlife systems only.** Research found two streaming *families*: Family A
(wildlife grounded + aloft — plain payload arrays, ONE shared mesh, **synchronous** build,
**symmetric** nearest-corner keep) and Family B (`BushSystem`/`GrassSystem`/`TreeSystem` —
heavyweight per-patch objects, **lazy budgeted** build, **asymmetric** raw-centre keep). They share
only the `0.7072` constant, not the shape. Adopting any Family-B system would change its
behavior/density → a WRONG-IF, so they are deferred, and the shared `0.7072` is NOT centralized
into them (identical value → zero correctness win, pure blast-radius across 3 proven systems).

**What moved + what stayed.** `RegionStreamer` owns the `regions` Map + the keep/drop/build pass
(byte-faithful to the inline loop: drop-before-scan, the `0.7072` LITERAL — never `Math.SQRT1_2`,
dz-outer/dx-inner grid order, `rx + "," + rz` key, `dist*dist > visSq && dist > 0` gate,
`activeCount` seeded from `itemCount()` then `>= maxItems` checked BEFORE build / incremented AFTER
— overshoot-by-one-region preserved). All three cfg reads (regionSize/visible/keep) are getters
read per-frame. The systems supply `buildRegion` (place→spawn→filter) + `countItems` (the budget
UNIT: grounded `animals.length`, aloft `Σ flock.members`); they point `this.regions` at
`streamer.regions` (same Map instance) so the **proven `_simulate`/`_render` bodies stay
byte-identical**, keeping their raw-centre distance gate (the intentional asymmetry vs the
nearest-corner stream metric — NOT "fixed", as that would shift counts). `main.js` +
`WorldRuntimeLoader.js` untouched; public system signatures unchanged.

**Verification.** `test:streamer` — `0.7072` literal guard, deterministic set+order, no-thrash
idempotency, budget overshoot semantics (both count units), and the decisive **ORACLE**: an
inlined verbatim transcription of the old `_streamRegions` loop whose key SET + ORDER must match
the streamer for every camera position, run for BOTH the grounded and aloft payload/budget-unit.
`test:wildlife` (435 animals / 32 regions) + `test:flock` (72 flocks / 783 birds) + the two
SwiftShader proofs pass with **byte-identical counts**; full regression sweep + qa green.
Fresh-context adversarial review (git-diff vs HEAD): APPROVE, 0 critical / 0 high; its MEDIUM
(add a direct aloft oracle run) and LOW (regionSize per-frame getter for faithfulness) were both
fixed + re-verified.

**Non-goals.** No new species/behavior, no Family-B adoption, no centralizing `0.7072` into
Family B, no "fixing" the raw-centre sim/render metric, no ECS migration, no Arsenal v3.

## ADR-028 — Ambient-0: Streamed Environmental Micro-Actors (the third RegionStreamer consumer)

**Decision.** Prove the Wildlife-2 `RegionStreamer` extraction generalizes by adding a THIRD streamed
runtime actor class — `alpine_motes`, tiny firefly-like glowing specks that drift over the glacial
valley's wet meadow + waterside — **with zero changes to the streamer** and **no change to wildlife
behavior**. Also the first runtime consumer of `getWetness` (the Visual-1 shoreline-dampness signal
nothing had used). A small, visually-additive feature, not a refactor. Docs: `docs/AMBIENT0.md`. User
picks: firefly-glow look (additive, depthWrite off); wet-meadow & waterside habitat.

**The streamer is REUSED, never copied or mutated.** `AmbientSystem` constructs its OWN `RegionStreamer`
instance with its OWN budget (`MAX_ACTIVE_MOTES`), `buildRegion`/`countItems`(=`region.motes.length`)/
distance getters, aliases `this.regions = streamer.regions`, keeps its own raw-centre sim/render gate —
exactly as `WildlifeSystem`/`AloftWildlife` do. No method/field added to `RegionStreamer`/`RegionMetrics`/
`RegionKey`. A `test:ambient` source-scan asserts `src/world/ambient/` re-implements no region-streaming
math and imports `RegionStreamer` (GOTCHA: the scan false-matched its OWN header comment listing the
tokens — reworded the comment, same prose-in-comment class as the Wildlife-0 Math.random scan).

**Biome-aware density (first getWetness consumer).** `densityAt = clamp01(wetWeight*getWetness +
meadowWeight*getGrassDensityFactor) * snowFactor`, `snowFactor = isFinite(snow) ? clamp01((snow−h)/
snowFalloff) : 1`; accept on `rng() < densityAt` (the grass probabilistic-thinning idiom). Motes
concentrate on the wet meadow/shoreline, thin to 0 at the snowline, auto-degrade on rolling (wetness 0,
snowline +∞ → meadow-only). Proven: 971 motes / 439 on wet ground; placed-mean density ≫ uniform baseline.

**Bounded drift + hover = copied flock discipline.** `updateMote`: dt clamped FIRST, velocity = wind +
seeded `fbm2D` wander clamped to maxSpeed, per-step displacement capped (MAX_STEP), position
hard-projected back inside `tetherRadius` of home every step, non-finite → snap home, scatter heading-only
(NaN-threat-safe). Twinkle = `sizeBase*(1 + amp*sin(phase))` with `amp<1` (factor ∈ (0,2), never collapses
to 0). `solveHoverY` = the flock floor-after-band solver (`max(getHeight+hoverOffset, getHeight+minClearance,
isFinite(water)?water+minClearance:-∞)`) → mote contract ⊂ proven bird contract (never below ground/water,
incl. the trough where the alpine water table sits above terrain). Render finite-guards pos AND scale
before `setMatrixAt` (motes write a per-instance scale unlike birds).

**Render + wiring.** One `InstancedMesh` of a tiny `OctahedronGeometry` + `MeshBasicMaterial` (self-lit
firefly glow: AdditiveBlending, transparent, depthWrite:false, fog:true, no shadows); `mesh.count` gates
draw; caps `MAX_ACTIVE_MOTES 2000`/`MAX_INSTANCES 4096`. Wiring mirrors wildlife one-for-one (one `ambient`
handle: `WorldDocument`/`WorldValidation` +1 each, `WorldRuntimeLoader` construct/return/dispose, `main.js`
tick-after-wildlife/prewarm/`__AMBIENT_DEBUG__`); `updateDocumentFromRuntime` untouched (config+seed
round-trip like lighting/wildlife). Family-B (grass/bush/tree) untouched.

**Verification.** `test:ambient` (determinism, biome bias with a non-trivial-baseline guard, hover above
terrain+water incl. trough, 5000-step hostile sim with absurd wind + NaN threat + a dt=1e6 frame,
rolling-safe, streamer-reused + no-Math.random scans); `test:ambient0` (SwiftShader: motes instanced +
on-band + none below ground/water/above snowline, **grounded + flock wildlife counters UNCHANGED in the
same scene**, player unaffected, zero console errors); full sweep with wildlife (435/32) + flock (72/783)
+ streamer counts byte-identical; build + qa 32/0/0. Fresh-context adversarial review: APPROVE, 0 crit /
0 high; its MEDIUM (genuinely-finite hover fallback) + LOW (uniform-baseline assertion) fixed + re-verified.

**Non-goals.** No weather system, no particle editor, no combat/projectiles/status/inventory/loot, no
flock-behavior changes, no Family-B streamer extraction, no `RegionStreamer` mutation, no Arsenal v3.

## ADR-029 — Arsenal v3: Click-to-Place & Equip-to-Hand (generated weapons become interactable)

**Decision.** Make the generated weapons of Arsenal v1/v2 INTERACTABLE: click-to-place onto terrain
in the editor, equip-to-hand on the player in runtime. A minimal interaction layer — NOT gameplay
(no combat/damage/projectiles/inventory/loot/crafting/economy). Preserves the v2 recipe boundary,
the `runtimeAssets` persistence, the marker contract, and the isolated `/arsenal.html`. Docs:
`docs/ARSENAL_V3.md`. User picks: BOTH unequip outcomes (drop→world / store→hidden) and BOTH
persistence modes (transient / persistEquip) are selectable.

**Engineering call: extend the canonical `src/world/placement/`** (`PlacedWeaponRuntime` +
`WeaponPlacementTool` already live there) — NOT a parallel `src/world/arsenal/`. `WeaponEquipRuntime`
joins it; `ArsenalSelection`/`ArsenalDebug` fold into the editor armed-recipe + nearest query and
`debugSnapshot`/DEV hooks. Equip runtime is owned in `main.js` (needs player + input + the per-load
store), NOT `WorldRuntimeLoader` (no player; rebuilt per load). `updateDocumentFromRuntime` untouched.

**Click-to-place.** `PlacedWeaponRuntime` gained CRUD (`add`/`remove`/`getEntry`) sharing one
`_instantiate(item)` body with `load()`. BLOCKER FIX: `clear()`/`remove()` detach via
`group.removeFromParent()` (NOT `scene.remove`) — a no-op once a weapon is parented to the player,
which would orphan it on reload. The editor arms a FRESHLY-rolled default recipe
(`generateWeaponRecipe(rollConfig(preset.seed, preset.type))`, key **B**) — NOT a handoff peek (the
queue is drained+deleted before the editor opens). Editor imports only PURE arsenal modules; the
boundary grep (extended to `src/world` + `src/editor`) forbids only `WeaponWorkbench|arsenalMain`.

**Equip-to-hand.** `WeaponEquipRuntime` reparents a placed weapon's group onto `player.mesh` at the
inverted `equip` marker. GOTCHA — markers are POSITION-ONLY (no orientation; verified in
`WeaponRuntime._build`), so the attach transform is just `group.position = handLocal − equipLocal`
at identity (the equip marker then coincides with the hand). The marker→transform is the one path
with NO validator between data and the scene graph → FINITE-GUARDED (a non-finite marker/result
refuses the equip, leaves it placed). **F** = equip nearest / drop; **G** = store (hide). The weapon
follows the player as a child of `player.mesh` (`syncMesh` propagates) — no per-frame copy; the
energy shader still ticks via `placedWeaponRuntime.update` regardless of parent.

**Persistence (no schema change — `equipped`/`stored`/`owner`/`visible` already in the v2 `runtime`
block).** `persistEquip` (default transient) gates whether `equip()` WRITES `state:"equipped"`.
`load()` re-attaches equipped items UNCONDITIONALLY — the DOCUMENT is the source of truth, not the
session flag (a transient equip never wrote that state). drop → grounded at the player, `idle`,
transform written back; store → hidden, `stored`, `visible:false` (set BEFORE reparenting — review fix).

**Verification.** `test:arsenal-placement` (Node, headless THREE: CRUD; equip-marker reparent math —
marker coincides with the hand in world space, finite; drop/store/persist states; persisted-equipped
re-attaches on a fresh load; `EQUIP_RADIUS` gate; hostile descriptor + poisoned marker rejected;
isolation grep). `test:arsenal-v3` (SwiftShader: place→equip[parented to Player + markers finite]→
drop→store→persist-equip+save→**reload re-attaches**; player/wildlife/ambient unaffected; 0 console
errors). v2 `test:arsenal-world` + proof byte-unchanged; full sweep + build + qa green. Fresh-context
adversarial review: APPROVE 0 crit/0 high; MEDIUM (store reparent order) + LOW (radius test) fixed.

**Non-goals.** No combat/damage/projectiles, inventory, rarity, loot/drops, economy, crafting, stats;
no merging the workbench into the world app; no `runtimeAssets`/recipe schema change.

## ADR-030 — Arsenal v4: Oriented Equip Slots & Multi-Slot Attachment (the attachment contract)

**Decision.** Strengthen the v3 equip from position-only to a full-transform attachment contract
before weapon variety/combat depend on it: markers expose finite `{position, rotation}`, attachment
is a single compose rule, and the player gains three explicit slots (rightHand / back / hip). Still
NOT gameplay. Docs: `docs/ARSENAL_V4.md`. User pick: **single-weapon slot-cycle** (one weapon at a
time, **R** cycles rightHand → back → hip) over holster/multi-occupant (deferred to a future v5 — the
smallest coherent change that still proves all three slots + persists which one).

**The attachment rule.** `weaponLocal = slotMatrix(slot) × inverse(equipMatrix(markers))`, decomposed
onto the weapon group, reparented to `player.mesh` — so the `equip` marker coincides with the slot in
world space, oriented. The weapon stays a **direct child of `player.mesh`** (slots are transforms
composed into the player-local matrix, NOT intermediate scene nodes) → `syncMesh` carries it and the
v3 `equippedParentIsPlayer` invariant holds. The marker→transform is still the one unvalidated
data→scene path → finite-guard the equip matrix, slot matrix, AND the decomposed result, all BEFORE
reparenting (a poisoned marker leaves the weapon placed — preserves the v3 refusal).

**Why the upgrade lives entirely in `src/world/placement/` (arsenal untouched).** The v1/v2 arsenal
tests REQUIRE `userData.markers` stay position-only ARRAYS (`arsenal-world-regression.mjs:32`
`m.every(...)`, `browser-arsenal-world-proof.mjs:65` `Array.isArray`). So the contract upgrade is a
NEW world-layer module, `WeaponMarkerTransforms.js`, that LIFTS the arrays into oriented transforms
(rotation defaults to IDENTITY — the weapon's model grip frame; meaningful per-attach orientation
lives in the SLOT rotations in `WeaponEquipSlots.js`, legitimately inside the slot contract — not a
render hack). This also matches the user's own module scoping (all v4 files under
`src/world/placement/`). **Reduces-to-v3:** rightHand uses identity rotation and
`localPosition == the v3 handLocal` exactly, so `slot × equip⁻¹` decomposes to `position = handLocal −
equip`, identity quat — bit-for-bit the v3 result → v1/v2/v3 tests stay green UNCHANGED.

**BLOCKER FIX (B1, the load-bearing one).** Slot persistence is impossible without it:
`RuntimeAssetTypes.normalizeRuntimeAssetDescriptor` rebuilds the `runtime` block from a FIXED
whitelist and drops unknown keys, so a naive `runtime.slot` is silently lost on every save→load
(re-sanitized on `PlacedAssetStore.add`, `WorldSerializer.save`, and load). Fix: add a `RUNTIME_SLOTS`
set + `slot:` to the whitelist (additive; no v2/v3 test deep-equals the runtime sub-block). `equip()`
in persist mode writes `slot`; drop/store CLEAR it to null; `load()` re-attaches the equipped item to
`runtime.slot ?? "rightHand"` unconditionally (legacy/transient saves fall back to rightHand).

**Controls.** **R** = cycleSlot (re-runs `equip(id, player, nextSlot)`); **F**/**G** unchanged
(equip-nearest/drop, store). `unequip(player, mode)` signature kept (the v3 DEV hook `A.unequip('drop')`
passes mode positionally). One weapon equipped at a time → `load()`'s single `.find` is correct.

**Verification.** `test:arsenal-equip-slots` (Node, headless THREE: marker/slot transforms finite; the
core invariant `equipMarkerWorld == slotWorld` oriented for EACH of rightHand/back/hip; rightHand
reduces to v3; `cycleSlot` walks the three; `runtime.slot` round-trips the sanitizer AND the document;
drop/store clear it; persisted equipped@hip re-attaches to the hip on a fresh load; poisoned marker +
unknown slot refused; isolation). `test:arsenal-v4` (SwiftShader: place→equip hand→cycle back→cycle
hip→persist-equip on hip+save→**reload re-attaches to the hip**; player/wildlife/ambient unaffected; 0
console errors). v1/v2/v3 arsenal tests + full sweep + build + qa green.

**Non-goals.** No firing/damage/ammo/recoil, inventory grid, rarity, loot, crafting, enemies, or
animation beyond static slot attachment; no holster/multi-occupant (deferred); no `src/arsenal/` or
`/arsenal.html` changes; no recipe-schema change.

## ADR-031 — First Playable Build Gate (the first-game finish line, FP-0)

**Decision.** Establish a single canonical **gate document**, `docs/FIRST_PLAYABLE_BUILD.md`, as the
first-game build target distinct from engine-capability stages. It defines: the player-facing end goal
(Glacial Valley First Playable — find/equip/carry/store a generated relic weapon, reload to prove
persistence), the required vs deferred scope, a hidden-issue discovery checklist, the required test
gates (all real npm scripts), go/no-go criteria, and an update rule kept current after each accepted
stage. NOT a roadmap — every "done" is backed by a runnable command or a go/no-go check. This is a
NON-feature stage (documentation only); it adds no code. (The user's draft suggested "ADR-030"; that
number was already taken by Arsenal v4, so this is **ADR-031**.)

**Why.** The foundation stack (Arsenal v1–v4, Visual-0/1, Wildlife-0/1/2, Ambient-0) is strong but is
*engine capability*, not a proven *game loop*. Without a fixed, tested finish line, every cool system
risks becoming a Build-1 requirement and "ready to demo" blurs into "ready to ship live." The gate
separates the two and forces a tested-clear bar before any public/live exposure.

**Shape.** Tags: `world-builder-first-playable-doc-v0.1` = this FP-0 doc milestone;
`world-builder-first-playable-v0` is RESERVED for FP-4 (the actual playable) and applying it before the
§8 GO criteria hold is itself a NO-GO violation. Milestones: FP-0 build doc (DONE) → FP-1 objective
marker → FP-2 `test:first-playable-proof` (the one missing gate script) → FP-3 hidden-issue sweep →
FP-4 tag. Current status: foundation gates §7.1–§7.5 all green as of Arsenal v4 (`b602009`); FP-1/FP-2/
FP-3 not yet built → NO-GO for the first-playable tag. The document's §11 update block must be refreshed
after every accepted stage.

**Non-goals.** No code, no new feature, no combat/inventory/live-deploy; the doc explicitly defers all
of those out of Build 1.

## ADR-032 — FP-1: Relic Weapon Objective Marker (the first completable gameplay loop)

**Decision.** The first player-facing loop, built from existing systems only: find the marked relic
weapon → equip it (Arsenal v4) → carry it to the cache marker → deposit it on the pedestal → complete,
persisting across reload, with an always-on banner. NOT a quest engine / combat / inventory. Docs:
`docs/FIRST_OBJECTIVE.md`. User pick: **deposit = visible trophy on the pedestal** (vs stow/hide). The
relic is auto-spawned (a dedicated, deterministic `runtimeAssets` weapon with a fixed `RELIC_ID`) — not
a genuine fork (designate-existing is unsatisfiable on an empty world + has an unstable id).

**New `objectives` document block (additive — `WORLD_DOCUMENT_VERSION` UNCHANGED at 2).** Mirrors
`runtimeAssets`: `{version, items[]}` with one descriptor `{kind:"relic-weapon.fp1", id, relicId,
cache:{x,y,z}, radius, completed}`, validated by `ObjectiveTypes.sanitizeObjectivesBlock` and owned by
`ObjectiveStore` (the `PlacedAssetStore` analog; self-heals + in-place mutation → reaches disk on save).
Bumping the version would break ~6 zero-warning + `version === 2` assertions, so it stays additive and
the sanitizer emits zero warnings on an empty block.

**Persistence whitelist (the Arsenal-v4 B1 lesson, third time).** A document block survives save→load
only if its sanitizer EXPLICITLY emits each field: `completed: item.completed === true` (a boolean is
silently dropped if conditionally emitted — and it's read back on reload to restore the phase); and a
**non-finite `cache` DROPS the whole objective** (no origin fallback — that would relocate the zone to
world origin and make it uncompletable-by-walking). The relic's deposited pedestal transform persists
via its existing `runtimeAssets` descriptor (in-place), so reload rebuilds the trophy + restores it.

**Completion has no soft-lock.** `tryDeposit` (bound to **G**): holding the relic + in-zone → place it
on the pedestal (idempotent) + `completed=true` + beacon→claimed; holding the relic out-of-zone → just
**drop** it (visible, re-grabbable — never hidden); not holding the relic → returns false so the generic
Arsenal v4 store runs. So the relic can never be lost, and completion only happens by a deliberate in-
zone deposit. Completion is latched (terminal). Dedicated `ObjectiveRuntime` (a single objective) — NOT
the InteractionRuntime trigger system (too heavy; the non-goals forbid a generalized quest engine);
zone test is a plain `dx*dx+dz*dz < r*r`.

**Runtime ownership + lifecycle.** `ObjectiveRuntime` is owned in `main.js` (runtime-only — needs the
player + the per-load store), loaded AFTER the player is grounded (so sites derive from the resolved
spawn), gated `runtimeMode && player` (`loadRuntimeAssets` runs in the editor too). The relic is spawned
only if absent (fixed id → idempotent across reloads); that fresh world is saved once. The beacon +
relic marker live on `scene` (NOT in `WorldRuntimeLoader.dispose`), so `load()` CLEARS its prior markers
idempotently to avoid a leak/duplicate on reload (mirrors `PlacedWeaponRuntime.clear`). DEV hooks
`__OBJECTIVE_DEBUG__` + `__OBJECTIVE_DO__` (relicId/equipRelic/teleportToCache/deposit/save — the proof
drives the loop deterministically without physical movement; teleport forces an in-zone recompute).

**Verification.** `test:first-objective` (Node, headless THREE: deterministic relic + dry-ground sites;
objectives round-trip + `completed`-literal + cache-drop + zero-warning empty; self-heal; spawn-if-absent
+ idempotent reload + beacon dispose; deposit pedestal/drop/no-op; persistence; phase table).
`test:first-objective-proof` (SwiftShader 5228/9362: find→equip→carry→deposit→complete + reload-persists;
wildlife/ambient unaffected; 0 console errors). Arsenal v1–v4 + the foundation sweep + build + qa green.
Tag `world-builder-first-objective-fp1` (local). Does NOT satisfy FP-4 — `world-builder-first-playable-v0`
stays reserved (FP-2 proof + FP-3 sweep + go/no-go review pending). `docs/FIRST_PLAYABLE_BUILD.md` FP-1
marked done + §10/§11 refreshed.

**Non-goals.** No combat, inventory, enemies, dialogue, procedural quest generation, economy, multiple
objectives, generalized objective/quest engine, AI director, or live deployment; no `src/arsenal/` /
`/arsenal.html` / recipe-schema / environment-system changes; no `WORLD_DOCUMENT_VERSION` bump.

## ADR-033 — FP-2: Integrated First-Playable Proof (the one missing §7.7 gate)

**Decision.** Author `test:first-playable-proof` (`scripts/browser-first-playable-proof.mjs`) — the
INTEGRATED move-through-world loop the per-subsystem proofs never covered. In one SwiftShader session it
loads a dense alpine world, proves the world is alive (terrain · water · fog · wildlife · flocks ·
ambient motes, each asserted ACTIVE + legal, mirroring the wildlife1/ambient0 patterns + seeds), exercises
the full weapon interaction (place → equip → slot-cycle → store via `__ARSENAL_EQUIP_DO__`), then plays
the relic objective for real — equip the relic, **physically walk** it from spawn to the cache, deposit on
the pedestal, complete — and proves completion + trophy + runtime assets survive a full reload, with zero
console errors across both sessions. This satisfies §7.7 of the First Playable gate. No new gameplay; the
proof gate, not a feature.

**The walk must be real, not a teleport — and headless rAF is throttled.** The FP-1 proof used
`teleportToCache`; FP-2's spec forbids that ("no movement bypass"). But the player only moves from
keyboard input read off two MODULE-LOCAL symbols in `main.js` (`input.keys`, `cameraController.yaw`),
and movement is camera-yaw-relative — neither is reachable from an injected eval, and pointer-lock mouse
steering is unavailable headless. Measured: the headless renderer services ≈ one frame per CDP round-trip
(~5fps), so a real-time wall-clock walk of the ~26-unit spawn→cache distance would take ~37s and be flaky.

**Resolution — a DEV-only `__PLAYER_MOVE_DO__` movement driver (the only product-file touch).** Guarded
by `import.meta.env.DEV` (stripped from prod, like `__OBJECTIVE_DO__`): `faceXZ(x,z)` sets the camera yaw
to `atan2(-(x-px), -(z-pz))` (the inverse of `PlayerController`'s `_forward = (-sin yaw, 0, -cos yaw)`
basis, so holding forward walks toward the target); `hold(forward,strafe)` injects the held movement keys;
`step(dt)` advances ONE fixed simulation tick using the SAME per-frame update the main loop runs
(`cameraController.update` → `playerController.update` → `objectiveRuntime.update`). The proof paces those
steps deterministically (≤ 600 fixed 1/60s steps in one eval, stop on zone entry), so the player still
translates through the real movement/collision/grounding pipeline and the objective zone is recomputed by
the real `objectiveRuntime.update` — only the wall-clock pacing is replaced. The proof asserts the player
moved > 5 units (genuine traversal, not a teleport), stays grounded, and is not submerged at the cache.
Faithful but explicitly not a real-time playthrough — recorded as a residual risk in §11.

**Boundaries.** No schema change (no `WORLD_DOCUMENT_VERSION` bump), no edits to any gameplay/runtime
system beyond the one DEV driver, no `src/arsenal/` / `/arsenal.html` / recipe touch, no qa-config change
(proof scripts aren't tracked there; the gate doc was already registered). `scripts/lib/browser.mjs` left
byte-identical (the rAF-throttling launch flags were tried and had no measurable effect — reverted to keep
the change minimal). Change surface: `src/main.js` (+the DEV driver), `package.json` (+ one script),
`scripts/browser-first-playable-proof.mjs` (new), docs.

**Verification.** `test:first-playable-proof` (SwiftShader 5229/9363) passes the full loop. No
regressions: build, qa (skills 32/0/0 + layout), `test:world`, the foundation sweep (visual0/1, water,
atmosphere, wildlife/0/1, flock, ambient/0, streamer), arsenal v1–v4, and `test:first-objective` +
`-proof` all green (arsenal-v3 had one transient editor-readiness timeout under back-to-back load; passes
in isolation). Tag `world-builder-first-playable-proof-fp2` (local, no push). Does NOT satisfy FP-4 —
`world-builder-first-playable-v0` stays reserved until FP-3 (hidden-issue sweep) + §7.8 (go/no-go review).
`docs/FIRST_PLAYABLE_BUILD.md` §7.7 + FP-2 marked done, §10/§11 refreshed.

**Non-goals.** No new gameplay, weapon variety, Arsenal v5, or hidden-issue sweep (that's FP-3); no
combat/inventory/quests; no schema bump; no gameplay/runtime-system edits beyond the DEV driver; do NOT
apply `world-builder-first-playable-v0` (FP-4 only).

## ADR-034 — FP-3: Hidden-Issue Sweep (hostile validation before the go/no-go)

**Decision.** Add a Node + browser hostile/edge test pair that tries to BREAK the integrated
first-playable loop, covering the nine gate probes (§9 FP-3): spawn-in-water, poisoned weapon marker,
hostile dt, region-border thrash, reload duplication, proof drift, store/equip/drop reload, the console
gate, and the UX traversal. `test:first-playable-hidden`
(`scripts/first-playable-hidden-regression.mjs`, headless THREE) owns the deterministic/pure-logic
probes; `test:first-playable-hidden-proof` (`scripts/browser-first-playable-hidden-proof.mjs`,
SwiftShader, 5230/9364) owns the live/integrated ones. Hostile validation ONLY — no features, no
objective change, FP-2 untouched. This satisfies §7.8 of the First Playable gate.

**Outcome — the sweep found NO defect; every invariant already held.** The build's existing guards are
sufficient: `findGoodSpawn` never returns a submerged point + `resolveSpawn` relocates wet spawns +
`deriveSites`/`isWalkable` keep the relic/cache dry; the v4 marker finite-guards refuse a poisoned equip
without reparenting (the weapon stays placed, never orphaned); `FlockRuntime`/`AmbientRuntime` guard
`dt<=0` and clamp the high side, and the player/grounded-animal stay finite under finite-extreme dt via
their `MAX_STEP`/`exp(-rate·dt)` math; the shared `RegionStreamer` hysteresis (keep−visible gap) builds
each region at most once under oscillation; the replace-by-id stores + spawn-if-absent objective + the
`clear()`-on-load markers keep reload counts at exactly 1; terrain/water/slope/cache/relic are
deterministic across sessions; and the persisted runtime `state`/`slot` round-trips a real reload.

**dt scope (the one judgment call).** The probe feeds the finite extremes {0, 1e6, −1} — the reachable
(`dt=0`) and defensive (huge stall / backwards clock) cases — and proves finiteness + recovery. **NaN dt
is documented out-of-scope:** the frame loop's `dt = Math.min((now−last)/1000, 0.05)` over a monotonic
`performance.now` always yields a finite, non-negative dt, so NaN cannot reach the updaters in the real
loop; `FlockRuntime`/`AmbientRuntime` additionally early-return on `dt<=0`. No boundary guard was added
(it would be speculative hardening for an unreachable input — YAGNI), keeping FP-3 pure validation.

**Two additive DEV-only hooks (the only product touch; both in the `import.meta.env.DEV` block of
`src/main.js`).** `window.__DOC_DEBUG__()` reports document item counts + a scene-graph scan
(`relicWeapons`/`cacheBeacons`/`relicMarkers`/`objectives`/`runtimeAssets`) — the live scene + document
are module-local, unreachable from an eval — for the reload-duplication probe.
`__ARSENAL_EQUIP_DO__.poisonEquipMarker(id)` corrupts a placed weapon's equip marker so the live proof
can prove the finite-guard refuses the equip. Dynamic `import('/src/terrain/terrainSampling.js')` inside
an eval reaches `getHeight`/`getWaterLevel`, so no terrain-sample hook was needed. Stripped from prod.

**Verification.** `test:first-playable-hidden` + `-proof` green; **FP-2 `test:first-playable-proof`
passes UNCHANGED**; build, qa (skills 32/0/0 + layout), `test:world`, arsenal v1–v4,
`test:first-objective`(+proof), and the foundation sweep all green (`src/main.js` is +28 lines, purely
additive). Tag `world-builder-first-playable-hidden-fp3` (local, no push). Does NOT satisfy FP-4 —
`world-builder-first-playable-v0` stays reserved until the §7.9 go/no-go review. `docs/FIRST_PLAYABLE_BUILD.md`
§7.8 added + FP-3 marked done; §10/§11 refreshed (only the review remains).

**Non-goals.** No Arsenal v5, weapon variety, new objective, combat/inventory, live deploy, schema bump,
or gameplay-logic change (none was needed); no FP-2 proof change beyond shared-helper hardening; do NOT
apply `world-builder-first-playable-v0` (FP-4 only).

## ADR-035 — FP-4: First Playable Go/No-Go Review + Tag (the Glacial Valley First Playable is GO)

**Decision.** Run the §7.9 go/no-go review against `docs/FIRST_PLAYABLE_BUILD.md`, substantiate the manual
UX walk, verify the tree, and — since every §8 GO criterion holds and no NO-GO condition does — apply the
reserved milestone tag **`world-builder-first-playable-v0`** locally (no push). No gameplay was added;
FP-4 is judgment + tagging only. This CLOSES the first-playable gate (FP-0 → FP-4).

**Evidence.** (1) The full gate sweep is green: build, qa (skills 32/0/0 + layout; `qa:browser` WARN-skips
— Playwright absent), `test:world`, `test:first-playable-proof` (FP-2) + `test:first-playable-hidden`(+
`-proof`) (FP-3), `test:first-objective`(+proof), the foundation sweep (visual0/1, water, atmosphere,
wildlife/0/1, flock, ambient/0, streamer), and arsenal v1–v4 — 29/29. (2) The §7.9 fresh-context review
used FOUR independent reviewers across the ten dimensions (determinism · persistence · runtime leaks ·
spawn/grounding · terrain/profile single-source · water/wetness/snowline · region streaming · arsenal
boundary · browser-proof validity · UX clarity): **0 critical / 0 high / 0 medium; 1 LOW** (the WASD
`#hint` panel is hidden in runtime mode — F/G remain discoverable via the context-sensitive banner;
accepted by design). Reviewers independently confirmed the FP-2 walk is a REAL movement-pipeline traversal
(not teleport/state-write), the FP-3 reloads are real fresh pages, the single terrain source-of-truth holds
(the lone out-of-module `profile.height()` call is visual-only fog), the persistence whitelist drops no
field, no runtime path appends instead of replacing, and the arsenal boundary is airtight (recipe-only,
no baked geometry, no UI leak). (3) **Manual UX walk** — substantiated with LIVE on-screen evidence: the
always-on `#objective-banner` narrates every step (`…find the marked relic weapon and equip it (F)` →
`…carry the relic to the glowing cache marker` → `…press G to deposit the relic on the cache` →
`…COMPLETE. The relic rests on the cache.`), with a visible relic marker, a glowing cache beacon + deposit
ring, and the relic left as a visible trophy (`relicOnPedestal:true`, one beacon, completion latched). A
player needs only basic controls (WASD+mouse), which the gate permits.

**Honesty note (the one proxy).** The literal naive-human play-session is the only piece that cannot be
fully automated; it is proxied here by the live banner/marker/trophy evidence + four fresh-context reviews.
The tag is local + reversible (`git tag -d`) if a human session ever disagrees. The first-playable target —
*find → equip → carry → deposit a generated relic in the glacial valley, reload-safe* — is met.

**Tree + tag discipline.** The tree is clean except the known untracked `sword forge.html` (left
untracked). The FP-4 commit contains only the intentional first-playable files (this charter +
`docs/FIRST_PLAYABLE_BUILD.md`). Tag `world-builder-first-playable-v0` applied locally on that commit. NO
push, NO deploy.

**Non-goals.** No new gameplay, weapon variety, Arsenal v5, combat/inventory, new objective, schema bump,
or public deploy; no push without explicit authorization. Subsequent feature work builds ON this tag.

## ADR-036 — Arsenal v5: Relic Weapon Variety & Identity (the first feature ON the first-playable tag)

**Decision.** Make the central artifact of the first-playable loop — the generated relic weapon — feel
worth finding, by giving every generated weapon a **deterministic derived identity** (name / type / tier /
hash), stronger and more distinct silhouettes, and relic presentation that uses that identity. This is the
first feature stage built ON `world-builder-first-playable-v0`; it advances, and does not reopen, the gate.

**Key architectural decision — identity is DERIVED, never persisted.** `weaponIdentity(recipe)` recomputes
`{id, name, type, family, rarity, tier, hash}` from fields the recipe already carries and that
`sanitizeWeaponRecipe` preserves (seed/type/family/rarity/material.energyColor/parts, with `counts`
recomputed from parts). Because the recipe already round-trips through the runtimeAssets persistence
whitelist, identity recomputed on load is byte-identical → **"survives reload" for free, with ZERO whitelist
edits, ZERO `WORLD_DOCUMENT_VERSION` bump (stays 2), ZERO new persisted fields.** The namer seeds off the
canonical `recipeHash` (a stable 32-bit int), so it is stable under the persistence path's 3-decimal part
rounding. The canonical id/hash (`weaponAssetId`/`recipeHash`) are reused — no second id scheme. Naming is
**fully procedural** (the relic's name too — user decision) in an **arcane / energy-tech** aesthetic; the
relic still reads special via **forced relic-grade presentation** (top-tier gold aura/label) while its name
stays a pure function of its recipe.

**Surface.** New PURE arsenal modules `WeaponIdentity.js` (tier + arcane/energy-tech namer),
`WeaponRelicProfiles.js` (tier palette/labels + relic-grade-forcing `relicProfile`), and
`WeaponVariantGrammar.js` (the strengthened per-type silhouette kit, lifted out of `WeaponGrammar.js` which
now only orchestrates). New world-layer `src/world/objectives/RelicPresentation.js` (pure glue: name-enriched
banner + tier-coloured trophy style), consumed by `ObjectiveRuntime` (named banner, tier-coloured relic
marker + a new claimed-trophy aura, `relicName/relicHash/relicTier` in `debugSnapshot`). The Arsenal Lab
studio status shows name/tier/hash. No change to `relicRecipe()` determinism; markers stay position-only
arrays (v4 equip math untouched).

**Evidence.** Full gate green: build, qa (skills 32/0/0 + layout 43/0/0), `test:world`, arsenal v1–v4, the
NEW `test:arsenal-identity` (determinism, reload-stability across single + double sanitize, name distinctness
≥90% + well-formed, tier mapping/clamp, relic-grade forcing, strengthened-grammar invariants, no-random scan
of the 3 new modules), `test:first-objective`(+proof; the proof now asserts the relic carries a derived
name + recipe hash, presents as tier 5, and that name+hash survive a reload — proving derived-not-persisted),
`test:first-playable-proof`, `test:first-playable-hidden`(+proof), arsenal v3/v4/world proofs. The banner
substitution is asserted in `test:first-objective`.

**Adversarial review.** Three fresh-context reviewers (arsenal pure modules · world integration · tests):
**0 critical, 1 HIGH, 4 MEDIUM, 2 LOW.** Fixed: HIGH — `buildExotic` had no grip so the equip anchor fell on
a stray floating blade; the blade fan is now biased to non-negative Y so the haft (first part, y=0) is the
equip anchor (also a nicer upward crown). MEDIUM — `relicProfile` now overrides `identity.tier` to match the
forced presentation tier; the banner substitution is now tested; distinctness tightened 80%→90% + structural
name pattern; a double-sanitize idempotency assertion added. LOW ×2 accepted (mixed numeric/string colour
param — THREE accepts both; alias-blind static scan — acceptable). World-integration reviewer returned
APPROVE (0/0/0).

**Gotcha (the recurring prose-in-comment scan trap).** Two boundary scans tripped on COMMENT prose in
`RelicPresentation.js`, not on real code: the isolation grep matched the literal `arsenalMain`, and the
no-random scan matched `performance.now (` (token + space + paren). Reworded the comment to describe the
constraints without spelling the forbidden tokens. Same class as the Wildlife-0 / Ambient-0 scan false-matches.

**Non-goals (held).** No damage/firing/ammo/combat/enemies/inventory/loot economy; no persisted geometry; no
new persisted fields / no schema bump; no change to `relicRecipe()` determinism; no push/deploy. Commit +
tag `world-builder-arsenal-v5` locally; `sword forge.html` left untracked.

## ADR-037 — Gate Repair-0: Visibility Test Rebaseline + Sweep Isolation Triage (greening the working baseline)

**Decision.** Before expanding features (Arsenal v6), make the active working baseline green. The Build Status
Ledger surfaced one genuine red gate (`test:visibility`) and three sweep-fragile gates; repair them by
correcting **tests/fixtures only** — never by mutating shipped runtime behavior or weakening assertions.

**Diagnosis (proven, not assumed).** `test:visibility` (the Stage 17A SwiftShader proof) authors a world with
two animated rigs and asserted the kernel registered exactly **2** agents; it now registers **3**. A throwaway
agent dump showed the third agent is `relic-weapon-fp1` — the relic the objective **auto-spawns in any runtime
world since FP-1**, which `PlacedWeaponRuntime.load(..., visibilityKernel)` registers as an agent. It is
registered exactly ONCE (`__DOC_DEBUG__` → `relicWeapons:1`), so this is correct runtime state, not a
double-registration bug. The `=== 2` assertion simply predates the FP-1 auto-spawn (it also fails at the FP-4
commit — pre-existing, unrelated to Arsenal v5). The kernel works (registers all placed agents, never hides,
tiers correctly); only the test's expected count was stale.

**Fix.** Rebaselined the proof to the intended agent set and **strengthened** it rather than loosening it: it now
explicitly asserts the relic agent is registered (`relic-weapon-fp1` present) AND `vis.total === 3` (2 authored
rigs + 1 auto-spawned relic), with a comment so a future change to what auto-registers trips it on purpose. All
prior coverage is retained (both rigs present, near awake / far asleep, the no-hide invariant, the
asleep-mixer-frozen check). The change is confined to `scripts/browser-visibility-proof.mjs` — **no `src/`
change, no runtime/visual behavior touched.**

**Sweep-fragile triage (resolved with zero extra changes).** `test:undo`, `test:connectors`, `test:visual0`
passed in isolation but failed in a back-to-back Node sweep. Hypothesis: they were collateral from the
*crashing* visibility proof leaving residue. Confirmed — after the visibility fix the full sweep is **39/39
green in a single run**. The fragility was a symptom of the red gate, not independent test-isolation debt; no
per-test cleanup hack was warranted.

**Verification.** `test:visibility` green alone AND in the full sweep; Node sweep 39/39; `build`, `qa:skills`
32/0/0, `qa:layout` 43/0/0; `test:first-playable-proof` and `test:arsenal-identity` remain green; `git status`
shows only the one test script modified. Committed test+ledger only; tagged `world-builder-gate-repair-visibility-v0`
locally; `sword forge.html` left untracked.

**Why this before Arsenal v6.** A first playable plus a *truthful* ledger is the asset; allowing the ledger to
normalize a known red gate ("green except for known stuff") is the debt this repair prevents. Feature work
resumes on a fully green baseline.

## ADR-038 — Arsenal v6 + Slice-0: The Frozen Cache Authored Experience

**Decision.** Accept Arsenal v6 multi-carry/holster behavior as the prerequisite for Slice-0, then layer the
first authored 5–10 minute experience over the existing FP-1 relic objective. `ObjectiveRuntime` remains the
sole completion authority; `FrozenCacheSlice` observes it and owns only authored presentation: arrival and
route beats, three landmarks, contextual F/R/H/G prompts, an optional tutorial weapon, a stronger guidance
beacon, procedural WebAudio feedback, and the completion card. Completion is saved at deposit and restores
the trophy/card after reload. No generalized quest system or new document schema was introduced.

**Boundaries held.** No combat, enemies, damage, inventory screen, crafting, dialogue, economy, live service,
or new procedural world system. The tutorial weapon uses the existing recipe/runtime-asset path. The slice
composes from the runtime-resolved player spawn so dry-ground relocation cannot separate the tutorial from
the player. First-run teaching state is local UI preference data; objective/trophy truth remains in the
validated world document.

**Evidence.** Implementation commit `464c4a2`. New gates `test:arsenal-carry`, `test:arsenal-v6`,
`test:frozen-cache`, and `test:frozen-cache-proof` pass. The Frozen Cache proof verifies arrival banner,
beacon, authored landmarks, contextual F/H/R/G sequence, relic deposit, completion card, trophy, reload
persistence, and zero console errors. `test:first-objective`, `test:first-playable-hidden` and its six-session
SwiftShader proof remain green. Build and aggregate QA pass (`qa:skills` 32/0/0, `qa:layout` 43/0/0;
`qa:browser` WARN-skips because Playwright is absent).

**Review.** 0 critical / 0 high / 0 medium. Proof-driven fixes aligned authored placement with the resolved
spawn and separated the optional pickup from the relic interaction radius so F and H teach as distinct beats.
The hidden proof now asserts exactly one relic plus exactly one tutorial weapon across reloads rather than the
obsolete “only relic” total.

**Known caveats / next gate.** Browser audio begins only after user activation. The production build retains
its pre-existing large-chunk warning. Automated clarity assertions prove UI state, not human comprehension;
Slice-0A must record a fresh tester's friction and prove completion without outside explanation before
Combat-0 begins. Tag `world-builder-slice0-frozen-cache` locally; no push/deploy; `sword forge.html` remains
untracked.

**Post-acceptance hardening.** A later fresh-context adversarial review of the carry engine found a latent
orphan in `WeaponEquipRuntime.applyOccupancy`: it clears the slot map then re-attaches each weapon, so an
attach that fails mid-swap (a non-finite marker) would leave a previously-carried weapon parented to the
player yet absent from the occupancy map — unreachable in normal play (markers are finite + immutable), but a
violation of the explicit never-orphan invariant. Fixed by a safety net that drops any such weapon to the
world instead, plus a `_dropToWorld` extraction and a deterministic `test:arsenal-carry` §9b
(poisoned-marker-mid-swap → dropped, not orphaned). A small `fix(arsenal)` commit on shipped v6; no behavior
change for valid input.

## ADR-039 — Focused Procedural World Editor, Not "Unreal-in-a-Tab" (product doctrine)

**Decision.** Lock the product identity: this is a **specialized, browser-native procedural environment +
encounter editor**, not a general-purpose engine clone. The honest target is AAA-*grade* quality within a
focused niche — excellent interaction design, fast deterministic generation, strong terrain/atmosphere/
vegetation/composition, reliable export + playable previews, professional debugging/validation/undo/profiling/
persistence. It is explicitly **not** an attempt to match Unreal's full renderer, animation stack, physics,
cinematic tooling, and decades of asset-ecosystem investment. "Unreal-in-a-tab" is a losing comparison that
would dilute what makes this promising; a focused editor that authors playable spaces quickly, deterministically,
and beautifully is a real product.

**Division of labor (the doctrine).**

```text
Math owns structure.        (terrain, placement, roads, vegetation, settlements, visibility, LOD, validation)
Art direction owns identity.(characters, architecture kits, hero props, animation, sound, textures)
The browser owns reach.     (portable, collaborative, instant-launch — scope is the constraint, not the browser)
The editor owns usability.  (selection, snapping, layers, non-destructive modifiers, autosave, crash recovery)
The gate owns truth.        (every "done" is backed by a command/proof, never a vibe)
```

Pure procedural geometry looks technically impressive but visually homogeneous; AAA presentation comes from
**art direction + procedural composition**, not mathematics replacing artists.

**Browser reality.** WebGL carries this project much further than its current use; memory limits, shader
compilation, file access, threading, and mobile GPUs shape the product but are not fatal. **WebGPU** is a
future feasibility gate (see roadmap), not a permanent ideological exclusion.

**Roadmap (supersedes the short list above; each builds ON `…first-playable-v0` + `…slice0-frozen-cache`).**

```text
1. Slice-0A           — Human UX hardening (fresh-player completion without coaching)  ← IMMEDIATE NEXT
2. Editor UX-1        — hierarchy, selection, snapping, layers, autosave
3. Performance Contract-1 — explicit CPU/GPU/memory/draw-call budgets + benchmark scenes
4. Procedural Authoring-1 — editable splines, biome masks, non-destructive modifiers
5. Asset Pipeline-1   — GLB import + validation, LOD/collision gen, material templates, provenance/budgets
6. Combat-0           — combat seam only (no enemies)
7. Enemy-0            — one non-networked test enemy
8. Encounter Editor-0 — authored encounter placement  ← SHIPPED (ADR-047)
9. Geometry Stream Gate-0 — deterministic ≤64k-vertex chunked geometry streaming (infra gate; does NOT replace LOD)  ← SHIPPED (ADR-048)
10. Visual Benchmark-1 — one compact area polished to shipping quality  ← SHIPPED (ADR-049)
11. WebGPU Feasibility Gate-0 — feasibility-only research gate; go/no-go = B (keep as experimental lab)  ← SHIPPED (ADR-050)
12. Environment Polish-1 — visual benchmark expansion (landmarks + readability overrides + feedback), still WebGL  ← SHIPPED (ADR-051)
13. Encounter-1 — authored combat-beat polish (telegraph + gate-light + phase/banner), no AI director  ← SHIPPED (ADR-052)
14. Content-1 — second authored combat beat (repeatable encounter composition: crossing + cache gate), no AI/waves/loot  ← SHIPPED (ADR-053)
15. Content-2 — authored slice expansion (off-route frozen shrine: exploration + sign + fog + optional exotic reward), no AI/loot-system  ← SHIPPED (ADR-054)
16. (await operator pick) — Enemy-1 (movement/patrol, the bigger foundational seam) / more authored content+audio / Nanite-like Shader Feasibility (only if visuals/perf become the constraint)
```

**Decisive milestone.** Not "more systems" — one compact environment that looks intentional, edits smoothly,
survives reloads, holds frame rate on target hardware, and rebuilds repeatedly without developer intervention.

**Immediate next = Slice-0A (do not skip).** Frozen Cache works *technically* (automated proofs assert UI
state), but Slice-0A answers the product question automated gates cannot: **can a fresh player understand and
finish the slice without being coached?** It records a real tester's friction and proves completion without
outside explanation before Combat-0 begins.

## ADR-040 — Slice-0A: Human-UX Hardening + Instrumentation (the human walk is the OPEN gate)

**Status: ACCEPTED — tag `world-builder-slice0a-human-ux`.** Slice-0A's completion gate is a real fresh-player
walk recorded by the operator, and it is now met: across three walks the operator drove the slice to a clean,
no-coaching completion (session log: `discovery → F pick-up → return → deposit → G → complete @ 20.2s`, zero
`stuck` events), and the three friction items found along the way (see the friction log) were fixed. This stage
ships the *hardening + instrumentation* that made that walk productive and observable; it does NOT claim
human comprehension is *proven* for every newcomer — the operator had played it several times by the accepting
walk, so a brand-new person's cold first-contact remains the only stronger evidence, and the tag is therefore
**reversible** if a fresh tester later trips on something. (Evidence bar chosen by the operator: "harden +
instrument for me," not an automated self-guided proxy.)

**Why a different shape.** "Can a fresh player finish without coaching?" cannot be self-graded — an automated
proof asserts UI *state*, not human *understanding*. So Slice-0A does what automation legitimately can: (1) a
rigorous friction audit, (2) hardening of the genuine gaps, (3) instrumentation so the operator's own walk is
recorded and friction is visible — then hands the comprehension judgment to a human.

**Friction audit → hardening (shipped).**

- *Controls discoverability* (the top gap): the slice teaches F/H/R/G contextually but NOTHING taught
  movement/look/camera, and the editor controls hint is hidden in play mode — a fresh player could stall at
  "how do I move?" New `ControlsHint` shows Move/Look/Camera on arrival and fades on the player's first
  demonstrable movement (or after an 8s window).
- *Quiet navigation stretches*: a `_maybeStuckNudge` surfaces a gentle "follow the beacon" prompt only after a
  long (18s) unproductive dwell in a navigation beat — far beyond any scripted run, so it guides a genuinely
  lost player without masking normal play. It is always logged as friction even though it also helps.

**Instrumentation (shipped).** `SliceTrace` records the walk — `load`, `beat` transitions, `prompt` changes,
`action` (F/H/R/G), `firstMove` (time-to-first-movement), `stuck`, `complete` — timestamped by the slice's
deterministic `elapsed` (no wall-clock). A toggleable on-screen session log (press **L** in play mode), a
`__SLICE_TRACE__()` debug hook, and a `debugSnapshot` summary let the operator review exactly where the slice
helped or lost them.

**Boundaries.** Play-mode only (`instrument = ?play`); the bare `?runtime=1` harness never renders the hint or
trace, so the arsenal/visibility/first-playable proofs are untouched. No document-schema change, no new world
system, no combat/inventory. Additive UI + telemetry; the existing objective/slice completion logic is
unchanged (the friction trace never affects gameplay).

**Verification.** NEW `test:slice0a` (SwiftShader): the controls hint is visible on arrival and DISMISSES on
first movement (logging `firstMove`); the trace records `load/beat/action/stuck/complete`; the stuck nudge +
`stuck` event fire after a long dwell; the slice still completes end to end. `test:frozen-cache`(+proof),
`test:first-objective`, `test:first-playable-hidden`, `build`, `qa:skills` 32/0/0, `qa:layout` 43/0/0 all
remain green. Committed locally; **no tag** (the human walk is the gate); `sword forge.html` untracked.

**Operator hand-off (how to close this gate).** Open `/?play=1` with a cleared profile, press **L** to show the
session log, and play the slice as a fresh player WITHOUT looking at code or this doc. After the walk, read the
trace (or `__SLICE_TRACE__()`): a long gap before the first `action`, a high `firstMove` time, or any `stuck`
event marks real friction. Report what confused you; those become the hardening backlog. When a walk completes
without coaching, tag `world-builder-slice0a-...` and flip this ADR to accepted.

**Friction log — walk #1 (operator, 2026-06-19): completed the slice; 2 friction items found + fixed.**

1. *Replay path was missable.* On completion the operator wanted to replay, but "Keep Exploring" sat FIRST and
   was silently unwired (`onExplore` undefined → it just hid the card with no feedback), and the reset lived in
   the second button. Fix: the card now leads with a primary **"↻ Play Again"** (restart), demotes **Keep
   Exploring** to a labelled secondary that records an `explore` trace event, and adds a one-line explanation of
   each choice. (`CompletionCard` + completion-card CSS.)
2. *The editor controls bar leaked into play mode.* The full `#hint` bar (Move/Jump/Sprint/Look/Camera/Debug)
   stayed up the whole session, redundant with the compact arrival `ControlsHint`. Fix: `body.play-mode #hint {
   display: none }` plus a `play-mode` body class — a CSS guarantee independent of JS load path, so the arrival
   hint is the single controls teacher. `test:slice0a` now asserts `#hint` is hidden in play mode and that the
   card's primary action is Play Again. Stage remains OPEN pending a clean no-coaching walk.

**Friction log — walk #2 (operator, 2026-06-19): the biggest gap — no way to PLAY.** The operator kept landing
on `localhost:5173` (the editor/sandbox), where the slice does not run: pressing **L** did nothing, there was
no quest, just the leftover deposited relic from the earlier completed save, and the full editor controls bar
showed. Root cause: the slice/quest/session-log all require `?play=1`, but the only toolbar button was "▣ World
Builder" — **there was no Play entry at all**, so a player had to know to type `?play=1`. Fix: a primary
**▶ Play** button in the toolbar (`#enter-play` → `/?play=1`), so entering the game is one click and the
`?play=1` URL is never something a player must discover. `test:slice0a` asserts the Play button is present and
primary on the sandbox landing. (Lesson: the play-mode fixes from walk #1 were correct but invisible because
the operator was never in play mode — the discoverability of *play itself* was the real first-contact gap.)

## ADR-041 — Editor UX-1: First Usable Authoring Surface (the editor becomes the product)

**Status: ACCEPTED — tag `world-builder-editor-ux1`.** First stage of ADR-039's "editor is the product"
pivot. The runtime loop is understood (FP-4, Slice-0A); the bottleneck is now the **authoring surface**. This
turns the developer sandbox into a surface where a non-coder can *author or adjust a Frozen-Cache-style space*:
a Hierarchy/outliner, two-way selection (viewport ↔ list), a numeric transform inspector, grid snap, per-category
layer visibility/lock, debounced autosave with a status chip, and the Play↔Editor round-trip.

**What already existed (reused, not rebuilt).** The editor already had raycast click-select + multi-select,
`SelectionGroup` highlights, a `TransformControls` gizmo, an undo/redo `CommandStack` with Add/Remove/Transform
commands, and `WorldSerializer` save/load. Editor UX-1 is gap-filling wired onto that, not green-field.

**Core boundary decision (the invariant defended hardest): editor view state is session-only, never persisted.**
Layer visibility/lock and snap settings are an editor *view* concern. They are NOT written to the WorldDocument
→ zero schema change (`WORLD_DOCUMENT_VERSION` stays **2**), zero whitelist/validation edits, and — critically —
**a layer hidden or locked in the editor can never hide content for a player.** They reset on world reload, like
the undo history. The serializer (`WorldObjectManager.serializeWorldObject`) writes `runtime.visible =
object.visible` per child, so the **trap** was using `object.visible` for layer-hide. Avoided two ways:
(1) the six system layers (terrain/water/wildlife/ambient/arsenal + the editable-objects parent) toggle
*system-owned roots* that never go through `serializeWorldObject`; (2) the "objects" layer toggles the **parent**
`manager.root.visible` — the serializer reads each *child's* own `.visible`, never the root's — so hiding it
changes nothing that persists. The browser proof asserts `allChildVisible` stays true after a hide+save.

**Layers scoped honestly.** Objective markers are runtime-only (`objectiveRuntime` is null in editor mode), so
"objectives" is **not** a dead Layers toggle — the objective is surfaced in the Hierarchy instead, read from
`document.objectives`. Lock is shown only on the editable-`objects` layer (the only raycast-selectable content),
gating the selection raycast via a pure editor Set — no fake lock toggles on layers with nothing to select.

**New modules.** Pure + Node-testable: `SnapSettings` (grid/rot/scale snap math + a `TransformControls` driver),
`EditorAutosave` (debounced `idle→dirty→saving→saved|error` state machine, injected timer), `LayerModel`
(visible/lock Sets + an injected `onVisibility` callback so the editor owns the THREE toggle). DOM panels:
`HierarchyPanel`, `TransformInspector`, `LayersPanel`. Three runtime systems gained a tiny additive
`setVisible()` (`WildlifeSystem`/`AloftWildlife`/`AmbientSystem`) — pure render flag, never serialized. Arsenal
visibility is handled in-editor (`_setArsenalVisible`) so a *stored* (intentionally hidden) weapon is never
revealed by a layer toggle.

**Autosave.** The manual Save button and the debounced autosave share one persistence path (`_persistWorld` →
`updateDocumentFromRuntime` → `WorldSerializer.save`) so both produce byte-identical saves. Edits mark dirty
(via `history.onChange` + the system-panel callbacks); the ▶ Play button flushes autosave first so Play always
tests the latest edits. **Throw-safe reset:** `setWorldContext` resets autosave (cancelling the timer armed by
`history.clear()`) *immediately* after the clear, before any panel-setup line can throw — so a half-reconstructed
world is never autosaved over the saved one (review fix, see below).

**Play round-trip.** Editor→Play already existed (▶ Play → `?play=1`). Added Play→Editor: a `#exit-play` corner
button shown only in play mode (`body.play-mode`) → `/`. The proof clicks both and asserts the mode lands.

**Verification.** TDD: `test:editor-ux1-unit` (12 checks: Snap/Autosave/Layer logic) RED→GREEN first.
`test:editor-ux1` (SwiftShader) drives the full loop: place→Hierarchy lists→select-from-row→snap (gizmo +
placement + nudge land on grid)→hide objects layer (root hidden, children stay visible)→lock (un-pickable)→
autosave flush (status saved, localStorage has 3 objects, all children still visible)→reload (objects persist)→
Play→Back-to-Editor. Full regression re-run green: `test:undo`, `test:slice0a`, `test:arsenal-v6`,
`test:frozen-cache(+proof)`, `test:first-objective-proof`, `test:first-playable-proof`, the Node subset, qa
skills 32/0/0, qa layout 43/0/0, build, qa:browser.

**Review (2 fresh-context reviewers, adversarial).** Verdict 0 critical / 0 high; the persistence invariant held
on all five probes. Fixed: **MEDIUM** — the autosave timer armed by `history.clear()` could survive a thrown
exception during the ~50 lines of panel setup and later fire against a half-loaded world; moved `autosave.reset()`
to immediately after `history.clear()`. **LOW** — `_arsenalHidden` wasn't cleared on world reload (a transient
visual glitch, no persistence impact); now cleared in the same throw-safe block. Both re-verified green.

**Non-goals (held).** No Unity/Unreal clone, no terrain-sculpt/combat/inventory, no persistence rewrite, no new
persisted fields/schema bump, no generalized asset browser, no complex gizmos. `relicRecipe()` and all runtime
proofs byte-unaffected (Editor UX-1 adds editor-session view tooling only). Next per ADR-039: Performance
Contract-1.

## ADR-042 — Performance Contract-1: Performance as a Tested Gate

**Status: ACCEPTED — tag `world-builder-performance-contract-1`.** Editor UX-1 made the product *authorable*,
which changes the risk profile: the next failure mode is silent performance collapse as authored worlds grow
(Procedural Authoring-1 will multiply objects), so a tested performance contract comes first. The bar: *how large
can a Frozen-Cache-style authored scene get before the editor or play mode becomes unreliable, and how do we
catch that automatically?*

**Reuse-heavy by design (the suggested module shape largely duplicated existing infra).** Stage 20A already
ships the measurement plumbing — `src/perf/PerformanceBudget.js` (the pure `classify`/`evaluateBudget` +
calibrated `PERFORMANCE_BUDGETS`), the `__BUDGET__`/`__PERF__` DEV hooks, `perf:report`, `test:budget`, and a
`.stats`/`debugSnapshot()` on every system. This stage did NOT re-plumb measurement; it turned the measurements
into a **gate**. Stage 20A's `PerformanceBudget.js`, `BudgetHUD.js`, and `browser-budget-proof.mjs` are
byte-stable (verified by review + `test:budget` staying green). The new modules live in `src/perf/` beside them.

**New modules (PURE).** `src/perf/BenchmarkScenes.js` — four deterministic, reusable benchmark scenes
(`emptyScene`, `frozenCacheScene`, `denseAuthoredScene(n)`, `streamingBorderScene`) returning plain
WorldDocuments via `createWorldDocument` + the city generator; no RNG/wall-clock (statically scanned). Each
carries a `gated` per-scene ceiling map. `src/perf/PerformanceContract.js` — `CONTRACT_BUDGETS` (spreads
`...PERFORMANCE_BUDGETS` + four contract-only metrics: `objects`, `runtimeAssets`, `memGeometries`,
`memTextures`), `extractMetrics({perf,budget})`, `evaluateContract`, and the hard gate `assertWithinBudget` (a
per-scene ceiling breach OR a global RED-ceiling breach throws; **yellow is a warning, never a failure**, so
vegetation's intended triangle pressure does not false-fail).

**Only additive runtime edit.** `__PERF__.snapshot()` gained three read-only fields (`wildlife`/`ambient`/
`arsenal` actor counts from existing `.stats`) inside the existing DEV gate, null-guarded. No schema/persistence
change (`WORLD_DOCUMENT_VERSION` stays 2).

**Two gates (TDD).** `test:performance-contract` (pure Node, 8 checks): contract logic + scene determinism +
headless load/unload stability (object + geometry counts return to baseline across 5 reloads) + save/load
round-trip no-duplication. `test:performance-contract-proof` (SwiftShader): per-scene authoring → capture
`__PERF__`+`__BUDGET__` → `assertWithinBudget` (fails on breach) → reload stability (objects/runtime-assets/
geometry don't grow) → streaming-border boundedness → a software-raster liveness/stall smoke → editor-mode
autosave bounds (~2 ms serialize / ~9 ms write for 500 objects). The per-scene ceilings are the measured baseline
plus ~30-45 % headroom (captured by running the proof once, then locked just above) — empirically non-vacuous:
the gate failed during calibration when a ceiling sat below the real number.

**Performance Contract — budgets + measured baseline (SwiftShader, structural / GPU-independent):**

| Scene | draws | triangles | objects | inst.batches | veg.patches | runtime-assets | ceiling (draws / tris) |
|---|---|---|---|---|---|---|---|
| empty (fresh editor, default grass) | ~89–110 | ~504–516k | 0 | 0 | ~56–62 | 2 | 160 / 700k |
| frozen-cache (slice base) | ~89–110 | ~504–516k | 0 | 0 | ~56–62 | 2 | 160 / 700k |
| dense-authored (500 cubes, grass↓) | ~111 | ~381k | 500 | 1 | ~62 | 2 | 160 / 560k |
| streaming-border (city, default grass) | ~113 | ~488k | 114 | 3 | ~62 | 2 | 160 / 620k |

Global RED design ceilings (the scene-independent backstop, from `PERFORMANCE_BUDGETS`): draws 240, triangles
1.4M, instanced batches 120, generated objects 1000, veg patches 320; contract-only: objects 2500, runtime
assets 150, geometries 6000. Key reading (unchanged from the Stage 20A report): **triangles are the dominant
budget driver — default grass alone puts the "empty" scene near the green/yellow line; draw calls stay flat
because instancing collapses repeated primitives** (500 cubes → 1 batch).

**Review (2 fresh-context reviewers, adversarial).** Verdict: 0 critical / 0 high / 0 medium. Reviewer A
confirmed the structural gate (draws/triangles/objects/batches/reload-stability) is genuinely load-bearing and
catches the named regressions; flagged four weak checks that read as coverage they didn't provide — all
hardened: the frame check now has a real multi-second **stall detector** (`worstMs < 2000`) and the rest is
honestly labelled a software-raster liveness smoke (not a frame-budget gate); the streaming check now requires
grass to be **actually streaming** (`grass1 > 0`) before bounding it, and gates wildlife thrash only when live;
the geometry-growth check asserts the metric is measured (it is `renderer.info`-sourced, always present).
Reviewer B confirmed no system weakening (the `denseAuthoredScene` grass↓ is a fixture authoring choice, not a
default change; empty/frozen-cache/streaming run default density), Stage 20A byte-stable, the main.js edit
additive, and no schema impact (1 LOW — the streaming scene was running sub-default density — fixed by removing
the override so it measures player-facing cost).

**Non-goals (held).** No renderer rewrite, no WebGPU, no HLOD, no asset compression, no procedural authoring, no
combat, no gameplay change. **No weakening of visual/world systems to fit a budget** (the gate measures the real
scene). Stage 20A budget infra byte-stable. Next per ADR-039: Procedural Authoring-1.

## ADR-043 — Procedural Authoring-1: Editable Spline / Mask / Modifier Primitives

**Context.** Editor UX-1 made the world authorable and Performance Contract-1 put a measured ceiling under it, but
*everything a user could place was still hand-placed* — there was no way to shape a *region* (a guided path, an
influence area) without dropping objects one at a time. The smallest tool that changes that, and that improves
player readability of a Frozen-Cache-style space, is a **spline-guided trail/landmark modifier**.

**Decision — derived, non-destructive output (NOT baked).** Add three editable primitives behind one new additive
document block `authoring: { version, splines[], masks[], modifiers[] }`. The decisive architecture call (it
resolved a real fork in the design research): **the authored splines/masks/modifiers are the persisted source of
truth; the modifier's VISUALS are re-derived every load and never written into `document.objects`.** This is the
existing **`runtimeAssets` idiom** ("rebuilt from a recipe each load") applied to authoring — the faithful reading
of "non-destructive" — NOT the generator idiom (which bakes emitted objects into `objects`). Consequences:
`document.objects` stays clean, editing the spline + re-deriving never accumulates baked geometry, and the perf
gate watches the derived-geometry path (triangles/draws/batches) rather than the object count.

**Mechanism.**

- **Source of truth + whitelist** — `src/world/authoring/AuthoringTypes.js` is the validation boundary (mirrors
  `ObjectiveTypes`/`RuntimeAssetTypes`): `sanitizeAuthoringBlock` whitelists every field, caps the lists, ALWAYS
  emits the `enabled`/`locked`/`ring` booleans (so falsey survives save→load), drops a descriptor on any
  non-finite point/radius (never silently repaired to origin), enforces 3..8 spline points and mask-radius bounds,
  and keeps a modifier's spline/mask references syntactically (resolved + skipped at runtime, never crashed). One
  line wires it into `WorldValidation` after `objectives`. **No `WORLD_DOCUMENT_VERSION` bump** (stays 2);
  zero warnings on an empty block.
- **Derivation (pure, deterministic)** — `BeaconTrailModifier.deriveBeaconTrail` samples the spline (a THREE-free
  uniform Catmull-Rom), gates samples by the mask (circle/box with a falloff band), and returns marker transforms
  plus an optional ground ring. Seeded by `mulberry32(stringToSeed(seed))` — no `Math.random`/wall-clock; a jitter
  draw is consumed for EVERY sample so the seeded stream stays stable regardless of which samples the mask gates
  out (byte-identical across reloads).
- **Runtime (re-derived visuals)** — `AuthoringRuntime` is owned by `WorldRuntimeLoader` exactly like
  `wildlife`/`ambient` (built in `load()`, torn down in `dispose()`, returned in the result). Because **both**
  runtime load paths call `WorldRuntimeLoader.load()`, this single wiring covers editor preview AND play — the
  recurring "two load paths" gotcha is sidestepped. One `THREE.Group` per enabled modifier; markers are a single
  InstancedMesh (flat draw calls), the mask edge one Torus. Markers reuse the ObjectiveRuntime `beaconMat` idiom +
  `getHeight` grounding. `updateDocumentFromRuntime` is intentionally left untouched (the block is authored data,
  current in place — the lighting persistence pattern).
- **Editor surface** — `AuthoringPanel` + editor-only `SplineEditTool`/`MaskEditTool` (reuse the existing
  raycaster; previews are never serialized, never in play). Edits are **pure-data commands** on the block
  (`AuthoringCommands`: Add/Remove/Update) executed through the existing `CommandStack`, so undo/redo + autosave +
  the outliner all work; each `do/undo` mutates the block and calls `authoringRuntime.rebuild()`. `dispose()` is a
  no-op (no parked GPU objects — the runtime owns the derived geometry). The block also lists in the Editor UX-1
  hierarchy.
- **Perf gate** — a 5th canonical benchmark `authoredProceduralScene()` (one beacon trail over a 5-point spline +
  circle mask) joins `allBenchmarkScenes()`; the contract proof asserts it within budget. Because output is
  derived geometry not `objects`, the per-scene ceiling gates triangles/draws/batches; `objects`(4)/`batches`(4)
  are small absolute guards that would breach if the trail ever leaked into placed objects.

**Performance — captured then locked (SwiftShader, structural / GPU-independent).** authored-procedural: draws
112, triangles 516k, objects 0, instanced batches 0, veg patches 62 → overall **yellow** (default grass dominates
triangles, like the empty floor; the ~16-marker trail adds only a few hundred triangles + zero placed objects).
Ceilings: draws 160 / tris 700k / objects 4 / batches 4 / veg 120. The gate is non-vacuous (the proof asserts the
trail actually derived markers, and `objects 0` confirms nothing is baked).

**Gates (TDD).** `test:authoring-procedural` (pure Node, 9 checks): validation drop/clamp/cap rules, falsey
survival, derivation determinism + mask gating + getHeight grounding, `WorldSerializer` round-trip with no schema
bump + idempotent re-validation, dangling-reference tolerance, benchmark determinism + a no-RNG static scan.
`test:authoring-procedural-proof` (SwiftShader): author spline→mask→trail in the editor → derived trail renders →
undo/redo restores exactly → **regenerate yields a fresh seed even across reload** → autosave + reload PERSISTS →
the trail shows in PLAY (and the editor — hence any edit gizmo — does not exist in runtime) → the authored
benchmark stays within the performance contract → an authored trail coexists with the relic objective on the
Frozen Cache base. 0 console errors. (Full slice completion is the unchanged `test:first-playable-proof`.)

**Review (5 fresh-context reviewers, adversarial; each critical/high verified by a skeptic).** Net **0 unresolved
critical/high**. Three reviewers flagged disposal double-free / use-after-free as critical/high; the verify phase
plus the actual three.js **r0.169.0 source settled it — `InstancedMesh.dispose()` frees only `morphTexture` + the
per-instance buffer, never the shared geometry/material** — so those were confirmed FALSE POSITIVES (the shared
geo/mat are freed exactly once in `dispose()`; the disposal comment now documents the verified semantics). One
genuine HIGH was confirmed and FIXED: `regenerateModifier` used a session counter that reset on reload, so the
first post-reload regenerate reproduced the same seed (a silent no-op) — now the suffix is parsed from the
persisted seed and bumped monotonically, with a dedicated proof assertion. Medium/low items (benchmark-comment
precision; an explicit play-mode no-editor assertion) addressed.

**Non-goals (held).** No road system, settlement grammar, terrain erosion/overhaul, asset import, node graph,
combat, WebGPU, or live deploy. No `WORLD_DOCUMENT_VERSION` bump. No new persisted visuals in `objects`. Mote-
density boost (would fold into the ambient seed) and a fog-thinning corridor (no local/volumetric fog) were
explicitly deferred. Next per ADR-039: **Asset Pipeline-1**.

## ADR-044 — Asset Pipeline-1: Validated GLB Budget Gate (reuse, not rebuild)

**Context.** The doctrine is "math handles composition, authored assets provide identity," so the next bottleneck
after authoring was importing real meshes — with scale discipline, validation, and budget enforcement — without
breaking performance, persistence, or the procedural source-of-truth model. Research surfaced the decisive fact:
**a working GLB pipeline already existed.** `AssetImporter.importGLTF` loads a GLB through a real `GLTFLoader`;
`AssetStore` persists the binary in IndexedDB (`grass-world-assets`, metadata + blobs stores); `AssetLibrary` is the
registry with stable ids + lazy `resolve`; `document.assets` carries a metadata manifest (`createManifest` flags
`localIndexedDB:true`); `WorldObjectManager.addFromAsset`/`_buildObject3D` place a GLB as a world object referenced
by `assetRef`; the rigged-animation runtime even plays its clips (proven by `test:anim`). Persistence already obeys
the core rule — the binary never enters `.world.json`; the document holds a reference.

**Decision — add the missing validation/budget layer; reuse everything else.** Building the originally-suggested
greenfield module list (AssetRegistry / AssetImport / AssetRuntimeLoader) would DUPLICATE `AssetLibrary` /
`AssetImporter` / `AssetStore` — the adapter swamp the project rules forbid ("smallest coherent change", "reuse
canonical utilities", "read existing ownership boundaries"). The genuine gap was that **nothing measured or enforced
an imported asset's cost.** So this stage adds ONE new module and threads a budget through the existing seams — the
same shape as Performance Contract-1 (which reused the Stage 20A measurement infra and added a gate on top, leaving
the measured system byte-stable).

**Mechanism.**

- **The budget boundary** — new `src/assets/AssetBudget.js` (pure, imports only `three`; isolation grep-enforced).
  `computeAssetBudget(object3D, animations)` traverses a loaded scene (the `AssetPreview` idiom) → `{ triangles,
  materials, textures, nodes, meshes, hasAnimation, clipCount, maxDimension }` (materials/textures counted unique by
  uuid; triangles handle indexed + non-indexed). `validateAssetBudget` grades it against `ASSET_BUDGET_LIMITS`
  (triangles / materials / textures / nodes / maxDimension upper tiers + a `tinyDimension` floor = scale discipline)
  → `{ severity: ok|warn|reject, breaches }`. `AssetBudgetError` carries the report; `sanitizeAssetBudget` is the
  pure persistence whitelist (clamps counts non-negative — a corrupted budget can't subtract from a summed report).
- **The gate** — `AssetImporter.importGLTF` computes the budget AFTER parse and BEFORE `storeAsset`. A `reject`
  verdict THROWS `AssetBudgetError` (the throw precedes storage, so the budget-busting asset never reaches IndexedDB
  or the in-memory map); a `warn` is stored + flagged. The captured budget rides in the asset metadata.
- **Persistence (no schema bump)** — the `budget` field is threaded through the three whitelists:
  `AssetValidation.normalizeAssetMetadata`, `AssetLibrary.createManifest`, and
  `WorldValidation.sanitizeAssetManifestItem`. `WORLD_DOCUMENT_VERSION` stays **2** (the `assets` block already
  existed at version 1; a sub-field is additive). The binary stays in IndexedDB — the document carries a reference.
- **Editor surface (reused, not rebuilt)** — placement already worked (`selectedAsset` + `_placeAssetAt` +
  `addFromAsset`), so no new tool/panel. `WorldEditor._importGLTF` catches `AssetBudgetError` and surfaces a
  "Rejected …" label WITHOUT `console.error` (a budget reject is an expected outcome, not an error — proofs assert 0
  console errors); the asset-list rows show a triangle badge + a warn marker. A DEV `__ASSETS__` hook + an `assets`
  field on `__PERF__.snapshot()` (placed instances carrying `assetRef` + summed triangles) make the gate observable.
- **Performance Contract** — `assetInstancesScene({ assetId, count })` in `BenchmarkScenes.js` is a scene of GLB
  instances referencing one asset (reference-only). It is NOT in `allBenchmarkScenes()` (it needs a live IndexedDB
  asset to resolve, so it can't render in the Node determinism enumeration); the browser proof imports a fixture to
  supply a real `assetId` and gates it.

**Performance — captured then locked (SwiftShader, structural / GPU-independent).** asset-instances (24 × the clean
box fixture): draws 110, triangles 379k, objects 24, instanced batches 0, memGeometries 91 → overall **green**.
Ceilings: draws 160 / tris 560k / objects (n+10) / batches 4 / memGeometries 200. `objects` guards that instances
stay REFERENCED placed objects; `memGeometries` guards against per-instance geometry duplication (cloned GLB
instances SHARE geometry — a regression that stopped sharing would spike it); `batches` is a small absolute guard
(GLB instances are not primitive-batched). Non-vacuous: the proof asserts all 24 instances resolved and the heavy
fixture was rejected.

**Gates (TDD).** `test:asset-pipeline` (pure Node, 10 checks): exact budget counts on clean + heavy fixtures;
tier grading (clean→ok, heavy→reject, borderline→warn, oversized/sub-tiny scale); `AssetBudgetError` shape;
`sanitizeAssetBudget` whitelist + non-negative clamp; the `budget` field round-trips through all three whitelists
with no schema bump + zero-warning-empty + idempotent; `assetInstancesScene` content determinism + reference-only;
AssetBudget three-only import boundary + no-RNG scan. `test:asset-pipeline-proof` (SwiftShader): import a clean GLB
→ budget captured (12 tris, ok); import a heavy GLB → REJECTED (not stored, surfaced, no console error — the gate is
non-vacuous); place + persist + reload → asset + budget re-resolve from IndexedDB while the document holds a
reference (a slice of the model's base64 is asserted ABSENT from the saved doc; the blob is asserted PRESENT in
IndexedDB, 2140 bytes); the asset-instances scene stays within the contract; instances render in PLAY (no editor)
coexisting with the Frozen Cache base. 0 console errors. Fixtures (`src/assets/fixtures/assetBudgetFixtures.js`) are
GLTFExporter-built, deterministic, never bundled. The existing `test:anim` proves the budget gate did not break the
rigged-GLB import/place/animate path.

**Review (4 fresh-context reviewers, adversarial; each finding verified by two diverse-lens skeptics).** Net **0
unresolved critical/high**. The verify phase confirmed ONE genuine HIGH (empirically reproduced ~21%): the
`assetInstancesScene` determinism assertion compared the whole document including `createWorldDocument`'s wall-clock
`createdAt`/`updatedAt` timestamps, making the Node check intermittently flaky — FIXED by comparing the deterministic
scene content (`document.objects` + `gated`), the same pattern `performance-contract-regression` already used; the
structurally-identical latent flake in `authoring-procedural-regression` was hardened the same way (both now 0/30
under stress). A MEDIUM (an inaccurate triangle-count comment, 218,400 vs the real 217,560 after pole dedup) and a
LOW (negative budget values could pass the whitelist) were both fixed.

**Non-goals (held).** No asset marketplace, texture authoring/compression, animation retargeting, skeletal pipeline,
DRACO/KTX2, node graph, combat, WebGPU, or live deploy. No duplicate registry/import/loader modules. No
`WORLD_DOCUMENT_VERSION` bump. No material-convention rewriting (counts are captured + reported, not mutated). Next
per ADR-039: **Combat-0**.

## ADR-045 — Combat-0: A Validated Hitscan Strike Seam (reuse six seams, build five modules)

**Status:** Accepted 2026-06-20. Tag `world-builder-combat-0` (local; no push). First stage of phase 12
("Combat & encounters"), after Asset Pipeline-1 (ADR-044).

**Context.** The editor can author structure (Procedural Authoring-1), enforce performance (Performance
Contract-1), and place validated identity assets (Asset Pipeline-1); the relic objective (FP-1) proved a
find→equip→carry→deposit loop with Arsenal v4/v6 weapons. The next seam is *using* an equipped weapon.
Combat-0 adds the minimum contract future Enemy-0 / Encounter Editor stages can consume —
`input → active equipped weapon → aim ray → hit query → validated StrikeEvent → feedback` — and nothing
more. It is **a seam, not a game**: an inert `combat_target_dummy`, a hitscan ray, an impact flash, a
recorded event. Explicit non-goals: enemy AI, health/damage economy, ammo, loot, inventory, projectiles,
weapon balancing.

**The architecture call (the inverse of Asset Pipeline-1).** Asset Pipeline-1 found the suggested modules
already existed, so it reused. Combat-0 is the opposite: the things combat must *read* already exist, but
there was **no combat layer at all**. So the decision is **reuse the six existing seams, build the five new
combat modules**. Reused read-only: rightHand-only `weaponEquipRuntime.activeId`
(`WeaponEquipRuntime.js:77`); the equipped weapon's `group.userData.markers`; the shared yaw/pitch aim
basis; an inert primitive `WorldObject` as the hittable target; the `ObjectiveRuntime` owned-in-main /
loaded-in-both-paths / `clear()`-idempotent pattern; and the Node-regression + SwiftShader-proof harness.

**Mechanism.** New `src/world/combat/`: `CombatTypes.js` (constants + a finite-guarded, timestamp-free
`createStrikeEvent`), `CombatValidation.js` (`validateStrike` — the "no active weapon ⇒ no event" gate +
`isCombatTarget`), `CombatTarget.js` (an inert hit record — counts hits, never dies/removes),
`CombatFeedback.js` (transient emissive impact marks, capped + disposed on `clear()`), and `CombatRuntime.js`
(the seam: polls one input edge → requires `activeId` → casts ONE eye-aim hitscan ray at the registered
targets → emits the `StrikeEvent` → drives feedback + the target record). Additive edits: a public
`PlayerCameraController.aimRay()` (the single source of the aim basis, so combat never duplicates the trig);
a left-mouse `Mouse0` edge in `input.js` (gated on pointer-lock; **Space stays jump** — deliberately not
overloaded); and runtime-only `main.js` wiring (construct beside `objectiveRuntime`; a `loadCombat()` helper
in both load paths; `combatRuntime?.update(dt)` in the frame loop; DEV-only `__COMBAT_DO__` / `__COMBAT__`).

**The StrikeEvent contract (what Enemy-0 consumes).**
`{ weaponId, weaponRecipeId(=recipe.seed), origin, direction, muzzle, hit: { targetId, point, normal,
distance } | null }` — timestamp-free (determinism) and finite-guarded at every vector boundary (safety).
**Holstered weapons cannot fire** because `activeId` is the rightHand occupant only — the rule falls out of
the existing contract, not a separate check. Enemy-0 consumes the seam by registering enemies in the same
target set and reading `StrikeEvent.hit` — touching neither arsenal (combat only READS recipe/markers/slot),
objectives (separate runtime), nor input (one edge, already wired). Hitscan only; arc/projectile are later.

**Isolation + persistence.** Combat modules import ONLY `three` or `./Combat*.js` — never an arsenal
workbench module (scan-enforced, now covering `from`/side-effect/dynamic import forms). Combat events do not
persist; the dummy is an ordinary persisted primitive `WorldObject`. **No `WORLD_DOCUMENT_VERSION` bump
(stays 2).** The shipped Frozen Cache / first-playable world is byte-unchanged: it has no targets, so combat
is inert there (proven by the regression sweep staying green).

**Verification.** `test:combat` (10 Node checks: the active-weapon gate, finite-guarded `createStrikeEvent`,
a real hitscan against a production-built target, determinism via `deepEqual`, the *real* rightHand-only
`activeId` contract for holstering, inert target + non-leaking feedback, the shared `aimRay` basis, the
reserved-name predicate, and the determinism/isolation static scans). `test:combat-proof` (SwiftShader:
equip→hit + feedback, holstered-blocked with no new event, miss leaves the dummy untouched, reload
re-registers cleanly with the relic objective intact, in-play with no editor; 0 console errors). Full
regression re-run green, including `test:anim` (the rigged-GLB path is unbroken).

**Review.** Fresh-context workflow — 4 reviewers (correctness / safety-determinism / isolation-regression /
test-vacuity) → per-finding adversarial verification. **0 critical/high.** Three confirmed MEDIUM + three
LOW/downgraded, ALL fixed: (1) `CombatFeedback.update()` did not finite-guard `dt` (a non-finite `dt`, only
reachable via the DEV `step()` hook, wrote NaN to a mesh and pinned the mark) → early-return guard;
(2) the isolation scan only matched `from "…"` imports → widened to side-effect + dynamic forms with
negative controls; (3) the muzzle-marker read was untested (passed even if it silently fell back to the eye)
→ the Node test now asserts the marker value, distinct from the eye; (4) the determinism scan missed
`performance.now()` → added; (5) `_ownerId` ignored the `uuid` fallback key `load()` can register under →
now matches both; (6) the proof's holstered check leaned on `hitCount` only → now also asserts `lastEvent`
is unchanged. **Process note (recorded as a gotcha):** an adversarial *verifier* agent, having file-write
tools, mutated `CombatRuntime.js` to empirically confirm finding (3); it self-reverted, and the full tree
was re-audited clean (no probe markers) before commit — a reminder that workflow verifiers can write, so
the producer must audit the working tree after a review, not trust it.

**Non-goals (held).** No enemy AI, health/damage economy, ammo, loot, inventory, projectiles, arc/melee
weapons, weapon balancing, multiplayer, or WebGPU. No `WORLD_DOCUMENT_VERSION` bump. No change to the shipped
Frozen Cache / first-playable world. Next per ADR-039: **Enemy-0**.

## ADR-046 — Enemy-0: A Reactive Combat Target (consume the seam, build five modules)

**Status:** Accepted 2026-06-20. Tag `world-builder-enemy-0` (local; no push). Second stage of phase 12
("Combat & encounters"), after Combat-0 (ADR-045).

**Context.** Combat-0 shipped the weapon-use *seam* (`input → active weapon → aim ray → hit query →
StrikeEvent → feedback`) against an inert dummy, with its header documenting the next step:
*"Enemy-0 consumes the seam by registering enemies as targets and reading StrikeEvent.hit."* Enemy-0 is the
first **consumer** — the smallest hostile-actor contract: `enemy spawns → registers as a combat target →
receives the existing StrikeEvent → applies a finite health/state transition → shows feedback → can be
defeated`. It is **combat-target consumption, not AI**: one stationary test type (`glacial_sentinel`),
idle / hit-react / defeated. Explicit non-goals: full AI, patrol, chase, loot, waves, XP, inventory,
projectiles, navmesh, factions, networking, encounter authoring.

**The architecture call (consume the seam; one additive extension).** Reading the live Combat-0 code,
`CombatRuntime.use()` already delivers a hit via `this.targets.get(id)?.registerHit(...)` and `_queryHit()`
raycasts *whatever is in `this.targets`*. So an enemy plugs in by dropping a **`CombatTarget`-shaped adapter**
into that set — the existing `registerHit` call **is** the hit delivery. Hit detection is byte-unchanged (no
duplicate raycast; honoring "no combat rewrite"). The single needed extension is the **additive**
`registerTarget(id, target)` / `unregisterTarget(id)` on `CombatRuntime` (~14 lines); `use()` / `_queryHit` /
`_ownerId` / `snapshot` are unchanged. Decision: **build the five new `src/world/enemies/` modules, reuse the
combat hit path + the objectives doc-block/persistence pattern + the test harness.**

**Mechanism.** New `src/world/enemies/`: `EnemyTypes.js` (constants + a pure, immutable `createEnemyState`),
`EnemyValidation.js` (the untrusted-block whitelist `normalizeEnemyDescriptor` / `sanitizeEnemiesBlock` + the
pure, finite-guarded, deterministic transitions `applyDamage` / `advanceState` — defeat is **latched +
idempotent**), `EnemyTargetAdapter.js` (the `CombatTarget` drop-in: `{ id, object3D, hitCount, lastHit,
registerHit }` forwarding the strike to `onHit`), `EnemyFeedback.js` (the enemy *reacting* — an emissive body
flash that decays over the react timer + a one-time desaturated defeat color; owns no THREE objects, so it
can't leak), and `EnemyRuntime.js` (owns the actors, **injects** `combatRuntime`, registers an adapter per
enemy, drives the FSM + body visuals, persists the defeat edge). Additive edits: an `enemies` document block
with `sanitizeEnemiesBlock` in `WorldValidation`; runtime-only `main.js` wiring (construct after
`combatRuntime`; a `loadEnemies()` helper called in **both** load paths **after** `loadCombat()` — which
clears the target set, so order matters; `enemyRuntime.update(dt, player)` + a save-on-defeat-edge in the
frame loop; DEV-only `__ENEMY__` / `__ENEMY_DO__`).

**The enemy contract.** `EnemyState = { state: idle|hit-react|defeated, health, maxHealth, reactTimer }` —
immutable, finite-guarded, timestamp-free (identical strikes ⇒ identical state). The adapter's `registerHit`
runs `applyDamage`; the `snapshot()` reports the **logical** state + the authored HOME position (never the
animated transform), so it is deterministic. **Holstered weapons can't damage an enemy** — that falls out of
Combat-0's rightHand-only `activeId` (no active weapon ⇒ no `StrikeEvent` ⇒ no `registerHit`), not a separate
check. One stationary type; patrol/chase are a later `EnemyPathing`.

**Isolation + persistence.** Enemy modules import ONLY `three` or `./Enemy*.js` — `combatRuntime` is injected
(never imported), so the layer depends on combat's runtime *API*, not its code (scan-enforced, covering
`from`/side-effect/dynamic forms). The terminal **`defeated` state persists** (whitelisted boolean — always
emitted so `false` survives save→load — mutated in place on the defeat edge + saved, mirroring objective
completion); **live health is runtime-only** (a reloaded live enemy starts at full health; only the terminal
state persists, like objectives persist completion not progress). A non-finite transform **rejects** the
enemy rather than relocating it to the origin. **No `WORLD_DOCUMENT_VERSION` bump (stays 2).** Enemies are
**doc-authored, not auto-spawned**: a world with no `enemies` descriptor spawns zero enemies and registers
zero new combat targets, so the shipped Frozen Cache / first-playable world is byte-unchanged (combat stays
inert there).

**Verification.** `test:enemy` (8 Node checks: the descriptor whitelist + non-finite-transform reject, the
zero-warning-on-empty/​capped block, finite-guarded clamped latched `applyDamage`, deterministic
`advanceState`, the adapter's `CombatTarget` surface, a **non-vacuous consumption test** that registers an
adapter into a *real* `CombatRuntime`, fires a real ray, and asserts the enemy lost health through combat's
own `registerHit`, the doc-block round-trip, and the determinism/isolation static scans). `test:enemy-proof`
(SwiftShader: the enemy registers as a combat target → an equipped strike resolves to it and decreases its
health → repeated strikes DEFEAT it, latched → the scene stays within the draw/object budget → reload
PERSISTS the defeated state with the relic objective intact → a no-enemy world has zero enemies; 0 console
errors). Full regression re-run green, including `test:combat` (10) + `test:combat-proof` — proving Combat-0
was not weakened by `registerTarget`.

**Review.** Fresh-context workflow — 4 reviewers (combat-boundary / determinism-safety / persistence-whitelist
/ regression-lifecycle) → per-finding adversarial verification (default-refute). **15 raw → 0 critical / 0
high / 0 medium, 3 LOW.** Two were defense-in-depth hardening (both fixed): (1) `_applyDefeatPose` wrote a
group transform without a *site-local* finite guard (finite by construction via the distant spawn guard, no
live defect) → guarded at the site for consistency; (2) `applyDamage` / `advanceState` trusted the *incoming*
`state.health`/`maxHealth`/`reactTimer` (the producer set is closed — all states come from `createEnemyState`
and the two transitions, all finite — so unreachable) → added site-local finite guards so purity is
self-contained. The third LOW was an **informational confirmation** (Frozen Cache byte-unchanged), not a bug.
Per the Combat-0 process gotcha, the working tree was re-audited clean after the workflow (verifiers ran
empirical probes; no source mutation reached the tree — changed-file set + a probe-marker grep both clean).

**Non-goals (held).** No enemy AI, patrol, chase, loot, waves, XP, inventory, projectiles, navmesh, factions,
networking, encounter authoring, or duplicate hit detection. No `WORLD_DOCUMENT_VERSION` bump. No change to
the shipped Frozen Cache / first-playable world. Next per ADR-039: **Encounter Editor-0**.

## ADR-047 — Encounter Editor-0: Author One Combat Beat (orchestrate the seams, don't rewrite them)

**Status:** Accepted 2026-06-20. Tag `world-builder-encounter-editor-0` (local; no push). Third stage of
phase 12 ("Combat & encounters"), after Enemy-0 (ADR-046).

**Context.** Combat-0 (ADR-045) shipped the weapon-use seam; Enemy-0 (ADR-046) shipped the first consumer —
a reactive combat target. Encounter Editor-0 is the **authoring layer**: the editor places + configures a
simple combat encounter, and play resolves it through the existing seams. The minimum loop is *editor places
an encounter descriptor → play projects one `glacial_sentinel` → Combat-0 defeats it → the encounter
completes → the descriptor + completion persist*. Doctrine held: Combat-0 owns strikes, Enemy-0 owns reactive
enemy state, Encounter Editor-0 owns authored **placement + completion only**. Explicit non-goals: waves,
loot, rewards, an AI director, pathfinding, factions, an encounter scripting language, dialogue, inventory,
procedural combat generation, duplicate enemy/combat models. (Skybreak 798 stays a *later design-reference
audit* — recorded in memory, deliberately out of this stage's scope.)

**The architecture call (orchestrate; one additive method).** A fresh codebase read confirmed Encounter
Editor-0 is a thin orchestration layer on top of two live seams, touching neither's source except for one
additive method. `EnemyRuntime._spawn` is *already* a descriptor-driven spawner that registers an
`EnemyTargetAdapter` into `combatRuntime` — it does **not** require the descriptor to live in
`document.enemies.items`. The editor *already* has the full placement machinery (`_handleCanvasClick` →
raycast `terrain.mesh` → `snap.snapPlacement` → `_markDirty`). So: **build the encounter domain (six modules)
plus an `EncounterPanel`, reuse `EnemyRuntime` as the spawn engine and `CombatRuntime` as the hit authority —
both untouched as source save for one additive `EnemyRuntime.spawnEphemeral` (plus a sibling `removeEphemeral`
and a `snapshot()` ephemeral filter).**

**The load-bearing decision — no baked enemy (Approach A).** `EncounterRuntime` calls
`EnemyRuntime.spawnEphemeral(descriptor, groundHeight)` — the enemy lives in a **transient pool** under a
namespaced id (`enc:<encounterId>:<n>`), flagged `ephemeral`, with a descriptor the encounter owns that is
**never** a `document.enemies.items` member; it polls `isDefeated(actor.state)` for completion. The
alternative (push a transient enemy descriptor into `enemies.items`, feed it to `EnemyRuntime.load`) was
**rejected**: the moment a sentinel descriptor enters `enemies.items` it round-trips through save/load and
**respawns as a baked, pre-dead enemy on reload** — a direct violation of "no baked enemy." `spawnEphemeral`
calls the unchanged `_spawn` then tags `actor.ephemeral = true`; `removeEphemeral` is guarded on that flag so
a baked enemy can never be torn down through it (idempotent); `snapshot()` gains a `.filter(a => !a.ephemeral)`
so ephemerals are reported by `EncounterRuntime.snapshot()` instead — `_spawn`/`_onHit`/`load`/`clear`/`update`
bodies stay **byte-unchanged** (`test:enemy` 8 + `test:combat` 10 + both proofs re-run green). The id
namespaces are provably disjoint: the enemy id sanitizer strips colons, so a sanitized doc id can never equal
an `enc:…:0` ephemeral id.

**Mechanism.** New `src/world/encounters/`: `EncounterTypes.js` (constants + clamps + the untrusted-block
whitelist `normalizeEncounterDescriptor`, importing only `ENEMY_TYPES` from the pure enemy value module),
`EncounterValidation.js` (`sanitizeEncountersBlock` — zero-warning on empty + capped), `EncounterPersistence.js`
(`EncounterStore` add/get/remove over `document.encounters.items`, in-place), `EncounterCompletion.js` (the
pure `allDefeated` rule, reusing Enemy-0's `isDefeated` — non-vacuous: an empty actor set is not complete),
`EncounterMarkers.js` (the shared zone-ring builder — THREE only — used by both the runtime zone and the
editor preview, DRY), and `EncounterRuntime.js` (the runtime orchestrator: draws each beat's ring, projects
one ephemeral enemy via the injected `enemyRuntime`, polls defeat, marks completion). Additive edits:
`EnemyRuntime` (the two methods + filter); an `encounters` document block; `sanitizeEncountersBlock` in
`WorldValidation`; `WorldEditor` (the `EncounterPanel` section, `_armEncounterPlacement`, an `_handleCanvasClick`
branch *before* the armed-weapon/prefab checks, `_placeEncounterAt`, `_removeEncounter`, render-only preview
rings via `_refreshEncounterRings`, `KeyN` + `Escape` handling — placement folds into `WorldEditor` methods
matching the inline armed-weapon precedent, not a separate tool file); runtime-only `main.js` wiring (construct
after `enemyRuntime`; a `loadEncounters()` helper called in **both** load paths **after** `loadEnemies()` so
ephemerals join a fresh enemy/target set; `encounterRuntime.update` + a save-on-completion-edge; DEV-only
`__ENCOUNTER__` / `__ENCOUNTER_DO__` + additive `__DOC_DEBUG__` enemy/encounter counts).

**The descriptor + persistence.** A beat descriptor is `type: "combat-beat.v0"` with `id`, `position`,
`radius` (clamp [1,40], default 6), `enemyType` (∈ Enemy-0's `ENEMY_TYPES`, else reject), `enemyCount`
(clamp to **exactly 1** — the no-waves gate), `completed`, and `persistCompletion`. A non-finite position
**rejects** the encounter (no origin relocation); an
unspawnable `enemyType` rejects it. `completed` and `persistCompletion` are **always-emitted booleans** so
`false` survives save→load. Only the descriptor + completion persist: the editor's `EncounterStore.add`
mutates `document.encounters.items` in place, which `updateDocumentFromRuntime` preserves and `WorldSerializer.save`
re-validates; the runtime flips `descriptor.completed = true` on the defeat edge **only when
`persistCompletion` (default true)** and raises a one-shot persist request. A replayable beat
(`persistCompletion: false`) leaves the descriptor uncompleted, so it respawns its enemy on reload. The
spawned enemy **never** persists. **No `WORLD_DOCUMENT_VERSION` bump (stays 2).** Encounters are
**doc-authored**: a world with no `encounters` descriptor projects nothing, so the shipped Frozen Cache /
first-playable world is byte-unchanged.

**Two interpretive choices (operator-approved).** (1) `persistCompletion` is a per-beat boolean defaulting
**true** (honoring the spec's "optionally persists / if configured" — a designer can author a replayable
beat). (2) The radius preview is a **zone ring** drawn in *both* the editor (authoring feedback) and play
(the zone), via the shared `EncounterMarkers` builder; the editor rings are session/render projections —
tracked in `_encounterRings`, disposed + rebuilt on every change, and **never** written into
`document.objects` (confirmed: they carry `userData.isEncounterMarker`, are added straight to the scene, and
the serializer collects only `manager.objects`).

**Verification.** `test:encounter-editor` (7 Node checks: the descriptor whitelist + non-finite/allow-list
rejects + radius/count clamps, the zero-warning/​capped block, the store add/replace/remove, the **non-vacuous**
`allDefeated`, the doc-block round-trip preserving `completed`/`persistCompletion`, the **load-bearing**
ephemeral-isolation test that drives a *real* `CombatRuntime` + `EnemyRuntime` — `spawnEphemeral` registers a
combat target yet `document.enemies.items` stays length 0, `snapshot()` omits the ephemeral, and
`removeEphemeral` refuses a baked enemy — and the determinism/isolation static scan). `test:encounter-editor-proof`
(SwiftShader: **author the beat through the real editor tool** → 1 descriptor + 1 preview ring + 0 enemies
while editing → play projects the enemy as a combat target while `document.enemies.items` stays length 0 (a
`GlacialSentinel` is live in the scene) → equip → strike ×3 → defeat → `completed` false→true → budget green →
reload persists completion with no respawn and `enemies.items` still empty; 0 console errors). Full regression
re-run green: `test:enemy` (8) + `test:combat` (10) + both proofs (seams unweakened), `test:first-playable-proof`,
`test:frozen-cache-proof`, `test:performance-contract(-proof)`, `test:world`, `qa` (skills 32/0/0, layout, build).

**Review.** Fresh-context workflow — 5 reviewers (no-baked-enemy / persistence-whitelist / lifecycle-leak /
editor-boundary / isolation-determinism) → per-finding adversarial verification (default-refute). **0 critical
/ 0 high / 0 medium / 0 low** — every dimension CLEAN with file:line evidence and executed probes (incl. a
sharp id-namespace-disjointness proof that `enc:…:0` can never collide with a sanitized baked-enemy id). Per
the Combat-0 / Enemy-0 process gotcha, the working tree was re-audited clean after the workflow (reviewers ran
probes only under `/tmp`; the changed-file set, diffstat, a probe-marker grep, and a `test:encounter-editor`
re-run were all unchanged).

**Non-goals (held).** No waves, loot, rewards, AI director, pathfinding, factions, encounter scripting,
dialogue, inventory, procedural combat, duplicate enemy/combat models, or baked enemies. No
`WORLD_DOCUMENT_VERSION` bump. No change to the shipped Frozen Cache / first-playable world. Next per ADR-039:
**Visual Benchmark-1**.

## ADR-048 — Geometry Stream Gate-0: PagedGeometryStream (a tested infrastructure gate that does NOT replace LOD)

Decision recorded 2026-06-20. Tag `world-builder-geometry-stream-0` (local only, no push). Sits in
phase 12, inserted **before** Visual Benchmark-1, after Encounter Editor-0 (ADR-047).

**Context.** Before polishing one compact area to shipping quality (Visual Benchmark-1), the operator
called for a validated **chunked geometry streaming** layer so large procedural surfaces upload as bounded
chunks instead of one stalling buffer — and explicitly fenced it against scope creep: build it **first-party,
narrowly, test-first**, and integrate only after tests prove the contract. A research pass confirmed no
`PagedGeometryStream` existed anywhere in the tree (the only streaming was the Family-A `RegionStreamer`,
which streams world *objects* by region, not geometry; Family-B grass/bush/tree geometry streaming was
deferred at Wildlife-2). So this is net-new, not an audit of external code.

**The load-bearing doctrine (operator-mandated, affirmed here verbatim-in-spirit).**
**PagedGeometryStream reduces CPU/upload stalls and buffer pressure. It does NOT replace LOD. LOD can only be
deferred or reduced after Visual Benchmark-1 proves triangle/draw/memory/frame-budget safety.** Paging is
upload/CPU-stall + buffer-size infrastructure; it does nothing for screen-space triangle waste, vertex/fragment
shading, overdraw, shadow-pass cost, or memory residency. Those remain governed by Performance Contract-1 and
(later) LOD work. No code, comment, doc, or test in this stage claims paging makes a scene safe without a
measured budget; the fresh-context review included a dedicated `lod-doctrine` dimension that verified this.

**Decision — orchestrate the existing contracts; build five pure-ish modules; touch the runtime only additively.**

- `src/world/geometry/PagedGeometryTypes.js` (PURE) — `MAX_VERTICES_PER_CHUNK = 64000`, finite/bounds predicates,
  `normalizePageDescriptor` (whitelist + deep-frozen bounds; rejects, never relocates).
- `src/world/geometry/PagedGeometryValidation.js` (THREE-free, duck-typed) — `validatePageDescriptor` /
  `validatePages` (dedup ids) / `validateBuiltGeometry`. **Two cap layers**: the descriptor's promised
  `vertexCount` AND the realized `position.count` are both checked against the cap, and must agree — so a producer
  cannot under-promise then over-build. Every position/normal/uv value must be finite; every index in `[0, count)`.
- `src/world/geometry/PagedGeometryStats.js` (PURE) — `summarizePages`, the ONE definition the stream's
  `snapshot()` and the runtime `__PERF__.paged` field share.
- `src/world/geometry/PagedGeometryProducer.js` (THREE) — a synthetic terrain-detail grid producer, deterministic
  via seeded `mulberry32`/`hash2i` (never the platform RNG). The ONLY producer shipped; NO runtime system
  constructs it (it serves the gate's tests + the DEV harness).
- `src/world/geometry/PagedGeometryStream.js` (THREE) — `createPagedGeometryStream({ maxVerticesPerChunk, material,
  sceneRoot })` → `replacePages` (transactional: validate the whole batch BEFORE disposing/queuing — a bad batch
  leaves state unchanged) · `commitNext` (incremental: `maxPages` per call by default; `budgetMs` honored only via
  an **injected `now()` clock**, so `performance.now` stays out of the module and the emission path is
  scan-clean/deterministic) · `clear` / `dispose` (release every page geometry, detach meshes; the caller-owned
  **material is never disposed by the stream**) · `snapshot`. One shared material across all page meshes. A page
  whose build yields invalid geometry is disposed and dropped from the queue, then rejected — it never enters the
  scene graph.

**Page descriptor:** `{ id, bounds:{min:[x,y,z],max:[x,y,z]}, vertexCount, indexCount, build:()=>BufferGeometry }`.
`build` is LAZY, so determinism is compared on ids/order/counts/bounds (and, in tests, built positions) — never
timestamps. **Generated pages are runtime projections** — the stream never touches the world document, so paging
adds nothing to the saved world file (statically scan-enforced).

**Performance Contract integration = the established additive `__PERF__` pattern** (as wildlife/ambient/arsenal
did in Performance Contract-1). `main.js` (DEV-gated) gains a `__PAGED__` harness that mounts one stream against
the live scene and an additive `paged: pagedStream?.snapshot() ?? null` field in `__PERF__.snapshot()`.
`PerformanceContract.extractMetrics` gains four **reported** `paged*` metrics. `CONTRACT_BUDGETS` and
`evaluateContract` are UNCHANGED — the per-page ≤64k cap (enforced in the stream) is the real safety gate, not a
fixed total-vertex ceiling, so the existing performance gate is not weakened. No production stream is constructed;
`paged` is null in normal play; shipped worlds are byte-stable.

**Verification.** `test:geometry-stream` (9 Node checks) + `test:geometry-stream-proof` (SwiftShader: mount →
incremental commit 1→2→3→4 → contract sees stats live → unmount disposes all → `__PERF__.paged` null; 0 console
errors). Full regression re-run green (`qa`, all Node regressions, `test:frozen-cache-proof`,
`test:first-playable-proof`, `test:performance-contract-proof`, `test:encounter-editor-proof`). Fresh-context
adversarial review — 6 dimensions (cap-and-rejection / lifecycle-leak / determinism-emission / boundary-and-doctrine
/ test-rigor / **lod-doctrine**) + per-finding adversarial verify, 184 executed probes — returned **0 critical / 0
high / 0 medium / 4 LOW**. The three test-rigor LOWs were fixed (assert geometric determinism not just the id
string; feed a real `stream.snapshot()` through `extractMetrics`, not only a literal; add a non-vacuous "clear
changed state" guard); the fourth LOW (this ADR's doctrine affirmation being absent) is closed by this entry.

**Refinements vs the original spec (convention alignment).** Tests live in `scripts/` (not `tests/`), named
`paged-geometry-stream-regression.mjs` + `browser-paged-geometry-stream-proof.mjs`, npm `test:geometry-stream(-proof)`,
matching the repo's 60+ gates and the `qa:skills` walker. Page-diffing on regenerate is deferred (KISS:
dispose-all + queue-new); a real PCG consumer (grass/terrain) paging its geometry is a later stage, gated on
Visual Benchmark-1 budget evidence.

**Non-goals (held).** Does NOT claim LOD is obsolete. No broad rewrite of terrain/grass/wildlife/asset systems.
No WebGPU, workers, async race complexity, or renderer rewrite. No `Math.random`/`Date.now`/`performance.now`/
`eval`/network/`fs`/dynamic import in the emission path. No generated geometry in the world document. No weakening
of Performance Contract-1. No `WORLD_DOCUMENT_VERSION` bump. Next per ADR-039: **Visual Benchmark-1** (which may
USE the stream as one tool, but LOD stays deferred-not-deleted until its budget evidence lands).

## ADR-049 — Visual Benchmark-1: One Polished, Measurable Authored Corridor

Decision recorded 2026-06-20. Tag `world-builder-visual-benchmark-1` (local only, no push). The first serious
quality target in phase 12, after Geometry Stream Gate-0 (ADR-048).

**Context.** With the engine's systems shipped (terrain/water/fog, authored procedural modifiers, asset
pipeline, encounter authoring, the performance contract, and the geometry stream), the operator called for
the first *quality* target: prove those systems can **coexist in one intentional space** — not a new engine
phase. The central question: *can one small authored slice look intentional and stay measurable, reload-safe,
and playable?* Hard fences: do NOT mutate the shipped Frozen Cache / first-playable slice (historical
baselines), no renderer rewrite / WebGPU / new generator / new combat / asset-pipeline expansion, no new
production geometry-stream consumer, no "LOD obsolete" language.

**Decision — a NEW authored sample world, reusing every system as data.** `visual-benchmark-1`
(`src/world/samples/visualBenchmarkV1.js`, registered in `samples/index.js`, loadable via
`?world=visual-benchmark-1`) composes the Relic Overlook → glacial crossing → cache-pedestal corridor:

- **Terrain/water/fog** — the default alpine glacial valley (Visual-0/1), no override.
- **Composition** — authored primitive landmarks (overlook gateway, ruin, ice-pillar pass, cache pedestal)
  arranged along the deterministic `deriveSites(spawn)` axis (relic +X·14, cache −X·26), framing a readable
  route with an unobstructed carry centerline. `visualBenchmarkLayout()` is the single source of truth the
  builder + the proof share.
- **Procedural authoring** — a Procedural Authoring-1 beacon-trail spline + mask + modifier along the route.
- **Encounter** — one Encounter Editor-0 `combat-beat.v0` (glacial_sentinel) on the crossing.
- **Asset** — a reference-only validated-GLB cache prop (`type:"gltf"`, `asset:null`, fixed
  `BENCHMARK_CACHE_ASSET_ID`); the binary lives in IndexedDB (the proof imports the clean fixture, budget-
  validates it, and re-stores it under the fixed id). GLB binaries are never embedded in the document.
- **Gameplay** — the relic find→carry→cache loop is the runtime's AUTOMATIC objective (no authored
  `objectives` block); the landmarks frame that same axis. Both the relic loop and the encounter complete.

The composition is pure + deterministic (no `Math.random`/`Date.now`/`performance.now`). The shipped slice is
NOT touched: `main.js`, `FrozenCacheSlice.js`, `PerformanceContract.js`, and `WorldDocument.js` are
byte-identical; only additive edits to `BenchmarkScenes.js` (a 6th scene), `samples/index.js` (registration),
`performance-contract-regression.mjs` (5→6 count), and `package.json` (two scripts). No
`WORLD_DOCUMENT_VERSION` bump.

**Performance Contract inclusion.** `visualBenchmarkScene()` is the contract's 6th gated benchmark scene (the
unresolvable-headless GLB prop is dropped from the budget variant — its live cost is proven in the proof).
Ceiling captured-then-locked (draws ≤160, tris ≤700k, objs ≤16, batches ≤8, veg ≤120, rtAssets ≤12) at
baseline + headroom. `CONTRACT_BUDGETS`/`evaluateContract`/`assertWithinBudget` are UNCHANGED — the contract
is not weakened.

**Geometry stream + the LOD finding (the load-bearing deliverable).** The geometry stream is used for
**measured stats only** (the DEV `__PAGED__` harness mounts a synthetic producer, commits it, reads stats,
unmounts) — **no production streamed-detail consumer is created** (that would be a different stage, per
ADR-048). `docs/VISUAL_BENCHMARK.md` records the measured baseline (SwiftShader = CPU/structural signal, NOT
GPU FPS — stated explicitly) and the conservative finding: **B — LOD can be deferred for this scoped
benchmark** (grass dominates triangles ≈513k, managed by patch streaming + the visibility kernel, not
per-object LOD; the authored corridor adds little). **C** (LOD reducible for streamed procedural detail)
**remains an untested hypothesis** — no real consumer exists. The doc states verbatim: *PagedGeometryStream is
available and structurally measured; no production visual dependency has been created yet; LOD remains
deferred-not-deleted.* No "LOD obsolete" / Nanite / "no visible lag" claim appears (the only Nanite mention is
the forbidden-claims list).

**Verification.** `test:visual-benchmark` (9 Node checks: valid + deterministic + registered + composed +
budget-bounded) + `test:visual-benchmark-proof` (SwiftShader: living world → composition → GLB resolved →
geometry-stream stats → Performance Contract → relic AND encounter completed → reload-persists → 0 console
errors). Full regression re-run green incl. byte-stability proofs `test:frozen-cache-proof` +
`test:first-playable-proof` + `test:performance-contract-proof` (6 scenes). Fresh-context adversarial review —
6 dimensions (byte-stability-boundary / composition-authoring / asset-reference-only / performance-contract /
geometry-stream-lod-doctrine / proof-rigor) + per-finding verify, 219 executed probes — returned **0 critical
/ 0 high / 1 medium / 2 low**, all three fixed (lintel built immutably; proof asset re-store made idempotent;
the geometry-stream demo now asserts every page committed).

**Non-goals (held).** No mutation of the shipped Frozen Cache / first-playable slice. No renderer rewrite, no
WebGPU, no new generator, no new combat, no asset-pipeline expansion, no broad biome overhaul. No new
production geometry-stream consumer. No "LOD obsolete" language. No `WORLD_DOCUMENT_VERSION` bump. No embedded
GLB binary. Next per ADR-039: **WebGPU Feasibility Gate** (a future feasibility track, not a commitment).

## ADR-050 — WebGPU Feasibility Gate-0: Feasibility Only, WebGL Stays Production (go/no-go = B)

**Status.** Accepted. Tag `world-builder-webgpu-feasibility-0` (local only). Stage 61.

**Context.** The roadmap (ADR-039) lists a WebGPU Feasibility Gate. The word that governs is *feasibility*,
not migration. After Visual Benchmark-1 (ADR-049) the measured bottleneck is grass triangle pressure +
content/streaming discipline — not renderer architecture or CPU draw-call overhead (draws are already green,
95–116). The question to answer honestly: *does WebGPU materially improve the next 3–5 stages, or is WebGL +
the existing Performance Contract sufficient?*

**Decision — build a contained, isolated research gate; do NOT migrate.** An experimental WebGPU lab behind
its OWN Vite entry (`webgpu-lab.html` → `src/feasibility/webgpu/webgpuLabMain.js`, a 3rd rollup input beside
the app and Arsenal Lab — exactly the established isolated-entry pattern). It imports **nothing** from the
production renderer (`src/core/renderer.js`), `src/main.js`, or the world. WebGL remains the production path,
byte-stable.

**What shipped.**
- **Three pure modules (THREE-free, deterministic, Node-testable):** `WebGPUCapability.js` (`probeWebGPU(nav)`
  → honest `{apiPresent, available, reason, isFallbackAdapter, limits}`; never throws; never reports available
  without a granted adapter; whitelisted limits), `WebGPULabComposition.js` (a deterministic structural plan
  for a minimal instanced grass-like field — 64×64 = 4096 blades × 2 tris = 8192 tris in ONE draw batch;
  clamped inputs), `WebGLBaselineComparison.js` (architectural comparison vs the recorded Visual Benchmark-1
  WebGL numbers — 116 draws / 512,962 tris — with explicit "not scene-equal, not GPU-FPS" notes).
- **The spike (THREE + `three/webgpu`):** `WebGPULabScene.js` builds the InstancedMesh of 2-tri blades via a
  `MeshBasicNodeMaterial` with seeded placement (the canonical `mulberry32`/`hash2i`, never the platform RNG);
  `webgpuLabMain.js` probes, initializes a `WebGPURenderer` (no forced backend — it chooses WebGPU when an
  adapter exists and auto-falls back to WebGL2 otherwise, reporting which it actually got), renders the field,
  and exposes a DEV-gated `__WEBGPU_LAB__` readout. Field structural numbers are read off the REAL rendered
  mesh after `renderAsync` (so they stay 0 on a render failure — every proof field-assertion is render-gated).

**Measured result (evidence behind the go/no-go).** The headless proof runs its OWN launcher that ATTEMPTS a
WebGPU adapter (`--enable-unsafe-webgpu --enable-features=Vulkan`) WITHOUT touching the shared
`scripts/lib/browser.mjs` (kept byte-identical). In CI an adapter was granted and `WebGPURenderer` used a live
**`webgpu` backend** to render the 4096-instance field with 0 console errors. **Honesty caveat:**
`isFallbackAdapter=false` ("hardware-backed") under headless `--enable-features=Vulkan` is almost certainly a
SOFTWARE Vulkan path (SwiftShader/lavapipe), a STRUCTURAL/CPU signal — **not** a GPU-FPS measurement. The gate
is robust to BOTH outcomes; an adapter-less machine gets the WebGL2 fallback and the gate still passes.

**Go/No-Go = B — keep WebGPU as an experimental lab only.** Not A (the lab demonstrably initializes + renders,
so it is worth keeping, not discarding). Not C (a parallel renderer lane is real maintenance the evidence does
not justify — no current bottleneck WebGPU uniquely solves; its render-bundle lever targets a CPU draw cost we
do not have; its one possibly-relevant lever, compute culling/placement for vegetation, is an untested
hypothesis needing a real producer + hardware-GPU run). Not D (migration; out of scope, unjustified). The
durable isolated lab IS outcome B. Falsifiers that would move it toward C/D are recorded in
`docs/WEBGPU_FEASIBILITY.md` (a hardware-GPU bottleneck WebGPU uniquely relieves; a real streamed-detail
producer needing GPU compute; a decision to drop older-device reach).

**Gates.** `test:webgpu-feasibility` (6 Node checks) + `test:webgpu-feasibility-proof` (own WebGPU-flagged
launcher; production WebGL app still boots). Full sweep re-run green; `src/core/renderer.js` + `src/main.js`
byte-stable; `three/webgpu` is a separate build chunk (app bundles unchanged). Fresh-context adversarial review
(4 dimensions + per-finding verify, 5 agents): **0 critical / 0 high / 0 medium / 1 low** — fixed (field
structural asserts now read the real rendered mesh, not plan constants). Tree re-audited clean.

**Non-goals (held).** No renderer rewrite. No WebGPU in the production path. No drop of WebGL. No port of the
world. No TSL rewrite of the production shaders. No new production geometry-stream consumer. No "LOD obsolete" /
Nanite / GPU-FPS / "no visible lag" claim. No `WORLD_DOCUMENT_VERSION` bump. No edit to the shared browser
harness. No renderer migration without a later, separately approved stage.

## ADR-051 — Environment Polish-1: Visual Benchmark Expansion (art-directed quality, not engine infrastructure)

**Status.** Accepted. Tag `world-builder-environment-polish-1` (local only). Stage 62.

**Context.** WebGPU Feasibility Gate-0 (ADR-050) proved the immediate bottleneck is not renderer architecture —
it is grass triangle pressure + content/authoring discipline. The next constraint is therefore **art-directed
quality**: can the proven Visual Benchmark-1 corridor be polished toward a shippable authored slice **using only
the existing stack**, while staying measurable, reload-safe, and playable? A Nanite-like shader track would have
been speculative — this stage keeps converting the engine into a product surface instead.

**Decision — evolve `visual-benchmark-1` IN PLACE; touch no new rendering architecture.** The corridor scene
(`src/world/samples/visualBenchmarkV1.js`) grows toward shipping quality; the git tag
`world-builder-visual-benchmark-1` preserves the pre-polish byte-state. Three operator-approved choices: evolve
in place (not a new scene), particles-primary + additive audio cues, and re-capture-and-re-lock the performance
ceiling.

**What shipped (all additive, all existing systems as data).**
- **Composition / landmark density:** +4 route-framing primitives — two waypoint cairns guiding the eye along
  the route, and a crossing gateway (two short ice posts) framing the combat beat as a threshold. The
  route-readability invariants (perpendicular distance ≤ 14, carry centerline midpoint unobstructed) still hold
  and the regression now requires the specific new landmark ids.
- **Per-scene readability overrides (THIS document only):** `doc.lighting` (brighter, higher, more raking sun so
  the stone/ice landmarks read with form; fog near 90→112, far 320→380 so the cache is discoverable from the
  overlook while the route keeps depth), `doc.water` (foam 0.7→1.4, fresnel 0.28→0.40, flow 0.35→0.50 for the
  crossing edge), `doc.atmosphere` (basin fog 0.45→0.38, mist 0.40→0.32, band 12→16 for legibility). Each config
  factory returns a fresh object and the loader reads the value off the document, so the override affects ONLY
  the benchmark — the global default is unchanged (the regression asserts a vanilla world is unaffected).
- **Feedback:** ambient particle emitters stage the relic (spark), the cache (spark), and the crossing
  threshold (dust) — pure authored data on objects, auto-loaded by `ParticleRuntime`. The relic loop's audio
  already comes from the always-on `FrozenCacheSlice`, so a NEW additive `RuntimeFeedback`
  (`src/world/feedback/RuntimeFeedback.js`) closes only the encounter gap: it fires an `AUDIO_CUES.COMPLETE` cue
  on an encounter's completion edge (edge-triggered once via a `_cued` Set), reusing the existing `ProceduralAudio`.
  Headless-graceful (cue no-ops without a user gesture) with a `cueAttempts` counter so the wiring is provable.

**Byte-stability (the load-bearing invariant).** `src/main.js` is edited ADDITIVELY only — a `RuntimeFeedback`
import + construction, two `runtimeFeedback.update(encounterRuntime.snapshot())` calls after the existing
`encounterRuntime.update` (in both the `__ENCOUNTER_DO__` driver and the real frame loop), and a DEV
`__RUNTIME_FEEDBACK__` hook. `FrozenCacheSlice.js` + `SliceCompletion.js` are UNTOUCHED. Worlds with no
encounters (the frozen-cache / first-playable slices) fire no cue → no behavior change. The frozen-cache +
first-playable proofs are green. No `WORLD_DOCUMENT_VERSION` bump. No new test scripts (the polish reuses
`test:visual-benchmark(-proof)` on the same evolved scene).

**Measured (SwiftShader, STRUCTURAL not GPU-FPS; `docs/VISUAL_BENCHMARK.md`).** Full scene before→after: draws
116→119, tris 512,962→511,720, objs 11→15, batches 2→1 — the polish is nearly free (+3 draws, no triangle
delta; grass dominates ~500k). The `visual-benchmark` per-scene ceiling was RE-CAPTURED + RE-LOCKED (`objects`
16→20) at the new baseline + headroom, with draws/tris/veg at the shared glacial-grass values; the scene
classifies green, far under the global red. The LOD finding is UNCHANGED: **B (defer for this scope)** — polishing
toward shipping quality did not move the scene out of its structural band.

**Gates.** `test:visual-benchmark` (11 Node checks) + `test:visual-benchmark-proof` (overrides applied live +
persisted across reload, particle feedback live, encounter-clear cue fires 0→1, relic + encounter completable,
reload-stable, 0 errors) + `test:performance-contract(-proof)` (6 scenes). Fresh-context adversarial review
(4 dimensions — byte-stability/isolation · override-safety · feedback-correctness · proof-rigor + per-finding
verify, 4 agents): **0 critical / 0 high / 0 medium / 0 low**. Tree re-audited clean.

**Non-goals (held).** No new rendering architecture. No WebGPU. No Nanite-like shader work. No new terrain
engine. No new combat systems. No enemy AI. No broad world generation. No mutation of the shipped Frozen Cache /
first-playable slice. No edit to the frozen `FrozenCacheSlice` / `SliceCompletion`. No global lighting/water/
atmosphere default change. No `WORLD_DOCUMENT_VERSION` bump. No "LOD obsolete" / Nanite / GPU-FPS claim.

## ADR-052 — Encounter-1: Authored Combat Beat Polish (presentation over the seams, not new combat)

**Status.** Accepted. Tag `world-builder-encounter-1` (local only). Stage 63.

**Context.** Environment Polish-1 made the corridor read; the combat beat at the crossing was still flat. The data
still says rendering architecture is not the bottleneck (draws green, polish cheap, grass dominant) and movement/
pathing (Enemy-1) is a bigger seam than the slice needs — so the right next step is to make the EXISTING beat feel
authored and readable: approach → recognize the threat → draw a weapon → defeat the sentinel → clear feedback →
continue the objective. Using only Combat-0 (the strike), Enemy-0 (the reactive state), and Encounter Editor-0 (the
authored placement + orchestration).

**Decision — add a presentation OBSERVER; rewrite none of the seams.** A new additive `EncounterPresentation`
(`src/world/encounters/EncounterPresentation.js`, the `RuntimeFeedback` pattern) reads `EncounterRuntime` + the
projected Enemy-0 actor + the player and drives readability. Its pure decisions live in
`EncounterPresentationLogic.js` (no THREE, Node-testable). It is an observer: it mutates only its OWN beacon meshes
and the sentinel's (fresh, per-enemy) MATERIAL emissive — never encounter or enemy STATE.

**What already existed vs what Encounter-1 added.** Hit feedback (EnemyFeedback emissive flash + recoil), defeat
feedback (color shift + slump + tip), the zone-ring amber→green on completion, the clear audio cue (Polish-1's
`RuntimeFeedback`), and persistence were ALREADY shipped. Encounter-1 added the MISSING readability:

- **A player-facing PHASE** — `dormant → alert → engaged → cleared`, derived from player distance, the Enemy-0 state,
  and completion.
- **A sentinel idle→alert TELEGRAPH** — the threat reads before it fires. It runs AFTER `EnemyFeedback` each frame and
  pulses the idle sentinel's emissive ONLY while idle; the instant the enemy is hit-react/defeated it backs off and
  `EnemyFeedback` owns the material (so the two never fight). Per-enemy materials are fresh, so no bleed.
- **A dedicated runtime GATE-LIGHT beacon** at the crossing — dim while dormant, hostile pulse while alert/engaged,
  steady route-open green + a one-shot expand pulse when cleared. Runtime-built from the encounter (never authored/
  serialized, like the zone ring), so no coupling to `WorldObjectManager` and the authored posts are untouched.
- **An encounter BANNER** — "ready your weapon" → "strike the sentinel" → "the route is clear", taking precedence at a
  live/just-cleared beat (prepended to the slice/objective banner chain) and yielding to null otherwise.

**Byte-stability (the load-bearing invariant).** `src/main.js` is edited ADDITIVELY only — an `EncounterPresentation`
import + construction, a `load()` inside `loadEncounters` (both load paths), two `update(encounterRuntime, player, dt)`
calls after `runtimeFeedback.update` (the `__ENCOUNTER_DO__` driver + the real frame loop), a banner-fallback PREPEND
that returns null for encounter-less worlds, and a DEV `__ENCOUNTER_PRESENTATION__` hook. `EncounterRuntime` /
`EnemyRuntime` / `EnemyFeedback` / `EnemyTypes` / `FrozenCacheSlice` / `SliceCompletion` and the benchmark scene
`visualBenchmarkV1.js` are ALL UNTOUCHED — Encounter-1 is pure runtime presentation (no authored-scene change). Worlds
with NO encounters build no gate-light + fire no telegraph → the frozen-cache + first-playable slices are byte-stable.
No `WORLD_DOCUMENT_VERSION` bump.

**Gates.** `test:encounter-polish` (7 Node: phase derivation, telegraph idle-only, banner per phase, beacon colour/
opacity, purity, and an assignment-only isolation scan proving the layer mutates no encounter/enemy STATE) +
`test:encounter-polish-proof` (on `visual-benchmark-1`: staged+visible → `dormant→alert→engaged→cleared` driven by REAL
player teleports → the telegraph substantively lifts the sentinel emissive → hit→defeat via real strikes → the clear
pulse fires exactly ONCE and does not re-fire → the audio cue fires → reload persists completed/defeated with no
re-pulse → benchmark within the Performance Contract → 0 errors). Fresh-context adversarial review (4 dimensions —
byte-stability/isolation · observer-discipline · phase/feedback-correctness · proof-rigor + per-finding verify, 5
agents): **0 critical / 0 high / 0 medium / 1 low** — fixed (the telegraph proof threshold raised from > 0.25 to > 0.6
so it validates the lift is substantively applied, not merely that some emissive was written). Tree re-audited clean.

**Non-goals (held).** No AI director. No movement / patrol / chase. No ranged attacks. No enemy damage to the player.
No waves. No loot. No factions. No procedural encounter generation. No inventory. No combat balancing. No health UI
beyond the simple sentinel state. No rewrite of Combat-0 / Enemy-0 / Encounter Editor-0. No mutation of the frozen
slice or the benchmark scene. No `WORLD_DOCUMENT_VERSION` bump.

## ADR-053 — Content-1: Second Authored Combat Beat (prove repeatable composition, add no runtime systems)

**Status.** Accepted. Tag `world-builder-content-1-combat-beats` (local only). Stage 64.

**Context.** Encounter-1 made ONE combat beat read as an intentional moment. Before opening the much larger Enemy-1
movement/patrol seam — and with the data still saying rendering architecture is not the bottleneck — the right next
step is to prove the authoring model is REPEATABLE: a designer can stage a SECOND readable combat beat with the existing
editor/runtime seams and no new runtime code. If two staged sentinels feel enough, more authored content follows; if
they feel dead, that tells us what Enemy-1 actually needs. Either way the pathing decision is deferred on evidence.

**Decisive finding — the runtime already iterates N beats.** `EncounterRuntime.load/update/snapshot` and
`EncounterPresentation.load/update` already loop over every authored beat (the single on-screen banner is the
max-priority across all beats). So a second beat is almost entirely a SAMPLE-DATA addition — not a systems change. This
is the orchestrate-don't-rewrite doctrine at its purest: the verification surface is bigger than the implementation.

**Decision — author a second beat + thread one optional `label`.** (1) `visualBenchmarkV1.js` authors a second
`combat-beat.v0` (`vb-cache-sentinel`, `glacial_sentinel`, count 1) at the cache gate — `cache − dir·2.5`, ~10.5m past
the crossing, framed by the existing tall pass pillars (a tighter "final threshold" vs the open crossing). The crossing
stays `items[0]` so `encounters[0]` is unchanged for the Encounter-1 gate. (2) The encounter banner was hardcoded to
"the crossing"; a second beat elsewhere would read the wrong location. So `encounterBannerText` is TEMPLATED on an
optional per-beat `label` (`guards ${loc}` / `clear ${loc}` / `${Cap(loc)} is clear`); with label "the crossing" the
three strings are BYTE-IDENTICAL to the pre-Content-1 banner. The crossing beat is labelled "the crossing", the cache
beat "the pass". The label threads `descriptor → EncounterRuntime.snapshot → EncounterPresentation → banner`.

**The `label` field (the only new data).** `label` is added to the encounter descriptor whitelist
(`normalizeEncounterDescriptor`). It is UNTRUSTED (save files / imported worlds), so `sanitizeLabel` strips markup
angle-brackets, C0 control chars + DEL, and Unicode bidi-override / zero-width / BOM formatting (defense in depth — the
banner already renders via `.textContent`, so there is no injection vector; the strip prevents cosmetic reorder/hide),
trims, and caps at 48 chars. It is ALWAYS emitted as `string|null` (the persistence-whitelist lesson — absence
round-trips stably; a null label falls back to the neutral noun "the path"). Ordinary spaces + printable Unicode (emoji)
are preserved. No `WORLD_DOCUMENT_VERSION` bump — `label` is an additive, backward-compatible whitelist key.

**Independence (the load-bearing property).** The two beats complete + persist INDEPENDENTLY. `EncounterRuntime.update`
marks each beat complete only when ITS OWN ephemeral actors are all defeated (the two beats project distinct namespaced
enemies `enc:vb-crossing-sentinel:0` / `enc:vb-cache-sentinel:0`); the whitelist emits `completed` per descriptor, so
one beat true + one false round-trip through save→load without leaking. Each beat owns its own one-shot clear pulse. The
banner precedence is emergent + correct: clearing one beat while standing inside the adjacent beat's 22m alert range
shows the nearer live threat's banner ("the pass") rather than the just-cleared message — the immediate threat reads
first. (This is why the Encounter-1 gate's cleared-banner check moved to the crossing beat's OWN per-beat `bannerText`
line, which is precedence-independent — a legitimate fix, not a weakening.)

**Byte-stability.** `src/main.js` is UNTOUCHED (the frame loop + `loadEncounters` already drive all beats). `EnemyRuntime`
/ `EnemyFeedback` / `EnemyTypes` / `CombatRuntime` / `FrozenCacheSlice` / `SliceCompletion` / `EncounterCompletion` /
`EncounterMarkers` are ALL zero-diff. The only runtime edits are additive: `label` in two snapshots, the templated
banner, and a per-beat `bannerText` in the presentation snapshot. Worlds with no encounters (the frozen-cache +
first-playable slices) are unaffected. Benchmark draws/triangles are unchanged (98 / 499,864 — the two sentinels +
gate-lights add no measurable draw cost; the perf contract's visual-benchmark scene stays within its locked ceiling, no
re-lock needed).

**Gates.** `test:content-combat-beats` (5 Node: two distinct beats staged apart with distinct ids/labels; label
sanitization incl. bidi/zero-width/BOM stripping + emoji preserved + cap; banner location-awareness with the crossing
banner asserted BYTE-IDENTICAL via `===`; INDEPENDENT completion round-trip in BOTH directions through
`validateWorldDocument`; determinism) + `test:content-combat-beats-proof` (SwiftShader on `visual-benchmark-1`: two
beats staged, two DISTINCT ephemeral enemies, two gate-lights, independent phase at the overlook (far cache dormant,
near crossing live) → defeat beat#1 with `before:[false,false]` precondition → beat#1 completed while beat#2 STILL false
→ the cache beat's own banner + the live on-screen banner name "the pass" → defeat beat#2 → both completed, each
`clearPulses===1` (no shared pulse) → relic objective still completable → benchmark within the Performance Contract →
reload persists BOTH completions + the objective, `clearPulses:[0,0]`, 0 console errors). The three sibling 1-beat gates
evolved honestly to two beats: `encounter-editor-regression` (the `Object.keys` whitelist set gains `label` + new
sanitization sub-cases), `visual-benchmark-regression` §7 (1→2 with per-beat type/enemy/count/finite/id/label/staging
assertions — strictly stronger), `browser-visual-benchmark-proof` (`encounters` 1→2; still fights `encounters[0]`),
`browser-encounter-polish-proof` (`presentCount` ===1→≥1 with the exact count now owned by the content proof; cleared
banner via the crossing beat's per-beat line).

**Review.** Fresh-context adversarial review — 4 dimensions (byte-stability/isolation · independence/persistence ·
label-sanitization/security · proof/gate-rigor), per-finding verify: **0 critical / 0 high / 1 medium / 4 low**, all
addressed — the content proof's banner check documents + asserts the ~10.5m/22m geometry precondition (and adds the
precedence-independent per-beat assertion); `sanitizeLabel` hardened to strip bidi/zero-width/BOM Unicode; an explicit
non-null banner assert added. Council (local model) returned 8 findings, ALL refuted by the actual code + green gates
(hallucinated unsanitized-label / undefined-`capitalize` / single-beat-render / missing-test — none real). Tree
re-audited clean after the review (verifier-can-write gotcha).

**Non-goals (held).** No enemy movement / patrol / chase / pathfinding. No waves (each beat is exactly one enemy). No
loot / rewards / factions / inventory. No AI director. No ranged attacks or enemy damage to the player. No procedural
encounter generation. No new combat rules or balancing. No new runtime system — the second beat reuses Encounter
Editor-0 + Combat-0 + Enemy-0 unchanged. No rewrite of the seams. No mutation of the frozen-cache / first-playable
slices. No `WORLD_DOCUMENT_VERSION` bump.

## ADR-054 — Content-2: Authored Slice Expansion (a fuller slice on existing systems, add no runtime code)

**Status.** Accepted. Tag `world-builder-content-2-slice-expansion` (local only). Stage 65.

**Context.** Content-1 proved a second staged sentinel works. Before opening the much larger Enemy-1 movement/patrol seam
(terrain grounding, water avoidance, combat range, proximity, state transitions, path validity, reload, performance), the
operator chose one more content pass: turn the corridor from "two combat beats + relic objective" into a fuller authored
slice — more variety + pacing — with all enemies still static/reactive and every system unchanged.

**Decisive finding — the loaders already iterate N items.** `InteractionRuntime`, `ParticleRuntime`, and
`PlacedWeaponRuntime` already load their respective WorldDocument blocks (interactions on `object.userData.interaction`,
particles on `object.particles`, weapons in `runtimeAssets.items`). So the expansion is almost entirely SAMPLE DATA — no
new runtime code, no `src/main.js` change. The verification surface (2 new gates + a perf re-lock) is larger than the
implementation.

**Decision — one discoverable "frozen shrine" alcove that bundles the three minimum-scope beats.** Rather than three
scattered additions, Content-2 authors a single cohesive off-route moment, `shrine = relic + perp·9` (~9m beside the relic
ruin, within the 14m route band, clear of the carry centerline and both combat zones):
- **Exploration** — four `vb-shrine-*` primitives (base, idol, two ward stones).
- **Readable** — a data-only `sign` Interaction on the idol whose text names the place AND points the player on to the
  cache (wayfinding → objective clarity). Sanitized by `sanitizeInteraction`; rendered via `.textContent` (no XSS).
- **Environment** — a brooding `smoke` fog-pocket particle emitter on the idol (the 4th ambient emitter).
- **Reward** — one optional `generated.weapon` in a new `doc.runtimeAssets` block: a deterministic **exotic** recipe
  (`generateWeaponRecipe(rollConfig("vb-shrine-relic", "exotic"))`), `state: "idle"` (findable), claimed with F. It
  coexists with the runtime-spawned relic (distinct id `vb-shrine-relic-weapon`; the objective completes only on the relic).

**Implementation surface (minimal).** (1) `groundedPrimitive` gained an additive `interaction` option (mirrors the existing
`particles` option) — existing objects pass `interaction: null`, a harmless new key that survives validation. (2) The sample
imports `generateWeaponRecipe` + `rollConfig` from the arsenal PURE recipe modules — the SAME allowed world→arsenal-recipe
direction already used by `RelicWeaponObjective.js` and `FrozenCacheSlice.js` (the boundary scan forbids only the arsenal
UI; `test:arsenal-world` still passes). (3) The encounters block + the relic objective axis are UNCHANGED (the two combat
beats stay byte-stable — repositioning them would re-open Content-1's tagged byte-state for marginal gain; "encounter
pacing" is satisfied by keeping the new content off-route + the sign's wayfinding).

**Performance — a deliberate content-growth re-lock.** The shrine adds 4 primitives (live objects 15→19; perf-scene 14→18
with the GLB dropped). The `visual-benchmark` perf `objects` ceiling was re-locked **20→24** in `BenchmarkScenes.js`
(measured 18 + ~33% headroom; capture-then-lock; the gate still FAILS above 24). Every other ceiling is unchanged with
ample headroom (live draws 121-142 ≤ 160, triangles ~501k ≤ 700k, runtimeAssets 3-5 ≤ 12 — grass still dominates
triangles; the shrine + fog + reward add little). The frozen-cache / first-playable slices don't load the benchmark → no
re-capture needed there.

**Byte-stability.** `src/main.js` and EVERY runtime system are zero-diff (enemies / combat / slice / encounters / placement
/ assets / interaction / particles). No `WORLD_DOCUMENT_VERSION` bump. Content-2 touches exactly five files:
`visualBenchmarkV1.js` (the shrine + reward + the helper option + two imports), `BenchmarkScenes.js` (the objects re-lock),
`package.json` (two scripts), and the two new gate scripts.

**Gates.** `test:content-slice-expansion` (6 Node: the 4-piece shrine within the route band + clear of the carry midpoint;
the sign role/text/showRadius + save-stable; the smoke fog emitter + ≥4 emitters; the exotic reward validates via
`normalizeRuntimeAssetDescriptor` + is deterministic + distinct from the relic id; the two combat beats + the no-objectives
relic axis byte-stable; determinism + the authored-primitive budget) + `test:content-slice-expansion-proof` (SwiftShader on
`visual-benchmark-1`: the four shrine primitives load + the sign is registered → teleport to the shrine, drive
`interactionRuntime.update(0)`, the sign surfaces its wayfinding text → the reward is placed + `pickUp()` returns
`vb-shrine-relic-weapon` specifically, carried as the active weapon (carriedBefore 0 → after 1, non-vacuous) → BOTH combat
beats still complete independently (`before:[false,false]`, beat#1 done while beat#2 live, then beat#2) → the relic
objective completes → benchmark within the Performance Contract → reload persists the objective + both beats + the reward
re-instantiates, 0 console errors). Full sweep — `test:visual-benchmark(-proof)`, `test:content-combat-beats(-proof)`,
`test:encounter-polish-proof`, `test:frozen-cache-proof`, `test:first-playable-proof`, `test:performance-contract(-proof)`
(6 scenes), `test:arsenal-world` (boundary), enemy/combat, `build`, `qa` — all green; shipped worlds byte-stable.

**Review.** Fresh-context adversarial review (4 dimensions: byte-stability/isolation · data-validity/security/determinism ·
route/perf-relock-honesty · proof/gate-rigor) + per-finding verify: **0 critical / 0 high / 0 medium / 4 low**, all fixed —
a stale `≤20` ceiling comment in the new regression corrected to the re-locked 24 (3 reviewers flagged the same line), and
the sign-surface proof made DETERMINISTIC via a synchronous `interactionRuntime.update(0)` after the teleport (instead of a
throttled-rAF `sleep`). One finding refuted (a "vacuous perf gate" claim — `objects`/`runtimeAssets` are finite + non-zero,
so `collectBreaches` runs real comparisons; the cited `drawCalls>0` guard does not exist in the sibling proof). Tree
re-audited clean after the review (the verifier-can-write gotcha — code-reviewer agents have Bash).

**Non-goals (held).** No enemy movement / patrol / chase / pathfinding. No enemy attacks or damage to the player. No waves.
No loot SYSTEM (the reward is one authored optional weapon, not drops/tables/rarity). No factions. No inventory. No AI
director. No procedural encounter generation. No shader/LOD experiments or renderer work. No new runtime system — the
shrine reuses Interaction / Particle / Arsenal loaders unchanged. No `src/main.js` change. No mutation of the two combat
beats, the relic objective, or the frozen-cache / first-playable slices. No `WORLD_DOCUMENT_VERSION` bump.
