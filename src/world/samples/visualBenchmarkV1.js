// Visual Benchmark-1 — one compact, authored corridor polished toward shipping quality while staying
// inside measured budgets. A NEW sample world (it never mutates the shipped Frozen Cache / first-playable
// slice): the Relic Overlook → glacial crossing → cache-pedestal corridor, composed as intentional data
// from the systems already shipped — glacial terrain/water/fog (default alpine profile), authored
// primitive landmarks framing a readable route, a Procedural Authoring-1 beacon-trail along that route,
// an Encounter Editor-0 combat beat on the crossing, and a reference-only validated-GLB cache prop.
//
// Environment Polish-1 (ADR-051) evolves this corridor IN PLACE toward a shippable authored slice without
// adding any new rendering architecture: a few more route-framing landmarks (waypoint cairns + a crossing
// gateway), PER-SCENE lighting/water/atmosphere readability overrides (applied to THIS document only — the
// global default and the frozen slices stay byte-stable), and ambient particle feedback emphasising the
// relic, the cache, and the crossing threshold. The git tag `world-builder-visual-benchmark-1` preserves
// the pre-polish byte-state.
//
// The relic find→carry→cache loop is the runtime's AUTOMATIC objective (ObjectiveRuntime.deriveSites from
// the spawn) — so this scene authors NO objectives block; the landmarks frame that same deterministic
// axis. Pure + deterministic: no RNG, no wall-clock (the composition is a function of the terrain only).

import { createWorldDocument } from "../WorldDocument.js";
import { getHeight, findGoodSpawn, setTerrainProfile } from "../../terrain/terrainSampling.js";
import { createTerrainProfile } from "../../terrain/profiles/index.js";
import { glacialLighting } from "../../lighting/GlacialAtmosphere.js";
import { createWaterConfig } from "../water/WaterConfig.js";
import { createAtmosphereConfig } from "../atmosphere/AtmosphereConfig.js";
import { deriveSites } from "../objectives/RelicWeaponObjective.js";
import { ENCOUNTER_TYPE } from "../encounters/EncounterTypes.js";

export const VISUAL_BENCHMARK_ID = "visual-benchmark-1";
// A stable id for the validated-GLB cache prop. The doc carries only this REFERENCE (asset:null) — the
// GLB binary lives in IndexedDB and is resolved at runtime (the proof imports the clean fixture under it).
export const BENCHMARK_CACHE_ASSET_ID = "gltf-visual-benchmark-cache";

// Activate the canonical alpine (glacial valley) profile so getHeight/findGoodSpawn/deriveSites sample
// the SAME field the runtime loader applies — landmark Y values + the derived relic/cache then match play.
function activateProfile() {
  const terrain = createWorldDocument({ metadata: { name: "Visual Benchmark 1" } }).terrain;
  setTerrainProfile(createTerrainProfile(terrain));
  return terrain;
}

function unit(ax, az) {
  const len = Math.hypot(ax, az) || 1;
  return { x: ax / len, z: az / len };
}

/**
 * The composition's single source of truth: the corridor's key points, deterministic given the terrain.
 * Both buildVisualBenchmarkV1() and the proof read this so the authored landmarks, the route spline, the
 * encounter, and the runtime-derived objective all agree. UNCHANGED by Environment Polish-1 — the relic
 * axis is stable, so polish only adds framing around the same spawn/relic/cache/crossing points.
 */
export function visualBenchmarkLayout() {
  activateProfile();
  const base = findGoodSpawn(); // a flat, dry, walkable point on the valley floor — the overlook
  const spawn = { x: base.x, z: base.z };
  const { relic, cache } = deriveSites(spawn); // relic ~ one side, cache ~ opposed → carrying required
  const crossing = { x: (spawn.x + cache.x) / 2, z: (spawn.z + cache.z) / 2 }; // the glacial crossing
  const dir = unit(cache.x - spawn.x, cache.z - spawn.z); // spawn → cache (the carry sightline)
  const perp = { x: -dir.z, z: dir.x };
  return { spawn, relic, cache, crossing, dir, perp };
}

/**
 * Per-scene readability overrides (Environment Polish-1). Applied to the benchmark document ONLY — each
 * config factory returns a fresh object and the loader reads the value off the document, so overriding
 * here never mutates the global default other worlds receive (the frozen slices stay byte-stable). The
 * deltas are tasteful: a slightly higher, brighter, more raking sun so the authored stone/ice landmarks
 * read with form; fog pushed back so the cache pedestal is discoverable from the overlook while the route
 * keeps depth; brighter water foam/fresnel + a touch more shimmer so the crossing's edge reads; a hair
 * less basin fog + mist so the corridor floor and the crossing stay legible.
 */
