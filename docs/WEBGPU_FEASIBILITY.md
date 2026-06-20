# WebGPU Feasibility Gate-0 — Capability, Comparison, and Go/No-Go

> A **feasibility-only** research gate. It answers one question — *is WebGPU worth pursuing for this
> project's actual bottlenecks?* — and records the evidence honestly. It is **not** a renderer
> migration. WebGL remains the production path, untouched. Observation and inference are kept separate,
> and the conditions that would change the conclusion are stated.

## What this gate is (and is not)

- **Is:** a capability probe, a minimal isolated WebGPU spike that actually renders, a structural
  comparison against the WebGL Visual Benchmark-1 baseline, and a go/no-go recommendation.
- **Is not:** a renderer rewrite, a port of the world, a replacement of Three.js, a drop of WebGL, or
  any claim that WebGPU solves LOD/Nanite concerns. None of those are done or implied here.

The spike lives behind its own Vite entry (`webgpu-lab.html` → `src/feasibility/webgpu/webgpuLabMain.js`)
and imports **nothing** from the production renderer (`src/core/renderer.js`), `src/main.js`, or the
world. That isolation is machine-checked by `test:webgpu-feasibility` (static import scan) and by
`test:webgpu-feasibility-proof` (the production WebGL app still boots cleanly alongside the lab).

## Capability — measured

`test:webgpu-feasibility-proof` launches its own headless Chromium that **attempts** a WebGPU adapter
(`--enable-unsafe-webgpu --enable-features=Vulkan`) while keeping the SwiftShader GL path for the WebGL2
fallback and the production app. The gate is robust to **both** outcomes.

| Probe / renderer | Measured (this environment) |
|---|---|
| `navigator.gpu` present | yes |
| WebGPU adapter granted | yes (`isFallbackAdapter = false`) |
| `WebGPURenderer` backend **actually used** | **`webgpu`** |
| Instanced field rendered | yes — 4096 instances · 8192 triangles · 1 draw batch |
| Console errors | 0 |
| Production WebGL app still boots | yes (`__PERF__` present, 0 errors) |

So **WebGPU initializes and renders an instanced field in-browser via a live WebGPU backend** in our CI
environment. The renderer also auto-falls back to a WebGL2 backend when no adapter exists; the gate
accepts that path too (it is the expected outcome on a machine without `--enable-features=Vulkan`).

### CRITICAL honesty caveats

1. **"hardware-backed" ≠ a real GPU.** `isFallbackAdapter = false` only means *the adapter did not
   self-report as a software fallback*. Under headless `--enable-features=Vulkan` this is almost
   certainly a **software Vulkan path** (SwiftShader/lavapipe), not a discrete GPU. Treat it as a
   **structural / CPU-budget** signal — that WebGPU *initializes and draws* — **not** a GPU-FPS result.
2. **No FPS claim.** As with every proof in this project, SwiftShader is a CPU rasterizer; "rendered"
   means "drew without error", not "ran at 60 fps on your GPU". A real performance verdict still needs a
   hardware-GPU run (`docs/PERFORMANCE_REPORT.md`).
3. **The backend used varies by environment.** This gate records what *this* CI got; a different
   machine/flags will legitimately get the WebGL2 fallback, and the gate still passes.

## Structural comparison — lab spike vs WebGL baseline

The lab field is a **controlled micro-scene**, not a copy of the full Visual Benchmark-1 world, so this
is an **architectural** comparison, not a scene-equal benchmark.

| | Lab spike (WebGPU backend) | Visual Benchmark-1 (WebGL, full scene) |
|---|---|---|
| Triangles | 8,192 | 512,962 |
| Draw batches (instanced) | 1 | 2 |
| Source | `webgpuLabComposition()` | `docs/VISUAL_BENCHMARK.md` |

**What the comparison shows:** both renderers collapse an instanced field into a *single* draw batch.
Instance batching is **not** where WebGPU differs from WebGL — Three.js `InstancedMesh` already does it
on WebGL. WebGPU's real architectural levers are **render bundles** (CPU draw-submission cost) and
**compute shaders** (GPU culling/placement) — and *neither is exercised by this minimal field*. Our
measured draw calls are already green (95–116 in Visual Benchmark-1), so the render-bundle lever
addresses a cost we do not currently have.

## Risk / benefit across the dimensions in the gate contract

