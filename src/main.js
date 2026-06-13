// Entry point. Wires the core scene, terrain, streaming grass, player, cameras,
// debug HUD, and the world editor into a single update/render loop.

import * as THREE from "three";

import { createRenderer } from "./core/renderer.js";
import { createScene } from "./core/scene.js";
import { createCamera, resizeCamera } from "./core/camera.js";
import { createLights } from "./core/lights.js";
import { Input } from "./core/input.js";

import { Terrain } from "./terrain/Terrain.js";
import { findGoodSpawn } from "./terrain/terrainSampling.js";

import { createGrassConfig } from "./grass/GrassConfig.js";
import { GrassSystem } from "./grass/GrassSystem.js";
import { ColliderSystem } from "./physics/ColliderSystem.js";
import { createTreeConfig } from "./trees/TreeConfig.js";
import { TreeSystem } from "./trees/TreeSystem.js";

import { Player } from "./player/Player.js";
import { PlayerController } from "./player/PlayerController.js";
import { PlayerCameraController } from "./player/PlayerCameraController.js";

import { DebugPanel } from "./debug/DebugPanel.js";
import { WorldEditor } from "./editor/WorldEditor.js";

const container = document.getElementById("app");
const loaderEl = document.getElementById("loader");
const crosshairEl = document.getElementById("crosshair");

// --- core --------------------------------------------------------------------

const grassConfig = createGrassConfig();

const renderer = createRenderer(container);
const scene = createScene({ fogNear: 70, fogFar: grassConfig.visibleDistance + 60 });
const camera = createCamera();
const lights = createLights(scene);
const input = new Input(renderer.domElement);

// --- world -------------------------------------------------------------------

const terrain = new Terrain({ size: 700, segments: 240 });
scene.add(terrain.mesh);

const colliders = new ColliderSystem();
colliders.attachScene(scene);

const grass = new GrassSystem(scene, lights, scene.fog, grassConfig, colliders);
const trees = new TreeSystem(scene, createTreeConfig(), colliders);

const player = new Player();
// Start on open, fairly flat ground with a vista across the field.
const spawn = findGoodSpawn();
player.position.set(spawn.x, 0, spawn.z);
scene.add(player.mesh);

const cameraController = new PlayerCameraController(camera, player, input, { toggleKey: "KeyV" });
const playerController = new PlayerController(player, input, cameraController, colliders);

// --- ui ----------------------------------------------------------------------

const debug = new DebugPanel({ visible: grassConfig.debug });

const editor = new WorldEditor({
  scene,
  camera,
  renderer,
  terrain,
  input,
  colliderSystem: colliders,
  getGrassStats: () => grass.stats,
  treeSystem: trees,
  getTreeStats: () => trees.stats,
  onWorldChanged: (change = {}) => {
    if (change.full) {
      grass.rebuildActivePatches();
      trees.rebuildActivePatches();
      return;
    }
    for (const box of change.boxes ?? []) {
      grass.queueRebuildForBox(box);
      trees.queueRebuildForBox(box);
    }
  },
  onOpen: () => {
    if (document.pointerLockElement) document.exitPointerLock();
  },
});
document.getElementById("open-editor").addEventListener("click", () => editor.open());

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

  if (editor.isOpen) {
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