function benchmarkLighting() {
  const base = glacialLighting();
  return {
    ...base,
    sun: { ...base.sun, color: "#f1f5fb", intensity: 2.55, azimuth: 48, elevation: 36 },
    hemisphere: { ...base.hemisphere, intensity: 0.82 },
    fog: { ...base.fog, near: 112, far: 380 },
  };
}
function benchmarkWater() {
  return createWaterConfig({ flowSpeed: 0.5, foamBand: 1.4, fresnel: 0.4 });
}
function benchmarkAtmosphere() {
  return createAtmosphereConfig({ basinFogBoost: 0.38, mistStrength: 0.32, mistBand: 16 });
}

// --- authored-object helpers --------------------------------------------------

function groundedPrimitive(id, name, kind, p, scale, { rotationY = 0, colliderType = "box", absoluteY = null, particles = null } = {}) {
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
    // Ambient particle feedback (Environment Polish-1) — null on most, a spark/dust emitter on the few
    // objects that should draw the eye (relic, cache, crossing). Sanitized by WorldValidation on load.
    particles,
  };
}

function offset(p, perp, side, along = { x: 0, z: 0 }) {
  return { x: p.x + perp.x * side + along.x, z: p.z + perp.z * side + along.z };
}

export function buildVisualBenchmarkV1() {
  const doc = createWorldDocument({ metadata: { name: "Visual Benchmark 1" } });
  const { spawn, relic, cache, crossing, dir, perp } = visualBenchmarkLayout();

  // --- Per-scene readability (Environment Polish-1, this document only) ---------------------------
  doc.lighting = benchmarkLighting();
  doc.water = benchmarkWater();
  doc.atmosphere = benchmarkAtmosphere();

  const objects = [];

  // --- Overlook gateway at the spawn, opening toward the cache (frames the sightline) -------------
  const gateYaw = Math.atan2(dir.x, dir.z);
  objects.push(groundedPrimitive("vb-overlook-pillar-l", "Overlook Pillar L", "cube", offset(spawn, perp, 2.4), { x: 0.6, y: 3.6, z: 0.6 }, { rotationY: gateYaw }));
  objects.push(groundedPrimitive("vb-overlook-pillar-r", "Overlook Pillar R", "cube", offset(spawn, perp, -2.4), { x: 0.6, y: 3.6, z: 0.6 }, { rotationY: gateYaw }));
  // The lintel spans the pillars at the gateway top — set its absolute Y at construction (no post-mutation).
  objects.push(groundedPrimitive("vb-overlook-lintel", "Overlook Lintel", "cube", spawn, { x: 5.4, y: 0.6, z: 0.7 }, { rotationY: gateYaw, absoluteY: getHeight(spawn.x, spawn.z) + 3.4 }));

  // --- Ruin marking the relic (off the carry centerline, on the relic side) ----------------------
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const p = { x: relic.x + Math.cos(a) * 1.8, z: relic.z + Math.sin(a) * 1.8 };
    objects.push(groundedPrimitive(`vb-ruin-stone-${i}`, `Ruin Stone ${i}`, "cube", p, { x: 1.1, y: 0.9 + i * 0.3, z: 1.1 }, { rotationY: a }));
  }
  // The relic ice shard catches the eye — an additive spark emitter marks the relic as the goal.
  objects.push(groundedPrimitive("vb-ruin-shard", "Ruin Ice Shard", "cylinder", relic, { x: 0.7, y: 3.4, z: 0.7 }, { colliderType: "cylinder", particles: { kind: "spark", rate: 22, max: 90, color: "#bfe4ff", colorEnd: "#3aa0ff", size: 0.18, speed: 2.2, gravity: -1.2 } }));

  // --- Waypoint cairns guiding the eye along the route (Environment Polish-1) ---------------------
  // Off the carry centerline (perp side), at one- and two-thirds of the way, so the route reads as a
  // path to follow without obstructing the direct carry line.
  const along = (t) => ({ x: spawn.x + (cache.x - spawn.x) * t, z: spawn.z + (cache.z - spawn.z) * t });
  objects.push(groundedPrimitive("vb-route-cairn-a", "Route Cairn A", "cube", offset(along(0.33), perp, 6.0), { x: 0.8, y: 1.4, z: 0.8 }, { rotationY: 0.5 }));
  objects.push(groundedPrimitive("vb-route-cairn-b", "Route Cairn B", "cube", offset(along(0.66), perp, -6.0), { x: 0.8, y: 1.7, z: 0.8 }, { rotationY: -0.6 }));

  // --- Crossing gateway: short ice posts flank the glacial crossing where the combat beat sits -----
  // Frames the encounter as a threshold. Perp ±3.4 keeps the carry centerline midpoint unobstructed.
  objects.push(groundedPrimitive("vb-crossing-post-l", "Crossing Post L", "cylinder", offset(crossing, perp, 3.4), { x: 0.5, y: 2.8, z: 0.5 }, { colliderType: "cylinder", particles: { kind: "dust", rate: 10, max: 70, color: "#cfe0e8", size: 0.6, speed: 0.5, gravity: -0.15 } }));
  objects.push(groundedPrimitive("vb-crossing-post-r", "Crossing Post R", "cylinder", offset(crossing, perp, -3.4), { x: 0.5, y: 2.8, z: 0.5 }, { colliderType: "cylinder" }));

  // --- Pass + cache pedestal (ice pillars flank the cache; the pedestal holds the GLB prop) -------
  objects.push(groundedPrimitive("vb-pass-pillar-l", "Pass Ice Pillar L", "cylinder", offset(cache, perp, 3.0), { x: 0.9, y: 4.6, z: 0.9 }, { colliderType: "cylinder" }));
  objects.push(groundedPrimitive("vb-pass-pillar-r", "Pass Ice Pillar R", "cylinder", offset(cache, perp, -3.0), { x: 0.9, y: 4.6, z: 0.9 }, { colliderType: "cylinder" }));
  // The cache pedestal glows — an additive spark emitter stages the destination.
  objects.push(groundedPrimitive("vb-cache-pedestal", "Cache Pedestal", "cylinder", cache, { x: 1.6, y: 1.2, z: 1.6 }, { colliderType: "cylinder", particles: { kind: "spark", rate: 18, max: 80, color: "#ffe6a8", colorEnd: "#ff9a3c", size: 0.16, speed: 1.8, gravity: -0.8 } }));

  // --- The validated-GLB cache prop (REFERENCE ONLY — resolved from IndexedDB at runtime) ---------
  const pedestalTop = getHeight(cache.x, cache.z) + 1.2;
  objects.push({
    id: "vb-cache-prop",
    name: "Cache Relic Prop",
    type: "gltf",
    primitive: null,
    assetRef: BENCHMARK_CACHE_ASSET_ID,
    asset: null,
    transform: { position: { x: cache.x, y: pedestalTop + 0.7, z: cache.z }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1.4, y: 1.4, z: 1.4 } },
    collider: { type: "box", enabled: true },
    exclusion: { grass: true, trees: true },
  });

  doc.objects = objects;

  // --- Procedural Authoring-1: a beacon-trail along the spawn → relic → cache route ---------------
  const routeRadius = Math.max(20, Math.hypot(cache.x - spawn.x, cache.z - spawn.z) * 0.6 + 8);
  doc.authoring = {
    version: 1,
    splines: [
      {
        id: "vb-route",
        name: "Corridor Route",
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
        id: "vb-area",
        name: "Corridor Area",
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
      { id: "vb-trail", name: "Route Beacons", enabled: true, type: "beacon-trail", splineId: "vb-route", maskId: "vb-area", seed: "vb-trail", markerCount: 20, markerScale: 1, ring: true },
    ],
  };

  // --- Encounter Editor-0: one combat beat on the glacial crossing --------------------------------
  doc.encounters = {
    version: 1,
    items: [
      {
        type: ENCOUNTER_TYPE,
        id: "vb-crossing-sentinel",
        position: { x: crossing.x, y: getHeight(crossing.x, crossing.z), z: crossing.z },
        radius: 8,
        enemyType: "glacial_sentinel",
        enemyCount: 1,
        completed: false,
        persistCompletion: true,
      },
    ],
  };

  // The relic find→carry→cache loop is the runtime's automatic objective — author NO objectives block.
  // Spawn at the overlook, facing the corridor; third-person so the framed composition reads.
  doc.player.spawn = { x: spawn.x, y: getHeight(spawn.x, spawn.z), z: spawn.z };
  doc.player.cameraMode = "third";

  return doc;
}
