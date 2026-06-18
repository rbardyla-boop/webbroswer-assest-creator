# First Playable Build Gate

**Status:** Draft v0.1
**Purpose:** Define the first tested-clear playable game build before any public/live release.
**Rule:** This document is the build target. Feature stages may *advance* this target, but they do
not *replace* it. After every accepted stage, update §10 and §11.

This is a **gate** document, not a roadmap. Every "done" here is backed by a runnable command or a
go/no-go check. If a claim can't be checked, it doesn't belong here.

---

## 1. End Goal

The first build is a small browser-playable vertical slice set in the glacial valley world.

The player should be able to:

1. Load into the glacial valley.
2. Move around the terrain with stable camera and grounding.
3. See the math-authored alpine terrain, water, fog, vegetation, wildlife, ambient motes, and placed
   generated weapons.
4. Place or encounter at least one generated weapon.
5. Equip, cycle its slot, drop, store, and reload that weapon without corrupting world state.
6. Experience a coherent living world without combat, inventory, networking, monetization, or public
   live-service systems.

The first build is **not the full game**. It is the first tested proof that the world engine can host
a playable game loop without hidden structural defects.

## 2. First Build Name

Working name: **Glacial Valley First Playable**

Tag targets:

```text
world-builder-first-playable-doc-v0.1   # FP-0: this gate document (a milestone, not the build)
world-builder-first-playable-v0         # FP-4: the actual first playable — RESERVED, do not apply early
```

Applying `world-builder-first-playable-v0` before §8 GO is satisfied is itself a NO-GO violation.

## 3. Non-Negotiable Build Rules

The first playable must preserve these architectural rules (each is already enforced by a test today):

1. Terrain has one source of truth through the active `TerrainProfile`. *(test:terrain-source,
   test:terrain-profile)*
2. Water, wetness, snowline, vegetation, wildlife, and ambient systems derive from that
   terrain/profile contract. *(test:water, test:atmosphere, test:wildlife, test:ambient)*
3. Generated weapons persist by recipe + transform + runtime state, **never** by generated geometry.
   *(test:arsenal-world)*
4. `/arsenal.html` remains isolated from the world app. *(isolation grep in test:arsenal-world /
   test:arsenal-placement / test:arsenal-equip-slots)*
5. Runtime systems must be deterministic where they claim determinism. *(test:streamer,
   test:terrain-source)*
6. Browser proof must have zero console errors. *(every browser proof asserts this)*
7. No feature is accepted without tests.
8. No live/public release happens from a dirty or partially verified tree.

## 4. Current Proven Foundation

These stages are accepted (committed + tagged + adversarially reviewed) and are part of the current
foundation. They are **foundation systems, not the final game loop.**

| Stage      | Status   | Gate(s) | Notes                                               |
| ---------- | -------- | ------- | --------------------------------------------------- |
| Arsenal v1 | Accepted | test:arsenal, test:arsenal-proof | Isolated procedural weapon generator |
| Arsenal v2 | Accepted | test:arsenal-world, test:arsenal-world-proof | Recipe→world placement & persistence |
| Arsenal v3 | Accepted | test:arsenal-placement, test:arsenal-v3 | Click-to-place + equip/drop/store interaction |
| Arsenal v4 | Accepted | test:arsenal-equip-slots, test:arsenal-v4 | Oriented equip slots (rightHand/back/hip) + slot persistence |
| Visual-0   | Accepted | test:terrain-profile, test:terrain-source, test:visual0 | Glacial valley TerrainProfile + math visual layer |
| Visual-1   | Accepted | test:water, test:atmosphere, test:visual1 | Terrain-derived water, wetness, fog, atmosphere |
| Wildlife-0 | Accepted | test:wildlife, test:wildlife0 | Grounded biome-aware wildlife |
| Wildlife-1 | Accepted | test:flock, test:wildlife1 | Aloft snow_finch flock system |
| Wildlife-2 | Accepted | test:streamer | Shared RegionStreamer for Family-A streamed actors |
| Ambient-0  | Accepted | test:ambient, test:ambient0 | Alpine motes as the third streamed actor class |

## 5. First Playable Scope

### Required

The first playable must include:

1. Player movement and camera.
2. TerrainProfile-backed alpine valley.
3. Glacial water and atmosphere.
4. Vegetation and grass.
5. Grounded wildlife.
6. Aloft flocks.
7. Ambient motes.
8. Generated weapon placement.
9. Generated weapon equip / slot-cycle / drop / store.
10. Save/load (reload) persistence proof.
11. Debug/proof visibility for major runtime systems.
12. One clear player-facing objective.

### Minimal Objective

The first objective should be simple:

```text
Find a generated relic weapon in the glacial valley, equip it, carry it to a marked overlook/cache
point, store it, and reload the world to prove persistence.
```

This proves traversal, world readability, generated assets, equip state, placement, persistence, and
environmental stability — without any combat or inventory.

### Deferred (must NOT be in the first playable)

