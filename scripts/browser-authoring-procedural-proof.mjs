// test:authoring-procedural-proof — Procedural Authoring-1 in a real (SwiftShader) WebGL
// session. It drives the editor through window.__WORLD_EDITOR__ to author a spline + mask
// + beacon-trail modifier, proves the derived trail renders, undo/redo restores exactly,
// the authoring block PERSISTS across reload, the trail shows in PLAY mode (with no edit
// gizmos), the authored benchmark scene stays WITHIN the performance contract, and an
// authored trail coexists with the relic objective (the full Frozen Cache completion walk
// is covered by the unchanged test:first-playable-proof). Zero console errors. Skips
// cleanly without Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { evalValue, openPage, sleep, withBrowserProof } from "./lib/browser.mjs";
import { authoredProceduralScene } from "../src/perf/BenchmarkScenes.js";
import { frozenCacheScene } from "../src/perf/BenchmarkScenes.js";
import { assertWithinBudget, evaluateContract, extractMetrics } from "../src/perf/PerformanceContract.js";

const ROOT = process.cwd();
const PORT = 5243;
const CDP_PORT = 9377;
const BASE = `http://127.0.0.1:${PORT}`;
const SETTLE_MS = 1800;

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

async function injectDoc(cdp, doc) {
  const okFlag = await evalValue(
    cdp,
    `(async () => {
       const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
       localStorage.clear();
       new WorldSerializer().save(JSON.parse(${JSON.stringify(JSON.stringify(doc))}));
       return true;
     })()`
  );
  if (okFlag !== true) throw new Error("scene injection failed");
}

