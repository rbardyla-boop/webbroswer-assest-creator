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
import { WorldEditor } from "./editor/WorldEditor.js";
import { createWorldDocument } from "./world/WorldDocument.js";
import { WorldRuntimeLoader } from "./world/WorldRuntimeLoader.js";
import { WorldSerializer } from "./world/WorldSerializer.js";

const container = document.getElementById("app");
const loaderEl = document.getElementById("loader");
const crosshairEl = document.getElementById("crosshair");
const toolbarEl = document.getElementById("toolbar");
const hintEl = document.getElementById("hint");
const runtimeMode = new URLSearchParams(window.location.search).has("runtime")
  || new URLSearchParams(window.location.search).has("play");

// --- core --------------------------------------------------------------------

const renderer = createRenderer(container);
const scene = createScene({ fogNear: 70, fogFar: 225 });
const camera = createCamera();
const lights = createLights(scene);
const input = new Input(renderer.domElement);
const worldSerializer = new WorldSerializer();

// --- world -------------------------------------------------------------------

const colliders = new ColliderSystem();
colliders.attachScene(scene);

const worldLoader = new WorldRuntimeLoader({ scene, lights, fog: scene.fog, colliderSystem: colliders });
const savedWorld = worldSerializer.load();
let world = worldLoader.load(savedWorld?.document ?? createWorldDocument());
for (const warning of world.warnings) console.warn(warning);
let terrain = world.terrain;
let grass = world.grass;
let trees = world.trees;
let objectManager = world.objectManager;

const player = new Player();
// Start on open, fairly flat ground with a vista across the field.
const spawn = world.document.player.spawn ?? findGoodSpawn();
player.position.set(spawn.x, spawn.y ?? 0, spawn.z);
scene.add(player.mesh);

const cameraController = new PlayerCameraController(camera, player, input, { toggleKey: "KeyV" });
setCameraMode(world.document.player.cameraMode);
const playerController = new PlayerController(player, input, cameraController, colliders);

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
objectManager.onChange = handleWorldChanged;

function applyLoadedWorld(document) {
  world = worldLoader.load(document);
  for (const warning of world.warnings) console.warn(warning);
  terrain = world.terrain;
  grass = world.grass;
  trees = world.trees;
  objectManager = world.objectManager;
  objectManager.onChange = handleWorldChanged;

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
if (runtimeMode) {
  toolbarEl.style.display = "none";
  hintEl.style.display = "none";
} else {
  editor = new WorldEditor({
    scene,
    camera,
    renderer,
    terrain,
    input,
    colliderSystem: colliders,
    objectManager,
    worldLoader,
    worldSerializer,
    player,
    cameraController,
    getGrassStats: () => grass.stats,
    treeSystem: trees,
    getTreeStats: () => trees.stats,
    onLoadWorld: applyLoadedWorld,
    onWorldChanged: handleWorldChanged,
    onOpen: () => {
      if (document.pointerLockElement) document.exitPointerLock();
    },
  });
  document.getElementById("open-editor").addEventListener("click", () => editor.open());
}

// --- shadow rig follows the player so the shadow map stays useful ------------

const SUN_OFFSET = new THREE.Vector3(60, 90, 40);

function updateSun() {
  lights.sun.position.copy(player.position).add(SUN_OFFSET);
  lights.sun.target.position.copy(player.position);
  lights.sun.target.updateMatrixWorld();
}

// --- prewarm + reveal --------------------------------------------------------

// Seat the camera before warming grass so the first patches load around it.
// Prewarm only the closest patches for an instant near-field; streaming fills
// the rest over the first second so the load never hangs.
cameraController.update(0.016);
grass.prewarm(camera, 80);
updateSun();

requestAnimationFrame(() => {
  loaderEl.classList.add("hidden");
  setTimeout(() => loaderEl.remove(), 700);
});

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

  renderer.render(scene, camera);

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

requestAnimationFrame(frame);

// --- resize ------------------------------------------------------------------

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  resizeCamera(camera, window.innerWidth, window.innerHeight);
});
