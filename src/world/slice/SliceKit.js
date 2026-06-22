// Slice Authoring Kit-1 — the byte-compatible factory layer for authored playable slices.
//
// Two slices (visual-benchmark-1 "Relic Overlook", ice-chapel-1 "The Ice Chapel") proved a repeatable pattern,
// each hand-rolling byte-identical local helpers (unit/groundedPrimitive/offset), a seed-driven layout, and the
// same document-block shapes (slice identity, encounter beat, generated-weapon reward, beacon-trail authoring,
// glacial-lighting override). This module extracts that pattern into ONE pure, deterministic, Node-safe set of
// factories so the NEXT slice assembles from the kit instead of copy-pasting.
//
// BYTE-COMPATIBLE BY CONTRACT: each factory reproduces the existing slices' blocks exactly (asserted in
// test:slice-authoring-kit), so a FUTURE migration of the two slices to the kit changes no output. This stage
// does NOT migrate them — it only adds this module. No THREE, no DOM, no RNG, no wall-clock (the seed-driven
// terrain is the only input). Reuses SliceIdentity (resolveSliceIdentity/sanitizeSliceIdentity), terrain
// sampling, deriveSites, the encounter type, and the pure arsenal recipe modules.

import { createWorldDocument } from "../WorldDocument.js";
import { getHeight, findGoodSpawn, setTerrainProfile } from "../../terrain/terrainSampling.js";
import { createTerrainProfile } from "../../terrain/profiles/index.js";
import { glacialLighting } from "../../lighting/GlacialAtmosphere.js";
import { deriveSites } from "../objectives/RelicWeaponObjective.js";
import { ENCOUNTER_TYPE } from "../encounters/EncounterTypes.js";
import { generateWeaponRecipe } from "../../arsenal/WeaponGrammar.js";
import { rollConfig } from "../../arsenal/WeaponConfig.js";

// --- vector helpers (byte-identical to the slices' local copies) -----------------------------------

export function unit(ax, az) {
  const len = Math.hypot(ax, az) || 1;
  return { x: ax / len, z: az / len };
}

export function offset(p, perp, side, along = { x: 0, z: 0 }) {
  return { x: p.x + perp.x * side + along.x, z: p.z + perp.z * side + along.z };
}

// --- terrain-grounded primitive (byte-identical to the slices' local groundedPrimitive) ------------

export function groundedPrimitive(id, name, kind, p, scale, { rotationY = 0, colliderType = "box", absoluteY = null, particles = null, interaction = null } = {}) {
  return {
    id,
    name,
    type: "primitive",
    primitive: kind,
    assetRef: null,
    asset: null,
    transform: {
      // Grounded so the primitive sits ON the terrain; absoluteY overrides for a spanning piece (a lintel).
      position: { x: p.x, y: absoluteY ?? getHeight(p.x, p.z) + scale.y / 2, z: p.z },
      rotation: { x: 0, y: rotationY, z: 0 },
      scale: { ...scale },
    },
    collider: { type: colliderType, enabled: true },
    exclusion: { grass: true, trees: true },
    particles,
    interaction,
  };
}

// --- the seed-driven layout (single source of truth; reproduces visualBenchmarkLayout/iceChapelLayout) ---

/**
 * Activate the seeded alpine profile so getHeight/findGoodSpawn/deriveSites sample the SAME field the runtime
 * loader applies on load (the single-terrain-source invariant). `createWorldDocument({terrain:{seed}})`
 * deep-merges, keeping all terrain defaults and overriding only the seed — identical to the slices' local
 * activateProfile (which built a default-seed-0 doc).
 */
export function activateSliceProfile(seed = 0) {
  const terrain = createWorldDocument({ terrain: { seed } }).terrain;
  setTerrainProfile(createTerrainProfile(terrain));
  return terrain;
}

/**
 * The corridor's key points, deterministic given the seeded terrain: spawn (findGoodSpawn), the relic + cache
 * (deriveSites — relic ~ +X, cache ~ −X, so carrying is required), the crossing (midpoint), and the carry
 * dir/perp. Reproduces visualBenchmarkLayout() at seed 0 and iceChapelLayout() at seed 137 byte-for-byte.
 */
