// The Ice Chapel — a SECOND authored playable slice (Slice-1), proving the stack produces another distinct
// 5–10 minute run from the SAME systems rather than only polishing the one benchmark corridor. It is a NEW
// sample world (`ice-chapel-1`), never a mutation of `visual-benchmark-1`: a seeded alpine field
// (`terrain.seed = 137`) relocates the whole run to the OPPOSITE valley wall — spawn high on a broken stair,
// then bear the relic DOWN the descent to a chapel seal on the trough floor. Composed as intentional data from
// the shipped systems: glacial terrain/water/fog (with its OWN colder/mistier readability), authored primitive
// landmarks framing the descent, a Procedural Authoring-1 beacon-trail, two Encounter Editor-0 combat beats
// (a moving sentinel patrol on the descent + a frost_wisp guardian at the seal), an optional shrine reward, and
// the scene-coherent slice identity ("The Ice Chapel").
//
// The relic find→carry→cache loop is the runtime's AUTOMATIC objective (ObjectiveRuntime.deriveSites from the
// spawn) — so this scene authors NO objectives block; the landmarks frame that same deterministic axis. Pure +
// deterministic: the composition is a function of the seed-137 terrain only (no RNG, no wall-clock). The loader
// reproduces the seed in play (load → applyTerrainSettings(doc.terrain) → createTerrainProfile), so mesh ==
// sampling == placement. The benchmark + the frozen slices stay byte-stable (this file touches none of them).

import { createWorldDocument } from "../WorldDocument.js";
import { getHeight, findGoodSpawn, setTerrainProfile } from "../../terrain/terrainSampling.js";
import { createTerrainProfile } from "../../terrain/profiles/index.js";
import { glacialLighting } from "../../lighting/GlacialAtmosphere.js";
import { createWaterConfig } from "../water/WaterConfig.js";
import { createAtmosphereConfig } from "../atmosphere/AtmosphereConfig.js";
import { deriveSites } from "../objectives/RelicWeaponObjective.js";
import { ENCOUNTER_TYPE } from "../encounters/EncounterTypes.js";
import { SENTINEL_TYPE, WISP_TYPE } from "../enemies/EnemyTypes.js";
// The optional shrine reward is a generated weapon rebuilt from a recipe at load (never baked) — the same
// allowed world→arsenal-recipe dependency the benchmark + RelicWeaponObjective use (the boundary scan forbids
// only the arsenal UI, not these PURE recipe modules).
import { generateWeaponRecipe } from "../../arsenal/WeaponGrammar.js";
import { rollConfig } from "../../arsenal/WeaponConfig.js";

export const ICE_CHAPEL_ID = "ice-chapel-1";
// The seed that relocates the run to the +X wall (a different findGoodSpawn → a different relic/cache axis,
// ≈160 m from the benchmark's −X overlook) while keeping the glacial identity. Verified dry + walkable with a
// real carry loop (spawn (80,60) → relic up-wall (94,60) → seal on the floor (54,60)).
const CHAPEL_SEED = 137;

// Activate the seed-137 alpine profile before authoring so getHeight/findGoodSpawn/deriveSites sample the SAME
// field the runtime loader applies on load (so landmark Y values + the derived relic/seal match play).
function activateProfile() {
  const terrain = createWorldDocument({ metadata: { name: "The Ice Chapel" }, terrain: { seed: CHAPEL_SEED } }).terrain;
  setTerrainProfile(createTerrainProfile(terrain));
  return terrain;
}

function unit(ax, az) {
  const len = Math.hypot(ax, az) || 1;
  return { x: ax / len, z: az / len };
}

/**
 * The composition's single source of truth: the descent's key points, deterministic given the seed-137 terrain.
 * Both buildIceChapelV1() and the proof read this so the authored landmarks, the route spline, the encounters,
 * and the runtime-derived objective all agree. The relic sits up the wall and the cache (the chapel seal) sits
 * on the trough floor, so the loop is a real climb-to-find / descend-to-seal carry.
 */
