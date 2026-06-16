#!/usr/bin/env node
// qa:layout — Settlement Layout QA gate (Stage 18C).
//
// A pure-Node, deterministic gate that judges whether a generated settlement has
// READABLE STRUCTURE, not just valid objects: a center, a visible landmark, clear
// spawn, no overlapping buildings, no paths through buildings, connected anchors,
// and valid data-only markers. It builds the same scene graph the runtime builds
// (new THREE.Scene → WorldObjectManager → loadWorldObjects works headless; THREE
// geometry/material construct without a GL context) and REUSES the canonical
// validatePlacement + THREE.Box3 — no bespoke footprint math.
//
// Classification is read from each object's declarative `layoutRole` (set by the
// emitters, sanitized on load), never from display names. House style mirrors
// scripts/threejs-skill-gates.mjs: PASS/WARN/FAIL rows, a summary line, exit 1 on
// any FAIL.

import * as THREE from "three";
import { createWorldDocument } from "../src/world/WorldDocument.js";
import { validateWorldDocument } from "../src/world/WorldValidation.js";
import { WorldObjectManager } from "../src/world/WorldObjectManager.js";
import { validatePlacement } from "../src/generators/PlacementValidator.js";
import { generateGeneratorObjects } from "../src/generators/GeneratorRegistry.js";
import {
  createCityConfig,
  createCampConfig,
  createPlazaConfig,
  createConnectorConfig,
  GENERATOR_LIMITS,
} from "../src/generators/GeneratorConfig.js";

// --- thresholds (conservative; documented in docs/SETTLEMENT_LAYOUT_STANDARD.md) ----
const CLEARANCE_R = 2.5; // no solid footprint may sit within this XZ radius of a spawn
const SIGHT_D = 260; // a landmark must exist within this XZ distance of the spawn
const CENTER_R = 12; // a cluster needs a focal object (landmark/path) within this of its origin
const ANCHOR_REACH = 30; // a connector endpoint must land within this of an anchor origin to "connect" it
const PATH_OVERLAP_TOL = 0.15; // fraction of a building's XZ footprint a path may clip before it's "through"

const results = [];
const pass = (name, detail = "") => results.push({ level: "PASS", name, detail });
const warn = (name, detail = "") => results.push({ level: "WARN", name, detail });
const fail = (name, detail = "") => results.push({ level: "FAIL", name, detail });

// --- geometry over the built scene (reuses THREE.Box3, like validatePlacement) ------
function collectBoxes(manager) {
  const out = [];
  for (const obj of manager.objects.values()) {
    obj.updateWorldMatrix?.(true, true);
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) continue;
    out.push({
      id: obj.userData.objectId ?? null,
      name: obj.name,
      role: obj.userData.layoutRole ?? null,
      generatorId: obj.userData.generatorId ?? null,
      solid: (obj.userData.collider?.type ?? "none") !== "none",
      pos: { x: obj.position.x, z: obj.position.z },
      box,
    });
  }
  return out;
}

const xz = (b) => ({ minX: b.box.min.x, maxX: b.box.max.x, minZ: b.box.min.z, maxZ: b.box.max.z });
const xzArea = (r) => Math.max(0, r.maxX - r.minX) * Math.max(0, r.maxZ - r.minZ);

function xzOverlapArea(a, b) {
  const ra = xz(a);
  const rb = xz(b);
  const w = Math.min(ra.maxX, rb.maxX) - Math.max(ra.minX, rb.minX);
  const d = Math.min(ra.maxZ, rb.maxZ) - Math.max(ra.minZ, rb.minZ);
  return w > 0 && d > 0 ? w * d : 0;
}

// Does the XZ segment p→q intersect an axis-aligned rectangle (slab method)?
function segmentHitsRect(p, q, r) {
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dz = q.z - p.z;
  for (const [o, d, lo, hi] of [
    [p.x, dx, r.minX, r.maxX],
    [p.z, dz, r.minZ, r.maxZ],
  ]) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return false; // parallel and outside the slab
    } else {
      let tA = (lo - o) / d;
      let tB = (hi - o) / d;
      if (tA > tB) [tA, tB] = [tB, tA];
      t0 = Math.max(t0, tA);
      t1 = Math.min(t1, tB);
      if (t0 > t1) return false;
    }
  }
  return true;
}

const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// --- scene authoring (deterministic; fixed seeds) -----------------------------------
function instance(id, type, config) {
  return { id, type, config };
}

