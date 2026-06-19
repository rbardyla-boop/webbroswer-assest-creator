// Entry point. Wires the core scene, terrain, streaming grass, player, cameras,
// debug HUD, and the world editor into a single update/render loop.

import * as THREE from "three";

import { createRenderer, getReverseDepthStatus } from "./core/renderer.js";
import { VisibilityKernel } from "./visibility/VisibilityKernel.js";
import { InstancedWorldObjectRenderer } from "./generators/InstancedWorldObjectRenderer.js";
import { createScene } from "./core/scene.js";
import { createCamera, resizeCamera } from "./core/camera.js";
import { createLights } from "./core/lights.js";
import { Input } from "./core/input.js";

import { findGoodSpawn, getHeight, getWaterLevel, getActiveTerrainProfile } from "./terrain/terrainSampling.js";

import { ColliderSystem } from "./physics/ColliderSystem.js";

import { Player } from "./player/Player.js";
import { PlayerController } from "./player/PlayerController.js";
import { PlayerCameraController } from "./player/PlayerCameraController.js";

import { DebugPanel } from "./debug/DebugPanel.js";
import { BudgetHUD } from "./debug/BudgetHUD.js";
import { createWorldDocument } from "./world/WorldDocument.js";
import { WorldRuntimeLoader } from "./world/WorldRuntimeLoader.js";
import { WorldSerializer } from "./world/WorldSerializer.js";
import { AssetLibrary } from "./assets/AssetLibrary.js";
import { PrefabLibrary } from "./prefabs/PrefabLibrary.js";
import { getSampleWorld } from "./world/samples/index.js";
import { createAssetLibraryFromWorldPack } from "./export/PlayableBuildExport.js";
import { ModRegistry } from "./mods/ModRegistry.js";
import { AnimationRuntime } from "./animation/AnimationRuntime.js";
import { InteractionRuntime } from "./interaction/InteractionRuntime.js";
import { InteractionOverlay } from "./interaction/InteractionOverlay.js";
import { ParticleRuntime } from "./particles/ParticleRuntime.js";
import { PlacedWeaponRuntime } from "./world/placement/PlacedWeaponRuntime.js";
import { WeaponEquipRuntime } from "./world/placement/WeaponEquipRuntime.js";
import { WeaponCarryRuntime } from "./world/placement/WeaponCarryRuntime.js";
import { PlacedAssetStore } from "./world/assets/PlacedAssetStore.js";
import { placeWeapon, autoPlacementPoint } from "./world/placement/WeaponPlacementTool.js";
import { WEAPON_PRESETS } from "./arsenal/WeaponPresets.js";
import { rollConfig } from "./arsenal/WeaponConfig.js";
import { generateWeaponRecipe } from "./arsenal/WeaponGrammar.js";
import { ObjectiveRuntime } from "./world/objectives/ObjectiveRuntime.js";
import { RELIC_ID } from "./world/objectives/RelicWeaponObjective.js";
import { FrozenCacheSlice, TUTORIAL_WEAPON_ID } from "./world/slice/FrozenCacheSlice.js";

const container = document.getElementById("app");
const loaderEl = document.getElementById("loader");
const crosshairEl = document.getElementById("crosshair");
const objectiveBannerEl = document.getElementById("objective-banner");
const toolbarEl = document.getElementById("toolbar");
const hintEl = document.getElementById("hint");
const urlParams = new URLSearchParams(window.location.search);
const runtimeMode = urlParams.has("runtime") || urlParams.has("play");
const worldParam = urlParams.get("world"); // e.g. ?world=vertical-slice-v1
const worldpackParam = urlParams.get("worldpack"); // url of an exported .worldpack.json
const modParam = urlParams.get("mod"); // id of an installed mod package to play

window.__WORLD_READY__ = false;
window.__WORLD_MODE__ = runtimeMode ? "runtime" : "editor";
document.body.dataset.worldReady = "false";
document.body.dataset.worldMode = window.__WORLD_MODE__;

// --- core --------------------------------------------------------------------

const renderer = createRenderer(container);
// Reverse-Z status resolves at construction and never changes — read it once.
const reverseDepthStatus = getReverseDepthStatus(renderer);
const scene = createScene({ fogNear: 70, fogFar: 225 });
const camera = createCamera();
const lights = createLights(scene);
const input = new Input(renderer.domElement);
const worldSerializer = new WorldSerializer();
let assetLibrary = null;

// --- world -------------------------------------------------------------------

const colliders = new ColliderSystem();
colliders.attachScene(scene);

let worldLoader = null;
// Runtime-only: drives THREE.AnimationMixer playback for rigged assets. Absent in
// the editor so authoring never auto-plays gameplay animation.
const animationRuntime = runtimeMode ? new AnimationRuntime() : null;
// Debug-safe observability hook (dev/test builds only — stripped from production
// playable exports so it is never exposed to end users): inspect live mixers.
if (animationRuntime && import.meta.env.DEV) window.__ANIM_RUNTIME__ = animationRuntime;
let world = null;
let terrain = null;
let water = null;
let atmosphere = null;
let wildlife = null;
let ambient = null;
let grass = null;
let trees = null;
let bushes = null;
let objectManager = null;
// Scratch for the camera's world position (atmosphere fog modulation, runtime only).
const _atmoCamPos = new THREE.Vector3();

const player = new Player();
scene.add(player.mesh);

const cameraController = new PlayerCameraController(camera, player, input, { toggleKey: "KeyV" });
const playerController = new PlayerController(player, input, cameraController, colliders);

// Runtime-only: data-driven interaction engine (triggers/doors/signs/pickups/
// spawns) + its sign overlay. Absent in the editor so authoring never fires
// gameplay. Loaded from the world's objects after the world is built.
const interactionOverlay = runtimeMode ? new InteractionOverlay() : null;
const interactionRuntime = runtimeMode
  ? new InteractionRuntime({ player, onMessage: (message) => interactionOverlay?.setMessage(message) })
  : null;