export function iceChapelLayout() {
  activateProfile();
  const base = findGoodSpawn(); // the broken stair — high on the +X valley wall
  const spawn = { x: base.x, z: base.z };
  const { relic, cache } = deriveSites(spawn); // relic up-wall; cache = the chapel seal on the floor
  const crossing = { x: (spawn.x + cache.x) / 2, z: (spawn.z + cache.z) / 2 }; // the mid-descent threshold
  const dir = unit(cache.x - spawn.x, cache.z - spawn.z); // spawn → seal (the descent sightline)
  const perp = { x: -dir.z, z: dir.x };
  return { spawn, relic, cache, crossing, dir, perp };
}

/**
 * Per-scene readability overrides — colder + mistier + more enclosed than the benchmark's open overlook, to
 * sell the Ice Chapel as a distinct place. Applied to THIS document only (each factory returns a fresh object
 * and the loader reads the value off the document), so overriding here never mutates the global default other
 * worlds receive — the frozen slices stay byte-stable. A lower, cooler sun; fog pulled in for an enclosed
 * descent; colder, slower water; thicker basin mist gathering on the floor where the seal sits.
 */
function chapelLighting() {
  const base = glacialLighting();
  return {
    ...base,
    sun: { ...base.sun, color: "#d6e2f2", intensity: 1.95, azimuth: 312, elevation: 24 },
    hemisphere: { ...base.hemisphere, skyColor: "#c2d6ea", intensity: 1.05 },
    fog: { ...base.fog, color: "#b3c8d8", near: 64, far: 250 },
  };
}
function chapelWater() {
  return createWaterConfig({ shallowColor: "#a8cdd9", deepColor: "#173b4f", flowSpeed: 0.2, foamBand: 1.1, fresnel: 0.36, opacity: 0.88 });
}
function chapelAtmosphere() {
  return createAtmosphereConfig({ basinFogBoost: 0.6, mistStrength: 0.58, mistBand: 18 });
}

// --- authored-object helpers (local — the byte-stable benchmark is not touched/extracted) -----------

