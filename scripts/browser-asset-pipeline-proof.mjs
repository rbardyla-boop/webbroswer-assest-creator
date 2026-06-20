// test:asset-pipeline-proof — Asset Pipeline-1 in a real (SwiftShader) WebGL session.
// Drives the editor through window.__WORLD_EDITOR__ to import a GLB through the real
// Asset Library, proving: the import budget is CAPTURED (counts + severity); an
// over-budget GLB is REJECTED (non-vacuous — never stored, surfaced in the UI, no
// console error); placed instances render; the asset + budget PERSIST across reload
// while the world document holds only a REFERENCE (no embedded binary — the blob lives
// in IndexedDB); the asset-instances benchmark scene stays WITHIN the performance
// contract; and instances render in PLAY mode (no editor) coexisting with the Frozen
// Cache base. Zero console errors. Skips cleanly without Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { evalValue, openPage, sleep, withBrowserProof } from "./lib/browser.mjs";
import { assetInstancesScene, frozenCacheScene } from "../src/perf/BenchmarkScenes.js";
import { assertWithinBudget, evaluateContract, extractMetrics } from "../src/perf/PerformanceContract.js";

const ROOT = process.cwd();
const PORT = 5244;
const CDP_PORT = 9378;
const BASE = `http://127.0.0.1:${PORT}`;
const SETTLE_MS = 1800;