// Dev/test-only hook (stripped from production builds): drive/inspect interactions.
if (interactionRuntime && import.meta.env.DEV) window.__INTERACTION_RUNTIME__ = interactionRuntime;
// Runtime-only: data-driven particle/smoke emitters. Loaded from the world's
// objects after the world is built.
const particleRuntime = runtimeMode ? new ParticleRuntime({ scene }) : null;
// Placed generated weapons (Arsenal v2) — rebuilt from recipes on load; present in BOTH
// editor and runtime so authored weapons are visible while building and while playing.
const placedWeaponRuntime = new PlacedWeaponRuntime();
// Equip-to-hand (Arsenal v3) — reparents a placed weapon onto the player at its `equip`
// marker. Needs the per-load store (set in loadRuntimeAssets) + the player (runtime only).
const weaponEquipRuntime = new WeaponEquipRuntime(placedWeaponRuntime, { scene });
// Multiple carried weapons + holster/draw (Arsenal v6) — the verb layer over the equip engine.
// rightHand is the drawn/active slot; back + hip are holstered. Owns no state of its own.
const weaponCarryRuntime = new WeaponCarryRuntime(weaponEquipRuntime);
let placedAssetStore = null; // the current PlacedAssetStore, recreated per world load
// First-playable objective (FP-1) — the relic retrieval loop. Runtime-only (it needs the
// player + the per-load store); persists across reloads (its load() clears prior markers).
const objectiveRuntime = runtimeMode ? new ObjectiveRuntime() : null;
const frozenCacheSlice = runtimeMode
  ? new FrozenCacheSlice({
      scene,
      player,
      objectiveRuntime,
      weaponCarryRuntime,
      weaponEquipRuntime,
      onRestart: () => {
        localStorage.removeItem(worldSerializer.storageKey);
        localStorage.removeItem("frozen-cache-tutorial-v1");
        window.location.href = "/?play=1";
      },
    })
  : null;
