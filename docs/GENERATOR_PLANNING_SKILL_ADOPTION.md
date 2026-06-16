# Generator Planning Skill Adoption Layer (Stage 18C)

Status: planning skills (village/city layout doctrine, playable-world standards,
visual-composition standards, generator QA) are adopted as **mandatory pre-generation
doctrine** for every settlement generator — used to design layout intent *before*
emitting, never as after-the-fact commentary on whatever the generator happened to
produce. The enforceable floor is `docs/SETTLEMENT_LAYOUT_STANDARD.md` + `npm run
qa:layout`.

## Non-negotiable boundary

A generator is a deterministic `(seed, config) → layout of plain descriptors`; a separate
emitter turns that layout into NORMAL WorldDocument objects. Planning skills inform the
**layout intent and the standard**, never grant the generator runtime/scene authority.
Output always flows through `WorldObjectManager` like any other placed object. No skill
adoption may introduce code execution, hidden scene graphs, or non-deterministic
placement (`Math.random` in generation is banned; only seeded `mulberry32`).

## Current engine baseline

- `src/generators/` — city, camp, ruin, forest, road, plaza, connector generators
  (`*Generator.js` / `*Layout.js` + emitters), `GeneratorRegistry`, `GeneratorConfig`
  (clamped, capped), `emitHelpers` (`primitiveDescriptor` with `layoutRole`),
  `roadHelpers`, `landmarkAnchors`.
- `src/world/` — `WorldDocument` (the `generators` block + `objects`), `WorldValidation`
  (`sanitizeLayoutRole`, caps), `WorldObjectManager` (build + `serializeWorldObject`,
  `layoutRole` round-trip).
- `src/generators/PlacementValidator.js` — canonical overlap validator (reused by the
  gate headless).
- `scripts/layout-gates.mjs` (`qa:layout`), `scripts/browser-settlement-layout-proof.mjs`
  (`test:settlement-layout`), `src/main.js` `__LAYOUT_DEBUG__` hook.

## Skill-to-engine map

| Planning skill area | Adopted as | Current engine surface | Gate posture |
|---|---|---|---|
| Village / city layout doctrine | center + edge + district + path archetypes before config | generator layout functions; `landmarkAnchors` | `qa:layout`: center exists, anchors connect |
| Playable-world standards | spawn readability + gameplay anchors | `interaction` markers (spawn/sign/trigger/pickup), `player.spawn` | `qa:layout`: spawn clearance, line-of-sight, marker validity |
| Visual-composition standards | landmark visibility + density variation + silhouette | `layoutRole=landmark` focal objects; `test:settlement-layout` proxy | hard: landmark near spawn; judgment: composition |
| Generator QA | deterministic structural gate | `validatePlacement` + `THREE.Box3` headless | `qa:layout` blocks on overlaps / through-building / caps |

## Adoption rules

1. **Plan before emit.** Decide intent → archetype → config → generate. The planning
   pass is upstream of emission, not a review of it.
2. **Standard is the floor.** Every new settlement generator (and every change to an
   existing one) must pass `qa:layout` for a canonical scene before commit.
3. **Classify with data.** Tag every emitted object with the correct `layoutRole`; the
   gate must never depend on display names.
4. **Reuse canonical utilities.** Overlap = `validatePlacement`; footprint = `THREE.Box3`
   over the built scene; anchors = `landmarkAnchors`. Do not re-derive geometry math.
5. **Deterministic + capped.** Seeded RNG only; every loop hard-capped; the emitter caps
   the grand total.
6. **Fix, don't relax.** On a FAIL, change the seed/config/generator. Relaxing a gate
   threshold requires explicit operator sign-off and a charter note.
7. **Judgment is documented, not skipped.** The qualitative criteria (composition,
   density, copy-paste feel) are author + visual-proof responsibilities recorded in the
   standard — the gate is a floor, not a ceiling.

## Layout QA gate

Required evidence:
- `npm run qa:layout` green (PASS rows for round-trip, caps, overlaps, valid placements,
  path-through-building, markers, landmark, center, spawn clearance, spawn line-of-sight,
  anchor connectivity across the canonical scenes).
- `npm run test:settlement-layout` green (or clean skip with no Chromium): a landmark is
  near the spawn, paths/buildings/markers present, instancing active, zero console errors.

Known gap: terrain-slope avoidance and explicit district zoning are judgment-only today
(no deterministic check yet) — candidates for a future gate iteration.

## Commands

```
npm run qa:layout                # deterministic settlement-structure gate
npm run test:settlement-layout   # runtime readability proof (SwiftShader; skips w/o Chromium)
npm run qa                       # qa:skills && qa:layout && build && qa:browser
```

## Project adoption status (wired into the working engine)

The seven settlement generators are tagged with `layoutRole`; camp/plaza/city pass
`qa:layout` green (43/0) after the green-now retrofit (crate spacing, gutter street
trees, plaza well, town monument, entrance spawn). `qa:layout` is in the `qa` chain.
The planning doctrine governs the next generator work — WFC layout generation is
sequenced **after** this standard, so it satisfies a defined bar rather than producing
more structured-looking scatter.

## Stage-completion rule

A settlement-generator stage is complete only when:
1. New/changed generators tag `layoutRole` correctly.
2. `npm run qa:layout` is green for a canonical scene (no FAIL).
3. `npm run test:settlement-layout` passes (or skips cleanly).
4. `npm run test:world` + `npm run qa` are green; the production bundle is clean of DEV
   hooks (grep).
5. The decision is recorded in `docs/PROJECT_CHARTER.md` (ADR) and memory.
