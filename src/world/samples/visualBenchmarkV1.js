// Visual Benchmark-1 — one compact, authored corridor polished toward shipping quality while staying
// inside measured budgets. A NEW sample world (it never mutates the shipped Frozen Cache / first-playable
// slice): the Relic Overlook → glacial crossing → cache-pedestal corridor, composed as intentional data
// from the systems already shipped — glacial terrain/water/fog (default alpine profile), authored
// primitive landmarks framing a readable route, a Procedural Authoring-1 beacon-trail along that route,
// an Encounter Editor-0 combat beat on the crossing, and a reference-only validated-GLB cache prop.
//
// The relic find→carry→cache loop is the runtime's AUTOMATIC objective (ObjectiveRuntime.deriveSites from
// the spawn) — so this scene authors NO objectives block; the landmarks frame that same deterministic
// axis. Pure + deterministic: no RNG, no wall-clock (the composition is a function of the terrain only).

import { createWorldDocument } from "../WorldDocument.js";
import { getHeight, findGoodSpawn, setTerrainProfile } from "../../terrain/terrainSampling.js";
import { createTerrainProfile } from "../../terrain/profiles/index.js";
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
 * encounter, and the runtime-derived objective all agree.
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

// --- authored-object helpers --------------------------------------------------

function groundedPrimitive(id, name, kind, p, scale, { rotationY = 0, colliderType = "box", absoluteY = null } = {}) {
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
  };
}

function offset(p, perp, side, along = { x: 0, z: 0 }) {
  return { x: p.x + perp.x * side + along.x, z: p.z + perp.z * side + along.z };
}

export function buildVisualBenchmarkV1() {
  const doc = createWorldDocument({ metadata: { name: "Visual Benchmark 1" } });
  const { spawn, relic, cache, crossing, dir, perp } = visualBenchmarkLayout();

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
  objects.push(groundedPrimitive("vb-ruin-shard", "Ruin Ice Shard", "cylinder", relic, { x: 0.7, y: 3.4, z: 0.7 }, { colliderType: "cylinder" }));

  // --- Pass + cache pedestal (ice pillars flank the cache; the pedestal holds the GLB prop) -------
  objects.push(groundedPrimitive("vb-pass-pillar-l", "Pass Ice Pillar L", "cylinder", offset(cache, perp, 3.0), { x: 0.9, y: 4.6, z: 0.9 }, { colliderType: "cylinder" }));
  objects.push(groundedPrimitive("vb-pass-pillar-r", "Pass Ice Pillar R", "cylinder", offset(cache, perp, -3.0), { x: 0.9, y: 4.6, z: 0.9 }, { colliderType: "cylinder" }));
  objects.push(groundedPrimitive("vb-cache-pedestal", "Cache Pedestal", "cylinder", cache, { x: 1.6, y: 1.2, z: 1.6 }, { colliderType: "cylinder" }));

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
