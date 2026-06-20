// test:webgpu-feasibility-proof — WebGPU Feasibility Gate-0 under a real (headless) browser.
//
// This proof is ISOLATED: it runs its OWN vite + chrome launch so it can ATTEMPT a WebGPU adapter
// (--enable-unsafe-webgpu --enable-features=Vulkan) WITHOUT touching the shared scripts/lib/browser.mjs
// harness (kept byte-identical for every other proof). It imports only the harness's pure helpers.
//
// It is robust to BOTH adapter outcomes — that is the whole point of a feasibility gate:
//   * WebGPU adapter granted  → WebGPURenderer reports backend "webgpu".
//   * No adapter (the expected SwiftShader-headless case) → WebGPURenderer transparently falls back to
//     a WebGL2 backend and reports "webgl". The probe says "unavailable" honestly.
// Either way the gate asserts: the probe ran + gave a definite verdict, the renderer initialized to a
// real backend, the instanced field rendered, the structural comparison was computed, the production
// WebGL app STILL boots (renderer untouched), and there were no console errors. It then PRINTS the
// measured backend + probe verdict — the evidence behind the go/no-go in docs/WEBGPU_FEASIBILITY.md.

import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { findChrome, waitForHttp, openPage, evalValue, sleep } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5247;
const CDP_PORT = 9382;
const BASE = `http://127.0.0.1:${PORT}`;
const PROFILE = path.join(ROOT, "tmp", "webgpu-feasibility-profile");

// --- isolated launcher (own chrome flags; reuses only pure helpers) -----------
function terminate(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(killTimer);
      clearTimeout(hardCap);
      resolve();
    };
    child.once("exit", finish);
    const killTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 2500);
    const hardCap = setTimeout(finish, 6000);
    try { child.kill("SIGTERM"); } catch { finish(); }
  });
}

