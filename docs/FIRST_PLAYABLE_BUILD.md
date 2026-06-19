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
§7.7, which is the FP-2 deliverable.**

### 7.1 Build gate
```bash
npm run build
npm run qa
```
Expected: build succeeds; `qa` summary `0 fail`; no console-breaking build warnings. (Pre-existing
chunk-size advisory on the arsenal recipe bundle is allowed.) `qa:browser` may WARN-skip when
Playwright is absent — the SwiftShader CDP proofs in §7.3–§7.8 are the real browser gate.

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

### 7.6 Objective gate (FP-1 — done)
```bash
npm run test:first-objective
npm run test:first-objective-proof
```
The relic-weapon objective (find → equip → carry → deposit-on-pedestal → complete) is playable and
its completion + the relic's pedestal transform persist across reload.

### 7.7 First-playable proof gate — **DONE (FP-2, `scripts/browser-first-playable-proof.mjs`)**
```bash
npm run test:first-playable-proof
```
Verifies, in one SwiftShader session: world loads · player grounded + not submerged at spawn ·
terrain/water/fog visible · wildlife active · flocks active · ambient motes active · weapon placed +
equipped + slot-cycled + stored · the relic equips, is **physically walked** across the world to the
cache (no teleport — the proof asserts the player moved > 5 units via the real movement pipeline) and
deposited on the pedestal to complete · the world reloads · runtime asset + objective state persist ·
**zero console errors** across both sessions. The deterministic walk is driven by a DEV-only
`__PLAYER_MOVE_DO__` driver (camera yaw + held keys + fixed-step advance of the real per-frame update),
stripped from production builds.

### 7.8 Hidden-issue sweep gate — **DONE (FP-3)**
```bash
npm run test:first-playable-hidden        # Node: spawn safety · determinism · hostile-dt finiteness · region-thrash · store/equip reload
npm run test:first-playable-hidden-proof  # SwiftShader: spawn-in-water · poisoned marker · hostile-dt · reload-duplication · cross-session drift · stored-weapon reload
```
Hostile/edge validation of the integrated loop: a deliberately submerged authored spawn resolves to
dry/grounded ground (player + relic + cache); a poisoned weapon marker is refused without reparent or
orphan; hostile dt keeps the player/wildlife/flocks/motes/objective finite + recoverable; repeated
reloads never duplicate the relic/beacon/objective (`__DOC_DEBUG__` counts stay 1); the world is
byte-stable across sessions (no drift); and a stored weapon round-trips a real reload. Zero console
errors. The sweep found **no defect** — every invariant already held; only two additive DEV hooks
(`__DOC_DEBUG__`, `poisonEquipMarker`) were needed to make the live scene/markers observable.

### 7.9 Adversarial review gate — **DONE (FP-4) — GO**
A fresh-context review (four independent reviewers) ran across all ten dimensions: determinism ·
persistence · runtime leaks · player spawn/grounding · terrain/profile single-source ·
water/wetness/snowline consistency · region streaming · arsenal recipe boundary · browser-proof
validity · user-facing objective clarity.

Result: **0 critical, 0 high, 0 medium; 1 LOW** (the WASD `#hint` panel is hidden in runtime mode, but
F/G are discoverable via the context-sensitive banner — accepted by design). The manual UX walk was
substantiated with live on-screen evidence: the always-on `#objective-banner` narrates every step
(`…find the marked relic weapon and equip it (F)` → `…carry the relic to the glowing cache marker` →
`…press G to deposit the relic on the cache` → `…COMPLETE. The relic rests on the cache.`), with a
visible relic marker, a glowing cache beacon + deposit ring, and the relic left as a visible trophy.
Required outcome (`0 critical, 0 high; all medium fixed`) met.

## 8. Go / No-Go Criteria

### GO (may tag `world-builder-first-playable-v0`) — all must hold
1. All §7 required gates pass (including §7.7 once built).
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

### FP-1 — Objective Marker — **DONE**
One objective: find → equip → carry → deposit a generated relic weapon on a marked cache pedestal.
The relic + cache auto-spawn (deterministic, dry ground); an always-on banner names the step;
depositing in the cache zone leaves the relic as a visible trophy and completes the objective;
completion + the pedestal transform are reload-safe; no inventory/combat. Commit + tag
`world-builder-first-objective-fp1`; docs `docs/FIRST_OBJECTIVE.md`, ADR-032. Gates: §7.6
(`test:first-objective` + `test:first-objective-proof`).