if (particleRuntime && import.meta.env.DEV) window.__PARTICLE_RUNTIME__ = particleRuntime;
// Runtime-only: guard-banded Visibility + Streaming Kernel (Stage 17A). Tiers
// registered agents (currently animated objects) so far/off-screen ones sleep
// their per-frame updates — without ever hiding a mesh, so shadows stay intact
// and nothing pops on a fast turn. Absent in the editor (authoring shows all).
const visibilityKernel = runtimeMode ? new VisibilityKernel() : null;
if (visibilityKernel && import.meta.env.DEV) window.__VISIBILITY_DEBUG__ = () => visibilityKernel.debugSnapshot();
// Runtime-only: batch repeated static primitive WorldObjects (e.g. a procedural
// city) into instanced draw calls (Stage 17C-2). A render VIEW over the objects —
// they stay in the manager (identity/collision intact); only their source mesh is
// hidden. The editor never instances, so editor selection/identity is untouched.
const instancedRenderer = runtimeMode ? new InstancedWorldObjectRenderer(scene) : null;
if (instancedRenderer && import.meta.env.DEV) window.__INSTANCING_DEBUG__ = () => instancedRenderer.stats;
// Dev/test-only: read the live applied lighting (sun/hemisphere/fog).
if (import.meta.env.DEV) {
  window.__LIGHTING_DEBUG__ = () => ({
    sunIntensity: lights.sun.intensity,
    sunColor: `#${lights.sun.color.getHexString()}`,
    castShadow: lights.sun.castShadow,
    hemiIntensity: lights.hemi.intensity,
    fog: scene.fog ? { color: `#${scene.fog.color.getHexString()}`, near: scene.fog.near, far: scene.fog.far } : null,
  });
  // Dev/test-only: read the live grass system (vegetation v2 state).
  window.__GRASS_DEBUG__ = () => {
    const u = grass?.grassMaterial?.material?.uniforms ?? {};
    return {
      visibleBlades: grass?.stats?.visibleBlades ?? 0,
      activePatches: grass?.stats?.activePatches ?? 0,
      clumpStrength: grass?.cfg?.clumpStrength ?? null,
      distanceTint: u.uDistanceTint?.value ?? null,
      fresnelIntensity: u.uFresnelIntensity?.value ?? null,
    };
  };
  // Dev/test-only: read the live bush system (Stage 14B).
  window.__BUSH_DEBUG__ = () => ({
    visibleBushes: bushes?.stats?.visibleBushes ?? 0,
    activePatches: bushes?.stats?.activePatches ?? 0,
    visiblePatches: bushes?.stats?.visiblePatches ?? 0,
    drawCalls: bushes?.stats?.drawCalls ?? 0,
    density: bushes?.cfg?.density ?? null,
    clumpStrength: bushes?.cfg?.clumpStrength ?? null,
    seed: bushes?.cfg?.seed ?? null,
  });
  // Dev/test-only: read the live renderer's reverse-Z depth status (Stage 15).
  window.__RENDER_DEBUG__ = () => getReverseDepthStatus(renderer);
  // Dev/test-only: live placed-object count (used by the procedural proof to
  // confirm generated city objects loaded + rendered in the runtime).
  window.__WORLD_DEBUG__ = () => ({ objects: objectManager?.objects.size ?? 0 });
  // Dev/test-only: placed generated weapons (Arsenal v2) — count + the first weapon's
  // marker map, for test:arsenal-world-proof.
  window.__ARSENAL_WORLD__ = () => placedWeaponRuntime.snapshot();
  // Dev/test-only: equip-to-hand + slot state (Arsenal v3/v4) — placed count, equipped id/type,
  // occupied slot, marker world positions, slot-matrix finiteness, persist mode. For the
  // arsenal v3/v4 proofs.
  window.__ARSENAL_EQUIP__ = () => weaponEquipRuntime.debugSnapshot();
  // Dev/test-only: deterministic drivers so the proof can place/equip/cycle slots without a
  // canvas raycast (the editor click path is the user-facing equivalent of `place`).
  window.__ARSENAL_EQUIP_DO__ = {
    place: ({ x = 0, z = 0 } = {}) => {
      if (!placedAssetStore) return null;
      const preset = WEAPON_PRESETS[0];
      const recipe = generateWeaponRecipe(rollConfig(preset.seed + placedWeaponRuntime.entries.size, preset.type));
      const descriptor = placeWeapon(placedAssetStore, recipe, { x, z, yaw: 0 });
      if (descriptor) placedWeaponRuntime.add(descriptor);
      return descriptor?.id ?? null;
    },
    equip: (id, slot) => weaponEquipRuntime.equip(id, player, slot),
    cycle: () => weaponEquipRuntime.cycleSlot(player),
    selectSlot: (slot) => (weaponEquipRuntime.equippedId ? weaponEquipRuntime.equip(weaponEquipRuntime.equippedId, player, slot) : false),
    unequip: (mode = "drop") => weaponEquipRuntime.unequip(player, mode),
    toggleNearest: (mode = "drop") => weaponEquipRuntime.toggleNearest(player, mode),
    setPersist: (on) => {
      weaponEquipRuntime.persistEquip = !!on;
      return weaponEquipRuntime.persistEquip;
    },
    // Hostile-input probe (FP-3): corrupt a placed weapon's equip marker so the proof can prove the
    // finite-guard refuses the equip without reparenting/orphaning. Returns false if the id is unknown.
    poisonEquipMarker: (id) => {
      const g = placedWeaponRuntime.getEntry(id)?.group;
      if (!g?.userData?.markers) return false;
      g.userData.markers.equip = [NaN, 0, 0];
      return true;
    },
    save: () => world?.document && (worldSerializer.save(world.document), true),
  };
  // Dev/test-only: Arsenal v6 carry verbs so the proof can carry multiple weapons + holster/draw
  // without a canvas raycast (the keyboard F/R/H/G/1-2-3 are the user-facing equivalents). For
  // test:arsenal-v6.
  window.__ARSENAL_CARRY_DO__ = {
    place: ({ x = 0, z = 0 } = {}) => {
      if (!placedAssetStore) return null;
      const preset = WEAPON_PRESETS[0];
      const recipe = generateWeaponRecipe(rollConfig(preset.seed + "-c" + placedWeaponRuntime.entries.size, preset.type));
      const descriptor = placeWeapon(placedAssetStore, recipe, { x, z, yaw: 0 });
      if (descriptor) placedWeaponRuntime.add(descriptor);
      return descriptor?.id ?? null;
    },
    equip: (id, slot) => weaponEquipRuntime.equip(id, player, slot),
    pickUp: () => weaponCarryRuntime.pickUp(player),
    drawSlot: (slot) => weaponCarryRuntime.drawSlot(slot, player),
    holsterOrDraw: () => weaponCarryRuntime.holsterOrDraw(player),
    cycle: () => weaponCarryRuntime.cycle(player),
    dropActive: () => weaponCarryRuntime.dropActive(player),
    storeActive: () => weaponCarryRuntime.storeActive(player),
    setPersist: (on) => {
      weaponEquipRuntime.persistEquip = !!on;
      return weaponEquipRuntime.persistEquip;
    },
    snapshot: () => weaponCarryRuntime.debugSnapshot(),
    save: () => world?.document && (worldSerializer.save(world.document), true),
  };
  // Dev/test-only: relic objective (FP-1) state + deterministic drivers (the proof equips/
  // teleports/deposits without physical movement). For test:first-objective-proof.
  window.__OBJECTIVE_DEBUG__ = () => objectiveRuntime?.debugSnapshot() ?? { present: false };
  window.__OBJECTIVE_DO__ = {
    relicId: () => objectiveRuntime?.entry?.relicId ?? null,
    equipRelic: (slot) => weaponEquipRuntime.equip(RELIC_ID, player, slot),
    teleportToCache: () => {
      const c = objectiveRuntime?.entry?.cache;
      if (!c) return false;
      player.position.set(c.x, getHeight(c.x, c.z) + 0.1, c.z);
      player.velocityY = 0;
      player.syncMesh();
      objectiveRuntime.update(0, player); // recompute inZone now (deterministic for the proof)
      return true;
    },
    deposit: () => objectiveRuntime?.tryDeposit(player) ?? false,
    save: () => world?.document && (worldSerializer.save(world.document), true),
  };
  window.__FROZEN_CACHE_DEBUG__ = () => frozenCacheSlice?.debugSnapshot() ?? { present: false };
  window.__FROZEN_CACHE_DO__ = {
    teleportTo: (id) => {
      const descriptor = placedAssetStore?.list().find((item) => item.id === id);
      const p = descriptor?.transform?.position;
      if (!p) return false;
      player.position.set(p.x, getHeight(p.x, p.z) + 0.1, p.z);
      player.velocityY = 0;
      player.syncMesh();
      objectiveRuntime?.update(0, player);
      frozenCacheSlice?.update(0);
      return true;
    },
    tutorialWeaponId: () => TUTORIAL_WEAPON_ID,
    relicId: () => RELIC_ID,
    teleportToCache: () => {
      const c = objectiveRuntime?.entry?.cache;
      if (!c) return false;
      player.position.set(c.x, getHeight(c.x, c.z) + 0.1, c.z);
      player.velocityY = 0;
      player.syncMesh();
      objectiveRuntime.update(0, player);
      frozenCacheSlice?.update(0);
      return true;
    },
    pickUp: () => {
      const result = weaponCarryRuntime.pickUp(player);
      frozenCacheSlice?.noteAction("F", result !== false);
      objectiveRuntime?.update(0, player);
      frozenCacheSlice?.update(0);
      return result;
    },
    cycle: () => {
      const result = weaponCarryRuntime.cycle(player);
      frozenCacheSlice?.noteAction("R", result);
      frozenCacheSlice?.update(0);
      return result;
    },
    holster: () => {
      const result = weaponCarryRuntime.holsterOrDraw(player);
      frozenCacheSlice?.noteAction("H", result);
      frozenCacheSlice?.update(0);
      return result;
    },
    deposit: () => {
      const result = objectiveRuntime?.tryDeposit(player) ?? false;
      frozenCacheSlice?.noteAction("G", result);
      objectiveRuntime?.update(0, player);
      frozenCacheSlice?.update(0);
      if (objectiveRuntime?.entry?.completed && world?.document) worldSerializer.save(world.document);
      return result;
    },
    save: () => world?.document && (worldSerializer.save(world.document), true),
  };
  // Dev/test-only: physical-movement driver so a proof can WALK the player through the world
  // (no teleport). It only injects input intent — camera yaw + held movement keys, exactly what a
  // real keyboard would — and `step` advances ONE fixed simulation tick using the SAME per-frame
  // update the main loop runs (camera → player movement/collision/grounding → objective zone). A
  // proof paces those steps deterministically, sidestepping headless rAF throttling while the player
  // still translates through the real movement pipeline. faceXZ is the inverse of PlayerController's
  // `_forward = (-sin yaw, 0, -cos yaw)` basis, so holding forward walks toward the target.
  // For test:first-playable-proof.
  window.__PLAYER_MOVE_DO__ = {
    faceXZ: (x, z) => {
      cameraController.yaw = Math.atan2(-(x - player.position.x), -(z - player.position.z));
      return cameraController.yaw;
    },
    hold: (forward, strafe) => {
      for (const k of ["KeyW", "KeyS", "KeyA", "KeyD"]) input.keys.delete(k);
      if (forward > 0) input.keys.add("KeyW");
      else if (forward < 0) input.keys.add("KeyS");
      if (strafe > 0) input.keys.add("KeyD");
      else if (strafe < 0) input.keys.add("KeyA");
      return true;
    },
    stop: () => {
      for (const k of ["KeyW", "KeyS", "KeyA", "KeyD"]) input.keys.delete(k);
      return true;
    },
    step: (dt = 1 / 60) => {
      cameraController.update(dt);
      playerController.update(dt);
      objectiveRuntime?.update(dt, player);
      return true;
    },
  };
  // Dev/test-only: live document + scene-graph counts a browser eval can't otherwise reach (both
  // are module-local). The reload-duplication probe asserts these stay exactly 1 across repeated
  // reloads (no leaked beacon/marker, no appended relic/objective). For test:first-playable-hidden-proof.
  window.__DOC_DEBUG__ = () => {
    const items = world?.document?.runtimeAssets?.items ?? [];
    const objectives = world?.document?.objectives?.items ?? [];
    let cacheBeacons = 0;
    let relicMarkers = 0;
    scene.traverse((n) => {
      if (n.name === "ObjectiveCacheBeacon") cacheBeacons++;
      else if (n.name === "ObjectiveRelicMarker") relicMarkers++;
    });
    return {
      objectives: objectives.length,
      runtimeAssets: items.length,
      relicWeapons: items.filter((i) => i.id === RELIC_ID).length,
      tutorialWeapons: items.filter((i) => i.id === TUTORIAL_WEAPON_ID).length,
      cacheBeacons,
      relicMarkers,
    };
  };
  // Dev/test-only: settlement layout snapshot (Stage 18C) for test:settlement-layout.
  // Scans the live objects once for their declarative layoutRole + interaction role —
  // the player's spawn position, landmark world positions (for a readability proxy),
  // per-role counts, and the active instanced-batch count. Read-only; no allocation in
  // the frame loop (called only by the proof).
  window.__LAYOUT_DEBUG__ = () => {
    const counts = { path: 0, building: 0, prop: 0, landmark: 0, marker: 0, vegetation: 0, edge: 0 };
    const markers = { spawn: 0, sign: 0, trigger: 0, pickup: 0, door: 0 };
    const landmarks = [];
    for (const o of objectManager?.objects.values() ?? []) {
      const role = o.userData.layoutRole;
      if (role && role in counts) counts[role]++;
      if (role === "landmark") landmarks.push({ id: o.userData.objectId ?? null, position: { x: o.position.x, y: o.position.y, z: o.position.z } });
      const ir = o.userData.interaction?.role;
      if (ir && ir in markers) markers[ir]++;
    }
    return {
      spawn: { x: player.position.x, y: player.position.y, z: player.position.z },
      landmarks,
      counts,
      markers,
      instancedBatches: instancedRenderer?.stats?.batches ?? 0,
    };
  };
  // Dev/test-only: performance instrumentation for the local-GPU validation report
  // (scripts/perf-report.mjs). snapshot() returns GPU-INDEPENDENT scene-complexity
  // metrics (draw calls, triangles, memory, object/instance/patch counts, heap) plus
  // the live WebGL renderer string. sample() times animation frames — under the
  // SwiftShader software rasterizer that is a CPU signal, NOT a GPU FPS measurement.
  window.__PERF__ = {
    snapshot() {
      const info = renderer.info;
      let gpu = "unknown";
      let vendor = "unknown";
      try {
        const gl = renderer.getContext();
        const ext = gl.getExtension("WEBGL_debug_renderer_info");
        if (ext) {
          gpu = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
          vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
        }
      } catch (_) {
        /* renderer string unavailable */
      }
      const heap = performance.memory
        ? {
            usedMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1),
            totalMB: +(performance.memory.totalJSHeapSize / 1048576).toFixed(1),
          }
        : null;
      return {
        renderer: { gpu, vendor },
        draw: { calls: info.render.calls, triangles: info.render.triangles, points: info.render.points, lines: info.render.lines },
        memory: { geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? null },
        heap,
        objects: objectManager?.objects.size ?? 0,
        instancing: instancedRenderer?.stats ?? null,
        grass: grass?.stats ? { visiblePatches: grass.stats.visiblePatches, activePatches: grass.stats.activePatches, visibleBlades: grass.stats.visibleBlades ?? null } : null,
        trees: trees?.stats ? { visiblePatches: trees.stats.visiblePatches, activePatches: trees.stats.activePatches, drawCalls: trees.stats.drawCalls ?? null } : null,
        bushes: bushes?.stats ? { visiblePatches: bushes.stats.visiblePatches, activePatches: bushes.stats.activePatches, drawCalls: bushes.stats.drawCalls ?? null } : null,
        visibility: visibilityKernel?.stats ?? null,
      };
    },
    // Time animation frames; `turn` forces a continuous camera pan to catch
    // worst-case streaming/visibility spikes. Stops at `frames` OR `maxMs` wall-clock
    // (so a very slow scene — e.g. dense grass under software raster — is still
    // bounded). softwareApproxFps is CPU-raster only, never a GPU FPS claim.
    async sample({ frames = 60, turn = false, turnRate = 0.04, maxMs = 8000 } = {}) {
      const times = [];
      let prev = performance.now();
      const start = prev;
      await new Promise((resolve) => {
        let i = 0;
        const tick = (now) => {
          times.push(now - prev);
          prev = now;
          if (turn) cameraController.yaw += turnRate;
          if (++i >= frames || now - start >= maxMs) {
            resolve();
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      if (times.length > 1) times.shift(); // drop the first interval (warm-up)
      const sorted = times.slice().sort((a, b) => a - b);
      const sum = times.reduce((a, b) => a + b, 0);
      const at = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))];
      return {
        frames: times.length,
        avgMs: +(sum / times.length).toFixed(2),
        medianMs: +at(0.5).toFixed(2),
        p95Ms: +at(0.95).toFixed(2),
        worstMs: +Math.max(...times).toFixed(2),
        softwareApproxFps: +(1000 / (sum / times.length)).toFixed(1),
      };
    },
  };
  // Dev/test-only: read the live terrain material v2 (Stage 14C). Reports the
  // upgrade uniforms + that fog/shadow stayed wired (the onBeforeCompile pass
  // only edits diffuseColor, never the lighting/fog/shadow chunks).
  window.__TERRAIN_DEBUG__ = () => {
    const mat = terrain?.mesh?.material;
    const u = terrain?._uniforms ?? {};
    return {
      hasUpgrade: typeof mat?.onBeforeCompile === "function",
      receiveShadow: terrain?.mesh?.receiveShadow ?? false,
      vertexColors: mat?.vertexColors ?? false,
      fog: mat?.fog ?? false, // MeshStandardMaterial.fog stays on → scene fog applies
      settings: terrain?.getMaterialSettings ? terrain.getMaterialSettings() : null,
      macroIntensity: u.uTerrainMacroIntensity?.value ?? null,
      slopeRock: u.uTerrainSlopeRock?.value ?? null,
    };
  };
  // Dev/test-only: Stage Visual-0 — the active terrain profile (identity), the
  // player's grounding against the SINGLE height source, and the snowline. Proves
  // the world loaded the profile and the player rests on the same field the mesh
  // and grass sample. Read-only; called by test:visual0.
  window.__VISUAL0_DEBUG__ = () => {
    const profile = getActiveTerrainProfile();
    const groundY = getHeight(player.position.x, player.position.z);
    return {
      profile: profile.id,
      snowlineY: profile.visual?.snowlineY ?? null,
      player: { x: player.position.x, y: player.position.y, z: player.position.z },
      groundY,
      groundDelta: Math.abs(player.position.y - groundY),
    };
  };
  // Dev/test-only: Stage Visual-1 — the glacial water surface + valley atmosphere.
  // Read-only; called by test:visual1 to prove water is present (alpine) / absent
  // (rolling), the player is not submerged, and the fog is modulating.
  window.__WATER_DEBUG__ = () => {
    if (!water) return { present: false, hasWater: getActiveTerrainProfile().hasWater };
    const geo = water.mesh.geometry;
    const aDepth = geo.getAttribute("aDepth");
    let submergedVerts = 0;
    for (let i = 0; i < aDepth.count; i++) if (aDepth.getX(i) > 0) submergedVerts++;
    const px = player.position.x;
    const pz = player.position.z;
    return {
      present: true,
      triangles: geo.index ? geo.index.count / 3 : aDepth.count / 3,
      submergedVerts,
      waterLevelAtPlayer: getWaterLevel(px, pz),
      playerSubmerged: player.position.y < getWaterLevel(px, pz),
    };
  };
  window.__ATMOSPHERE_DEBUG__ = () => ({
    present: !!atmosphere,
    fog: scene.fog ? { near: scene.fog.near, far: scene.fog.far, color: `#${scene.fog.color.getHexString()}` } : null,
  });
  window.__VISUAL1_DEBUG__ = () => ({
    profile: getActiveTerrainProfile().id,
    waterPresent: !!water,
    waterlineY: getActiveTerrainProfile().visual?.waterlineY ?? null,
    grassBlades: grass?.stats?.visibleBlades ?? 0,
    fogNear: scene.fog?.near ?? null,
  });
  // Dev/test-only: Stage Wildlife-0 — ambient animals + grounded-contract violations.
  // Read-only; called by test:wildlife0 to prove animals render, sit on the terrain
  // (not floating/submerged), and stay below the snowline.
  window.__WILDLIFE_DEBUG__ = () => wildlife?.debugSnapshot() ?? { present: false };
  // Dev/test-only: Stage Ambient-0 — streamed firefly motes + hover-contract violations.
  window.__AMBIENT_DEBUG__ = () => ambient?.debugSnapshot() ?? { present: false };
}

