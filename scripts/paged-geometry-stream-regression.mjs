// test:geometry-stream — pure-Node regression for Geometry Stream Gate-0 (PagedGeometryStream).
//
// A deterministic chunked geometry streaming layer for procedural producers. This gate proves
// the CONTRACT, not a visual feature:
//   1. a synthetic 200k-vertex producer splits into pages of <= 64000 vertices,
//   2. same seed/input emits the SAME page ids / order / vertex counts / bounds (determinism
//      compares descriptor metadata, never timestamps),
//   3. an over-limit page (> 64000 vertices) is rejected,
//   4. duplicate page ids are rejected,
//   5. a page whose build() yields non-finite geometry is rejected at commit,
//   6. clear()/dispose() removes every page and returns geometry/material counts to baseline,
//   7. a rebuild loop does not accumulate pages,
//   8. the Performance Contract receives the stream's chunk/vertex/geometry stats,
//   plus static scans: no nondeterministic / side-effecting sources in the emission path, and
//   the stream never reaches into the world document (generated pages are runtime projections).
// The live incremental-commit / 0-console-error proof is test:geometry-stream-proof.

import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";

import {
  MAX_VERTICES_PER_CHUNK,
  normalizePageDescriptor,
  boundsValid,
} from "../src/world/geometry/PagedGeometryTypes.js";
import {
  validatePageDescriptor,
  validateBuiltGeometry,
  validatePages,
} from "../src/world/geometry/PagedGeometryValidation.js";
import { summarizePages } from "../src/world/geometry/PagedGeometryStats.js";
import { createSyntheticTerrainProducer } from "../src/world/geometry/PagedGeometryProducer.js";
import { createPagedGeometryStream } from "../src/world/geometry/PagedGeometryStream.js";
import { extractMetrics } from "../src/perf/PerformanceContract.js";

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

// Count the page meshes + distinct geometries actually live under a stream's scene group.
function liveGroupCounts(sceneRoot) {
  let meshes = 0;
  const geometries = new Set();
  const materials = new Set();
  sceneRoot.traverse((node) => {
    if (node.isMesh && node.userData?.isPagedGeometry) {
      meshes++;
      if (node.geometry) geometries.add(node.geometry.uuid);
      if (node.material) materials.add(node.material.uuid);
    }
  });
  return { meshes, geometries: geometries.size, materials: materials.size };
}

// --- 1. a synthetic 200k-vertex producer splits into <= 64000-vertex pages ----
{
  const pages = createSyntheticTerrainProducer({ rows: 1000, cols: 200, seed: "stress", maxVerticesPerChunk: 64000 });
  assert.ok(Array.isArray(pages) && pages.length > 0, "producer returns pages");
  const total = pages.reduce((sum, p) => sum + p.vertexCount, 0);
  assert.equal(total, 200_000, "the producer covers exactly 200k vertices");
  for (const p of pages) {
    assert.ok(p.vertexCount > 0 && p.vertexCount <= 64_000, `page ${p.id}: ${p.vertexCount} vertices is within the 64k cap`);
    assert.equal(typeof p.build, "function", `page ${p.id}: build is a lazy function`);
    assert.ok(boundsValid(p.bounds), `page ${p.id}: finite bounds`);
  }
  assert.equal(pages.length, 4, "200k / 64k → 4 pages (320+320+320+40 rows)");
  ok(`producer: 200k vertices → ${pages.length} pages, each <= 64000 vertices`);
}

