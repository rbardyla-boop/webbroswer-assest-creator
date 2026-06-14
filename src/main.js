// Entry point. Wires the core scene, terrain, streaming grass, player, cameras,
// debug HUD, and the world editor into a single update/render loop.

import * as THREE from "three";

import { createRenderer } from "./core/renderer.js";
import { createScene } from "./core/scene.js";
import { createCamera, resizeCamera } from "./core/camera.js";
import { createLights } from "./core/lights.js";
import { Input } from "./core/input.js";

import { findGoodSpawn } from "./terrain/terrainSampling.js";

import { ColliderSystem } from "./physics/ColliderSystem.js";

import { Player } from "./player/Player.js";
import { PlayerController } from "./player/PlayerController.js";
import { PlayerCameraController } from "./player/PlayerCameraController.js";

import { DebugPanel } from "./debug/DebugPanel.js";
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

const container = document.getElementById("app");
const loaderEl = document.getElementById("loader");
const crosshairEl = document.getElementById("crosshair");
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
let grass = null;
let trees = null;
let objectManager = null;

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
if (particleRuntime && import.meta.env.DEV) window.__PARTICLE_RUNTIME__ = particleRuntime;
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
}

function handleWorldChanged(change = {}) {
  if (change.full) {
    grass.rebuildActivePatches();
    trees.rebuildActivePatches();
    return;
  }
  for (const box of change.boxes ?? []) {
    grass.queueRebuildForBox(box);
    trees.queueRebuildForBox(box);
  }
}
async function applyLoadedWorld(document) {
  resetWorldReady();
  world = await worldLoader.load(document);
  for (const warning of world.warnings) console.warn(warning);
  terrain = world.terrain;
  grass = world.grass;
  trees = world.trees;
  objectManager = world.objectManager;
  objectManager.onChange = handleWorldChanged;
  // Re-index interactions + particle emitters for the new object graph (runtime
  // mode only; no-op in the editor) so neither references torn-down objects.
  interactionRuntime?.load(objectManager);
  particleRuntime?.load(objectManager);

  const spawn = world.document.player.spawn;
  player.position.set(spawn.x, spawn.y, spawn.z);
  player.velocityY = 0;
  player.syncMesh();
  setCameraMode(world.document.player.cameraMode);
  cameraController.update(0.016);
  grass.prewarm(camera, 80);
  updateSun();
  editor?.setWorldContext({
    terrain,
    objectManager,
    treeSystem: trees,
    grassSystem: grass,
    getGrassStats: () => grass.stats,
    getTreeStats: () => trees.stats,
  });
}

function setCameraMode(mode) {
  cameraController.mode = mode === "first" ? "first" : "third";
  player.mesh.visible = cameraController.mode !== "first";
  cameraController._initialized = false;
}

// --- ui ----------------------------------------------------------------------

const debug = new DebugPanel({ visible: !runtimeMode });
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
  grass = world.grass;
  trees = world.trees;
  objectManager = world.objectManager;
  objectManager.onChange = handleWorldChanged;
  // Index this world's interactive objects + particle emitters (runtime only).
  interactionRuntime?.load(objectManager);
  particleRuntime?.load(objectManager);

  // Start on open, fairly flat ground with a vista across the field.
  const spawn = world.document.player.spawn ?? findGoodSpawn();
  player.position.set(spawn.x, spawn.y ?? 0, spawn.z);
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
      getTreeStats: () => trees.stats,
      prefabLibrary,
      modRegistry,
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
    renderer.render(scene, camera);
    markWorldReady();
    crosshairEl.style.display = "none";
    return;
  }

  elapsed += dt;

  // Global toggles.
  if (input.wasPressed("KeyH")) debug.toggle();

  // Update order: camera (yaw/pitch + mode) → movement → grass streaming.
  cameraController.update(dt);
  playerController.update(dt);
  updateSun();
  grass.update(camera, elapsed);
  trees.update(camera);
  animationRuntime?.update(dt);
  interactionRuntime?.update(dt);
  particleRuntime?.update(dt);

  renderer.render(scene, camera);
  markWorldReady();

  // First-person crosshair, only while the mouse is captured.
  const showCross = cameraController.mode === "first" && input.pointerLocked;
  crosshairEl.style.display = showCross ? "block" : "none";

  debug.update(dt, {
    grass: grass.stats,
    trees: trees.stats,
    player: player.position,
    cameraMode: cameraController.modeLabel,
    grounded: player.grounded,
    drawCalls: renderer.info.render.calls,
  });
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