function handleWorldChanged(change = {}) {
  if (change.full) {
    grass.rebuildActivePatches();
    trees.rebuildActivePatches();
    bushes?.rebuildActivePatches();
    return;
  }
  for (const box of change.boxes ?? []) {
    grass.queueRebuildForBox(box);
    trees.queueRebuildForBox(box);
    bushes?.queueRebuildForBox(box);
  }
}
// Stable predicate (no per-frame allocation) the animation runtime consults.
function isAgentAwake(object3D) {
  return visibilityKernel ? visibilityKernel.isAwake(object3D) : true;
}

// Ground a spawn point on its support surface (collider top, else the terrain
// single source) so the player starts standing — never floating or buried, and a
// platform spawn doesn't pop on the first physics tick. Mirrors PlayerController.
function groundedSpawnY(spawn) {
  return colliders.getSupportHeight(spawn.x, spawn.z, spawn.y) ?? getHeight(spawn.x, spawn.z);
}

// Resolve a spawn to DRY, grounded ground. If the authored/default spawn (x,z) sits
// in open water — the default {0,0,0} lands in the glacial pool at the trough's
// lowest point — relocate to findGoodSpawn() (which rejects submerged candidates)
// instead of dropping the player into the water. Never floats: Y is the support
// surface of the resolved (x,z). No-op for any dry spawn (Visual-0 worlds, rolling).
function resolveSpawn(spawn) {
  let x = spawn.x;
  let z = spawn.z;
  if (getHeight(x, z) < getWaterLevel(x, z)) {
    const dry = findGoodSpawn();
    x = dry.x;
    z = dry.z;
  }
  return { x, y: groundedSpawnY({ x, z, y: spawn.y }), z };
}

