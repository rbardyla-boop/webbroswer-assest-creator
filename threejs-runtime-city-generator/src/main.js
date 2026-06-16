// Entry point. Wires terrain, streaming instanced grass, runtime city generator,
// capsule player, FP/TP cameras, debug HUD, and relief editor into one demo.

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

import { CitySystem } from "./city/CitySystem.js";
import { CITY_STYLE_PRESETS } from "./city/CityConfig.js";

import { Player } from "./player/Player.js";
import { PlayerController } from "./player/PlayerController.js";
import { PlayerCameraController } from "./player/PlayerCameraController.js";

import { DebugPanel } from "./debug/DebugPanel.js";
import { ReliefEditor } from "./editor/ReliefEditor.js";

const container = document.getElementById("app");
const loaderEl = document.getElementById("loader");
const crosshairEl = document.getElementById("crosshair");
const statusEl = document.getElementById("city-status");

const grassConfig = createGrassConfig({
  visibleDistance: 170,
  keepDistance: 210,
  maxPatchBuildsPerFrame: 3,
  debug: true,
});

const renderer = createRenderer(container);
const scene = createScene({ fogNear: 85, fogFar: 480 });
const camera = createCamera();
const lights = createLights(scene);
const input = new Input(renderer.domElement);

const terrain = new Terrain({ size: 760, segments: 240 });
scene.add(terrain.mesh);

const grass = new GrassSystem(scene, lights, scene.fog, grassConfig);
const city = new CitySystem(scene, {
  seed: "showcase-001",
  style: "showcase",
  visibleDistance: 455,
  labelDistance: 380,
});

const player = new Player();
const spawn = findGoodSpawn(78, 19);
player.position.set(spawn.x, 0, spawn.z);
scene.add(player.mesh);

const cameraController = new PlayerCameraController(camera, player, input, { toggleKey: "KeyV" });
const playerController = new PlayerController(player, input, cameraController);
const debug = new DebugPanel({ visible: true });

const editor = new ReliefEditor({
  onOpen: () => {
    if (document.pointerLockElement) document.exitPointerLock();
  },
});
document.getElementById("open-editor").addEventListener("click", () => editor.open());

bindCityControls();

const SUN_OFFSET = new THREE.Vector3(60, 90, 40);
function updateSun() {
  lights.sun.position.copy(player.position).add(SUN_OFFSET);
  lights.sun.target.position.copy(player.position);
  lights.sun.target.updateMatrixWorld();
}

function bindCityControls() {
  const styleEl = document.getElementById("city-style");
  const seedEl = document.getElementById("city-seed");
  const generateEl = document.getElementById("city-regenerate");
  const randomEl = document.getElementById("city-random");
  const saveEl = document.getElementById("city-save");
  const loadEl = document.getElementById("city-load");

  const showStatus = (msg) => {
    statusEl.textContent = msg;
  };

  const regenerate = () => {
    const seed = seedEl.value.trim() || "showcase-001";
    const style = styleEl.value;
    const doc = city.regenerate({ seed, style });
    showStatus(`${CITY_STYLE_PRESETS[style]?.label || style}: ${doc.layout.stats.zones} zones, ${doc.layout.stats.buildings} buildings, ${doc.layout.stats.chunks} chunks.`);
  };

  generateEl.addEventListener("click", regenerate);
  randomEl.addEventListener("click", () => {
    seedEl.value = `${styleEl.value}-${Math.floor(Date.now() % 1000000).toString(36)}`;
    regenerate();
  });
  saveEl.addEventListener("click", () => {
    try {
      const bytes = city.save();
      showStatus(`Saved layout to localStorage (${bytes} bytes).`);
    } catch (err) {
      showStatus(`Save failed: ${err.message}`);
    }
  });
  loadEl.addEventListener("click", () => {
    try {
      const loaded = city.loadSaved();
      if (!loaded) {
        showStatus("No saved city layout found yet.");
        return;
      }
      styleEl.value = city.document.style;
      seedEl.value = city.document.seed;
      showStatus(`Loaded saved layout: ${city.document.layout.presetLabel}, seed ${city.document.seed}.`);
    } catch (err) {
      showStatus(`Load failed: ${err.message}`);
    }
  });

  showStatus(`${city.document.layout.presetLabel}: ${city.document.layout.stats.zones} labeled zones generated.`);
}

cameraController.update(0.016);
grass.prewarm(camera, 90);
city.update(camera, player.position, 0);
updateSun();

requestAnimationFrame(() => {
  loaderEl.classList.add("hidden");
  setTimeout(() => loaderEl.remove(), 700);
});

let last = performance.now();
let elapsed = 0;

function frame(now) {
  requestAnimationFrame(frame);

  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (editor.isOpen) return;

  elapsed += dt;

  if (input.wasPressed("KeyH")) debug.toggle();

  cameraController.update(dt);
  playerController.update(dt);
  updateSun();
  grass.update(camera, elapsed);
  city.update(camera, player.position, elapsed);

  renderer.render(scene, camera);

  const showCross = cameraController.mode === "first" && input.pointerLocked;
  crosshairEl.style.display = showCross ? "block" : "none";

  debug.update(dt, {
    grass: grass.stats,
    city: city.stats,
    player: player.position,
    cameraMode: cameraController.modeLabel,
    grounded: player.grounded,
    drawCalls: renderer.info.render.calls,
  });
}

requestAnimationFrame(frame);

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  resizeCamera(camera, window.innerWidth, window.innerHeight);
});