// --- 2. determinism: same input → identical page sequence + stats -------------
{
  const meta = (pages) => pages.map((p) => ({ id: p.id, vertexCount: p.vertexCount, indexCount: p.indexCount, bounds: p.bounds }));
  const a = createSyntheticTerrainProducer({ rows: 600, cols: 128, seed: "det", maxVerticesPerChunk: 64000 });
  const b = createSyntheticTerrainProducer({ rows: 600, cols: 128, seed: "det", maxVerticesPerChunk: 64000 });
  assert.deepEqual(meta(a), meta(b), "same seed/input → identical page ids/order/counts/bounds");
  const c = createSyntheticTerrainProducer({ rows: 600, cols: 128, seed: "other", maxVerticesPerChunk: 64000 });
  assert.notDeepEqual(meta(a), meta(c), "a different seed changes the page ids (non-vacuous)");
  // Built geometry is deterministic too: same seed → identical positions.
  const g1 = a[0].build();
  const g2 = b[0].build();
  const posA = Array.from(g1.attributes.position.array);
  assert.deepEqual(posA, Array.from(g2.attributes.position.array), "same seed → identical built page positions");
  // …and the determinism is GEOMETRIC, not just an id string: a different seed yields different
  // vertex HEIGHTS (the seed only feeds per-vertex y via mulberry32/hash2i; the x/z grid layout is
  // seed-independent, so this is the assertion that proves the height field actually varies by seed).
  const g3 = c[0].build();
  const posC = Array.from(g3.attributes.position.array);
  assert.equal(posA.length, posC.length, "same grid shape regardless of seed");
  assert.notDeepEqual(posA, posC, "a different seed → different built page positions (geometric non-vacuity, not just the id)");
  g1.dispose();
  g2.dispose();
  g3.dispose();
  ok("determinism: same seed → identical positions; different seed → different positions (geometric)");
}

// --- 3. an over-limit page (> 64000 vertices) is rejected ---------------------
{
  const over = { id: "too-big", bounds: { min: [0, 0, 0], max: [1, 1, 1] }, vertexCount: 64_001, indexCount: 0, build: () => new THREE.BufferGeometry() };
  const v = validatePageDescriptor(over, { maxVerticesPerChunk: 64000 });
  assert.equal(v.ok, false, "over-limit descriptor is invalid");
  assert.match(v.reason, /vert|64000|limit/i, "reason names the vertex limit");

  const scene = new THREE.Scene();
  const stream = createPagedGeometryStream({ sceneRoot: scene, material: new THREE.MeshBasicMaterial(), maxVerticesPerChunk: 64000 });
  assert.throws(() => stream.replacePages([over]), /vert|64000|limit/i, "replacePages rejects an over-limit page");
  assert.equal(stream.snapshot().pages, 0, "a rejected batch leaves the stream empty (transactional)");
  stream.dispose();
  ok("rejection: a page over the 64k vertex cap is refused");
}

// --- 4. duplicate page ids are rejected --------------------------------------
{
  const dup = [
    { id: "p", bounds: { min: [0, 0, 0], max: [1, 1, 1] }, vertexCount: 3, indexCount: 0, build: () => new THREE.BufferGeometry() },
    { id: "p", bounds: { min: [0, 0, 0], max: [1, 1, 1] }, vertexCount: 3, indexCount: 0, build: () => new THREE.BufferGeometry() },
  ];
  const v = validatePages(dup, { maxVerticesPerChunk: 64000 });
  assert.equal(v.ok, false, "a batch with duplicate ids is invalid");
  assert.match(v.reason, /duplicate|id/i, "reason names the duplicate id");

  const scene = new THREE.Scene();
  const stream = createPagedGeometryStream({ sceneRoot: scene, material: new THREE.MeshBasicMaterial() });
  assert.throws(() => stream.replacePages(dup), /duplicate|id/i, "replacePages rejects duplicate ids");
  stream.dispose();
  ok("rejection: duplicate page ids are refused");
}

// --- 5. a page that builds non-finite geometry is rejected at commit ----------
{
  const nan = {
    id: "nan",
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    vertexCount: 3,
    indexCount: 3,
    build: () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0, NaN, 0, 0, 1, 0, 1]), 3));
      g.setIndex([0, 1, 2]);
      return g;
    },
  };
  // The descriptor itself is structurally valid; the POISON is in the built geometry.
  assert.equal(validatePageDescriptor(nan, { maxVerticesPerChunk: 64000 }).ok, true, "the descriptor passes structural validation");
  const built = nan.build();
  assert.equal(validateBuiltGeometry(built, nan, { maxVerticesPerChunk: 64000 }).ok, false, "the built geometry is rejected (NaN position)");
  built.dispose();

  const scene = new THREE.Scene();
  const stream = createPagedGeometryStream({ sceneRoot: scene, material: new THREE.MeshBasicMaterial() });
  stream.replacePages([nan]);
  assert.throws(() => stream.commitNext({ maxPages: 1 }), /finite|NaN/i, "commit rejects a page with non-finite geometry");
  assert.equal(liveGroupCounts(scene).meshes, 0, "the poisoned page never enters the scene graph");
  stream.dispose();
  ok("rejection: a page whose build() yields non-finite geometry is refused at commit");
}