| Dimension | Assessment |
|---|---|
| **Grass triangle pressure** (our actual bottleneck) | WebGPU does **not** reduce triangle count. Grass cost is managed by patch streaming + the Stage-17A visibility kernel — a content/streaming discipline, not a renderer-architecture problem. A *future* compute-shader culling/placement path **could** help, but that is an untested hypothesis needing a real producer + hardware GPU. |
| **Geometry streaming** | `PagedGeometryStream` (ADR-048) is renderer-agnostic (deterministic chunked `BufferGeometry`). It works identically on either backend; WebGPU adds nothing required here. |
| **Shader / material complexity** | **The largest cost.** Every custom shader is GLSL/`onBeforeCompile` (grass wind, terrain blend, water, atmosphere, energy weapon). WebGPU needs **TSL/node materials** — a rewrite of the entire shader investment, or a dual material system. Assessed analytically; not undertaken (out of feasibility scope). |
| **Future visual-benchmark quality** | No evidence WebGPU is *required* for the next 3–5 stages' quality. Current quality ceiling is art-direction + content discipline, not API features. |
| **Browser / device support** | WebGPU is now in Chrome/Edge/Firefox and recent Safari, but **older devices and some mobile have no WebGPU**. "The browser owns reach" (ADR-039) ⇒ dropping WebGL would shrink reach. |
| **Fallback cost** | `WebGPURenderer` auto-falls back to WebGL2 — but a *production* dual path means maintaining/validating two backends and two material systems. Real, ongoing cost. |
| **Maintenance burden** | A parallel renderer lane is a standing maintenance + test surface. The evidence does not yet show a bottleneck that justifies paying it. |

## The specific question

> *Does WebGPU materially improve the next 3–5 stages, or is WebGL + the existing performance contract
> sufficient?*

**WebGL + the existing performance contract is sufficient for the next 3–5 stages.** Our measured
constraint is grass triangle pressure / content-and-streaming discipline, not renderer architecture or
CPU draw-submission overhead — and those are the costs WebGPU's headline levers (render bundles)
address. WebGPU's one *potentially* relevant lever (compute culling/placement for vegetation) is an
untested hypothesis that would need a real producer and a hardware-GPU measurement before it could
justify a renderer commitment.

## Go / No-Go

**Outcome B — WebGPU is worth keeping as an experimental lab only.**

- **Not A** (not worth pursuing): the spike shows WebGPU *does* initialize and render in-browser here, so
  it is worth *keeping a lab*, not discarding.
- **Not C** (small parallel renderer lane): C is a real maintenance commitment, and the evidence shows
  no current bottleneck WebGPU uniquely solves. Premature.
- **Not D** (plan migration): explicitly out of scope and unjustified by the evidence.

The durable artifact of this gate **is** outcome B: the isolated `webgpu-lab.html` lab — small,
build-gated, zero production coupling — is the standing experimental lab. WebGL stays the production
path. No renderer migration without a later, separately approved stage.

## What would move the conclusion from B toward C or D

- A measured bottleneck (on **real GPU hardware**, not SwiftShader) that WebGPU's compute path or render
  bundles **uniquely** relieve — e.g. grass culling/placement becoming GPU-bound in a way WebGL2 can't
  match.
- A real streamed-detail producer (a `PagedGeometryStream` consumer) whose triangle/draw load needs GPU
  compute to stay inside the Performance Contract.
- A product decision to drop older-device reach, removing the WebGL fallback obligation.

Absent those, the recommendation is **B**, and this lab is the place to test the hypotheses above when
they become concrete.

### Explicitly NOT concluded (forbidden over-claims)

- ✗ "WebGPU makes LOD obsolete." / ✗ "A Nanite-like path removes the need for LOD."
- ✗ "WebGPU runs the world at 60 fps." (No GPU-FPS measurement was taken.)
- ✗ "We should migrate the renderer." (Out of scope; unjustified.)

## Gates

- `test:webgpu-feasibility` — Node: probe verdicts across navigator shapes, limit whitelisting, field-plan
  determinism + clamps, structural comparison, and the isolation + purity static scans.
- `test:webgpu-feasibility-proof` — headless browser: the lab probes, initializes a real backend, renders
  the instanced field, computes the comparison, the production WebGL app still boots, 0 console errors —
  robust to both the adapter-granted and WebGL2-fallback outcomes.