### FP-2 — First Playable Proof — **DONE**
`test:first-playable-proof` (`scripts/browser-first-playable-proof.mjs`) executes the full loop in one
SwiftShader session: load → verify the living world (terrain/water/fog/wildlife/flocks/motes) → place +
equip + slot-cycle + store a weapon → equip the relic and **physically walk** it (no teleport) to the
cache → deposit → complete → save/reload → completion + trophy + runtime assets persist; fails on any
console error. Driven by a DEV-only `__PLAYER_MOVE_DO__` movement driver (prod-stripped). Commit + tag
`world-builder-first-playable-proof-fp2`; ADR-033. Gate: §7.7. (Does **not** satisfy FP-4 — the tag
`world-builder-first-playable-v0` stays reserved until FP-3 + §7.9 are also done.)

### FP-3 — Hidden Issue Sweep — **DONE**
`test:first-playable-hidden` (Node) + `test:first-playable-hidden-proof` (SwiftShader) cover the nine
hostile/edge cases: spawn-in-water (player + relic + cache resolve dry/grounded); poisoned weapon
marker (refused without reparent/orphan); hostile `dt` (player/wildlife/flocks/motes/objective stay
finite + recover; finite extremes {0, 1e6, −1} — NaN is unreachable past the frame clamp); region-border
thrash (the shared streamer builds each region ≤ once under oscillation); reload duplication (3× reload
keeps relic/beacon/objective counts at 1); proof drift (terrain/water/slope/cache/relic byte-stable
across sessions); and store/equip/drop reload. (The §6.7 *manual* UX walk — camera-feel, 60-second
emptiness — remains a tester judgment at the §7.9 go/no-go review; the automatable technical items in
§6.7 are covered here.) The sweep found **no defect** — every invariant already held. Two additive
DEV-only hooks (`__DOC_DEBUG__`, `poisonEquipMarker`); FP-2 proof unchanged. Commit + tag
`world-builder-first-playable-hidden-fp3`; ADR-034. Gate: §7.8. (Does **not** satisfy FP-4 — only the
§7.9 review remains.)

### FP-4 — First Playable Tag — **DONE (GO)**
All §7 gates pass (§7.1–§7.9 green); the §7.9 fresh-context review returned 0 critical / 0 high / 0
medium (1 LOW accepted); the manual UX walk is substantiated by live banner/marker evidence; the tree is
clean (only `sword forge.html` untracked); and the milestone is tagged **`world-builder-first-playable-v0`**
locally (no push). ADR-035. **The Glacial Valley First Playable is GO.**

## 10. Current First Playable Status

**Status: GO — the Glacial Valley First Playable is TAGGED (`world-builder-first-playable-v0`, local, no push).**

All gates closed (as of FP-4): the entire foundation stack in §4 passes; **§7.1–§7.9 are all green**; the
relic objective (find → equip → carry → deposit → complete) is playable and reload-safe; the INTEGRATED
first-playable loop passes end-to-end in one SwiftShader session with zero console errors
(`test:first-playable-proof`); the hostile/edge sweep (`test:first-playable-hidden` + `-proof`) found no
defect; and the §7.9 fresh-context review returned **0 critical / 0 high / 0 medium (1 LOW accepted)**
with the manual UX walk substantiated by live banner/marker evidence. Every §8 GO criterion holds; no
NO-GO condition holds.

The first-playable target is met. Subsequent feature work (weapon variety, holster, combat seam, deeper
environment) builds ON this tag — it does not re-open it. A human play-session is welcome as a final
confirmation; the tag is local + reversible if that session ever disagrees.

## 11. Update Rule

After every accepted stage, replace the "Current entry" block below.

```text
Last accepted stage: Slice-0 — The Frozen Cache authored play slice (includes Arsenal v6 prerequisite; ADR-038)
Implementation commit: 464c4a2 (local, no push)
Release tag: world-builder-slice0-frozen-cache (local, no push)
Tag: world-builder-first-playable-v0 REMAINS the first-playable milestone (unchanged; gate stays CLOSED).
  Slice-0 ADVANCES the target from verified engine loop to authored experience; it does NOT reopen the gate.
Tests passed: build; qa skills 32/0/0; qa layout 43/0/0; test:arsenal-carry; test:arsenal-v6;
  test:frozen-cache; test:frozen-cache-proof; test:first-objective; test:first-playable-hidden(+proof).
Review: implementation review → 0 critical, 0 high, 0 medium. Proof-driven UX fixes aligned composition to
  the resolved spawn and separated the F/H teaching beats before acceptance.
Known caveats: Slice-0A human UX testing is still required; WebAudio starts after user activation;
  qa:browser WARN-skips without Playwright; the pre-existing large-bundle build warning remains.
First playable readiness: COMPLETE and still green; gate CLOSED. Next stage is Slice-0A, not combat/enemies.
```