// --- 6. clear()/dispose() removes all pages; geometry/material counts stable ---
{
  const scene = new THREE.Scene();
  const material = new THREE.MeshStandardMaterial();
  const stream = createPagedGeometryStream({ sceneRoot: scene, material });
  const pages = createSyntheticTerrainProducer({ rows: 20, cols: 20, seed: "small", maxVerticesPerChunk: 64000 });
  assert.equal(pages.length, 1, "20x20 fits one page");

  const baseline = liveGroupCounts(scene);
  assert.deepEqual(baseline, { meshes: 0, geometries: 0, materials: 0 }, "no page meshes before commit");

  stream.replacePages(pages);
  const committed = stream.commitNext({ maxPages: 10 });
  assert.equal(committed.committed, 1, "one page committed");
  const live = liveGroupCounts(scene);
  assert.equal(live.meshes, 1, "one page mesh in the scene");
  assert.equal(live.geometries, 1, "one geometry");
  assert.equal(live.materials, 1, "one SHARED material across pages");
  // The committed state is STRICTLY ABOVE baseline — so the "return to baseline" below is a real
  // 0→1→0 transition, not a trivial 0==0 (clear() must actually remove live geometry to pass).
  assert.notDeepEqual(live, baseline, "the committed scene differs from the empty baseline (non-vacuous)");

  stream.clear();
  assert.deepEqual(liveGroupCounts(scene), baseline, "clear() returns geometry/material counts to baseline (removed the live page)");
  assert.equal(stream.snapshot().pages, 0, "clear() empties the stream");

  // The caller-owned material is NOT disposed by clear(): re-commit on the SAME stream and prove the
  // new page mesh reuses the ORIGINAL material instance (a disposed/dropped material would not).
  stream.replacePages(createSyntheticTerrainProducer({ rows: 20, cols: 20, seed: "small", maxVerticesPerChunk: 64000 }));
  stream.commitNext({ maxPages: 10 });
  const reLive = liveGroupCounts(scene);
  assert.equal(reLive.meshes, 1, "the stream is reusable after clear (re-committed one page)");
  assert.equal(reLive.materials, 1, "still one shared material after clear");
  assert.equal(stream.group.children[0].material, material, "the re-committed page uses the original caller-owned material (clear did not dispose/replace it)");

  stream.dispose();
  assert.equal(scene.children.length, 0, "dispose() detaches the stream group from the scene root");
  ok("lifecycle: clear()/dispose() releases every page; one shared material; counts return to baseline");
}

// --- 7. a rebuild loop does not accumulate pages -----------------------------
{
  const scene = new THREE.Scene();
  const stream = createPagedGeometryStream({ sceneRoot: scene, material: new THREE.MeshStandardMaterial() });
  let firstGeoCount = null;
  for (let cycle = 0; cycle < 5; cycle++) {
    const pages = createSyntheticTerrainProducer({ rows: 200, cols: 100, seed: "loop", maxVerticesPerChunk: 64000 });
    stream.replacePages(pages); // transactional: disposes the prior committed set
    let guard = 0;
    while (stream.snapshot().pendingPages > 0 && guard++ < 50) stream.commitNext({ maxPages: 4 });
    const live = liveGroupCounts(scene);
    assert.equal(live.meshes, pages.length, `cycle ${cycle}: exactly ${pages.length} page meshes (no accumulation)`);
    if (firstGeoCount === null) firstGeoCount = live.geometries;
    else assert.equal(live.geometries, firstGeoCount, `cycle ${cycle}: geometry count stable at ${firstGeoCount}`);
  }
  stream.dispose();
  ok(`rebuild loop: page + geometry counts stable across 5 regenerate cycles (${firstGeoCount} geometries)`);
}