// Register the world's animated objects with the visibility kernel so their per-
// frame mixer updates can sleep when far/off-screen. Runtime-only; the kernel
// never hides a mesh, so this is shadow- and pop-safe.
function syncVisibilityAgents(document) {
  if (!visibilityKernel) return;
  visibilityKernel.setConfig(document?.visibility);
  visibilityKernel.clear();
  for (const object3D of animationRuntime?.entries.keys() ?? []) {
    visibilityKernel.register({
      id: object3D.userData?.objectId ?? object3D.uuid,
      object3D,
      kind: "animation",
    });
  }
}

// Drain the Arsenal Lab handoff queue into the document (each weapon grounded near the
// spawn) and rebuild every persisted runtime-asset weapon from its recipe. Called AFTER
// syncVisibilityAgents so the weapons' kernel registrations survive the kernel's per-
// load clear. Built in both editor + runtime (placedWeaponRuntime is mode-agnostic).
function loadRuntimeAssets(document) {
  placedAssetStore = new PlacedAssetStore(document);
  const store = placedAssetStore;
  const spawn = document.player?.spawn ?? { x: 0, z: 0 };
  // Explicit grid index so a replace-by-id (same weapon re-sent) never reuses a slot.
  let drainIdx = store.list().length;
  const dropped = store.drainHandoffQueue((asset) => {
    const ok = !!placeWeapon(store, asset?.recipe, {
      ...autoPlacementPoint(spawn, drainIdx),
      id: asset?.id ?? null,
      runtime: asset?.runtime ?? null,
    });
    if (ok) drainIdx++;
    return ok;
  });
  placedWeaponRuntime.load(document, scene, visibilityKernel);
  // Equip runtime tracks the current store (descriptor access) and re-attaches any
  // persisted "equipped" weapon to the player (runtime only; transient mode → no-op).
  weaponEquipRuntime.setStore(store);
  if (runtimeMode && player) weaponEquipRuntime.load(player);
  if (dropped > 0) worldSerializer.save(document); // persist freshly-dropped weapons
}

