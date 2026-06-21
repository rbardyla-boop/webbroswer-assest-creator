# Blueprint Reconciliation — "grok Stages 0–4" vs. this repo

**Status:** Reviewed → **rejected; port nothing.** No source code changed as a result of this review.
**Scope of change from this doc:** this file only.

## What was evaluated

An AI-generated "Pre-Flight Verification Parameters" blueprint proposing a greenfield Three.js
"Stages 0–4" architecture: `src/grass`, `src/terrain`, `src/core`, `src/player`, `src/debug`, and a
`src/state` "decentralized state" layer (factions, WebRTC peer-to-peer, zero-knowledge proofs,
"settled on-chain").

The blueprint appears to have been generated with **no knowledge of this codebase**. This repo is
already that project, roughly 68 shipped stages further along (see `docs/FIRST_PLAYABLE_BUILD.md`
and the ADR ledger in `docs/PROJECT_CHARTER.md`). Every directory the blueprint proposes to
"create" already exists here in a more advanced, canonical form.

Two independent read-only analyses (an architecture/terrain sweep and an adversarial salvage pass)
reached the same verdict: **the warranted source-code change set is empty.**

## Reconciliation — blueprint area → existing owner

| Blueprint area | Verdict | Evidence in this repo |
|---|---|---|
| `src/grass/*` placement | **Already superior** | `GrassSystem.js` streams patches around the camera with a per-frame budget (`maxPatchBuildsPerFrame: 3`, `GrassConfig.js:56`) via `_enqueueNearby`/`_disposeFar`/`_processBuildQueue` (`GrassSystem.js:79-114`), with dispose hysteresis (`keepDistance: 200` > `visibleDistance: 165`, `GrassConfig.js:12-13`). Placement is deterministic: `mulberry32(hash2i(gx, gz) ^ 0x9e3779b9)` (`GrassPlacement.js:24`). The blueprint builds **all** patches at boot using `Math.random()`. |
| `src/grass/GrassMaterial.js` | **Already superior** | Repo shader carries per-blade wind phase (`aPhase`, `GrassMaterial.js:17,52`), gust turbulence (`uWindGust`, lines 24/53), manual fog, and grazing-angle Fresnel tip-bias (lines 92-93/118-119). The blueprint is a strict subset: one global sin/cos wind, a single hardcoded Lambert term, no fog, no per-blade phase. |
| `src/terrain/terrainSampling.js` | **Already superior** | Repo is a THREE-free pure-math wrapper over a swappable `TerrainProfile` (`terrainSampling.js:27-43`): `getHeight` delegates to `activeProfile.height`; `getNormal` uses central differences with no THREE dependency (line 46+). Profiles add snowline, water table, meadow masks, slope limits (alpine/rolling). The blueprint collapses this to one hardwired fBm with a broken `getNormalAt`. |
| `src/core/*`, `src/player/*` | **Already exists** | renderer (reverse-Z capable), scene, camera, lights, input all present. Player is grounded via collider `getSupportHeight` → `getHeight`; first/third-person camera toggle present. |
| `src/debug/DebugPanel.js` | **Already superior; 1 row forbidden** | Repo HUD shows FPS, **real** draw calls (`renderer.info.render.calls`, `main.js:1351`), patches, blades, LOD%, plus trees/bushes/weapons/visibility. The blueprint's only novel row — "World State Actions" — sources the forbidden state layer below. |
| `src/state/*` (factions, WebRTC, ZK, on-chain) | **Forbidden** | Violates **ADR-039** ("focused editor, not Unreal-in-a-tab") and the charter's hard non-goals: *local/browser-only; no cloud/account/networking; no factions; no decentralized state.* Confirmed absent from `src/` today (grep: no `webrtc`/`peer-to-peer`/`blockchain`/`zero-knowledge`/`faction`). |

## Blueprint defects (present even on its own terms)

1. **`getNormalAt` uses `THREE.Vector3` with no THREE import** → `ReferenceError: THREE is not defined`. This repo's `terrainSampling.js` deliberately imports no THREE and returns a plain `{x,y,z}`.
2. **`stage2.test.js` does `import { THREE } from 'three'`** — `three` has no named export `THREE` (it is a namespace/star import). Resolves to `undefined`, so any `THREE.*` access crashes. This repo uses `import * as THREE from "three"` everywhere.
3. **Grass placement uses `Math.random()` while the blueprint's Stage-1 verification asserts determinism** — internally contradictory. This repo has **zero** `Math.random` under `src/grass/` (verified).
4. **All-patches-at-boot is a perf regression** versus the repo's streaming `GrassSystem` (per-frame build budget + dispose hysteresis).

## Salvage assessment — why the change set is empty

Every overlapping system in the blueprint is a strict subset of, or a regression against, what the
repo already ships; the only genuinely novel element (the decentralized/networked state layer) is
categorically forbidden by doctrine. There is no small, doctrine-aligned improvement hiding in the
blueprint. Per the engineering rule ("smallest coherent change… no fake wiring, no placeholder
controls"), inventing edits just to "use" the blueprint would be busywork and net-negative. **Port
nothing; discard the blueprint.**

## Recommended path forward

- **Reuse the existing modules.** If the goal behind the blueprint was "better grass / terrain /
  world feel," the higher-leverage move is tuning the existing `GrassConfig` / `TerrainProfile`,
  not replacing the engine.
- **New project from this blueprint is not recommended.** If a true greenfield is still wanted, the
  blueprint must first fix the three defects above and add streaming — at which point it would just
  be a worse copy of this repo's `src/grass` + `src/terrain`. Prefer forking this repo's proven
  modules.
- **Networking / multiplayer / decentralized state is a charter-level pivot, not a bolt-on.** It
  would require its own ADR and an explicit decision to relax the "local/browser-only, no
  networking" constraint. Treat it as a separate, deliberate decision — do not import it via this
  blueprint.
- **The "implement blueprint as-is" option is gated.** Doing so would regress ~68 shipped stages
  and break the no-networking doctrine; it is not executed by this review and requires explicit
  re-confirmation.

## How to re-verify this verdict

```sh
rg -n "Math\.random" src/grass/                                  # expect: no matches (determinism)
rg -ni "webrtc|peer-to-peer|blockchain|zero-knowledge|faction" src/  # expect: no matches (no forbidden scope)
rg -n "maxPatchBuildsPerFrame|keepDistance|visibleDistance" src/grass/GrassConfig.js  # streaming budget exists
rg -n "mulberry32|hash2i" src/grass/GrassPlacement.js            # deterministic placement
rg -n "uWindGust|aPhase|Fresnel" src/grass/GrassMaterial.js      # richer shader exists
rg -n "info.render.calls" src/main.js                            # real draw-call HUD source
```
