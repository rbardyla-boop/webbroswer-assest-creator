# Visual Benchmark-1 — Measured Baseline + LOD Finding

> One compact, authored corridor (Relic Overlook → glacial crossing → cache pedestal) polished toward
> shipping quality while staying inside measured budgets. This document records the **measured** structural
> baseline and the **honest LOD finding** it supports. It is evidence, not advocacy — observation and
> inference are kept separate, and the conditions that would falsify the conclusion are stated.

## What the benchmark is

A new authored sample world (`visual-benchmark-1`, `src/world/samples/visualBenchmarkV1.js`) that composes
existing systems into one intentional space — glacial terrain/water/fog (default alpine profile), authored
primitive landmarks framing a readable route, a Procedural Authoring-1 beacon-trail along that route, an
Encounter Editor-0 combat beat on the crossing, and a reference-only validated-GLB cache prop. The relic
find→carry→cache loop is the runtime's automatic objective. It does **not** mutate the shipped Frozen Cache
/ first-playable slice (those remain historical baselines).

## Measured baseline (SwiftShader, structural)

Captured by `test:visual-benchmark-proof` (full scene, GLB resolved) and `test:performance-contract-proof`
(budget variant — the GLB binary is dropped because it won't resolve headless in the generic perf harness):

| Capture | draws | triangles | objects | inst. batches | veg patches | runtime assets |
|---|---|---|---|---|---|---|
| Visual Benchmark (full) | 116 | 512,962 | 11 | 2 | 62 | 2 |
| Visual Benchmark (budget variant) | 95 | 501,106 | 10 | 2 | 56 | 2 |
| Empty glacial floor (reference) | 110 | 515,672 | 0 | 0 | 62 | 2 |
| Dense authored (500 cubes, reference) | 111 | 381,056 | 500 | 1 | 62 | 2 |

Per-scene ceiling (locked in `BenchmarkScenes.visualBenchmarkScene`): draws ≤ 160, triangles ≤ 700,000,
objects ≤ 16, instanced batches ≤ 8, veg patches ≤ 120, runtime assets ≤ 12. The scene classifies **yellow**
(triangle pressure), which the Performance Contract treats as a warning, not a failure — identical to every
other glacial-grass scene.

### CRITICAL honesty caveat

SwiftShader is a **CPU/software rasterizer**. Every number above is a **structural / CPU-budget** signal —
draw calls, triangle counts, object/batch/patch counts, geometry/texture counts. **None of these is a GPU
FPS measurement.** "Within budget" means "well within a conservative structural budget", NOT "runs at 60 fps
on your GPU" — that still requires a hardware GPU measurement (per `docs/PERFORMANCE_REPORT.md`). The
"frame-budget safety" asserted by the proof is structural: counts within the contract + no multi-second
frame stall.

## Observations (measured, not inferred)

1. **Triangle cost is dominated by grass, not by the authored corridor.** The benchmark's ~513k triangles
   are within ~0.5% of the *empty* glacial floor (515,672). The authored composition — 10 landmark
   primitives + the GLB cache prop + the beacon trail + the runtime relic + the projected encounter
   sentinel — adds a negligible triangle delta on top of the default glacial grass.
2. **Draw calls stay green** (95–116 ≤ the 120 green line). The authored primitives collapse into ~2
   instanced batches; the corridor did not multiply draw calls.
3. **The scene is playable and reload-safe at this budget.** Both the relic objective and the encounter
   combat beat complete, completion persists across reload, and there are 0 console errors — all while the
   structural budget stays within the contract.

## LOD finding

**B — LOD can be deferred for this scoped benchmark.**

Inference from the observations: the dominant structural cost (grass) is already managed by **patch
streaming + the Stage-17A visibility kernel**, *not* by per-object LOD; and the authored corridor detail is
light enough that polishing it did not move the scene out of its existing structural band. So this scoped,
shipping-quality corridor does not *require* per-object/geometry LOD to stay inside the Performance Contract.
LOD is **deferred, not deleted.**

**C remains an untested hypothesis** — *"LOD can be reduced for certain streamed procedural detail only."*
No production streamed-detail producer exists (ADR-048 deliberately shipped `PagedGeometryStream` as a tested
infrastructure gate with **no** production consumer). In this benchmark the geometry stream was used **for
measured stats only** (the DEV `__PAGED__` harness): it is **available and structurally measured** —
deterministic chunked geometry, ≤ 64,000 vertices per chunk — but **no visual dependency was created**.
Whether LOD can be reduced for streamed procedural detail can only be answered when a real consumer exists,
under a hardware GPU measurement. That is future work, not a result of this stage.

The benchmark therefore records exactly, and only:

```text
PagedGeometryStream is available and structurally measured.
No production visual dependency has been created yet.
LOD remains deferred-not-deleted.
```

### Explicitly NOT concluded (forbidden over-claims)

- ✗ "LOD is obsolete."
- ✗ "A Nanite-like shader makes LOD unnecessary."
- ✗ "No visible lag means no LOD is needed."

### What would falsify finding B

- A richer authored slice (or a real streamed-detail producer) pushing triangles/draws toward the contract's
  **red** ceiling on target hardware.
- A **GPU FPS** measurement (real hardware, not SwiftShader) showing the scene is triangle- or
  overdraw-bound below 60 fps at this composition.
- Either result would move the conclusion from B (defer) toward "LOD needed soon" or toward testing C with a
  real producer.

## Environment Polish-1 — before / after (ADR-051)

Environment Polish-1 evolved this corridor **in place** toward a shippable authored slice **using only the
existing stack** — no new rendering architecture, no WebGPU, no terrain/combat/AI work. The git tag
`world-builder-visual-benchmark-1` preserves the pre-polish byte-state; the polished corridor is HEAD.

What changed, all additive and measured:

- **Composition / landmark density:** +4 route-framing primitives — two waypoint cairns guiding the eye
  along the route, and a crossing gateway (two short ice posts) framing the combat beat as a threshold.
- **Per-scene readability overrides (this document only):** `lighting` (a brighter, higher, more raking sun
  so the stone/ice landmarks read with form; fog pushed back — near 90→112, far 320→380 — so the cache is
  discoverable from the overlook while the route keeps depth), `water` (foam band 0.7→1.4, fresnel 0.28→0.40,
  flow 0.35→0.50 so the crossing edge reads), `atmosphere` (basin fog 0.45→0.38, mist 0.40→0.32, mist band
  12→16 so the corridor floor and crossing stay legible). Each config factory returns a fresh object and the
  loader reads the value off the document, so these affect **only** the benchmark — the global default and
  the frozen slices are byte-stable (the regression asserts a vanilla world still gets the unmodified default).
- **Feedback:** ambient particle emitters stage the relic (spark), the cache (spark), and the crossing
  threshold (dust); the relic loop's audio already comes from the always-on slice, so the additive
  `RuntimeFeedback` owner closes the remaining gap with an **encounter-clear audio cue** (provable via a cue
  counter — audio no-ops in the headless harness without a user gesture).

| Capture (SwiftShader, structural) | draws | triangles | objects | inst. batches | veg patches | runtime assets |
|---|---|---|---|---|---|---|
| **Before** — Visual Benchmark-1 (full) | 116 | 512,962 | 11 | 2 | 62 | 2 |
| **After** — Environment Polish-1 (full) | 119 | 511,720 | 15 | 1 | 62 | 2 |
| **After** — Environment Polish-1 (budget variant) | 98 | 499,864 | 14 | 1 | 56 | 2 |
| **After** — Content-2 (full, shrine claimed) | 121 | 501,790 | 19 | 1 | 56 | 3-5 |
| **After** — Content-2 (budget variant) | 121 | 501,790 | 18 | 1 | 56 | 3 |

The polish is **nearly free structurally**: Environment Polish-1's +4 landmarks + 3 emitters added ~3 draw calls
and no meaningful triangle delta (grass still dominates, ~500k ≈ the empty floor). **Content-2** then added a
4-piece off-route frozen shrine (+ a 4th `smoke` emitter + a sign) and one optional `runtimeAssets` reward
weapon — again nearly free (live objects 15→19; draws still ~121, triangles ~501k; the runtime asset count
ticks 2→3 with the shrine reward, up to 5 during combat as weapons are placed). The per-scene `visual-benchmark`
ceiling was **re-captured and re-locked** at each content step — the `objects` ceiling moved 16→20 (Polish-1)
then **20→24** (Content-2: measured 18 + ~33% headroom), while the draws/triangles/vegetation/runtimeAssets
ceilings stay at the shared values (still ample headroom). The scene classifies **green** in the contract.

The **LOD finding is unchanged: B (defer for this scope).** Polishing the corridor toward shipping quality did
not move the scene out of its structural band — the same conclusion the original benchmark recorded. C (LOD
reducible for streamed procedural detail) remains an untested hypothesis; no production streamed-detail
producer was created. The SwiftShader-is-CPU-not-GPU caveat above still applies to every number here.

## Audio/Feedback-1 — sensory layer (ADR-055)

Audio/Feedback-1 added a **slice sensory layer** (`SliceSensory`) over this benchmark: differentiated combat
**HIT/DEFEAT** cues, a **shrine discovery** cue, a distinct **exotic-reward** pickup cue, a **cache-payoff**
cue on objective completion, and a milestone **visual toast** mirror — all observing the existing seams and
playing through the existing `ProceduralAudio` engine (a single shared instance with `RuntimeFeedback`; no
third wind bed). It is **structurally free**: it adds **no scene geometry** (the toast is DOM), so the
benchmark's draws/triangles/objects are **unchanged** (draws ~121, tris ~501,790, objs 18–19) and the
Performance Contract needed **no re-lock**. The layer is dormant on any slice without authored encounters or
sign interactions (frozen-cache / first-playable stay byte-stable). The LOD finding (B — defer) is unaffected.

## Enemy-1 — bounded sentinel patrol (ADR-056)

Enemy-1 gave the benchmark's **crossing** sentinel a tiny authored patrol: it walks a 2-point line across
the corridor (perp ±3 m, inside the radius-8 zone, on the same walkable/dry ground the route uses) at
0.8 m/s with a 1 s dwell, `alert:"halt"` (it stops + faces the player when they enter the zone). The
**cache** sentinel stays **stationary**, so the slice now proves moving + static sentinels coexist and
reload-correctly in one scene. Movement is a **motion overlay** on the Enemy-0 combat target (the combat
FSM is byte-identical; CombatRuntime is untouched) — terrain-safe (rejects any out-of-radius / water /
snow / steep point → the sentinel stays stationary), provably **bounded** to the encounter radius,
deterministic, and frozen permanently on defeat. It is **structurally free**: it adds **no scene geometry**,
so the benchmark's draws/triangles/objects are **unchanged** (draws 121, tris ~501,790, objs 19) and the
Performance Contract needed **no re-lock**. The LOD finding (B — defer) is unaffected.

## Content-3 — mixed enemy encounter composition (ADR-058)

Content-3 made the benchmark's **cache gate** a **mixed final guardian**: the existing stationary `glacial_sentinel`
(`vb-cache-sentinel`) is now joined by a hovering `frost_wisp` (`vb-cache-wisp`) — two **independent single-enemy beats**
whose radius-6 zones **overlap** (centres ~3 m apart) so entering the gate engages both. It proves the combat / enemy /
encounter stack produces a mixed engagement through **authored composition alone**: no new enemy systems, no schema change,
no waves. The runtime (`EncounterRuntime` / `EnemyRuntime` / `CombatRuntime` / `EncounterPresentation`) is **byte-unchanged**
— the encounter stack was already multi-beat. The wisp beat is **appended** at `items[2]`, so the crossing (`items[0]`) and
cache sentinel (`items[1]`) round-trip **byte-identical**, and `enemyCount` stays clamped to 1 per beat (the no-waves gate).

It is **structurally free**: the wisp enemy is not a `WorldObject` and the far cache enemies are frustum-culled at the spawn
capture, so the benchmark's structural counts are **unchanged** (draws **121**, tris **~501,790**, objs **19**) and the
Performance Contract needed **no re-lock**. The two-beat gates (`content-combat-beats`, `visual-benchmark`,
`content-slice-expansion`, `enemy-patrol-proof`) were **deliberately rebaselined** 2→3 beats (operator-chosen, to enrich the
shipping corridor) — the two sentinel beats stay byte-stable and the beat proofs now additionally assert the wisp stays **live**
when the sentinels are defeated (a stronger independence check). The LOD finding (B — defer) is unaffected.

## Enemy-3 — light proximity response (ADR-059)

Enemy-3 makes the mixed cache engagement feel **aware**: the stationary `glacial_sentinel` ORIENTS (a clamped
turn) + LEANS toward the player while they stand in the gate; the `frost_wisp` BIASES its hover drift slightly
**away** from the player — both bounded, both dormant outside the zone, both stopping permanently on defeat. It
is a **motion overlay** (a new pure `EnemyProximityLogic` + a thin `EnemyRuntime` hook) reusing the encounter
zone + `EncounterPresentation`'s existing **brighten** telegraph — `CombatRuntime` / `EnemyTargetAdapter` /
`EncounterPresentation` / the Enemy-1 patrol facing are **byte-unchanged**, and the response writes only the
transform so `snapshot()` stays deterministic. It is **structurally free** (no scene geometry): the benchmark's
counts are **unchanged** (draws 121, tris ~501,790, objs 19) and the Performance Contract needed **no re-lock**.
Worlds without encounters (frozen-cache / first-playable) have no zone → the response is dormant + byte-stable.

## Gates

- `test:visual-benchmark` — Node (11 checks): the authored scene is valid, deterministic, registered, composed
  (landmarks frame a readable route; reference-only GLB; beacon-trail; one combat beat), budget-bounded, the
  per-scene readability overrides differ from the global default while the global default stays unchanged, and
  ambient particle feedback is present.
- `test:visual-benchmark-proof` — SwiftShader: living world → composition → GLB resolved → geometry-stream
  stats → Performance Contract → relic + encounter completable → readability overrides applied + persisted →
  particle feedback live → encounter-clear cue fired → reload-persists → 0 console errors.
- `test:performance-contract(-proof)` — the `visual-benchmark` scene is a gated benchmark scene (6th scene).
- `test:audio-feedback(-proof)` — the slice sensory layer (Audio/Feedback-1): differentiated combat /
  discovery / reward / cache cues + a visual toast, one-shot + reload-safe, dormant off-benchmark, 0 errors.
- `test:enemy-patrol(-proof)` — the bounded sentinel patrol (Enemy-1): the crossing sentinel moves in-zone +
  terrain-safe, halt-telegraphs on approach, is struck on its live displaced mesh, freezes on defeat, and
  reload-persists while the cache sentinel stays static; benchmark counts unchanged, 0 errors.
- `test:content-3(-proof)` — the mixed cache engagement (Content-3): the cache gate stages a sentinel + a
  hovering wisp with overlapping zones, both combat targets; entering the gate telegraphs both; one weapon
  defeats both (same `weaponId`, the wisp strike resolving to the wisp); each beat completes independently
  (defeating one leaves the other live) and reload-persists while the crossing stays live; schema unchanged
  (`enemyCount` clamps to 1, no new key); benchmark counts unchanged, 0 errors.
- `test:enemy-proximity(-proof)` — the light proximity response (Enemy-3): outside the cache zone both enemies
  are dormant; inside, the sentinel orients (yaw converges to the bearing) + leans and the wisp's drift biases
  away (bounded, away-from-player, body stays in-zone); both stay combat targets + are defeated by one weapon;
  defeat stops the response + freezes the pose; reload-persists; benchmark counts unchanged, 0 errors.
