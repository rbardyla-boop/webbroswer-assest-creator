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

**Deferred to Stage 17B (same kernel, more adapters).** Particle emitters (cull by
EMITTER BOUNDS, not origin), placed lights (keep off-screen lights that affect
visible terrain), procedural/voxel streaming agents (where `maxWakesPerFrame` becomes
load-bearing), and an opt-in render-hide tier for non-shadow-casting decorative
props. Grass/bush/tree already implement their own patch-level culling/LOD/streaming
and are intentionally left as-is (not rewritten).
