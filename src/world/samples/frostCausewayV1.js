// The Frost Causeway — a THIRD authored playable slice (Slice-2), and the FIRST slice assembled FROM the Slice
// Authoring Kit instead of hand-rolled. It is a NEW sample world (`frost-causeway-1`), never a mutation of an
// existing slice: a seeded alpine field (`terrain.seed = 251`) relocates the whole run to the far south of the
// EAST valley wall (≈130 m from both prior slices) — spawn on a broken ridge, climb to the relic on the ridge
// crown, then bear it DOWN a 26 m descent across the causeway to a seal low on the frozen basin floor.
//
// KIT-BUILT (the point of Slice-2): every structural block comes from `src/world/slice/SliceKit.js` — the
// seed-driven layout (sliceLayout), the grounded-primitive + offset helpers, the slice identity, each combat
// beat, the generated-weapon reward, the beacon-trail authoring, and the per-scene lighting override. This file
// hand-rolls NO local copies of unit/groundedPrimitive/offset/activateProfile (Slice-1 did; the kit replaced
// them). What remains bespoke is CONTENT, not structure: the seed, the identity strings, the "pale overcast
// whiteout" look, the per-landmark composition, the beat positions/labels, and the reward seed. The kit makes
// the slice byte-equal to a hand-authored one (asserted in test:slice-2) — so this proves the kit accelerates
// authoring without losing safety.
//
// Pure + deterministic: the composition is a function of the seed-251 terrain only (no RNG, no wall-clock). The
// loader reproduces the seed in play (load → applyTerrainSettings(doc.terrain) → createTerrainProfile), so mesh
// == sampling == placement. The two prior slices + the frozen slices stay byte-stable (this file touches none
// of them; the kit modules are consumed read-only).

import { createWorldDocument } from "../WorldDocument.js";
import { getHeight } from "../../terrain/terrainSampling.js";
import { deriveSites } from "../objectives/RelicWeaponObjective.js";
import { SENTINEL_TYPE, WISP_TYPE } from "../enemies/EnemyTypes.js";
// Water/atmosphere are authored directly from their config factories (the kit deliberately does not wrap these —
// Slice-1 used them directly too); everything else is assembled from the kit.
import { createWaterConfig } from "../water/WaterConfig.js";
import { createAtmosphereConfig } from "../atmosphere/AtmosphereConfig.js";
// The Slice Authoring Kit — the byte-compatible factory layer this slice is assembled from.
import {
  sliceLayout,
  routeRadius,
  groundedPrimitive,
  offset,
  sliceIdentity,
  encounterBeat,
  generatedWeaponReward,
  beaconTrail,
  mergeGlacialLighting,
} from "../slice/SliceKit.js";

export const FROST_CAUSEWAY_ID = "frost-causeway-1";
// The seed that relocates the run to the far south of the EAST wall (a different findGoodSpawn → a different
// relic/cache axis, ≈130 m from both prior slices) while keeping the glacial identity. Probe-confirmed USABLE:
// spawn (80,−70) on a broken ridge, relic up the crown (94,−70), seal low on the basin floor (54,−70), with a
// real 40 m carry — a ridge-to-basin descent opposite in feel to the two north-wall slices.
const CAUSEWAY_SEED = 251;

/**
 * The composition's single source of truth: the causeway's key points, deterministic given the seed-251 terrain.
 * A thin wrapper over the kit's sliceLayout — both buildFrostCausewayV1() and the proof read this so the authored
 * landmarks, the route spline, the encounters, and the runtime-derived objective all agree on one axis. The relic
 * sits up the ridge crown and the cache (the seal) sits low on the basin floor, so the loop is a real
 * climb-to-find / descend-to-seal carry.
 */
export function frostCausewayLayout() {
  return sliceLayout({ seed: CAUSEWAY_SEED });
}

// --- Per-scene readability: "pale overcast whiteout" — a fresh THIRD identity (vs the Relic Overlook's open
// warmth and the Ice Chapel's enclosed cold mist). Flat bright diffuse light, low contrast, palest near-white
// fog drawing the far causeway into white so the beacon trail is what you navigate by. Each factory returns a
// fresh object and the loader reads the value off the document, so overriding here never mutates the global
// default other worlds receive — the frozen slices stay byte-stable. ------------------------------------------
// Exported so the regression can pin the authored look to the kit factory output EXACTLY
// (`doc.lighting === mergeGlacialLighting(WHITEOUT_LIGHTING)`), not merely to the factory's shape.
export const WHITEOUT_LIGHTING = {
  sun: { color: "#e9eef2", intensity: 1.6, azimuth: 200, elevation: 52 }, // weak directional sun, high + behind cloud
  hemisphere: { skyColor: "#e4ecf0", intensity: 1.35 }, // the sky dome dominates (overcast) — brightest of the three slices
  fog: { color: "#dfe8ec", near: 48, far: 220 }, // palest, nearest fog — the whiteout veil
};
function causewayWater() {
  // A near-frozen, opaque, low-saturation sheet on the basin floor.
  return createWaterConfig({ shallowColor: "#cdd9de", deepColor: "#2a4350", flowSpeed: 0.12, foamBand: 0.8, fresnel: 0.3, opacity: 0.92 });
}
function causewayAtmosphere() {
  // The whiteout gathers in the low basin where the seal sits.
  return createAtmosphereConfig({ basinFogBoost: 0.7, mistStrength: 0.5, mistBand: 22 });
}