// Load the FP-1 relic objective (runtime only). Spawns the relic + cache if absent (deriving sites
// from the now-grounded player), then persists that fresh world once. Called from BOTH the initial
// boot path and the editor world-reload path, after the player is grounded.
function loadObjective(document) {
  if (!runtimeMode || !objectiveRuntime || !player) return;
  const spawnedRelic = objectiveRuntime.load({ player, scene, placedAssetStore, placedWeaponRuntime, weaponEquipRuntime, document });
  const spawnedTutorial = frozenCacheSlice?.load({ document, placedAssetStore, placedWeaponRuntime }) ?? false;
  if (spawnedRelic || spawnedTutorial) worldSerializer.save(document);
}

async function applyLoadedWorld(document) {
  resetWorldReady();
  world = await worldLoader.load(document);
  for (const warning of world.warnings) console.warn(warning);
  terrain = world.terrain;
  water = world.water;
  atmosphere = world.atmosphere;
  wildlife = world.wildlife;
  ambient = world.ambient;
  grass = world.grass;
  trees = world.trees;
  bushes = world.bushes;
  objectManager = world.objectManager;
  objectManager.onChange = handleWorldChanged;
  // Re-index interactions + particle emitters for the new object graph (runtime
  // mode only; no-op in the editor) so neither references torn-down objects.
  interactionRuntime?.load(objectManager);
  particleRuntime?.load(objectManager);
  syncVisibilityAgents(world.document);
  loadRuntimeAssets(world.document);
  // Batch repeated static primitive objects into instanced draws (runtime only).
  instancedRenderer?.rebuild(objectManager.objects);

  const spawn = world.document.player.spawn;
  // Ground the player on the support surface at spawn (collider top, else the
  // terrain single source) so it never starts floating, buried, or underwater — and
  // so a spawn saved on a platform doesn't pop. Mirrors PlayerController grounding.
  const resolved = resolveSpawn(spawn);
  player.position.set(resolved.x, resolved.y, resolved.z);
  player.velocityY = 0;
  player.syncMesh();
  loadObjective(world.document); // relic objective (FP-1) — after grounding so sites derive from spawn
  setCameraMode(world.document.player.cameraMode);
  cameraController.update(0.016);
  grass.prewarm(camera, 80);
  bushes?.prewarm(camera, 200);
  wildlife?.prewarm(camera);
  ambient?.prewarm(camera);
  updateSun();
  editor?.setWorldContext({
    terrain,
    objectManager,
    treeSystem: trees,
    grassSystem: grass,
    bushSystem: bushes,
    getGrassStats: () => grass.stats,
    getTreeStats: () => trees.stats,
    placedAssetStore, // the store was recreated by loadRuntimeAssets above
    placedWeaponRuntime,
  });
}

function setCameraMode(mode) {
  cameraController.mode = mode === "first" ? "first" : "third";
  player.mesh.visible = cameraController.mode !== "first";
  cameraController._initialized = false;
}

// --- ui ----------------------------------------------------------------------

const debug = new DebugPanel({ visible: !runtimeMode });
// Live performance budget HUD (Stage 20A) — DEV-only authoring aid (stripped from
// production builds). Collects already-computed counters into a reused scratch on a
// throttle; surfaces red/yellow/green budget status while building a world.
const budgetHUD = import.meta.env.DEV
  ? new BudgetHUD({
      visible: !runtimeMode, // shown by default while authoring; toggle with KeyB in runtime
      collect: (m) => {
        const r = renderer.info.render;
        m.drawCalls = r.calls;
        m.triangles = r.triangles;
        m.generatedObjects = countGeneratedObjects(objectManager);
        m.instancedBatches = instancedRenderer?.stats?.batches ?? 0;
        m.visibleVegetationPatches =
          (grass?.stats?.visiblePatches ?? 0) + (trees?.stats?.visiblePatches ?? 0) + (bushes?.stats?.visiblePatches ?? 0);
        m.heapMB = performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null;
        m.rigs = animationRuntime?.count ?? 0;
      },
    })
  : null;
