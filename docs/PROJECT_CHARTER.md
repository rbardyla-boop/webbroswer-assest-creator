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