// --- 8. the Performance Contract receives the stream's paged stats ------------
{
  // summarizePages is the single source the stream's snapshot() and __PERF__.paged share.
  const stats = summarizePages({
    maxVerticesPerChunk: 64000,
    committed: [
      { vertexCount: 64000, indexCount: 383_000 },
      { vertexCount: 8000, indexCount: 47_000 },
    ],
    pending: [{ vertexCount: 64000, indexCount: 383_000 }],
  });
  assert.equal(stats.committedPages, 2, "two committed pages");
  assert.equal(stats.pendingPages, 1, "one pending page");
  assert.equal(stats.pages, 3, "three pages total");
  assert.equal(stats.committedVertices, 72_000, "committed vertices summed");
  assert.equal(stats.draws, 2, "one draw per committed page");

  // extractMetrics carries the paged stats into the contract's flat metric set (additive —
  // reported for stability, like wildlife/ambient counts, NOT gated by a fixed red ceiling).
  const m = extractMetrics({ perf: { paged: stats } });
  assert.equal(m.pagedPages, 3, "contract sees the total page count");
  assert.equal(m.pagedCommittedPages, 2, "contract sees committed pages");
  assert.equal(m.pagedVertices, 72_000, "contract sees committed vertices");
  assert.equal(m.pagedGeometries, 2, "contract sees live page geometries");
  // A snapshot WITHOUT a stream reports null/zero — the contract is unaffected in normal play.
  const none = extractMetrics({ perf: {} });
  assert.equal(none.pagedPages, 0, "no stream → zero paged pages (contract unaffected)");

  // …and the SAME path with a REAL stream.snapshot() (not a hand-built literal): build a stream,
  // commit some-but-not-all pages, and feed its live snapshot through extractMetrics exactly as
  // __PERF__.paged does. This proves the wiring end-to-end at the Node layer too (the browser proof
  // exercises it live; this guards the stream→summarizePages→extractMetrics chain deterministically).
  const realScene = new THREE.Scene();
  const realStream = createPagedGeometryStream({ sceneRoot: realScene, material: new THREE.MeshStandardMaterial(), maxVerticesPerChunk: 64000 });
  const realPages = createSyntheticTerrainProducer({ rows: 200, cols: 200, seed: "contract", maxVerticesPerChunk: 64000 });
  realStream.replacePages(realPages); // 200*200=40000 verts → ceil over 320 rows/page → 1 page committed below
  realStream.commitNext({ maxPages: 1 });
  const realSnap = realStream.snapshot();
  const rm = extractMetrics({ perf: { paged: realSnap } });
  assert.equal(rm.pagedPages, realSnap.pages, "real snapshot: contract page count == snapshot page count");
  assert.equal(rm.pagedCommittedPages, realSnap.committedPages, "real snapshot: committed pages match");
  assert.equal(rm.pagedVertices, realSnap.committedVertices, "real snapshot: committed vertices match");
  assert.equal(rm.pagedGeometries, realSnap.geometries, "real snapshot: live page geometries match");
  assert.ok(rm.pagedCommittedPages >= 1, "real snapshot: at least one page actually committed (non-vacuous)");
  realStream.dispose();
  ok("performance contract: paged stats flow through extractMetrics from BOTH a literal and a real stream.snapshot()");
}

// --- 9. static scans: deterministic, side-effect-free emission; no doc writes --
{
  const dir = new URL("../src/world/geometry/", import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
  assert.ok(files.length >= 5, "the geometry module set is present");
  const forbidden = /Math\.random|Date\.now|new Date\(|performance\.now|\beval\(|\bfetch\(|XMLHttpRequest|\brequire\(|import\s*\(/;
  const docReach = /WorldSerializer|WorldDocument|\.world\.json|localStorage/;
  for (const f of files) {
    const src = fs.readFileSync(new URL(f, dir), "utf8");
    assert.equal(forbidden.test(src), false, `${f}: no nondeterministic / side-effecting source in the emission path`);
    assert.equal(docReach.test(src), false, `${f}: never reaches the world document (pages are runtime projections only)`);
  }
  ok(`static scans: ${files.length} geometry modules are deterministic, side-effect-free, and document-free`);
}

console.log(`\npaged-geometry-stream regression: ${passed} checks passed`);