if (budgetHUD) window.__BUDGET__ = () => budgetHUD.snapshot();

// Count placed objects emitted by a generator (they carry a generatorId) — the
// budget's "generated objects" metric. Runs at the HUD's throttle, not per frame.
function countGeneratedObjects(manager) {
  if (!manager) return 0;
  let n = 0;
  for (const object of manager.objects.values()) {
    if (object.userData.generatorId) n++;
  }
  return n;
}
let editor = null;

async function boot() {
  assetLibrary = await new AssetLibrary().init();

  // Priority: ?mod= installed mod → ?worldpack= export → ?world= sample →
  // saved world → empty default. A worldpack carries its own embedded assets, so
  // it brings its own runtime asset library (no IndexedDB needed); a mod's assets
  // were imported into the local library on install, so it uses the global one.
  let initialDoc = null;
  let runtimeAssetLibrary = assetLibrary;
  if (modParam) {
    try {
      const registry = await new ModRegistry().init();
      const modWorld = registry.getModWorld(modParam);
      if (modWorld?.document) initialDoc = modWorld.document;
      else console.warn(`Mod "${modParam}" is not installed or has no loadable world.`);
    } catch (error) {
      console.error("Failed to load mod world; falling back.", error);
    }
  }
  if (!initialDoc && worldpackParam) {
    try {
      // Only fetch a same-origin worldpack — never an attacker-supplied remote URL.
      const packUrl = new URL(worldpackParam, window.location.href);
      if (packUrl.origin !== window.location.origin) throw new Error("worldpack must be same-origin");
      const response = await fetch(packUrl);
      if (!response.ok) throw new Error(`worldpack fetch failed: HTTP ${response.status}`);
      const pack = await response.json();
      const loaded = await createAssetLibraryFromWorldPack(pack);
      if (loaded.document) {
        initialDoc = loaded.document;
        runtimeAssetLibrary = loaded.assetLibrary;
      }
    } catch (error) {
      console.error("Failed to load worldpack; falling back to the default world.", error);
    }
  }
  if (!initialDoc) initialDoc = worldParam ? getSampleWorld(worldParam) : null;
  if (!initialDoc) {
    const savedWorld = worldSerializer.load();
    initialDoc = savedWorld?.document ?? createWorldDocument();
  }

  worldLoader = new WorldRuntimeLoader({
    scene,
    lights,
    fog: scene.fog,
    colliderSystem: colliders,
    assetLibrary: runtimeAssetLibrary,
    animationRuntime,
  });
  world = await worldLoader.load(initialDoc);
  for (const warning of world.warnings) console.warn(warning);
  terrain = world.terrain;
  water = world.water;
  atmosphere = world.atmosphere;
  wildlife = world.wildlife;
  ambient = world.ambient;
  grass = world.grass;
  trees = world.trees;
  bushes = world.bushes;
  objectManager = world.objectManager;
  objectManager.onChange = handleWorldChanged;
  // Index this world's interactive objects + particle emitters (runtime only).
  interactionRuntime?.load(objectManager);
  particleRuntime?.load(objectManager);
  syncVisibilityAgents(world.document);
  loadRuntimeAssets(world.document);
  // Batch repeated static primitive objects into instanced draws (runtime only).
  instancedRenderer?.rebuild(objectManager.objects);

  // Start on open, fairly flat ground with a vista across the field — grounded on
  // the support surface so the player never spawns floating, buried, or underwater.
  const spawn = world.document.player.spawn ?? findGoodSpawn();
  const resolved = resolveSpawn(spawn);
  player.position.set(resolved.x, resolved.y, resolved.z);
  player.syncMesh();
  loadObjective(world.document); // relic objective (FP-1) — after grounding so sites derive from spawn
  setCameraMode(world.document.player.cameraMode);

  if (runtimeMode) {
    toolbarEl.style.display = "none";
    hintEl.style.display = "none";
  } else {
    const prefabLibrary = await new PrefabLibrary().init();
    // Bring any prefabs embedded in the initially-loaded world into the library.
    await prefabLibrary.importManifest(world.document.prefabs);
    const modRegistry = await new ModRegistry().init();
    const { WorldEditor } = await import("./editor/WorldEditor.js");
    editor = new WorldEditor({
      scene,
      camera,
      renderer,
      terrain,
      input,
      colliderSystem: colliders,
      objectManager,
      assetLibrary,
      worldLoader,
      worldSerializer,
      lights,
      player,
      cameraController,
      getGrassStats: () => grass.stats,
      treeSystem: trees,
      grassSystem: grass,
      bushSystem: bushes,
      getTreeStats: () => trees.stats,
      prefabLibrary,
      modRegistry,
      placedAssetStore, // arsenal v3 click-to-place context (refreshed per load via setWorldContext)
      placedWeaponRuntime,
      onLoadWorld: applyLoadedWorld,
      onWorldChanged: handleWorldChanged,
      onOpen: () => {
        if (document.pointerLockElement) document.exitPointerLock();
      },
    });
    document.getElementById("open-editor").addEventListener("click", () => editor.open());
    // Dev/test-only hook (stripped from production builds): drive and inspect the
    // editor + undo history.
    if (import.meta.env.DEV) window.__WORLD_EDITOR__ = editor;
  }

  cameraController.update(0.016);
  grass.prewarm(camera, 80);
  bushes?.prewarm(camera, 200);
  wildlife?.prewarm(camera);
  ambient?.prewarm(camera);
  updateSun();
  requestAnimationFrame(frame);
}

// --- shadow rig follows the player so the shadow map stays useful ------------

const SUN_OFFSET = new THREE.Vector3(60, 90, 40);