async function withWebGPUProof(fn) {
  const chrome = findChrome();
  if (!chrome) {
    console.warn("WebGPU feasibility proof skipped: no Chromium/Chrome found. Set CHROME_BIN to enable.");
    return { skipped: true };
  }
  const vite = spawn(path.join(ROOT, "node_modules/.bin/vite"), ["--host", "127.0.0.1", "--port", String(PORT)], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const browser = spawn(chrome, [
    "--headless=new",
    // Keep the SwiftShader GL path so the WebGL2 fallback backend AND the production app still work…
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    // …and additionally ATTEMPT a WebGPU adapter. On this headless config an adapter is usually NOT
    // granted (Vulkan/Dawn software path absent) → the renderer falls back to WebGL2, which is exactly
    // the honest outcome this gate records. If an adapter IS present, the spike uses it.
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE}`,
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  try {
    await waitForHttp(`${BASE}/`);
    await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);
    await fn();
    return { skipped: false };
  } finally {
    await Promise.all([terminate(vite), terminate(browser)]);
    await rm(PROFILE, { recursive: true, force: true }).catch(() => {});
  }
}

async function waitForLabReady(cdp, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ready = await evalValue(cdp, `window.__WORLD_READY__ === true && window.__WORLD_MODE__ === "webgpu-lab"`);
    if (ready) return;
    await sleep(250);
  }
  throw new Error("timed out waiting for webgpu-lab readiness");
}

async function waitForMode(cdp, mode, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ready = await evalValue(cdp, `window.__WORLD_READY__ === true && window.__WORLD_MODE__ === "${mode}"`);
    if (ready) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${mode} readiness`);
}

// --- the proof ----------------------------------------------------------------
const run = await withWebGPUProof(async () => {
  // === 1. The WebGPU feasibility lab loads, probes, initializes a backend, renders ===
  const lab = await openPage(CDP_PORT, `${BASE}/webgpu-lab.html`);
  try {
    await waitForLabReady(lab.cdp, 75000);
    const snap = await evalValue(lab.cdp, `window.__WEBGPU_LAB__ ? window.__WEBGPU_LAB__() : null`);
    if (!snap) throw new Error("__WEBGPU_LAB__ hook missing (DEV mode required)");

    // Probe ran and gave a DEFINITE verdict (available may be true OR false — both legal).
    assert.equal(typeof snap.probe.apiPresent, "boolean", "probe reports a definite apiPresent boolean");
    assert.equal(typeof snap.probe.available, "boolean", "probe reports a definite available boolean");
    assert.ok(typeof snap.probe.reason === "string" && snap.probe.reason.length > 0, "probe gives a human reason");

    // The renderer initialized to a REAL backend (WebGPU if granted, else WebGL2 fallback).
    assert.equal(snap.renderer.initialized, true, "WebGPURenderer initialized");
    assert.equal(snap.renderer.error, null, `no renderer error (${snap.renderer.error})`);
    assert.ok(["webgpu", "webgl"].includes(snap.renderer.backend), `renderer chose a real backend (${snap.renderer.backend})`);
    // Consistency: a webgpu backend implies the probe found WebGPU available.
    if (snap.renderer.backend === "webgpu") {
      assert.equal(snap.probe.available, true, "webgpu backend ⇒ probe reported WebGPU available");
    }

    // The instanced field actually rendered. These numbers are read off the REAL rendered mesh
    // (mesh.count, geometry index, InstancedMesh count in the scene) — they stay 0 on a render
    // failure, so every one of these is render-gated, not a restatement of the plan constants.
    assert.equal(snap.field.rendered, true, "the instanced grass-like field rendered");
    assert.equal(snap.field.instances, 4096, "rendered mesh has 4096 instances");
    assert.equal(snap.field.triangles, 8192, "rendered mesh has 8192 triangles");
    assert.equal(snap.field.drawBatches, 1, "exactly one InstancedMesh draw batch in the scene");

    // The structural comparison was computed against the recorded WebGL baseline.
    assert.equal(snap.comparison.webglBaseline.triangles, 512_962, "comparison cites the recorded VB-1 WebGL triangles");
    assert.equal(snap.comparison.structural.bothBatchInstancesIntoOneDraw, true, "comparison records single-batch instancing");

    assert.deepEqual(lab.consoleErrors, [], `no console errors in the lab (${JSON.stringify(lab.consoleErrors)})`);

    // The MEASURED result — the evidence behind the go/no-go.
    console.log(`  • probe: available=${snap.probe.available} — ${snap.probe.reason}`);
    console.log(`  • WebGPURenderer backend ACTUALLY used: ${snap.renderer.backend}` + (snap.probe.isFallbackAdapter ? " (fallback adapter)" : ""));
    console.log(`  • field: ${snap.field.instances} instances · ${snap.field.triangles} tris · ${snap.field.drawBatches} draw batch`);
    console.log("  ✓ feasibility lab: probe honest, backend real, field rendered, comparison computed, 0 errors");
  } finally {
    await lab.close();
  }

  // === 2. ISOLATION — the production WebGL app STILL boots (the renderer is untouched) ===
  const app = await openPage(CDP_PORT, `${BASE}/`);
  try {
    await waitForMode(app.cdp, "editor", 60000);
    const hasPerf = await evalValue(app.cdp, `typeof window.__PERF__ === "object" && window.__PERF__ !== null`);
    assert.equal(hasPerf, true, "the production app's __PERF__ hook is present (WebGL renderer booted)");
    assert.deepEqual(app.consoleErrors, [], `production app boots with no console errors (${JSON.stringify(app.consoleErrors)})`);
    console.log("  ✓ isolation: the production WebGL app still boots cleanly (renderer untouched)");
  } finally {
    await app.close();
  }
});

if (run.skipped) {
  console.log("webgpu-feasibility proof: SKIPPED (no browser)");
} else {
  console.log("\nwebgpu-feasibility proof: PASSED");
}