async function waitReady(cdp, mode, timeout = 90000) {
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
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "asset-pipeline-profile") },
  async () => {
    let cleanAssetId = null;

    // === Phase A: import (clean captured, heavy rejected) + place + persist =========
    const editorPage = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitReady(editorPage.cdp, "editor", 60000);
      await evalValue(editorPage.cdp, `localStorage.removeItem("grass-world-builder-save"); window.__WORLD_EDITOR__.open(); true`);

      // Import the CLEAN fixture → budget captured (severity ok, 12 triangles).
      const clean = await evalValue(
        editorPage.cdp,
        `(async () => {
          const { exportCleanAssetGLB } = await import('/src/assets/fixtures/assetBudgetFixtures.js');
          const glb = await exportCleanAssetGLB();
          const file = new File([new Blob([glb])], 'clean-prop.glb', { type: 'model/gltf-binary' });
          const e = window.__WORLD_EDITOR__;
          await e._importGLTF(file);
          return { id: e.selectedAsset?.id ?? null, budget: e.selectedAsset?.budget ?? null, lib: window.__ASSETS__().library.length };
        })()`
      );
      assert.ok(clean.id, "clean asset imported + selected");
      assert.equal(clean.budget?.severity, "ok", "clean asset graded ok");
      assert.equal(clean.budget?.triangles, 12, "clean asset budget captured (12 triangles)");
      cleanAssetId = clean.id;

      // Import the HEAVY fixture → REJECTED (not stored, surfaced, no console error).
      const heavy = await evalValue(
        editorPage.cdp,
        `(async () => {
          const { exportHeavyAssetGLB } = await import('/src/assets/fixtures/assetBudgetFixtures.js');
          const glb = await exportHeavyAssetGLB();
          const file = new File([new Blob([glb])], 'heavy-prop.glb', { type: 'model/gltf-binary' });
          const e = window.__WORLD_EDITOR__;
          const libBefore = window.__ASSETS__().library.length;
          await e._importGLTF(file);
          const lib = window.__ASSETS__().library;
          return { libBefore, libAfter: lib.length, label: e.selectionLabel.textContent, maxTris: Math.max(0, ...lib.map((a) => a.budget?.triangles ?? 0)) };
        })()`
      );
      assert.equal(heavy.libAfter, heavy.libBefore, "the over-budget asset was NOT added to the library");
      assert.match(heavy.label, /Rejected/i, "the editor surfaced the rejection");
      assert.ok(heavy.maxTris < 200000, "no over-budget asset reached the library (gate is non-vacuous)");

      // Place the clean asset a few times → instances render.
      const placed = await evalValue(
        editorPage.cdp,
        `(async () => {
          const e = window.__WORLD_EDITOR__;
          const ids = [];
          for (const [x, z] of [[-8,-8],[0,0],[8,8],[-8,8]]) ids.push(await e.placeSelectedAssetAt(x, z));
          e.flushAutosave();
          return { ids: ids.filter(Boolean), assets: window.__PERF__.snapshot().assets };
        })()`
      );
      assert.equal(placed.ids.length, 4, "four asset instances placed");
      assert.ok(placed.assets.instances >= 4, `placed instances are live (${placed.assets.instances})`);
      assert.deepEqual(editorPage.consoleErrors, [], `editor: zero console errors\n${editorPage.consoleErrors.join("\n")}`);
      console.log(`  editor: imported clean (${clean.budget.triangles} tris, ${clean.budget.severity}); heavy rejected; placed ${placed.ids.length} instances`);

      // Persist + reload: asset + budget survive (IndexedDB); the document holds a
      // REFERENCE only (no embedded binary), and placed instances re-resolve.
      await sleep(400);
      await evalValue(editorPage.cdp, `location.reload()`);
      await waitReady(editorPage.cdp, "editor", 90000);
      await sleep(SETTLE_MS);

      const reloaded = await evalValue(
        editorPage.cdp,
        `(async () => {
          const { exportCleanAssetGLB } = await import('/src/assets/fixtures/assetBudgetFixtures.js');
          const glb = await exportCleanAssetGLB();
          const u8 = new Uint8Array(glb);
          let bin = ''; for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
          const probe = btoa(bin).slice(100, 180); // a slice of the MODEL body, not its tiny icon thumbnail
          const raw = localStorage.getItem('grass-world-builder-save') || '';
          const doc = JSON.parse(raw);
          const assetObjs = (doc.objects || []).filter((o) => o.assetRef);
          const lib = window.__ASSETS__().library;
          const gltf = lib.find((a) => a.type === 'gltf');
          // Confirm the binary lives in IndexedDB, not the document.
          const blobSize = await new Promise((resolve) => {
            const req = indexedDB.open('grass-world-assets', 1);
            req.onsuccess = () => {
              try {
                const g = req.result.transaction('blobs', 'readonly').objectStore('blobs').get(gltf?.id);
                g.onsuccess = () => resolve(g.result?.size ?? 0);
                g.onerror = () => resolve(-1);
              } catch { resolve(-1); }
            };
            req.onerror = () => resolve(-1);
          });
          return {
            gltf, instances: window.__PERF__.snapshot().assets.instances,
            assetObjCount: assetObjs.length,
            allReferenceOnly: assetObjs.every((o) => o.asset === null && typeof o.assetRef === 'string'),
            binaryLeaked: raw.includes(probe),
            blobSize,
          };
        })()`
      );
      assert.ok(reloaded.gltf && reloaded.gltf.budget && reloaded.gltf.budget.triangles === 12, "asset + budget persisted across reload (from IndexedDB)");
      assert.ok(reloaded.instances >= 4, `placed instances re-resolved on reload (${reloaded.instances})`);
      assert.ok(reloaded.assetObjCount >= 4, "the document persisted the placed asset instances");
      assert.equal(reloaded.allReferenceOnly, true, "every asset instance is reference-only (asset:null + assetRef string)");
      assert.equal(reloaded.binaryLeaked, false, "the asset binary is NOT embedded in the world document");
      assert.ok(reloaded.blobSize > 0, `the asset binary lives in IndexedDB (${reloaded.blobSize} bytes)`);
      assert.deepEqual(editorPage.consoleErrors, [], `editor (reload): zero console errors\n${editorPage.consoleErrors.join("\n")}`);
      console.log(`  reload: asset+budget persisted, ${reloaded.instances} instances re-resolved; binary in IndexedDB (${reloaded.blobSize}B), 0 bytes in the document`);
    } finally {
      await editorPage.close();
    }

    assert.ok(cleanAssetId, "captured the clean asset id for the contract scene");

    // === Phase B: asset-instances scene stays within the performance contract ======
    {
      const scene = assetInstancesScene({ assetId: cleanAssetId, count: 24 });
      const seed = await openPage(CDP_PORT, `${BASE}/`);
      try {
        await waitReady(seed.cdp, "editor", 60000);
        await injectDoc(seed.cdp, scene.document);
      } finally {
        await seed.close();
      }
      const rt = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
      try {
        await waitReady(rt.cdp, "runtime", 90000);
        await sleep(SETTLE_MS + 800);
        const metrics = extractMetrics(await captureSnap(rt.cdp));
        console.log(
          `  asset-instances  draws ${metrics.drawCalls}  tris ${metrics.triangles}  objs ${metrics.objects}  ` +
            `batches ${metrics.instancedBatches}  memGeo ${metrics.memGeometries}  [${evaluateContract(metrics).overall}]`
        );
        const live = await evalValue(rt.cdp, `window.__PERF__.snapshot().assets`);
        assert.equal(live.instances, 24, `all 24 asset instances resolved in runtime (gate is non-vacuous; got ${live.instances})`);
        assert.deepEqual(rt.consoleErrors, [], `asset-instances: zero console errors\n${rt.consoleErrors.join("\n")}`);
        assertWithinBudget(scene.id, metrics, scene.gated);
      } finally {
        await rt.close();
      }
    }

    // === Phase C: instances render in PLAY mode, coexisting with the Frozen Cache ====
    {
      const fc = frozenCacheScene().document;
      fc.objects = assetInstancesScene({ assetId: cleanAssetId, count: 6 }).document.objects; // graft instances onto the slice base
      const seed = await openPage(CDP_PORT, `${BASE}/`);
      try {
        await waitReady(seed.cdp, "editor", 60000);
        await injectDoc(seed.cdp, fc);
      } finally {
        await seed.close();
      }
      const rt = await openPage(CDP_PORT, `${BASE}/?play=1`);
      try {
        await waitReady(rt.cdp, "runtime", 90000);
        await sleep(SETTLE_MS);
        const play = await evalValue(rt.cdp, `(() => ({ assets: window.__ASSETS__().placed, hasEditor: !!window.__WORLD_EDITOR__ }))()`);
        assert.ok(play.assets.instances >= 6, `asset instances render in play on the slice base (${play.assets.instances})`);
        assert.equal(play.hasEditor, false, "no editor exists in play mode");
        assert.deepEqual(rt.consoleErrors, [], `play: zero console errors\n${rt.consoleErrors.join("\n")}`);
        console.log(`  play: ${play.assets.instances} asset instances render on the Frozen Cache base, no editor`);
      } finally {
        await rt.close();
      }
    }

    console.log("\n  import budget captured + over-budget rejected + placed + persisted-as-reference + within-contract + in-play; 0 console errors");
  }
);

if (run.skipped) console.log("browser asset-pipeline proof skipped (no browser)");
else console.log("browser asset-pipeline proof passed");