function updateSun() {
  // The offset is derived from the world's lighting (azimuth/elevation); falls
  // back to the default rig before the first world is applied.
  lights.sun.position.copy(player.position).add(lights.sunOffset ?? SUN_OFFSET);
  lights.sun.target.position.copy(player.position);
  lights.sun.target.updateMatrixWorld();
}

// --- prewarm + reveal --------------------------------------------------------

// Seat the camera before warming grass so the first patches load around it.
// Prewarm only the closest patches for an instant near-field; streaming fills
// the rest over the first second so the load never hangs.
function resetWorldReady() {
  window.__WORLD_READY__ = false;
  document.body.dataset.worldReady = "false";
}

function markWorldReady() {
  if (window.__WORLD_READY__) return;
  loaderEl?.remove();
  window.__WORLD_READY__ = true;
  document.body.dataset.worldReady = "true";
}

// --- main loop ---------------------------------------------------------------

let last = performance.now();
let elapsed = 0;

function frame(now) {
  requestAnimationFrame(frame);

  const dt = Math.min((now - last) / 1000, 0.05); // clamp to avoid jumps
  last = now;

  if (editor?.isOpen) {
    elapsed += dt;
    editor.update(dt);
    grass.update(camera, elapsed);
    trees.update(camera);
    bushes?.update(camera);
    water?.update(elapsed); // animate the glacial surface flow (atmosphere stays at base in the editor)
    placedWeaponRuntime.update(dt, null); // editor: animate all placed weapons (no kernel)
    wildlife?.update(dt, camera); // ambient animals graze/wander; flee the editor camera
    ambient?.update(dt, camera); // firefly motes drift over the wet meadow; scatter from the camera
    renderer.render(scene, camera);
    budgetHUD?.update(dt);
    markWorldReady();
    crosshairEl.style.display = "none";
    return;
  }

  elapsed += dt;

  // Global toggles. (Debug moved to Backquote in v6 so H is free for holster/draw.)
  if (input.wasPressed("Backquote")) debug.toggle();
  if (input.wasPressed("KeyB")) budgetHUD?.toggle();
  // Arsenal v6 carry: F picks up the nearest placed weapon into a free slot / drops the active one;
  // R rotates carried weapons through the slots (next weapon to hand); H holsters the drawn weapon
  // to a free slot, or draws a holstered one back; 1/2/3 select rightHand/back/hip. No firing.
  if (input.wasPressed("KeyF")) {
    const changed = weaponCarryRuntime.pickUpOrDrop(player);
    frozenCacheSlice?.noteAction("F", changed);
  }
  if (input.wasPressed("KeyR")) {
    const changed = weaponCarryRuntime.cycle(player);
    frozenCacheSlice?.noteAction("R", changed);
  }
  if (input.wasPressed("KeyH")) {
    const changed = weaponCarryRuntime.holsterOrDraw(player);
    frozenCacheSlice?.noteAction("H", changed);
  }
  // G deposits the relic when carried (in the cache zone → complete; else drop it, never hidden);
  // otherwise it stores the drawn weapon.
  if (input.wasPressed("KeyG")) {
    const deposited = objectiveRuntime?.tryDeposit(player) ?? false;
    const changed = deposited || weaponCarryRuntime.storeActive(player);
    frozenCacheSlice?.noteAction("G", changed);
    if (deposited && objectiveRuntime?.entry?.completed && world?.document) worldSerializer.save(world.document);
  }
  if (input.wasPressed("Digit1")) weaponCarryRuntime.selectSlot("rightHand", player);
  if (input.wasPressed("Digit2")) weaponCarryRuntime.selectSlot("back", player);
  if (input.wasPressed("Digit3")) weaponCarryRuntime.selectSlot("hip", player);

  // Update order: camera (yaw/pitch + mode) → movement → grass streaming.
  cameraController.update(dt);
  playerController.update(dt);
  updateSun();
  grass.update(camera, elapsed);
  trees.update(camera);
  bushes?.update(camera);
  water?.update(elapsed); // glacial surface flow
  camera.getWorldPosition(_atmoCamPos);
  atmosphere?.update(_atmoCamPos, dt); // ease valley fog by camera position (thicker in basins)
  // Classify visibility tiers first, then let animation sleep asleep mixers.
  visibilityKernel?.update(camera, dt);
  animationRuntime?.update(dt, visibilityKernel ? isAgentAwake : null);
  interactionRuntime?.update(dt);
  particleRuntime?.update(dt);
  placedWeaponRuntime.update(dt, visibilityKernel ? isAgentAwake : null);
  objectiveRuntime?.update(dt, player); // relic objective: zone + phase (no scene mutation here)
  frozenCacheSlice?.update(dt);
  wildlife?.update(dt, camera); // ambient animals: habitat-clamped FSM, flee the viewer
  ambient?.update(dt, camera); // firefly motes: bounded drift over the wet meadow, scatter from the viewer

  renderer.render(scene, camera);
  markWorldReady();

  // First-person crosshair, only while the mouse is captured.
  const showCross = cameraController.mode === "first" && input.pointerLocked;
  crosshairEl.style.display = showCross ? "block" : "none";

  // Always-on objective banner (runtime only — the editor never reaches this branch).
  if (objectiveBannerEl) {
    const text = frozenCacheSlice?.bannerText() ?? objectiveRuntime?.bannerText() ?? "";
    objectiveBannerEl.textContent = text;
    objectiveBannerEl.style.display = text ? "block" : "none";
  }

  debug.update(dt, {
    grass: grass.stats,
    trees: trees.stats,
    bushes: bushes?.stats,
    player: player.position,
    cameraMode: cameraController.modeLabel,
    grounded: player.grounded,
    drawCalls: renderer.info.render.calls,
    depth: reverseDepthStatus,
    placedWeapons: placedWeaponRuntime.stats,
    visibility: visibilityKernel?.stats,
  });
  budgetHUD?.update(dt);
}

boot().catch((error) => {
  console.error("Failed to initialize world", error);
  loaderEl.querySelector(".sub").textContent = "failed to initialize world";
});

// --- resize ------------------------------------------------------------------

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  resizeCamera(camera, window.innerWidth, window.innerHeight);
});
