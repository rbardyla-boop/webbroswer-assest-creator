// Arsenal Lab entry. A self-contained studio viewer for the procedural weapon
// generator — its OWN clean scene, lighting, camera and loop (NOT the world engine).
// Reuses only the shared renderer factory + utils. Loaded by arsenal.html.

import * as THREE from "three";
import { createRenderer } from "../core/renderer.js";
import { clamp } from "../utils/math.js";
import { WeaponWorkbench } from "./WeaponWorkbench.js";

const app = document.getElementById("app");
const renderer = createRenderer(app);

// --- studio scene -------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111519);

const key = new THREE.DirectionalLight(0xfff1d8, 2.4);
key.position.set(4, 6, 5);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 24;
Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 });
key.shadow.bias = -0.0006;
scene.add(key);

const rim = new THREE.DirectionalLight(0x6ea8ff, 1.1);
rim.position.set(-5, 3, -4);
scene.add(rim);

scene.add(new THREE.HemisphereLight(0x9fc8ff, 0x20262b, 0.7));

// Ground catch-shadow disc (subtle, neutral).
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(14, 48).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x171b20, roughness: 0.95, metalness: 0.0 })
);
ground.position.y = -1.6;
ground.receiveShadow = true;
scene.add(ground);

// --- workbench ----------------------------------------------------------------------
const workbench = new WeaponWorkbench();
scene.add(workbench.group);

// --- camera + light mouse-orbit (no OrbitControls dependency) ------------------------
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
const target = new THREE.Vector3(0, 0.1, 0);
const orbit = { yaw: 0.7, pitch: 0.5, radius: 6.5 };

function applyCamera() {
  const r = orbit.radius;
  camera.position.set(
    target.x + r * Math.cos(orbit.pitch) * Math.sin(orbit.yaw),
    target.y + r * Math.sin(orbit.pitch),
    target.z + r * Math.cos(orbit.pitch) * Math.cos(orbit.yaw)
  );
  camera.lookAt(target);
}
applyCamera();

let dragging = false;
let lastX = 0;
let lastY = 0;
app.addEventListener("pointerdown", (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener("pointerup", () => { dragging = false; });
window.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  orbit.yaw -= (e.clientX - lastX) * 0.008;
  orbit.pitch = clamp(orbit.pitch + (e.clientY - lastY) * 0.008, -1.3, 1.4);
  lastX = e.clientX;
  lastY = e.clientY;
  applyCamera();
});
app.addEventListener("wheel", (e) => {
  e.preventDefault();
  orbit.radius = clamp(orbit.radius * (1 + Math.sign(e.deltaY) * 0.08), 2.5, 18);
  applyCamera();
}, { passive: false });

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- loop ---------------------------------------------------------------------------
let last = performance.now();
let elapsed = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  elapsed += dt;
  workbench.update(dt, elapsed);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// --- readiness + debug hooks --------------------------------------------------------
// Reuse the world proof-harness convention so waitForReady(cdp, "arsenal") works.
window.__WORLD_MODE__ = "arsenal";
window.__WORLD_READY__ = true;
if (import.meta.env.DEV) {
  window.__ARSENAL_DEBUG__ = () => workbench.snapshot();
  // Test affordance: re-roll a (seed, type) and return the new snapshot.
  window.__ARSENAL_REROLL__ = (seed, type) => {
    workbench._reroll(seed, type);
    return workbench.snapshot();
  };
}