Combat · damage · enemy AI · inventory grid · loot economy · crafting · multiplayer · account system ·
cloud save · live deployment · procedural quest system · AI dungeon-master runtime · weapon
holster/multi-occupant carry (Arsenal v5).

These remain future seams. No "cool system" becomes a Build-1 requirement just because it exists.

## 6. Hidden Issue Discovery Goals

The first playable exists to expose hidden problems before going live. The build (and FP-3 sweep) must
specifically look for the following. Items marked **[covered]** already have a regression/proof test;
items marked **[FP-3]** must be added in the hidden-issue sweep.

### 6.1 Terrain & movement
* Player floating above the valley floor. **[covered: test:visual0/visual1 groundDelta ≤ 2]**
* Player spawning underwater. **[covered: resolveSpawn in test:visual1; re-assert in FP-2]**
* Camera clipping into terrain. **[FP-3]**
* Grounding mismatch between visual terrain and support height (`getHeight` vs `getSupportHeight`).
  **[covered: test:terrain-source single-source invariant]**
* Movement instability near waterline / slope / scree / snowline. **[FP-3]**
* TerrainProfile swap leaving stale system data. **[covered: test:terrain-profile parity]**

### 6.2 Water & atmosphere
* Water where terrain says dry, or grass/bush/wildlife/motes spawning underwater.
  **[covered: test:water, test:wildlife, test:ambient legality]**
* Fog hiding gameplay-critical objects, or fog/lighting proof drift. **[covered: test:atmosphere; UX in FP-3]**
* Water shader console errors / depth artifacts. **[covered: zero-console-error proofs]**
* Waterline instability after profile/seed change. **[covered: test:water amplitude-stable table]**

### 6.3 Wildlife & ambient
* Animals above snowline when forbidden; entering water/cliffs during flee. **[covered: test:wildlife]**
* Birds below terrain or below water. **[covered: test:flock floor-after-band]**
* Motes producing NaN under hostile input. **[covered: test:ambient finite-guards]**
* Region streaming thrash near borders; active-count growth over time; InstancedMesh capacity errors.
  **[covered: test:streamer; re-assert over time in FP-3]**

### 6.4 Arsenal & runtime assets
* Recipe import accepts malformed data. **[covered: test:arsenal-world hostile-recipe]**
* Placed weapon transform becomes NaN. **[covered: test:arsenal-world / test:arsenal-equip-slots]**
* Equipped weapon orphaned after reload. **[covered: test:arsenal-v3 / test:arsenal-v4 reload]**
* Store/drop/equip/slot state mismatch; marker transform mismatch. **[covered: test:arsenal-equip-slots]**
* `/arsenal.html` coupling into the world app. **[covered: isolation grep]**
* Geometry accidentally persisted instead of recipe. **[covered: test:arsenal-world]**

### 6.5 Persistence
* Reload loses or duplicates runtimeAssets. **[covered: test:arsenal-world-proof; duplication in FP-3]**
* Equipped state fails to re-attach; stored becomes visible; dropped becomes equipped.
  **[covered: test:arsenal-v3 / test:arsenal-v4]**
* Save/load changes a deterministic summary. **[covered: test:world, test:arsenal-world]**

### 6.6 Performance
* Draw calls grow without bound; streaming leaks instances; region counts drift from caps.
  **[covered: test:budget, test:instancing, test:streamer]**
* Rebuild creating garbage every frame; frame-time spikes near region borders. **[FP-3]**
* Shader compile/runtime console errors. **[covered: zero-console-error proofs]**

### 6.7 UX
* Player cannot tell what to do; weapon controls undiscoverable; objective completion unclear; first
  60 seconds feel empty; visual beauty hides interactables; debug text hides gameplay. **[FP-3, all]**

## 7. First Playable Required Gates

The first playable is accepted only if all gates pass. **Every command below exists today except
§7.6, which is the FP-2 deliverable.**

### 7.1 Build gate
```bash
npm run build
npm run qa
```
Expected: build succeeds; `qa` summary `0 fail`; no console-breaking build warnings. (Pre-existing
chunk-size advisory on the arsenal recipe bundle is allowed.) `qa:browser` may WARN-skip when
Playwright is absent — the SwiftShader CDP proofs in §7.3–§7.6 are the real browser gate.

### 7.2 World regression gate
```bash
npm run test:world
```

### 7.3 Visual gates
```bash
npm run test:terrain-profile
npm run test:terrain-source
npm run test:visual0
npm run test:water
npm run test:atmosphere
npm run test:visual1
```

### 7.4 Wildlife & ambient gates
```bash
npm run test:wildlife
npm run test:wildlife0
npm run test:flock
npm run test:wildlife1
npm run test:ambient
npm run test:ambient0
npm run test:streamer
```

### 7.5 Arsenal gates
```bash
npm run test:arsenal
npm run test:arsenal-world
npm run test:arsenal-placement
npm run test:arsenal-v3
npm run test:arsenal-equip-slots
npm run test:arsenal-v4
```