export function buildFrostCausewayV1() {
  const doc = createWorldDocument({ metadata: { name: "The Frost Causeway" }, terrain: { seed: CAUSEWAY_SEED } });
  const { spawn, relic, cache, crossing, dir, perp } = frostCausewayLayout();

  // --- Per-scene readability (this document only — global default + frozen slices stay byte-stable) -
  doc.lighting = mergeGlacialLighting(WHITEOUT_LIGHTING);
  doc.water = causewayWater();
  doc.atmosphere = causewayAtmosphere();

  // --- This scene's completion identity (the generic slice wrapper reads it) -----------------------
  doc.slice = sliceIdentity({
    title: "The Frost Causeway",
    arrivalTagline: "Bear the relic across the causeway to the basin seal",
    completeBody: "The relic is sealed on the basin floor; the causeway stands empty in the white.",
  });

  const objects = [];
  const gateYaw = Math.atan2(dir.x, dir.z);
  const along = (t) => ({ x: spawn.x + (cache.x - spawn.x) * t, z: spawn.z + (cache.z - spawn.z) * t });

  // --- Broken ridge at the spawn (the opening) — toppled ridge blocks descending toward the causeway -
  for (let i = 0; i < 4; i++) {
    const step = offset(along(0.04 + i * 0.05), perp, i % 2 === 0 ? 2.2 : -2.2);
    objects.push(groundedPrimitive(`fc-ridge-${i}`, `Broken Ridge ${i}`, "cube", step, { x: 1.8, y: 1.3 - i * 0.22, z: 1.2 }, { rotationY: gateYaw + (i - 1.5) * 0.12 }));
  }

  // --- Opening orientation sign at the broken ridge (data-only interaction) -------------------------
  // Read at the head of the ridge: it frames the WHOLE loop (climb to the relic on the crown → bear it down
  // across the causeway → seal it on the basin floor) AND the non-lethal recovery rule.
  const orientationSign = offset(spawn, perp, 3.0, { x: dir.x * 1.2, z: dir.z * 1.2 });
  objects.push(
    groundedPrimitive("fc-orientation-sign", "Causeway Ridge Marker", "cube", orientationSign, { x: 0.5, y: 1.8, z: 0.5 }, {
      rotationY: gateYaw,
      interaction: { role: "sign", text: "The broken ridge above the frost causeway. A relic waits on the crown above — bear it down across the causeway to the basin seal on the valley floor. The wards will shove you back but cannot fell you: fall back, gather yourself, then seal it.", showRadius: 9 },
    })
  );

  // --- Ruin marking the relic (up the ridge crown, off the carry centerline) ------------------------
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const p = { x: relic.x + Math.cos(a) * 1.8, z: relic.z + Math.sin(a) * 1.8 };
    objects.push(groundedPrimitive(`fc-relic-stone-${i}`, `Relic Crown Stone ${i}`, "cube", p, { x: 1.1, y: 0.9 + i * 0.3, z: 1.1 }, { rotationY: a }));
  }
  // The relic ice shard catches the eye — an additive spark emitter marks it as the goal on the crown.
  objects.push(groundedPrimitive("fc-relic-shard", "Relic Ice Shard", "cylinder", relic, { x: 0.7, y: 3.4, z: 0.7 }, { colliderType: "cylinder", particles: { kind: "spark", rate: 22, max: 90, color: "#dbeeff", colorEnd: "#5ab4ff", size: 0.18, speed: 2.0, gravity: -1.0 } }));

  // --- Optional side reliquary off the route (an optional discovery + the reward) --------------------
  // ~9 m off the route on the relic side (within the route band, clear of the carry centerline). A reliquary
  // STRUCTURE (exploration), a readable SIGN, a brooding fog POCKET, and an optional generated weapon to claim
  // (authored below in doc.runtimeAssets). All data-only — surfaced in play by the existing runtimes.
  const shrine = offset(relic, perp, 9);
  const shrineYaw = Math.atan2(relic.x - shrine.x, relic.z - shrine.z);
  objects.push(groundedPrimitive("fc-reliquary-base", "Reliquary Base", "cube", shrine, { x: 2.4, y: 0.6, z: 2.0 }, { rotationY: shrineYaw }));
  objects.push(
    groundedPrimitive("fc-reliquary-idol", "Reliquary Idol", "cylinder", shrine, { x: 0.7, y: 2.8, z: 0.7 }, {
      colliderType: "cylinder",
      rotationY: shrineYaw,
      particles: { kind: "smoke", rate: 8, max: 100, lifetime: 4.2, size: 1.0, sizeEnd: 2.8, color: "#aebccd", colorEnd: "#5a6a7d", speed: 0.7, spread: 0.6, gravity: 0.3, emitRadius: 0.3, opacity: 0.4 },
      interaction: { role: "sign", text: "A frost reliquary kneels beside the ruin — its offering still here for the taking. Bear the relic on: down the causeway, the basin seal waits on the valley floor.", showRadius: 7 },
    })
  );
  objects.push(groundedPrimitive("fc-reliquary-ward-l", "Reliquary Ward L", "cube", offset(shrine, perp, 0, { x: dir.x * 1.6, z: dir.z * 1.6 }), { x: 0.6, y: 1.6, z: 0.6 }, { rotationY: shrineYaw }));
  objects.push(groundedPrimitive("fc-reliquary-ward-r", "Reliquary Ward R", "cube", offset(shrine, perp, 0, { x: -dir.x * 1.6, z: -dir.z * 1.6 }), { x: 0.6, y: 1.6, z: 0.6 }, { rotationY: shrineYaw }));

  // --- Threat-teaching sign before the causeway patrol (data-only interaction) ----------------------
  // Placed before the first combat beat so the player learns the wards' rule up front: the warding pulse is
  // NON-LETHAL (it shoves you back, it cannot fell you), how to recover, and how to press on.
  const threatSign = offset(along(0.42), perp, 4);
  objects.push(
    groundedPrimitive("fc-threat-sign", "Ward Warning Sign", "cube", threatSign, { x: 0.5, y: 1.8, z: 0.5 }, {
      rotationY: gateYaw,
      interaction: { role: "sign", text: "The causeway's wards bristle as you cross — a warding pulse will shove you back, but it cannot fell you. Fall back to gather yourself, then break through: the seal waits below.", showRadius: 8 },
    })
  );

  // --- The causeway proper: low parapet slabs + posts flank the mid-route crossing (the patrol beat) -
  // Flanked perpendicular (≥2.5 m off the carry centerline midpoint, which sits AT the crossing) so the road
  // reads as a built crossing without blocking the path.
  objects.push(groundedPrimitive("fc-causeway-parapet-l", "Causeway Parapet L", "cube", offset(crossing, perp, 3.2), { x: 1.0, y: 1.0, z: 4.2 }, { rotationY: gateYaw }));
  objects.push(groundedPrimitive("fc-causeway-parapet-r", "Causeway Parapet R", "cube", offset(crossing, perp, -3.2), { x: 1.0, y: 1.0, z: 4.2 }, { rotationY: gateYaw }));
  objects.push(groundedPrimitive("fc-causeway-post-l", "Causeway Post L", "cylinder", offset(crossing, perp, 3.6, { x: dir.x * 2.4, z: dir.z * 2.4 }), { x: 0.5, y: 2.8, z: 0.5 }, { colliderType: "cylinder", particles: { kind: "dust", rate: 10, max: 70, color: "#dbe6ec", size: 0.6, speed: 0.5, gravity: -0.15 } }));
  objects.push(groundedPrimitive("fc-causeway-post-r", "Causeway Post R", "cylinder", offset(crossing, perp, -3.6, { x: -dir.x * 2.4, z: -dir.z * 2.4 }), { x: 0.5, y: 2.8, z: 0.5 }, { colliderType: "cylinder" }));

  // --- The basin seal at the cache (ice pillars flank the seal; a primitive seal stone holds the spot) -
  objects.push(groundedPrimitive("fc-seal-pillar-l", "Basin Pillar L", "cylinder", offset(cache, perp, 3.0), { x: 0.9, y: 4.6, z: 0.9 }, { colliderType: "cylinder" }));
  objects.push(groundedPrimitive("fc-seal-pillar-r", "Basin Pillar R", "cylinder", offset(cache, perp, -3.0), { x: 0.9, y: 4.6, z: 0.9 }, { colliderType: "cylinder" }));
  // The seal pedestal glows — an additive spark emitter stages the destination (cold blue, the basin's colour).
  objects.push(groundedPrimitive("fc-seal-pedestal", "Basin Seal Pedestal", "cylinder", cache, { x: 1.6, y: 1.2, z: 1.6 }, { colliderType: "cylinder", particles: { kind: "spark", rate: 18, max: 80, color: "#cfe9ff", colorEnd: "#4aa6ff", size: 0.16, speed: 1.6, gravity: -0.7 } }));
  // The basin seal itself — a primitive stone (self-contained; NO GLB dependency), set on the pedestal top.
  const sealTop = getHeight(cache.x, cache.z) + 1.2;
  objects.push(groundedPrimitive("fc-seal-stone", "Basin Seal Stone", "cube", cache, { x: 1.0, y: 1.0, z: 1.0 }, { absoluteY: sealTop + 0.5, rotationY: gateYaw + 0.4 }));

  doc.objects = objects;

  // --- The reliquary's optional reward — a generated weapon REBUILT from a recipe on load ------------
  // A deterministic exotic relic offered on the reliquary (NOT the objective relic — a separate id the player
  // may claim or ignore with F). PlacedWeaponRuntime.load() instantiates it from the recipe (never baked).
  doc.runtimeAssets = {
    version: 1,
    items: [
      generatedWeaponReward({ id: "fc-reliquary-relic-weapon", seed: "fc-reliquary-relic", type: "exotic", position: shrine, rotationY: shrineYaw }),
    ],
  };

  // --- A beacon-trail along the spawn → relic → crossing → cache descent (route readability) ---------
  // Essential in the whiteout: the trail is what the player navigates by when the far causeway fades to white.
  doc.authoring = beaconTrail({
    prefix: "fc",
    splineName: "Causeway Route",
    maskName: "Causeway Area",
    modName: "Causeway Beacons",
    points: [
      { x: spawn.x, y: 0, z: spawn.z },
      { x: relic.x, y: 0, z: relic.z },
      { x: crossing.x, y: 0, z: crossing.z },
      { x: cache.x, y: 0, z: cache.z },
    ],
    center: { x: crossing.x, y: 0, z: crossing.z },
    radius: routeRadius(spawn, cache),
  });

  // --- Three authored combat beats — a moving causeway patrol + a mixed cache fight (sentinel + wisp) -
  // Beat 1: a MOVING glacial_sentinel patrol at the causeway (walks a short line across the route; "halt"
  // telegraphs when the player crosses). Beats 2+3: a MIXED cache fight — a stationary glacial_sentinel guarding
  // the cache mouth + a frost_wisp guardian hovering at the seal (Content-3 authored adjacency: two co-located
  // single-enemy beats, NOT a wave). Each is ONE enemy, completing + persisting INDEPENDENTLY.
  const causewayPatrolPoint = (side) => {
    const q = offset(crossing, perp, side);
    return { x: q.x, y: getHeight(q.x, q.z), z: q.z };
  };
  const cacheMouth = offset(cache, perp, 0, { x: -dir.x * 4, z: -dir.z * 4 }); // toward the crossing — guards the approach
  const sealWisp = offset(cache, perp, 3);
  doc.encounters = {
    version: 1,
    items: [
      encounterBeat({
        id: "fc-causeway-sentinel",
        position: { x: crossing.x, y: getHeight(crossing.x, crossing.z), z: crossing.z },
        radius: 8,
        enemyType: SENTINEL_TYPE,
        label: "the causeway",
        patrol: {
          enabled: true,
          points: [causewayPatrolPoint(3), causewayPatrolPoint(-3)],
          speed: 0.8,
          pauseSec: 1.0,
          loop: false,
          alert: "halt",
        },
      }),
      encounterBeat({
        id: "fc-cache-sentinel",
        position: { x: cacheMouth.x, y: getHeight(cacheMouth.x, cacheMouth.z), z: cacheMouth.z },
        radius: 7,
        enemyType: SENTINEL_TYPE,
        label: "the cache mouth",
      }),
      encounterBeat({
        id: "fc-cache-wisp",
        position: { x: sealWisp.x, y: getHeight(sealWisp.x, sealWisp.z), z: sealWisp.z },
        radius: 6,
        enemyType: WISP_TYPE,
        label: "the seal",
      }),
    ],
  };

  // The relic find→carry→seal loop is the runtime's automatic objective — author NO objectives block.
  // Spawn at the broken ridge, facing the descent; third-person so the framed composition reads.
  doc.player.spawn = { x: spawn.x, y: getHeight(spawn.x, spawn.z), z: spawn.z };
  doc.player.cameraMode = "third";

  return doc;
}