const captureSnap = (cdp) =>
  evalValue(cdp, `(() => ({ perf: window.__PERF__ ? window.__PERF__.snapshot() : null, budget: window.__BUDGET__ ? window.__BUDGET__() : null }))()`);

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "authoring-procedural-profile") },
  async () => {
    // === Phase A: author in the editor (spline → mask → trail) + undo/redo + persist ===
    const editorPage = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitReady(editorPage.cdp, "editor", 60000);
      await evalValue(editorPage.cdp, `localStorage.removeItem("grass-world-builder-save"); window.__WORLD_EDITOR__.open(); true`);

      // Author: a 5-point spline, a covering circle mask, then a beacon-trail modifier.
      const authored = await evalValue(
        editorPage.cdp,
        `(() => {
          const e = window.__WORLD_EDITOR__;
          e.beginSplineEdit();
          for (const [x, z] of [[-24,-8],[-10,4],[2,-2],[16,6],[28,-4]]) e.devAddSplinePoint(x, z);
          const splineId = e.finishSplineEdit();
          const maskId = e.devAddMask({ x: 2, y: 0, z: 0 }, 40);
          const modId = e.createBeaconTrail(splineId, maskId);
          return { splineId, maskId, modId, snap: e.authoringSnapshot() };
        })()`
      );
      assert.ok(authored.splineId && authored.maskId && authored.modId, "spline + mask + modifier were all created");
      assert.equal(authored.snap.splines, 1, "one spline authored");
      assert.equal(authored.snap.masks, 1, "one mask authored");
      assert.equal(authored.snap.modifiers, 1, "one modifier authored");
      assert.ok(authored.snap.runtime && authored.snap.runtime.groups >= 1, "the modifier derived a runtime group");
      assert.ok(authored.snap.runtime.markers > 0, `the trail derived markers (${authored.snap.runtime?.markers})`);

      // Undo the modifier-create → derived group gone; redo → back. (Pure-data command;
      // the runtime re-derives on each do/undo.)
      const cycle = await evalValue(
        editorPage.cdp,
        `(() => {
          const e = window.__WORLD_EDITOR__;
          e.history.undo();
          const afterUndo = e.authoringSnapshot();
          e.history.redo();
          const afterRedo = e.authoringSnapshot();
          return { afterUndo, afterRedo };
        })()`
      );
      assert.equal(cycle.afterUndo.modifiers, 0, "undo removes the modifier");
      assert.equal(cycle.afterUndo.runtime.groups, 0, "undo removes the derived group");
      assert.equal(cycle.afterRedo.modifiers, 1, "redo restores the modifier");
      assert.ok(cycle.afterRedo.runtime.groups >= 1, "redo restores the derived group");

      // Regenerate bumps the seed; capture it so we can prove (below) that a regenerate
      // AFTER reload still produces a fresh seed (no session-counter reset).
      const seed1 = await evalValue(
        editorPage.cdp,
        `(() => { const e = window.__WORLD_EDITOR__, id = ${JSON.stringify(authored.modId)};
                  e.regenerateModifier(id);
                  return e.worldLoader.document.authoring.modifiers.find((m) => m.id === id).seed; })()`
      );

      // Persist + reload: the authoring block survives, and the runtime re-derives on boot.
      await evalValue(editorPage.cdp, `window.__WORLD_EDITOR__.flushAutosave(); true`);
      await sleep(400);
      await evalValue(editorPage.cdp, `location.reload()`);
      await waitReady(editorPage.cdp, "editor", 90000);
      await sleep(SETTLE_MS);
      const reloaded = await evalValue(editorPage.cdp, `window.__AUTHORING__()`);
      assert.equal(reloaded.doc.splines, 1, "spline persisted across reload");
      assert.equal(reloaded.doc.masks, 1, "mask persisted across reload");
      assert.equal(reloaded.doc.modifiers, 1, "modifier persisted across reload");
      assert.ok(reloaded.runtime && reloaded.runtime.groups >= 1 && reloaded.runtime.markers > 0, "trail re-derived from the persisted block on reload");

      // Regenerate again AFTER reload — the seed must differ from the pre-reload one
      // (the fixed bug: a session counter reset on reload reproduced the same seed).
      const seed2 = await evalValue(
        editorPage.cdp,
        `(() => { const e = window.__WORLD_EDITOR__, id = ${JSON.stringify(authored.modId)};
                  e.regenerateModifier(id);
                  return e.worldLoader.document.authoring.modifiers.find((m) => m.id === id).seed; })()`
      );
      assert.notEqual(seed2, seed1, `regenerate yields a fresh seed even across reload (${seed1} → ${seed2})`);
      assert.deepEqual(editorPage.consoleErrors, [], `editor: zero console errors\n${editorPage.consoleErrors.join("\n")}`);
      console.log(`  editor: authored trail = ${reloaded.runtime.groups} group(s), ${reloaded.runtime.markers} markers; persisted across reload`);
    } finally {
      await editorPage.close();
    }

    // === Phase B: the authored trail shows in PLAY mode (no edit gizmos) ===============
    const playPage = await openPage(CDP_PORT, `${BASE}/?play=1`);
    try {
      await waitReady(playPage.cdp, "runtime", 90000);
      await sleep(SETTLE_MS);
      const play = await evalValue(
        playPage.cdp,
        `(() => ({ authoring: window.__AUTHORING__(), perf: window.__PERF__.snapshot().authoring, hasEditor: !!window.__WORLD_EDITOR__ }))()`
      );
      assert.equal(play.authoring.doc.modifiers, 1, "play mode loaded the persisted modifier");
      assert.ok(play.perf && play.perf.groups >= 1 && play.perf.markers > 0, `the trail renders in play (${play.perf?.markers} markers)`);
      // The spline/mask edit gizmos are owned by the WorldEditor, which is never
      // constructed in runtime mode — so no edit gizmo can leak into play.
      assert.equal(play.hasEditor, false, "no editor (hence no edit gizmos) exists in play mode");
      assert.deepEqual(playPage.consoleErrors, [], `play: zero console errors\n${playPage.consoleErrors.join("\n")}`);
      console.log(`  play: trail renders (${play.perf.markers} markers)`);
    } finally {
      await playPage.close();
    }

    // === Phase C: the authored benchmark scene stays within the performance contract ===
    {
      const scene = authoredProceduralScene();
      const authorPage = await openPage(CDP_PORT, `${BASE}/`);
      try {
        await waitReady(authorPage.cdp, "editor", 60000);
        await injectDoc(authorPage.cdp, scene.document);
      } finally {
        await authorPage.close();
      }
      const rt = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
      try {
        await waitReady(rt.cdp, "runtime", 90000);
        await sleep(SETTLE_MS + 800);
        const metrics = extractMetrics(await captureSnap(rt.cdp));
        console.log(
          `  authored-procedural  draws ${metrics.drawCalls}  tris ${metrics.triangles}  objs ${metrics.objects}  ` +
            `batches ${metrics.instancedBatches}  vegPatch ${metrics.visibleVegetationPatches}  [${evaluateContract(metrics).overall}]`
        );
        assert.deepEqual(rt.consoleErrors, [], `authored-procedural: zero console errors\n${rt.consoleErrors.join("\n")}`);
        // FAILS on a per-scene ceiling breach or a global red ceiling (yellow is allowed).
        assertWithinBudget(scene.id, metrics, scene.gated);
        const auth = await evalValue(rt.cdp, `window.__PERF__.snapshot().authoring`);
        assert.ok(auth && auth.markers > 0, "the benchmark trail actually derived markers (gate is non-vacuous)");
      } finally {
        await rt.close();
      }
    }

    // === Phase D: an authored trail coexists with the relic objective ==================
    // (The full Frozen Cache completion walk is the unchanged test:first-playable-proof.)
    {
      const fc = frozenCacheScene().document;
      fc.authoring = authoredProceduralScene().document.authoring; // graft a trail onto the slice base
      const authorPage = await openPage(CDP_PORT, `${BASE}/`);
      try {
        await waitReady(authorPage.cdp, "editor", 60000);
        await injectDoc(authorPage.cdp, fc);
      } finally {
        await authorPage.close();
      }
      const rt = await openPage(CDP_PORT, `${BASE}/?play=1`);
      try {
        await waitReady(rt.cdp, "runtime", 90000);
        await sleep(SETTLE_MS);
        const co = await evalValue(rt.cdp, `window.__AUTHORING__()`);
        assert.ok(co.runtime && co.runtime.markers > 0, "trail renders on the slice base (coexists with the relic objective)");
        assert.deepEqual(rt.consoleErrors, [], `coexistence: zero console errors\n${rt.consoleErrors.join("\n")}`);
        console.log(`  coexistence: trail (${co.runtime.markers} markers) loads cleanly on the Frozen Cache base`);
      } finally {
        await rt.close();
      }
    }

    console.log("\n  authoring authored + undo/redo + persisted + in-play + within-budget + coexists; 0 console errors");
  }
);

if (run.skipped) console.log("browser authoring-procedural proof skipped (no browser)");
else console.log("browser authoring-procedural proof passed");