function groundedPrimitive(id, name, kind, p, scale, { rotationY = 0, colliderType = "box", absoluteY = null, particles = null, interaction = null } = {}) {
  return {
    id,
    name,
    type: "primitive",
    primitive: kind,
    assetRef: null,
    asset: null,
    transform: {
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

function offset(p, perp, side, along = { x: 0, z: 0 }) {
  return { x: p.x + perp.x * side + along.x, z: p.z + perp.z * side + along.z };
}

export function buildIceChapelV1() {
  const doc = createWorldDocument({ metadata: { name: "The Ice Chapel" }, terrain: { seed: CHAPEL_SEED } });
  const { spawn, relic, cache, crossing, dir, perp } = iceChapelLayout();

  // --- Per-scene readability (this document only — global default + frozen slices stay byte-stable) -
  doc.lighting = chapelLighting();
  doc.water = chapelWater();
  doc.atmosphere = chapelAtmosphere();

  // --- This scene's completion identity (the generic slice wrapper reads it) -----------------------
  // Names the run's beginning (the arrival banner) AND its ending (the completion card). Optional, sanitized
  // on load; worlds that omit it keep the byte-exact frozen-cache default.
  doc.slice = {
    title: "The Ice Chapel",
    arrivalTagline: "Bear the relic down to the chapel seal",
    completeBody: "The relic lies sealed in the chapel; the valley floor holds its silence.",
  };

  const objects = [];
  const gateYaw = Math.atan2(dir.x, dir.z);
  const along = (t) => ({ x: spawn.x + (cache.x - spawn.x) * t, z: spawn.z + (cache.z - spawn.z) * t });

  // --- Broken stair at the spawn (the opening) — stepped blocks descending toward the seal ----------
  for (let i = 0; i < 4; i++) {
    const step = offset(along(0.04 + i * 0.05), perp, i % 2 === 0 ? 2.2 : -2.2);
    objects.push(groundedPrimitive(`ic-stair-${i}`, `Broken Stair ${i}`, "cube", step, { x: 1.8, y: 1.2 - i * 0.22, z: 1.2 }, { rotationY: gateYaw + (i - 1.5) * 0.1 }));
  }

  // --- Opening orientation sign at the broken stair (data-only interaction) -------------------------
  // Read at the head of the stair: it frames the WHOLE loop (find the relic above → bear it down the descent →
  // seal it at the chapel) AND the non-lethal recovery rule, so the run reads as a deliberate beginning.
  const orientationSign = offset(spawn, perp, 3.0, { x: dir.x * 1.2, z: dir.z * 1.2 });
  objects.push(
    groundedPrimitive("ic-orientation-sign", "Chapel Stair Marker", "cube", orientationSign, { x: 0.5, y: 1.8, z: 0.5 }, {
      rotationY: gateYaw,
      interaction: { role: "sign", text: "The broken stair of the ice chapel. A relic waits in the ruin above — bear it down the descent to the chapel seal on the valley floor. The wards will shove you back but cannot fell you: fall back, gather yourself, then seal it.", showRadius: 9 },
    })
  );

  // --- Ruin marking the relic (up the wall, off the carry centerline) -------------------------------
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const p = { x: relic.x + Math.cos(a) * 1.8, z: relic.z + Math.sin(a) * 1.8 };
    objects.push(groundedPrimitive(`ic-relic-stone-${i}`, `Relic Ruin Stone ${i}`, "cube", p, { x: 1.1, y: 0.9 + i * 0.3, z: 1.1 }, { rotationY: a }));
  }
  // The relic ice shard catches the eye — an additive spark emitter marks it as the goal.
  objects.push(groundedPrimitive("ic-relic-shard", "Relic Ice Shard", "cylinder", relic, { x: 0.7, y: 3.4, z: 0.7 }, { colliderType: "cylinder", particles: { kind: "spark", rate: 22, max: 90, color: "#cfe9ff", colorEnd: "#5ab4ff", size: 0.18, speed: 2.0, gravity: -1.0 } }));

  // --- Optional side shrine off the route (an optional discovery + the reward) ----------------------
  // ~9 m off the route on the relic side (within the route band, clear of the carry centerline). A shrine
  // STRUCTURE (exploration), a readable SIGN, a brooding fog POCKET, and an optional generated weapon to claim
  // (authored below in doc.runtimeAssets). All data-only — surfaced in play by the existing runtimes.
  const shrine = offset(relic, perp, 9);
  const shrineYaw = Math.atan2(relic.x - shrine.x, relic.z - shrine.z);
  objects.push(groundedPrimitive("ic-shrine-base", "Shrine Base", "cube", shrine, { x: 2.4, y: 0.6, z: 2.0 }, { rotationY: shrineYaw }));
  objects.push(
    groundedPrimitive("ic-shrine-idol", "Shrine Idol", "cylinder", shrine, { x: 0.7, y: 2.8, z: 0.7 }, {
      colliderType: "cylinder",
      rotationY: shrineYaw,
      particles: { kind: "smoke", rate: 8, max: 100, lifetime: 4.2, size: 1.0, sizeEnd: 2.8, color: "#9fb0c4", colorEnd: "#5a6a7d", speed: 0.7, spread: 0.6, gravity: 0.3, emitRadius: 0.3, opacity: 0.4 },
      interaction: { role: "sign", text: "A frost shrine kneels beside the ruin — its offering still here for the taking. Bear the relic on: down the descent, the chapel seal waits on the valley floor.", showRadius: 7 },
    })
  );
  objects.push(groundedPrimitive("ic-shrine-ward-l", "Shrine Ward L", "cube", offset(shrine, perp, 0, { x: dir.x * 1.6, z: dir.z * 1.6 }), { x: 0.6, y: 1.6, z: 0.6 }, { rotationY: shrineYaw }));
  objects.push(groundedPrimitive("ic-shrine-ward-r", "Shrine Ward R", "cube", offset(shrine, perp, 0, { x: -dir.x * 1.6, z: -dir.z * 1.6 }), { x: 0.6, y: 1.6, z: 0.6 }, { rotationY: shrineYaw }));

  // --- Threat-teaching sign before the descent patrol (data-only interaction) -----------------------
  // Placed before the first combat beat so the player learns the wards' rule up front: the warding pulse is
  // NON-LETHAL (it shoves you back, it cannot fell you), how to recover, and how to press on.
  const threatSign = offset(along(0.42), perp, 4);
  objects.push(
    groundedPrimitive("ic-threat-sign", "Ward Warning Sign", "cube", threatSign, { x: 0.5, y: 1.8, z: 0.5 }, {
      rotationY: gateYaw,
      interaction: { role: "sign", text: "The chapel's wards bristle as you descend — a warding pulse will shove you back, but it cannot fell you. Fall back to gather yourself, then break through: the seal waits below.", showRadius: 8 },
    })
  );

  // --- Descent gateway: short ice posts flank the mid-descent crossing where the patrol beat sits ----
  objects.push(groundedPrimitive("ic-descent-post-l", "Descent Post L", "cylinder", offset(crossing, perp, 3.4), { x: 0.5, y: 2.8, z: 0.5 }, { colliderType: "cylinder", particles: { kind: "dust", rate: 10, max: 70, color: "#cfe0e8", size: 0.6, speed: 0.5, gravity: -0.15 } }));
  objects.push(groundedPrimitive("ic-descent-post-r", "Descent Post R", "cylinder", offset(crossing, perp, -3.4), { x: 0.5, y: 2.8, z: 0.5 }, { colliderType: "cylinder" }));

  // --- The chapel seal at the cache (ice pillars flank the seal; a primitive seal stone holds the spot) -
  objects.push(groundedPrimitive("ic-seal-pillar-l", "Chapel Pillar L", "cylinder", offset(cache, perp, 3.0), { x: 0.9, y: 4.6, z: 0.9 }, { colliderType: "cylinder" }));
  objects.push(groundedPrimitive("ic-seal-pillar-r", "Chapel Pillar R", "cylinder", offset(cache, perp, -3.0), { x: 0.9, y: 4.6, z: 0.9 }, { colliderType: "cylinder" }));
  // The seal pedestal glows — an additive spark emitter stages the destination (cold blue, the chapel's colour).
  objects.push(groundedPrimitive("ic-seal-pedestal", "Chapel Seal Pedestal", "cylinder", cache, { x: 1.6, y: 1.2, z: 1.6 }, { colliderType: "cylinder", particles: { kind: "spark", rate: 18, max: 80, color: "#bfe4ff", colorEnd: "#4aa6ff", size: 0.16, speed: 1.6, gravity: -0.7 } }));
  // The chapel seal itself — a primitive stone (self-contained; NO GLB dependency), set on the pedestal top.
  const sealTop = getHeight(cache.x, cache.z) + 1.2;
  objects.push(groundedPrimitive("ic-seal-stone", "Chapel Seal Stone", "cube", cache, { x: 1.0, y: 1.0, z: 1.0 }, { absoluteY: sealTop + 0.5, rotationY: gateYaw + 0.4 }));

  doc.objects = objects;

  // --- The shrine's optional reward — a generated weapon REBUILT from a recipe on load ---------------
  // A deterministic exotic relic offered on the shrine (NOT the objective relic — a separate id the player may
  // claim or ignore with F). PlacedWeaponRuntime.load() instantiates it from the recipe (never baked geometry).
  doc.runtimeAssets = {
    version: 1,
    items: [
      {
        kind: "generated.weapon",
        id: "ic-shrine-relic-weapon",
        recipe: generateWeaponRecipe(rollConfig("ic-shrine-relic", "exotic")),
        transform: {
          position: { x: shrine.x, y: getHeight(shrine.x, shrine.z) + 1.2, z: shrine.z },
          rotation: { x: 0, y: shrineYaw, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
        runtime: { state: "idle", owner: null, durability: 1, visible: true, castShadow: true, receiveShadow: true, slot: null },
      },
    ],
  };

  // --- A beacon-trail along the spawn → relic → crossing → cache descent (route readability) ---------
  const routeRadius = Math.max(20, Math.hypot(cache.x - spawn.x, cache.z - spawn.z) * 0.6 + 8);
  doc.authoring = {
    version: 1,
    splines: [
      {
        id: "ic-route",
        name: "Chapel Descent Route",
        enabled: true,
        locked: false,
        points: [
          { x: spawn.x, y: 0, z: spawn.z },
          { x: relic.x, y: 0, z: relic.z },
          { x: crossing.x, y: 0, z: crossing.z },
          { x: cache.x, y: 0, z: cache.z },
        ],
        tension: 0.5,
        closed: false,
      },
    ],
    masks: [
      {
        id: "ic-area",
        name: "Chapel Area",
        enabled: true,
        locked: false,
        shape: "circle",
        center: { x: crossing.x, y: 0, z: crossing.z },
        radius: routeRadius,
        half: { x: routeRadius, z: routeRadius },
        falloff: 0.4,
      },
    ],
    modifiers: [
      { id: "ic-trail", name: "Descent Beacons", enabled: true, type: "beacon-trail", splineId: "ic-route", maskId: "ic-area", seed: "ic-trail", markerCount: 20, markerScale: 1, ring: true },
    ],
  };

  // --- Two authored combat beats — distinct staging vs the benchmark's three ------------------------
  // Beat 1: a MOVING glacial_sentinel patrol on the descent (walks a short line across the route; "halt" alert
  // telegraphs when the player enters its zone). Beat 2: a frost_wisp guardian at the chapel seal (stationary
  // hover; its radius-6 zone OVERLAPS the cache so approaching the seal telegraphs it). Each is ONE enemy
  // (enemyCount clamps to 1), completing + persisting INDEPENDENTLY — two single-enemy beats, not a wave.
  const sealWisp = offset(cache, perp, 3);
  const descentPatrolPoint = (side) => {
    const q = offset(crossing, perp, side);
    return { x: q.x, y: getHeight(q.x, q.z), z: q.z };
  };
  doc.encounters = {
    version: 1,
    items: [
      {
        type: ENCOUNTER_TYPE,
        id: "ic-descent-sentinel",
        position: { x: crossing.x, y: getHeight(crossing.x, crossing.z), z: crossing.z },
        radius: 8,
        enemyType: SENTINEL_TYPE,
        enemyCount: 1,
        completed: false,
        persistCompletion: true,
        label: "the descent",
        patrol: {
          enabled: true,
          points: [descentPatrolPoint(3), descentPatrolPoint(-3)],
          speed: 0.8,
          pauseSec: 1.0,
          loop: false,
          alert: "halt",
        },
      },
      {
        type: ENCOUNTER_TYPE,
        id: "ic-seal-wisp",
        position: { x: sealWisp.x, y: getHeight(sealWisp.x, sealWisp.z), z: sealWisp.z },
        radius: 6,
        enemyType: WISP_TYPE,
        enemyCount: 1,
        completed: false,
        persistCompletion: true,
        label: "the seal",
      },
    ],
  };

  // The relic find→carry→seal loop is the runtime's automatic objective — author NO objectives block.
  // Spawn at the broken stair, facing the descent; third-person so the framed composition reads.
  doc.player.spawn = { x: spawn.x, y: getHeight(spawn.x, spawn.z), z: spawn.z };
  doc.player.cameraMode = "third";

  return doc;
}
