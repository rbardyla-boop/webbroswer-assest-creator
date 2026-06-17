# Arsenal Lab — Procedural Weapon Generator

Status: a self-contained browser tool that emits **fictional sci-fi weapon silhouettes
from math** — no textures, no imported models, no real firearm engineering. It is a
sibling tool to the world builder (separate Vite entry `arsenal.html`), not part of the
world/editor/runtime. Open it at `/arsenal.html` (dev) or the built `arsenal.html`.

> The browser is not the limitation and the lack of Blender is not the limitation. One
> well-designed generator produces more usable item identity than a folder of static
> placeholder models.

## Pipeline (data first, THREE second, render last)

Mirrors the engine's layout→emitter boundary:

`config → grammar (pure recipe) → geometry (BufferGeometry) → materials → Group`

- **`WeaponSeed.js`** — `createRng(seed)` over the engine's `mulberry32` (`utils/random.js`). Deterministic float/int/pick/chance/jitter. **No `Math.random`.**
- **`WeaponConfig.js`** — `createWeaponConfig(overrides)` clamps every field (defense in depth); `rollConfig(seed,type)` derives a full seed-shaped config. `PARAM_RANGES` doubles as the workbench slider spec; `ARSENAL_LIMITS` caps parts/modules/vertices.
- **`WeaponGrammar.js`** — **PURE** `(config) → recipe` (plain JSON, no THREE, deterministic): per-type silhouette rules → a capped list of part descriptors + material params. This is where IDENTITY lives.
- **`WeaponGeometry.js`** — `recipe → parts[]` of `THREE.BufferGeometry` (box / cylinder / torus-ring / scaled-octahedron prism / capsule), per-part vertex colors, an explode axis. Headless-safe (builds geometry without a GL context). Bounded by a vertex budget.
- **`WeaponMaterial.js`** — shared **alloy** `MeshStandardMaterial` (vertex colors → studio lighting + shadows) + a hand-written **energy** `ShaderMaterial` (Fresnel rim, emissive pulse, scanlines, energy flow; `update(elapsed)` drives `uTime`; `dispose()`).
- **`WeaponGenerator.js`** — composes into a `THREE.Group` of part meshes sharing the two materials; `build()` tears down the previous weapon first (no leaks); live `setExploded/setWireframe/setGlow`.
- **`WeaponWorkbench.js`** — the left-side control panel (vanilla DOM, reusing `ProceduralPanel`'s helpers) + turntable. **`arsenalMain.js`** — studio scene (neutral backdrop, 3-point lights, ground shadow), turntable camera with mouse-orbit + wheel-zoom, the loop, and the readiness/debug hooks.

## The recipe (copyable JSON)

```jsonc
{
  "seed": "monolith-7", "type": "heavy", "family": "prism-rail", "rarity": "mythic",
  "body": { "length": 3.1, "bulk": 0.5, "asymmetry": 0.3 },
  "material": { "energyColor": "#46d6ff", "energyHue": 0.55, "coreIntensity": 1.1,
                "glassIOR": 1.4, "refractionStrength": 0.18, "pulseRate": 1.4, "scanlineDensity": 90 },
  "parts": [ { "shape": "box", "role": "alloy", "pos": [0,0,0], "size": [2.5,0.95,0.85], "rot": [0,0,0], "color": "#5b6b7a" }, ... ]
}
```

`role` ∈ `alloy | energy`. `shape` ∈ `box | cyl | ring | prism | capsule`. The weapon lies
along +X (muzzle toward +X), grip toward −Y, centered on the origin.

## Base-type silhouette rules (silhouette first)

A bad weapon with good glow is still bad — each type has strong profile rules so it reads
at a glance:

- **sidearm** — compact: short receiver, raked grip, short barrel, a reactor core, holo-sight.
- **longarm** — directional: long receiver + barrel, coil spine, energy tube, stock, top rail, fins.
- **heavy** — massive: oversized core, chunky side plates, heat-sink fins, multi-ring barrel, back battery.
- **exotic** — impossible (NOT a gun): a haft + a prism focus head, orbiting energy rings, floating fins, a counterweight.

## Workbench controls

Seed field · base-type select · presets (one per type) · a slider per `PARAM_RANGES`
entry (length, bulk, asymmetry, barrels, coil rings, fins, energy hue, core glow,
refraction, pulse, glass IOR) · **Randomize** (new seed-derived config) · **Copy recipe**
(JSON to clipboard) · toggles: **Turntable / Wireframe / Glow / Exploded**. Mouse-drag
orbits, wheel zooms.

## Invariants (enforced by `test:arsenal` + `test:arsenal-proof`)

- **Deterministic**: same `(seed, config)` → identical recipe + identical mesh/triangle counts (seed replay).
- **No `Math.random`** anywhere in the generator.
- **Capped**: parts ≤ `MAX_PARTS`, modules ≤ their caps, total vertices ≤ `MAX_VERTICES`; hostile config still yields a bounded, finite weapon.
- **No per-frame geometry churn**: geometry is built only on rebuild; the loop only advances `uTime` + the turntable.
- **Clean teardown**: `build()` disposes the previous weapon's geometries + materials.
- **Every weapon has ≥1 energy core** (the identity).
- DEV-only hooks (`__ARSENAL_DEBUG__`, `__ARSENAL_REROLL__`) are stripped from production builds.

## Commands

```
npm run dev               # open /arsenal.html
npm run build             # emits index.html + arsenal.html (isolated chunk)
npm run test:arsenal      # Node determinism + clamping + geometry budget
npm run test:arsenal-proof # SwiftShader render proof (all 4 types; skips w/o Chromium)
```

## Scope

v1 is a workbench, not an inventory/world system: it generates and inspects weapons. It
does not place weapons in the world, persist them, or model gameplay. Those are deliberate
future steps; the recipe JSON is the hand-off boundary if/when they come.