// A connected village: camp + plaza linked edge-to-edge by a connector, with a city
// to the east. Clusters are spaced so neither the connector nor city streets cross a
// building footprint — the layout a generator SHOULD produce.
function villageScene() {
  const camp = instance("gen-camp", "camp", createCampConfig({ seed: "v-camp", size: 4, origin: { x: -160, z: 0 } }));
  const plaza = instance("gen-plaza", "plaza", createPlazaConfig({ seed: "v-plaza", size: 4, origin: { x: -40, z: 0 } }));
  const city = instance("gen-city", "city", createCityConfig({ seed: "v-city", style: "town", blocks: 4, density: 0.6, origin: { x: 120, z: 0 } }));
  // Link the camp's east edge to the plaza's west edge — both at z=0, in open ground.
  const conn = instance(
    "gen-conn",
    "connector",
    createConnectorConfig({ seed: "v-conn", style: "straight", from: { x: -142, z: 0 }, to: { x: -56, z: 0 }, fromId: "gen-camp", toId: "gen-plaza" })
  );
  const instances = [camp, plaza, city, conn];
  const objects = instances.flatMap((i) => generateGeneratorObjects(i.type, i.config, i.id).objects);
  // Spawn at the camp's south entrance, facing the fire.
  const spawn = { x: -160, y: 1, z: -5.5 };
  return { name: "village", instances, objects, spawn, settlement: true, connected: true };
}

function singleScene(name, type, config, makeSpawn) {
  const inst = instance(`gen-${type}`, type, config);
  const { layout, objects } = generateGeneratorObjects(type, config, inst.id);
  return { name, instances: [inst], objects, spawn: makeSpawn(layout), settlement: true, connected: false };
}

const SCENES = [
  villageScene(),
  singleScene("camp", "camp", createCampConfig({ seed: "s-camp", size: 4, origin: { x: 0, z: 0 } }), (l) => ({ x: l.spawn.x, y: 1, z: l.spawn.z })),
  singleScene("plaza", "plaza", createPlazaConfig({ seed: "s-plaza", size: 4, origin: { x: 0, z: 0 } }), (l) => ({ x: l.spawn.x, y: 1, z: l.spawn.z })),
  // Standalone city: structural + landmark checks only (no spawn archetype yet).
  (() => {
    const inst = instance("gen-city", "city", createCityConfig({ seed: "s-city", style: "town", blocks: 4, density: 0.7, origin: { x: 0, z: 0 } }));
    const { objects } = generateGeneratorObjects("city", inst.config, inst.id);
    return { name: "city", instances: [inst], objects, spawn: null, settlement: false, connected: false };
  })(),
];

