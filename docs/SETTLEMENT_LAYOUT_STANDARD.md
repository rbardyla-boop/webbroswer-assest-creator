# Settlement Layout Standard (Stage 18C)

Status: a generated village / city / camp / ruin / plaza is accepted only when it has
**readable structure**, not merely valid objects. This is the design-quality bar a
generator output must clear before it is committed. The checkable subset is enforced by
`npm run qa:layout`; the qualitative subset is author + visual-proof judgment.

> A generator that "emits objects" is not a settlement. A settlement has a center, an
> edge, paths that connect meaningful places, a spawn you can read from, and a landmark
> you can see. Define that first; then use WFC / prefabs / stochastic variation to
> satisfy it.

## The classification boundary

Every emitted object carries a declarative `layoutRole` (data, never a display-name
guess) — one of `building | path | prop | landmark | marker | vegetation | edge`
(default `null` for hand-placed objects). Emitters stamp it; `WorldValidation`
allow-lists it (hostile values → `null`); it round-trips through `WorldObjectManager`.
The QA gate judges structure from this field, so the standard survives renames and new
generators. This is the same data boundary as `interaction` / `particles` / `generatorId`:
declarative metadata on a normal WorldObject, never executable.

## Minimum quality criteria

Eight criteria. **H** = hard-gated by `qa:layout` (deterministic, blocks). **J** =
judgment (author + `test:settlement-layout` visual proof; not auto-blocked).

1. **Spawn readability** — the player does not spawn inside clutter (**H**: no solid
   footprint within the clearance radius of the spawn), sees at least one landmark
   (**H**: a `landmark` exists within sight distance and no `building` blocks the line),
   and the first path forward is obvious (**J**).
2. **Settlement structure** — has a center (**H**: a `landmark` or `path` focal object
   near each cluster origin), has edges and districts (**J**: fences / tree-lines /
   walls / zoning), avoids random scatter (**J**).
3. **Path network** — roads connect meaningful places (**H**: a connector links ≥2
   distinct cluster anchors), no road runs through a building (**H**: no `path` footprint
   clips a `building` footprint beyond tolerance), no dead/aimless paths (**J**).
4. **Building placement** — no overlapping footprints (**H**: `validatePlacement` finds
   no solid overlap above 25% tolerance), sane spacing + readable silhouettes + varied
   but not chaotic rotation/scale (**J**).
5. **Terrain fit** — props sit cleanly on the ground, no floating/sunken objects, plazas
   and roads lie flat (**J**: emitters terrain-snap via `getHeight`; steep-slope
   avoidance is future work).
6. **Gameplay anchors** — spawn has a safe radius (**H**, see 1), markers
   (sign/trigger/spawn/pickup) are valid (**H**: finite position + recognised role), a
   first decision marker is reachable and the route completes without guessing (**J**).
7. **Visual composition** — a landmark is visible from the spawn / main road (**H**, see
   1), foreground/midground/background separation, repeats don't read as copy-paste,
   vegetation frames spaces instead of filling them, density varies intentionally (**J**).
8. **Performance budget** — generated count under cap (**H**: ≤ `MAX_TOTAL_OBJECTS` per
   instance), instancing stays active and vegetation/particle/light pressure stays
   visible (cross-checked by the Stage 20A budget HUD + `test:settlement-layout`
   asserting instancing is active).

`qa:layout` thresholds (conservative defaults, documented here so they are stable and
reviewable): spawn clearance radius `2.5`, sight distance `260`, center radius `12`,
anchor-connect reach `30`, path-through-building tolerance `0.15` of the building
footprint. They are structural, not an FPS claim.

## Pre-generation workflow (planning skills as doctrine, not commentary)

The planning pass happens **before** emitting, not as after-the-fact review:

1. **Plan the settlement intent** — what is this place, who is it for, what is the first
   thing the player should see and do.
2. **Choose a layout archetype** — ring camp, gridded town, paved plaza, ruin field, a
   connected cluster — before touching config.
3. **Emit the generator config** — seed, size, density, origin, style, anchors.
4. **Generate WorldObjects** — deterministic `(seed, config) → layout → descriptors`.
5. **Run `qa:layout`** — the deterministic floor.
6. **Reject / regenerate / fix** — on any FAIL, change the seed, the config, or the
   generator; do not relax the standard to pass.
7. **Only then commit.**

## What `qa:layout` does

Pure Node, deterministic. It generates canonical scenes (a connected village, plus
standalone camp / plaza / city), validates them, builds the **real** scene graph
headless (`THREE.Scene` → `WorldObjectManager` → `loadWorldObjects`), and judges with the
canonical `validatePlacement` + `THREE.Box3` — no bespoke geometry. House style matches
`qa:skills`: PASS/WARN/FAIL rows, a summary line, exit 1 on any FAIL. It is part of the
`qa` chain. Runtime readability is proven separately by `npm run test:settlement-layout`
(authors a village, spawns at the camp entrance, asserts a landmark is near the spawn,
paths/buildings/markers exist, instancing is active, zero console errors).

## What this stage fixed (the standard caught real defects)

Making the canonical scenes pass green surfaced and fixed genuine layout bugs rather
than papering over them:

- camp **crates overlapping their tents** → crates round-robined across tents and pushed
  clear of the rotated-AABB footprint;
- **crate ↔ crate piling** → round-robin assignment;
- city **street trees punched through buildings** → trees placed in the road-side gutter
  strip, clear of building lots;
- **plaza had no landmark** → a central **Plaza Well**; the plaza spawn moved to the
  entrance so you arrive facing it across the square;
- **city had no focal point** → a **Town Monument** snapped to the central crossroads
  (building-free for any block count).

## Scope

This standard governs settlement generators. It is the prerequisite for the WFC layout
generator (define "good" before generating more structured output) and is independent of
the optimization ladder. The qualitative criteria are intentionally not auto-blocked —
the gate is a floor, not a ceiling; taste still ships the world.
