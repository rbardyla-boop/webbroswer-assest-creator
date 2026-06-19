// test:performance-contract-proof — the Performance Contract-1 CI gate in a real
// (SwiftShader) WebGL session. For each canonical benchmark scene it authors the
// scene, loads it in play/runtime mode, captures structural counts (__PERF__ +
// __BUDGET__), and FAILS if any metric breaches its per-scene ceiling or the global
// red design ceiling. It also checks reload stability (no object/asset/memory growth),
// streaming-border boundedness, a relative frame-spike proxy, and editor-mode autosave
// bounds. Structural metrics are GPU-independent; no FPS/GPU claim is made.
// Zero console errors. Skips cleanly without Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { evalValue, openPage, sleep, withBrowserProof } from "./lib/browser.mjs";
import { allBenchmarkScenes, denseAuthoredScene } from "../src/perf/BenchmarkScenes.js";
import { assertWithinBudget, evaluateContract, extractMetrics } from "../src/perf/PerformanceContract.js";

const ROOT = process.cwd();
const PORT = 5242;
const CDP_PORT = 9376;
const BASE = `http://127.0.0.1:${PORT}`;
const SETTLE_MS = 2200; // let grass/object streaming settle so counts are real
const STORAGE_KEY = "grass-world-builder-save";

async function waitReady(cdp, mode, timeout = 75000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await evalValue(cdp, `window.__WORLD_READY__ === true && window.__WORLD_MODE__ === "${mode}"`)) return;
    } catch {
      /* context swapped mid-navigation — retry */
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${mode} readiness`);
}

// Inject a Node-built WorldDocument and normalize it through the real save path.
async function injectDoc(cdp, doc) {
  const docJson = JSON.stringify(doc);
  const okFlag = await evalValue(
    cdp,
    `(async () => {
       const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
       localStorage.clear();
       new WorldSerializer().save(JSON.parse(${JSON.stringify(docJson)}));
       return true;
     })()`
  );
  if (okFlag !== true) throw new Error("scene injection failed");
}

const captureSnap = (cdp) =>
  evalValue(
    cdp,
    `(() => ({ perf: window.__PERF__ ? window.__PERF__.snapshot() : null,
               budget: window.__BUDGET__ ? window.__BUDGET__() : null }))()`
  );

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "perf-contract-profile") },
  async () => {
    const scenes = allBenchmarkScenes();
    const captures = [];

    // --- capture every scene first (author → runtime → snapshot → reload) -------
    for (const scene of scenes) {
      const author = await openPage(CDP_PORT, `${BASE}/`);
      try {
        await waitReady(author.cdp, "editor", 60000);
        await injectDoc(author.cdp, scene.document);
      } finally {
        await author.close();
      }

      const rt = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
      try {
        await waitReady(rt.cdp, "runtime", 90000);
        await sleep(SETTLE_MS);
        const before = extractMetrics(await captureSnap(rt.cdp));

        // streaming-border: let streaming reach steady state, then sample twice well
        // apart to catch a LEAK/runaway (counts climbing) — not warm-up convergence.
        let streaming = null;
        if (scene.id === "streaming-border") {
          await sleep(3000); // grass/region streamers settle to steady state
          const s1 = await captureSnap(rt.cdp);
          await sleep(2500);
          const s2 = await captureSnap(rt.cdp);
          streaming = {
            grass1: s1.perf?.grass?.activePatches ?? 0,
            grass2: s2.perf?.grass?.activePatches ?? 0,
            wild1: s1.perf?.wildlife?.activeRegions ?? 0,
            wild2: s2.perf?.wildlife?.activeRegions ?? 0,
          };
        }

        const frame = await evalValue(rt.cdp, `window.__PERF__.sample({ frames: 60, maxMs: 7000 })`);

        // reload stability: same scene, capture again — counts must not grow. Let the
        // page quiesce first; reload boot under back-to-back SwiftShader load is slow.
        await sleep(500);
        await evalValue(rt.cdp, `location.reload()`);
        await waitReady(rt.cdp, "runtime", 120000);
        await sleep(SETTLE_MS);
        const after = extractMetrics(await captureSnap(rt.cdp));

        captures.push({ scene, before, after, frame, streaming, consoleErrors: rt.consoleErrors.slice() });
      } finally {
        await rt.close();
      }
    }

    // --- print the captured baseline (so a failing assert still shows the numbers)
    console.log("\n  scene             draws  triangles   objs  batches  vegPatch  rtAssets  geo  tex");
    for (const c of captures) {
      const m = c.before;
      console.log(
        `  ${c.scene.id.padEnd(16)} ${String(m.drawCalls).padStart(5)} ${String(m.triangles).padStart(10)} ` +
          `${String(m.objects).padStart(6)} ${String(m.instancedBatches).padStart(7)} ` +
          `${String(m.visibleVegetationPatches).padStart(8)} ${String(m.runtimeAssets).padStart(8)} ` +
          `${String(m.memGeometries).padStart(4)} ${String(m.memTextures).padStart(4)}  [${evaluateContract(m).overall}]`
      );
    }
    console.log("");

    // --- assert the contract ----------------------------------------------------
    for (const c of captures) {
      assert.deepEqual(c.consoleErrors, [], `${c.scene.id}: zero console errors\n${c.consoleErrors.join("\n")}`);

      // (1) within per-scene ceiling + global red ceiling (FAILS on breach).
      assertWithinBudget(c.scene.id, c.before, c.scene.gated);

      // (2) reload stability: objects + placed runtime assets must not grow; the
      //     geometry proxy (renderer.info.memory.geometries — always present, NOT
      //     performance.memory) must not climb beyond a small tolerance.
      assert.equal(c.after.objects, c.before.objects, `${c.scene.id}: object count stable across reload (no duplication)`);
      assert.equal(c.after.runtimeAssets, c.before.runtimeAssets, `${c.scene.id}: runtime-asset count stable across reload (no duplication)`);
      assert.ok(Number.isFinite(c.before.memGeometries) && Number.isFinite(c.after.memGeometries), `${c.scene.id}: geometry count is measured (renderer.info)`);
      const geoGrowth = c.after.memGeometries - c.before.memGeometries;
      assert.ok(geoGrowth <= Math.max(20, c.before.memGeometries * 0.15), `${c.scene.id}: geometry count does not grow on reload (Δ${geoGrowth})`);

      // (3) frame proxy (SOFTWARE RASTER — a liveness/stall smoke check, NOT a
      //     frame-budget gate; the structural metrics above are the real contract).
      //     The load-bearing assert is the stall detector: a single multi-second frame
      //     means a real hang/GC-death, even under software raster.
      assert.ok(c.frame.frames > 0, `${c.scene.id}: frame loop produced samples (liveness)`);
      assert.ok(Number.isFinite(c.frame.worstMs) && c.frame.worstMs < 2000, `${c.scene.id}: no multi-second frame stall (worst ${c.frame.worstMs} ms)`);
    }

    // (4) streaming-border: region/patch counts stay BOUNDED and don't run away at a
    //     populated border (a leak would climb without bound; warm-up convergence is OK).
    const border = captures.find((c) => c.scene.id === "streaming-border");
    if (border?.streaming) {
      const s = border.streaming;
      // Require grass to be ACTUALLY streaming first, so the bound below can't be
      // satisfied vacuously by an absent/broken grass system (0 ≤ anything).
      assert.ok(s.grass1 > 0, `streaming-border: grass is streaming at the border (${s.grass1} active patches)`);
      assert.ok(s.grass1 <= 170 && s.grass2 <= 170, `streaming-border: grass patches bounded (${s.grass1}, ${s.grass2})`);
      assert.ok(s.grass2 <= s.grass1 * 1.4 + 4, `streaming-border: grass patches do not run away (${s.grass1}→${s.grass2})`);
      // Wildlife may legitimately be absent near the city — only gate thrash when live.
      if (s.wild1 > 0) assert.ok(s.wild2 <= s.wild1 + 3, `streaming-border: wildlife regions do not thrash (${s.wild1}→${s.wild2})`);
    }

    // --- editor-mode autosave bounds (dense scene) ------------------------------
    {
      const ed = await openPage(CDP_PORT, `${BASE}/`);
      try {
        await waitReady(ed.cdp, "editor", 60000); // page must be booted before its module loader can import
        await injectDoc(ed.cdp, denseAuthoredScene(500).document);
        await evalValue(ed.cdp, `location.reload()`);
        await waitReady(ed.cdp, "editor", 90000);
        const editor = await evalValue(ed.cdp, `(() => {
          const e = window.__WORLD_EDITOR__;
          e.open();
          e.toggleLayerVisible("objects"); e.toggleLayerVisible("objects"); // hide+show
          e.toggleLayerVisible("terrain"); e.toggleLayerVisible("terrain");
          e.flushAutosave();
          return { objects: e.manager.objects.size, status: e.autosaveStatus(),
                   serializeMs: e.stats.saveSerializeMs, writeMs: e.stats.saveWriteMs };
        })()`);
        assert.ok(editor.objects >= 500, `editor loaded the dense scene (${editor.objects} objects)`);
        assert.equal(editor.status, "saved", "editor autosave settles to saved (no runaway)");
        // Baseline ~2ms serialize / ~9ms write for 500 objects; ceilings catch a
        // 10-100x runaway while tolerating machine jitter (not an absolute perf claim).
        assert.ok(editor.serializeMs < 250, `editor serialize within budget for 500 objects (${editor.serializeMs.toFixed(1)} ms)`);
        assert.ok(editor.writeMs < 150, `editor localStorage write within budget (${editor.writeMs.toFixed(1)} ms)`);
        assert.deepEqual(ed.consoleErrors, [], `editor: zero console errors\n${ed.consoleErrors.join("\n")}`);
        console.log(`  editor dense(500): serialize ${editor.serializeMs.toFixed(1)}ms · write ${editor.writeMs.toFixed(1)}ms · ${editor.status}`);
      } finally {
        await ed.close();
      }
    }

    console.log("\n  all scenes within budget; reload-stable; 0 console errors");
  }
);

if (run.skipped) console.log("browser performance-contract proof skipped (no browser)");
else console.log("browser performance-contract proof passed");