export function sliceLayout({ seed = 0 } = {}) {
  activateSliceProfile(seed);
  const base = findGoodSpawn();
  const spawn = { x: base.x, z: base.z };
  const { relic, cache } = deriveSites(spawn);
  const crossing = { x: (spawn.x + cache.x) / 2, z: (spawn.z + cache.z) / 2 };
  const dir = unit(cache.x - spawn.x, cache.z - spawn.z);
  const perp = { x: -dir.z, z: dir.x };
  return { spawn, relic, cache, crossing, dir, perp };
}

/** The route-mask radius both slices derive from the spawn→cache span. */
export function routeRadius(spawn, cache) {
  return Math.max(20, Math.hypot(cache.x - spawn.x, cache.z - spawn.z) * 0.6 + 8);
}

// --- document-block factories ----------------------------------------------------------------------

/** The optional authored slice identity block (sanitized on load by WorldValidation; default = frozen cache). */
export function sliceIdentity({ title, arrivalTagline, completeBody }) {
  return { title, arrivalTagline, completeBody };
}

/**
 * An Encounter Editor-0 combat beat. Stationary beats OMIT the patrol key entirely (so the block is
 * byte-identical to a hand-authored stationary beat); a moving beat passes a patrol descriptor.
 */
export function encounterBeat({ id, position, radius, enemyType, label, patrol = null, enemyCount = 1, persistCompletion = true }) {
  const beat = {
    type: ENCOUNTER_TYPE,
    id,
    position,
    radius,
    enemyType,
    enemyCount,
    completed: false,
    persistCompletion,
    label,
  };
  if (patrol) beat.patrol = patrol;
  return beat;
}

/**
 * A runtimeAssets generated-weapon reward (rebuilt from a recipe on load, never baked). Grounded at the given
 * (x,z) + liftY. The recipe is a pure function of the seed, so the composition stays deterministic.
 */
export function generatedWeaponReward({ id, seed, type = "exotic", position, rotationY = 0, liftY = 1.2 }) {
  return {
    kind: "generated.weapon",
    id,
    recipe: generateWeaponRecipe(rollConfig(seed, type)),
    transform: {
      position: { x: position.x, y: getHeight(position.x, position.z) + liftY, z: position.z },
      rotation: { x: 0, y: rotationY, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    runtime: { state: "idle", owner: null, durability: 1, visible: true, castShadow: true, receiveShadow: true, slot: null },
  };
}

/**
 * A Procedural Authoring-1 beacon-trail `doc.authoring` block over a route spline + circular mask. Ids derive
 * from `prefix` (`${prefix}-route`/`-area`/`-trail`, seed `${prefix}-trail`) so it reproduces the slices' ids.
 */
export function beaconTrail({ prefix, splineName, maskName, modName, points, center, radius, markerCount = 20, markerScale = 1, ring = true, tension = 0.5, falloff = 0.4 }) {
  return {
    version: 1,
    splines: [
      { id: `${prefix}-route`, name: splineName, enabled: true, locked: false, points, tension, closed: false },
    ],
    masks: [
      { id: `${prefix}-area`, name: maskName, enabled: true, locked: false, shape: "circle", center, radius, half: { x: radius, z: radius }, falloff },
    ],
    modifiers: [
      { id: `${prefix}-trail`, name: modName, enabled: true, type: "beacon-trail", splineId: `${prefix}-route`, maskId: `${prefix}-area`, seed: `${prefix}-trail`, markerCount, markerScale, ring },
    ],
  };
}

/**
 * A per-scene glacial-lighting override: the global glacialLighting() default with sun/hemisphere/fog deltas
 * deep-merged. Returns a FRESH object (never mutates the global default), reproducing the slices' *Lighting().
 */
export function mergeGlacialLighting({ sun = {}, hemisphere = {}, fog = {} } = {}) {
  const base = glacialLighting();
  return {
    ...base,
    sun: { ...base.sun, ...sun },
    hemisphere: { ...base.hemisphere, ...hemisphere },
    fog: { ...base.fog, ...fog },
  };
}
