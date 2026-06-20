// test:geometry-stream-proof — Geometry Stream Gate-0 (PagedGeometryStream) in a real
// (SwiftShader) WebGL runtime. Proves the streaming CONTRACT end to end, live:
//   - MOUNT a stream against the live scene through the DEV __PAGED__ harness,
//   - a synthetic 200k-vertex producer's pages COMMIT INCREMENTALLY (one per commitNext;
//     committed-page count rises 1→2→3→4 while pending falls) — never one stalling upload,
//   - every committed page is a real mesh in the scene, each <= 64000 vertices,
//   - the Performance Contract RECEIVES the paged chunk/vertex/geometry stats live
//     (__PERF__.paged → extractMetrics) while the pages render,
//   - UNMOUNT disposes every page (the stream group detaches, 0 children) and __PERF__.paged
//     returns to null (the contract is unaffected once unmounted),
//   - 0 console errors throughout (no GL error from a paged mesh).
// Skips cleanly without Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5245;
const CDP_PORT = 9380;
const BASE = `http://127.0.0.1:${PORT}`;
const SETTLE_MS = 1200;

// Mount, stream a synthetic producer's pages ONE AT A TIME, and read the paged stats back
// through the Performance Contract — all in one in-page eval (the page descriptors carry
// lazy build() functions, which cannot cross the CDP boundary).
const STREAM = `(async () => {
  const E = window.__PAGED__;
  if (!E) return { missing: true };
  const { createSyntheticTerrainProducer } = await import('/src/world/geometry/PagedGeometryProducer.js');
  const { extractMetrics } = await import('/src/perf/PerformanceContract.js');

  E.mount({ maxVerticesPerChunk: 64000 });
  const pages = createSyntheticTerrainProducer({ rows: 1000, cols: 200, seed: 'proof', maxVerticesPerChunk: 64000 });
  const planned = pages.length;
  E.replacePages(pages);

  // Commit one page per call → the committed count must rise monotonically (no single upload).
  const steps = [];
  for (let i = 0; i < planned; i++) {
    const r = E.commitNext({ maxPages: 1 });
    const s = E.snapshot();
    steps.push({ committed: r.committed, committedPages: s.committedPages, pendingPages: s.pendingPages });
  }

  const snap = E.snapshot();
  let pageMeshes = 0, maxPageVerts = 0, totalVerts = 0;
  E.stream().group.traverse((o) => {
    if (o.userData && o.userData.isPagedGeometry) {
      pageMeshes++;
      const n = o.geometry.attributes.position.count;
      totalVerts += n;
      if (n > maxPageVerts) maxPageVerts = n;
    }
  });

  const perf = window.__PERF__.snapshot();
  const metrics = extractMetrics({ perf });
  return { planned, steps, snap, pageMeshes, maxPageVerts, totalVerts, perfPaged: perf.paged, metrics };
})()`;

// Capture the stream's group, unmount, and confirm full teardown + contract reset.
const TEARDOWN = `(() => {
  const grp = window.__PAGED__.stream().group;
  window.__PAGED__.unmount();
  return {
    detached: grp.parent === null,
    children: grp.children.length,
    streamGone: window.__PAGED__.stream() === null,
    perfPagedAfter: window.__PERF__.snapshot().paged,
  };
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "paged-geometry-profile") },
  async () => {
    const page = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(page.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);

      const s = await evalValue(page.cdp, STREAM);
      assert.ok(s && !s.missing, "the __PAGED__ DEV harness is available");
      assert.equal(s.planned, 4, "200k / 64k → 4 planned pages");

      // Incremental commit: each step commits exactly one page; committed rises, pending falls.
      assert.equal(s.steps.length, 4, "four commit steps");
      for (let i = 0; i < s.steps.length; i++) {
        assert.equal(s.steps[i].committed, 1, `step ${i}: exactly one page committed (incremental, not one upload)`);
        assert.equal(s.steps[i].committedPages, i + 1, `step ${i}: committed count rose to ${i + 1}`);
        assert.equal(s.steps[i].pendingPages, 4 - (i + 1), `step ${i}: pending fell to ${4 - (i + 1)}`);
      }

      // Final state: all 4 pages live, each within the 64k cap, 200k vertices total.
      assert.equal(s.snap.committedPages, 4, "all four pages committed");
      assert.equal(s.snap.pendingPages, 0, "nothing left pending");
      assert.equal(s.snap.draws, 4, "one draw per committed page");
      assert.equal(s.pageMeshes, 4, "four page meshes in the scene");
      assert.ok(s.maxPageVerts <= 64000, `largest page is within the cap (${s.maxPageVerts} <= 64000)`);
      assert.equal(s.totalVerts, 200000, "200k vertices streamed in total");

      // The Performance Contract receives the paged stats LIVE while the pages render.
      assert.ok(s.perfPaged, "__PERF__.paged is populated while a stream is mounted");
      assert.equal(s.perfPaged.committedPages, 4, "perf paged: four committed pages");
      assert.equal(s.perfPaged.committedVertices, 200000, "perf paged: 200k committed vertices");
      assert.equal(s.metrics.pagedPages, 4, "extractMetrics carries the page count into the contract");
      assert.equal(s.metrics.pagedVertices, 200000, "extractMetrics carries the committed vertex count");
      assert.equal(s.metrics.pagedGeometries, 4, "extractMetrics carries the live page geometry count");

      // Let the committed pages render for a beat — a GL error on a paged mesh would surface here.
      await sleep(SETTLE_MS);
      assert.deepEqual(page.consoleErrors, [], `stream: zero console errors\n${page.consoleErrors.join("\n")}`);
      console.log(`  streamed 4 pages incrementally (200k verts, max ${s.maxPageVerts}/page) → contract saw the stats`);

      // Teardown: unmount disposes every page and resets the contract.
      const t = await evalValue(page.cdp, TEARDOWN);
      assert.equal(t.detached, true, "unmount detached the stream group from the scene");
      assert.equal(t.children, 0, "unmount disposed every page mesh (0 children)");
      assert.equal(t.streamGone, true, "the stream is gone after unmount");
      assert.equal(t.perfPagedAfter, null, "__PERF__.paged returns to null (contract unaffected once unmounted)");
      assert.deepEqual(page.consoleErrors, [], `teardown: zero console errors\n${page.consoleErrors.join("\n")}`);
      console.log("  unmount disposed all pages; __PERF__.paged reset to null");
    } finally {
      await page.close();
    }

    console.log("\n  mount → incremental commit (4×64k pages) → contract sees paged stats → unmount disposes all; 0 console errors");
  }
);

if (run.skipped) console.log("browser paged-geometry-stream proof skipped (no browser)");
else console.log("browser paged-geometry-stream proof passed");