// --- per-scene checks ----------------------------------------------------------------
async function checkScene(scene) {
  const tag = scene.name;
  const raw = createWorldDocument({
    metadata: { name: `qa-${tag}` },
    generators: { instances: scene.instances },
    objects: scene.objects,
    // Only override player when the scene defines a spawn — passing player:undefined
    // would overwrite the document default.
    ...(scene.spawn ? { player: { spawn: scene.spawn } } : {}),
  });

  // 1. Round-trip: validation is idempotent (object count + roles preserved).
  const v1 = validateWorldDocument(raw).document;
  const v2 = validateWorldDocument(v1).document;
  if (v1.objects.length === scene.objects.length && v2.objects.length === v1.objects.length) {
    pass(`${tag}: round-trip`, `${v1.objects.length} objects stable`);
  } else {
    fail(`${tag}: round-trip`, `emitted ${scene.objects.length} → ${v1.objects.length} → ${v2.objects.length}`);
  }
  const rolesPreserved = v1.objects.every((o, i) => o.layoutRole === v2.objects[i].layoutRole);
  if (rolesPreserved) pass(`${tag}: layoutRole round-trip`);
  else fail(`${tag}: layoutRole round-trip`, "a layoutRole changed across re-validation");

  // 2. Object count under the hard cap.
  if (v1.objects.length <= GENERATOR_LIMITS.MAX_TOTAL_OBJECTS * scene.instances.length) {
    pass(`${tag}: object cap`, `${v1.objects.length} objects`);
  } else {
    fail(`${tag}: object cap`, `${v1.objects.length} objects`);
  }

  // Build the real scene graph headless and gather world boxes.
  const sceneGraph = new THREE.Scene();
  const manager = new WorldObjectManager(sceneGraph);
  await manager.loadWorldObjects(v1.objects);
  const boxes = collectBoxes(manager);
  const buildings = boxes.filter((b) => b.role === "building");
  const paths = boxes.filter((b) => b.role === "path");
  const landmarks = boxes.filter((b) => b.role === "landmark");
  const solids = boxes.filter((b) => b.solid);

  // 3 + 4. No bad overlaps / invalid placements (canonical validatePlacement).
  const placement = validatePlacement(manager.objects);
  if (placement.overlaps.length === 0) pass(`${tag}: no building overlaps`, `${placement.solids} solids checked`);
  else fail(`${tag}: no building overlaps`, placement.overlaps.slice(0, 3).map((o) => `${o.aName}×${o.bName} ${o.fraction}`).join("; "));
  if (placement.invalid.length === 0) pass(`${tag}: valid placements`);
  else fail(`${tag}: valid placements`, `${placement.invalid.length} invalid (${placement.invalid[0]?.reason})`);

  // 11. No path runs through a building footprint (beyond a small clip tolerance).
  let through = 0;
  let throughEx = "";
  for (const p of paths) {
    for (const b of buildings) {
      const ov = xzOverlapArea(p, b);
      if (ov > PATH_OVERLAP_TOL * xzArea(xz(b))) {
        through++;
        if (!throughEx) throughEx = `${p.name}×${b.name}`;
      }
    }
  }
  if (through === 0) pass(`${tag}: no path through building`, `${paths.length} path × ${buildings.length} building`);
  else fail(`${tag}: no path through building`, `${through} crossings (${throughEx})`);

  // Markers (data-only) are valid: each has a finite position + a recognised role.
  const markerObjs = v1.objects.filter((o) => o.layoutRole === "marker");
  const badMarkers = markerObjs.filter(
    (o) => !o.interaction || !["spawn", "sign", "trigger", "pickup", "door"].includes(o.interaction.role) ||
      !Number.isFinite(o.transform.position.x) || !Number.isFinite(o.transform.position.z)
  );
  if (badMarkers.length === 0) pass(`${tag}: markers valid`, `${markerObjs.length} markers`);
  else fail(`${tag}: markers valid`, `${badMarkers.length} invalid`);

  // Settlement-structure checks (skip for the bare city, which has no spawn archetype).
  // 7. At least one landmark.
  if (landmarks.length >= 1) pass(`${tag}: has landmark`, `${landmarks.length}`);
  else fail(`${tag}: has landmark`, "no object tagged layoutRole=landmark");

  // 8. Each origin-bearing instance has a center (focal landmark/path near its origin).
  const anchored = scene.instances.filter((i) => Number.isFinite(i.config?.origin?.x));
  const missingCenter = anchored.filter((i) => {
    const o = i.config.origin;
    return !boxes.some((b) => b.generatorId === i.id && (b.role === "landmark" || b.role === "path") && dist2D(b.pos, o) <= CENTER_R);
  });
  if (missingCenter.length === 0) pass(`${tag}: has center`, `${anchored.length} cluster(s)`);
  else fail(`${tag}: has center`, `no focal object near ${missingCenter.map((i) => i.id).join(", ")}`);

  if (scene.settlement && scene.spawn) {
    // 5. Spawn clearance: no solid footprint within CLEARANCE_R of the spawn.
    const crowding = solids.filter((b) => {
      const r = xz(b);
      const cx = Math.max(r.minX, Math.min(scene.spawn.x, r.maxX));
      const cz = Math.max(r.minZ, Math.min(scene.spawn.z, r.maxZ));
      return Math.hypot(cx - scene.spawn.x, cz - scene.spawn.z) < CLEARANCE_R;
    });
    if (crowding.length === 0) pass(`${tag}: spawn clearance`, `R=${CLEARANCE_R}`);
    else fail(`${tag}: spawn clearance`, `${crowding.length} solid(s) crowd spawn (${crowding[0].name})`);

    // 6. Spawn sees a landmark: nearest landmark within SIGHT_D, no building blocks the line.
    let nearest = null;
    let nd = Infinity;
    for (const lm of landmarks) {
      const d = dist2D(lm.pos, scene.spawn);
      if (d < nd) {
        nd = d;
        nearest = lm;
      }
    }
    if (nearest && nd <= SIGHT_D) {
      const blocked = buildings.find((b) => segmentHitsRect(scene.spawn, nearest.pos, xz(b)));
      if (!blocked) pass(`${tag}: spawn sees landmark`, `${nearest.name} @ ${nd.toFixed(0)}u`);
      else fail(`${tag}: spawn sees landmark`, `${blocked.name} blocks line to ${nearest.name}`);
    } else {
      fail(`${tag}: spawn sees landmark`, nearest ? `nearest landmark ${nd.toFixed(0)}u > ${SIGHT_D}` : "no landmark");
    }
  }

  // 9. Connected scene: a connector links two distinct anchors.
  if (scene.connected) {
    const anchors = anchored.map((i) => ({ id: i.id, o: i.config.origin }));
    const connectors = scene.instances.filter((i) => i.type === "connector");
    const linked = connectors.some((c) => {
      const a = anchors.find((x) => dist2D(c.config.from, x.o) <= ANCHOR_REACH);
      const b = anchors.find((x) => dist2D(c.config.to, x.o) <= ANCHOR_REACH);
      return a && b && a.id !== b.id;
    });
    if (linked) pass(`${tag}: connects anchors`, `${anchors.length} anchors, ${connectors.length} connector(s)`);
    else fail(`${tag}: connects anchors`, "no connector links two distinct cluster origins");
  }
}

// --- run -----------------------------------------------------------------------------
for (const scene of SCENES) {
  try {
    await checkScene(scene);
  } catch (err) {
    fail(`${scene.name}: threw`, String(err?.stack ?? err).split("\n").slice(0, 2).join(" "));
  }
}

const order = { FAIL: 0, WARN: 1, PASS: 2 };
const grouped = [...results].sort((a, b) => order[a.level] - order[b.level] || a.name.localeCompare(b.name));
for (const r of grouped) {
  const suffix = r.detail ? ` - ${r.detail}` : "";
  console.log(`${r.level.padEnd(4)} ${r.name}${suffix}`);
}

const fails = results.filter((r) => r.level === "FAIL").length;
const warns = results.filter((r) => r.level === "WARN").length;
const passes = results.filter((r) => r.level === "PASS").length;
console.log(`\nsummary: ${passes} pass, ${warns} warn, ${fails} fail`);

if (fails > 0) process.exit(1);