### 7.6 First-playable proof gate — **NOT YET BUILT (FP-2 deliverable)**
```bash
npm run test:first-playable-proof   # to be authored as scripts/browser-first-playable-proof.mjs
```
The proof must verify, in one SwiftShader session: world loads · player grounded · terrain/water/fog
visible · wildlife active · flocks active · ambient motes active · weapon can be placed · equipped ·
slot-cycled · dropped or stored · the objective can be completed · the world can reload · runtime
asset + objective state persist correctly · **zero console errors**.

### 7.7 Adversarial review gate
Before tagging the first playable (FP-4), run a fresh-context review across: determinism ·
persistence · runtime leaks · player spawn/grounding · terrain/profile single-source ·
water/wetness/snowline consistency · region streaming · arsenal recipe boundary · browser-proof
validity · user-facing objective clarity.

Required outcome: `0 critical, 0 high; all medium fixed or explicitly deferred with a reason`.

## 8. Go / No-Go Criteria

### GO (may tag `world-builder-first-playable-v0`) — all must hold
1. All §7 required gates pass (including §7.6 once built).
2. Browser proof passes with zero console errors.
3. The objective can be completed by a tester.
4. Save/reload preserves required runtime + objective state.
5. No critical/high adversarial findings remain.
6. No untracked unrelated files are swept into the milestone commit (e.g. leave `sword forge.html`).
7. The final commit contains only intentional first-playable files.
8. The tag is created locally.
9. No push/deploy without explicit authorization.

### NO-GO (must not tag)
1. Any proof gate fails, or any console error occurs.
2. Player spawns underwater or floating.
3. Wildlife/ambient break terrain/water legality.
4. Weapon equip/slot/drop/store corrupts runtimeAssets.
5. Deterministic summaries drift unexpectedly.
6. The tree contains unrelated swept files.
7. The objective cannot be completed by a tester.
8. A high/critical review finding remains.

## 9. First Playable Milestones

### FP-0 — Build Document *(this document)*
Done when: `docs/FIRST_PLAYABLE_BUILD.md` exists; defines goal, scope, tests, go/no-go, hidden-issue
targets; and is referenced by the project charter (ADR-031). **Status: DONE.**

### FP-1 — Objective Marker
Add one simple objective: retrieve / equip / store a generated relic weapon at a marked cache point.
Done when: the objective marker appears in-world; the player can complete it; completion state is
deterministic and reload-safe; no inventory/combat added.

### FP-2 — First Playable Proof
Author `test:first-playable-proof` (`scripts/browser-first-playable-proof.mjs`).
Done when: the browser proof executes the full loop (load → move → environment → weapon interaction →
slot-cycle → save/reload → objective state) and fails on any console error.

### FP-3 — Hidden Issue Sweep
Done when these edge/hostile cases are tested: spawn-in-water; weapon poisoned-marker; hostile `dt`;
region-border thrash + active-count-over-time; reload duplication; fog/water/terrain proof drift; and
the UX checks in §6.7 are walked by a tester.

### FP-4 — First Playable Tag
Done when: all §7 gates pass; §7.7 review passes; the commit is clean; and
`git tag world-builder-first-playable-v0` is created locally. No push without authorization.

## 10. Current First Playable Status

**Status: Foundation ready — game-loop proof NOT yet ready (NO-GO for FP-4).**

What's proven (as of Arsenal v4, commit `b602009`): the entire foundation stack in §4 passes its
gates, and §7.1–§7.5 are all green today.

What's still missing before the first playable can be tagged:
1. A single player-facing objective (FP-1).
2. A dedicated first-playable browser proof, `test:first-playable-proof` (FP-2).
3. A reload-complete objective-state proof (part of FP-2).
4. A final hidden-issue sweep across the integrated loop (FP-3).
5. A go/no-go review against this document (§7.7).

## 11. Update Rule

After every accepted stage, replace the "Current entry" block below.

```text
Last accepted stage: Arsenal v4 — Oriented Equip Slots & Multi-Slot Attachment
Commit: b602009
Tag: world-builder-arsenal-v4-slots
Tests passed: build, qa (skills 32/0/0, layout 43/0/0; qa:browser skip — Playwright absent),
  test:world; test:terrain-profile, test:terrain-source, test:water, test:atmosphere;
  test:wildlife, test:flock, test:ambient, test:streamer (Node sweep);
  test:visual1, test:wildlife1, test:ambient0 (SwiftShader);
  test:arsenal, test:arsenal-world, test:arsenal-placement, test:arsenal-v3 (compat, unchanged);
  test:arsenal-equip-slots (Node), test:arsenal-v4 (SwiftShader, new)
New risks found: no integrated game-loop proof yet; no player-facing objective yet;
  objective-state persistence path does not exist yet (FP-1/FP-2)
Risks retired: position-only equip → full-transform attachment contract; equip-slot persistence
  (runtime.slot whitelisted at the sanitizer boundary, else silently dropped)
First playable readiness: foundation ready; first-playable proof + objective not yet built
```
