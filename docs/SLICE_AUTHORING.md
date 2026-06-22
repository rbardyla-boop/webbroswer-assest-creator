# How to author a playable slice (Slice Authoring Kit-1)

A "slice" is a compact, authored 5–10 minute playable run: spawn → find a relic → carry it past a readable
combat beat or two → deposit at a cache → a scene-coherent completion. Two ship today — `visual-benchmark-1`
("The Relic Overlook") and `ice-chapel-1` ("The Ice Chapel") — both built from the SAME systems. This kit
(ADR-064) turns that repeatable pattern into pure, byte-compatible factories + a seed probe + composition
validators + shared proof helpers so the next slice is assembled, not hand-rolled.

It is **non-invasive**: the two shipped slices are NOT migrated to the kit (they stay byte-stable). The kit's
factories are proven byte-equal to their output (`test:slice-authoring-kit`), so a future migration changes no
output. Build the NEXT slice with the kit.

## The kit

| Module | Use |
| --- | --- |
| `src/world/slice/SliceKit.js` | factories: `sliceLayout({seed})`, `unit`/`offset`/`groundedPrimitive`, `sliceIdentity`, `encounterBeat`, `generatedWeaponReward`, `beaconTrail`, `mergeGlacialLighting`, `routeRadius` |
| `src/world/slice/SliceSeedProbe.js` | `probeSliceSeed(seed, {baselineSpawns})`, `probeSliceSeeds(seeds, …)` — walkability/carry/distinctness |
| `src/world/slice/SliceComposition.js` | `validateSliceComposition(doc, {expectBeats})` → `{ok, issues}`, `assertSliceComposition(doc)` |
| `scripts/lib/slice-proof.mjs` | descriptor-driven SwiftShader proof helpers (`driveSlicePlay`/`driveSliceReplay`) |
| `npm run slice:probe` | print the seed report (`-- 7 11 99` for specific candidates) |

## Checklist

1. **Pick a distinct seed.** `npm run slice:probe` (baselines = every shipped slice's spawn). Choose a seed
   reported `USABLE` — all sites walkable, a real carry (>20 m), and distinct (>20 m from every existing slice's
   spawn). NOTE: `findGoodSpawn` snaps to a 10-unit grid so many seeds do NOT move the spawn; the alpine carry
   axis is always ±X, so seeds differ by LOCATION, not orientation.
2. **Lay out the corridor.** `const { spawn, relic, cache, crossing, dir, perp } = sliceLayout({ seed })`. The
   relic sits up one way, the cache (your deposit) the other — carrying is required. The runtime auto-derives
   the relic→cache objective from the spawn, so **do not author an `objectives` block**.
3. **Name the slice.** `doc.slice = sliceIdentity({ title, arrivalTagline, completeBody })` — names the arrival
   banner AND the completion card. Omit it only to inherit the default "The Frozen Cache" (you don't want that
   for an authored slice).
4. **Frame the route with landmarks.** Build cubes/cylinders with `groundedPrimitive(...)` placed via
   `offset(p, perp, side, along)`. Keep every landmark within ~14 m of the spawn→relic→cache route AND keep the
   carry-centerline midpoint clear (≥2.5 m) — the validator enforces both.
5. **Author an opening orientation sign** (`groundedPrimitive` with `interaction: { role:"sign", text, showRadius }`)
   framing the whole find→carry→deposit loop + the non-lethal recovery rule. Add a threat-teaching sign before
   the first combat beat.
6. **Stage 1–3 combat beats** with `encounterBeat({ id, position, radius, enemyType, label, patrol? })`.
   `enemyType` is `glacial_sentinel` or `frost_wisp`; pass a `patrol` descriptor for a mover, omit it for a
   stationary guardian. One enemy per beat (no waves). Ground each `position` with `getHeight`.
7. **(Optional) a detour reward** off the carry line: `doc.runtimeAssets = { version:1, items:[ generatedWeaponReward({ id, seed, position }) ] }`.
8. **Add a beacon-trail** for route readability: `doc.authoring = beaconTrail({ prefix, splineName, maskName, modName, points:[spawn,relic,crossing,cache mapped to {x,y:0,z}], center:{x:crossing.x,y:0,z:crossing.z}, radius: routeRadius(spawn, cache) })`.
9. **Give it a mood** (optional, per-document only): `doc.lighting = mergeGlacialLighting({ sun, hemisphere, fog })`, `doc.water = createWaterConfig({…})`, `doc.atmosphere = createAtmosphereConfig({…})`. These never mutate the global default.
10. **Spawn + camera.** `doc.player.spawn = { x: spawn.x, y: getHeight(spawn.x, spawn.z), z: spawn.z }; doc.player.cameraMode = "third"`.
11. **Register** the builder in `src/world/samples/index.js` (a +1 entry; `?world=<id>` then loads it).
12. **Validate** in a Node regression: `assertSliceComposition(buildMySlice(), { expectBeats: N })`. Mirror
    `scripts/slice-1-regression.mjs` for determinism + the byte-stable-global checks.
13. **Prove it** with the shared helper: build a descriptor `{ buildModulePath, buildFnName, identityTitle, arrivalTagline, signId, beats:[{id,kind}], rewardId, glb? }` and drive `driveSlicePlay`/`driveSliceReplay`
    (mirror `scripts/browser-slice-authoring-kit-proof.mjs`).
14. **Stay byte-stable.** Add a NEW builder + a +1 registry entry only. Do not edit the shipped slices, the
    frozen Frozen-Cache / first-playable slices, or any global default. No new combat/renderer/schema; no
    `WORLD_DOCUMENT_VERSION` bump.
