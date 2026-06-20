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

## Gates

- `test:visual-benchmark` — Node: the authored scene is valid, deterministic, registered, composed (landmarks
  frame a readable route; reference-only GLB; beacon-trail; one combat beat), and budget-bounded.
- `test:visual-benchmark-proof` — SwiftShader: living world → composition → GLB resolved → geometry-stream
  stats → Performance Contract → relic + encounter completable → reload-persists → 0 console errors.
- `test:performance-contract(-proof)` — the `visual-benchmark` scene is a gated benchmark scene (6th scene).
