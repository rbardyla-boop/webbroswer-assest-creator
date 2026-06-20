// WebGPU Feasibility Gate-0 — the isolated lab entry (loaded by webgpu-lab.html).
//
// A self-contained experimental lab that DOES NOT touch the production WebGL renderer, main.js, or the
// world. It probes WebGPU availability honestly, initializes a WebGPURenderer (which auto-falls back to
// a WebGL2 backend when no WebGPU adapter exists — the EXPECTED outcome in our SwiftShader headless
// harness), renders a minimal instanced grass-like field, and exposes the measured result through a
// DEV-gated __WEBGPU_LAB__ hook. WebGL stays the production path; this is a feasibility lab only.

import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { probeWebGPU } from "./WebGPUCapability.js";
import { webgpuLabComposition } from "./WebGPULabComposition.js";
import { compareToWebGLBaseline } from "./WebGLBaselineComparison.js";
import { buildWebGPULabField } from "./WebGPULabScene.js";

const app = document.getElementById("app");

// The single measured result, read back by the proof + the on-screen readout.
const state = {
  probe: null,
  renderer: { requested: "webgpu", initialized: false, backend: null, forcedWebGL: false, error: null },
  field: { instances: 0, triangles: 0, drawBatches: 0, rendered: false },
  comparison: null,
};

async function boot() {
  // 1. Honest capability probe against the REAL navigator (unavailable is a valid outcome).
  state.probe = await probeWebGPU(typeof navigator !== "undefined" ? navigator : null);

  // 2. Pure structural plan + WebGL-baseline comparison (the PLANNED composition). The field's
  //    structural numbers are NOT recorded here — they are read off the REAL rendered mesh after
  //    renderAsync (step 4), so the readout attests to what actually rendered, not just the plan.
  const plan = webgpuLabComposition();
  state.comparison = compareToWebGLBaseline(plan);

  // 3. Init WebGPURenderer. We do NOT force a backend — the renderer chooses WebGPU when an adapter is
  //    available and transparently falls back to WebGL2 otherwise, then reports which it actually got.
  const renderer = new WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  app.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1410);
  scene.add(new THREE.HemisphereLight(0xbfe6cf, 0x16201a, 1.0));
  const field = buildWebGPULabField();
  scene.add(field.mesh);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 4, 11);
  camera.lookAt(0, 0.4, 0);

  try {
    await renderer.init();
    state.renderer.initialized = true;
    const backend = renderer.backend;
    state.renderer.backend = backend?.isWebGPUBackend ? "webgpu" : backend?.isWebGLBackend ? "webgl" : "unknown";
  } catch (error) {
    state.renderer.error = error?.message ?? String(error);
  }

  // 4. Render the field at least once (renderAsync works on both backends), then record the field's
  //    structure FROM THE REAL mesh — so the numbers attest to what rendered, not the plan. They stay
  //    0 if rendering fails, which makes every field assertion in the proof render-gated (non-vacuous).
  try {
    await renderer.renderAsync(scene, camera);
    state.field.rendered = true;
    state.field.instances = field.mesh.count;
    state.field.triangles = field.mesh.count * (field.mesh.geometry.index.count / 3);
    state.field.drawBatches = scene.children.filter((child) => child.isInstancedMesh).length;
  } catch (error) {
    state.renderer.error = state.renderer.error ?? (error?.message ?? String(error));
  }

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  let spin = 0;
  function frame() {
    requestAnimationFrame(frame);
    spin += 0.01;
    field.mesh.rotation.y = spin * 0.2;
    renderer.renderAsync(scene, camera).catch(() => {});
  }
  requestAnimationFrame(frame);

  paintReadout();
}

function paintReadout() {
  const el = document.getElementById("readout");
  if (!el) return;
  const r = state.renderer;
  const p = state.probe ?? {};
  el.innerHTML =
    `<b>WebGPU Feasibility Lab</b><br>` +
    `probe: ${p.available ? "available" : "unavailable"} — ${p.reason ?? ""}<br>` +
    `renderer backend: <b>${r.backend ?? "—"}</b>${r.error ? ` (error: ${r.error})` : ""}<br>` +
    `field: ${state.field.instances} blades · ${state.field.triangles} tris · ${state.field.drawBatches} batch`;
}

// DEV-gated measured-result hook (defined synchronously so it exists; returns the populated state),
// mirroring the other lab hooks. Stripped from production builds.
if (import.meta.env.DEV) {
  window.__WEBGPU_LAB__ = () => ({
    probe: state.probe,
    renderer: { ...state.renderer },
    field: { ...state.field },
    comparison: state.comparison,
  });
}

window.__WORLD_MODE__ = "webgpu-lab";

// Run boot ONCE. Readiness is set only AFTER boot settles (success OR failure) so the proof harness's
// waitForReady(cdp, "webgpu-lab") never observes half-populated state — WebGPU being unavailable is a
// valid settled outcome, the probe + fallback result is the deliverable, not a live adapter.
boot()
  .catch((error) => {
    state.renderer.error = error?.message ?? String(error);
  })
  .finally(() => {
    paintReadout();
    window.__WORLD_READY__ = true;
  });
