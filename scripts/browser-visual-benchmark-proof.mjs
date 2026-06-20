// test:visual-benchmark-proof — Visual Benchmark-1 in a real (SwiftShader) WebGL runtime.
//
// Proves the central question end to end: can one small authored corridor look INTENTIONAL and stay
// MEASURABLE, RELOAD-SAFE, and PLAYABLE? It loads the authored Visual Benchmark scene and verifies:
//   - the living world is active (alpine terrain + glacial water + fog/atmosphere + lighting),
//   - the authored landmarks render and frame a readable route (overlook/ruin/pass/cache),
//   - the Procedural Authoring-1 beacon-trail is derived and visible,
//   - the validated-GLB cache prop RESOLVES (reference-only; binary in IndexedDB),
//   - the geometry stream is AVAILABLE and structurally measured via the DEV __PAGED__ harness
//     (stats only — NO production streamed-detail producer is created in this stage),
//   - BOTH the relic objective AND the encounter combat beat are completable,
//   - Environment Polish-1: per-scene lighting/water/atmosphere readability overrides are applied and
//     PERSIST (differing from the global default), ambient particle feedback is live, and the additive
//     encounter-clear audio cue fires on completion (provable via the cue counter — audio no-ops headless),
//   - the scene passes the Performance Contract (captured counts within the visual-benchmark ceiling),
//   - completion persists across reload, and there are 0 console errors throughout.
// Skips cleanly without Chromium. Does NOT touch the shipped Frozen Cache / first-playable slice.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";
import { assertWithinBudget, extractMetrics } from "../src/perf/PerformanceContract.js";
import { visualBenchmarkScene } from "../src/perf/BenchmarkScenes.js";

const ROOT = process.cwd();
const PORT = 5246;
const CDP_PORT = 9381;
const BASE = `http://127.0.0.1:${PORT}`;
const SETTLE_MS = 1400;
const GATED = visualBenchmarkScene().gated; // the SAME per-scene ceiling the Performance Contract gates

// Seed (editor session): import the clean GLB fixture (Asset Pipeline-1 validated), re-store it under the
// benchmark's stable cache-asset id so the authored vb-cache-prop resolves, and SAVE the benchmark scene
// as the active world (so reloads load the saved world → completion persists, like Frozen Cache / FP-1).
const SEED = `(async () => {
  const e = window.__WORLD_EDITOR__;
  if (!e) return { missing: true };
  const { exportCleanAssetGLB } = await import('/src/assets/fixtures/assetBudgetFixtures.js');
  const { buildVisualBenchmarkV1, BENCHMARK_CACHE_ASSET_ID } = await import('/src/world/samples/visualBenchmarkV1.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');

  // import + budget-validate the clean GLB (exportCleanAssetGLB returns a Promise<ArrayBuffer>)
  const glb = await exportCleanAssetGLB();
  const file = new File([new Blob([glb])], 'benchmark-cache.glb', { type: 'model/gltf-binary' });
  let importError = null;
  try { await e._importGLTF(file); } catch (err) { importError = String(err && err.message || err); }
  const imported = e.selectedAsset;
  const budgetOk = !!(imported && imported.type === 'gltf' && imported.budget && Number.isFinite(imported.budget.triangles));

  // re-store the SAME validated blob under the benchmark's fixed cache id. Delete any prior copy first so
  // a repeated run (shared profile) does not trip storeAsset's collision guard and get UUID-renamed.
  const blob = imported && imported.type === 'gltf' ? await e.assetLibrary.store.getBlob(imported.id) : null;
  if (blob) {
    if (e.assetLibrary.get(BENCHMARK_CACHE_ASSET_ID)) await e.assetLibrary.delete(BENCHMARK_CACHE_ASSET_ID);
    await e.assetLibrary.storeAsset({ ...imported, id: BENCHMARK_CACHE_ASSET_ID, name: 'Visual Benchmark Cache' }, blob);
  }
  const fixed = e.assetLibrary.get(BENCHMARK_CACHE_ASSET_ID);

  // save the benchmark scene as the active world
  new WorldSerializer().save(buildVisualBenchmarkV1());
  return { budgetOk, importError, importedType: imported?.type ?? null, triangles: imported?.budget?.triangles ?? null, importedId: imported?.id ?? null, fixedPresent: !!fixed, fixedType: fixed?.type ?? null };
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "visual-benchmark-profile") },
  async () => {
    // --- SEED (editor): validated GLB under the fixed id + benchmark saved as active world ----------
    const seeder = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(seeder.cdp, "editor", 45000);
      await sleep(SETTLE_MS);
      const s = await evalValue(seeder.cdp, SEED);
      assert.ok(s && !s.missing, "the editor DEV hook is available");
      assert.equal(s.budgetOk, true, `the clean GLB imported + budget-validated (type ${s.importedType}, tris ${s.triangles}, err ${s.importError})`);
      assert.equal(s.fixedPresent, true, "the validated GLB is registered under the benchmark cache id");
      assert.equal(s.fixedType, "gltf", "the registered cache asset is a gltf");
      console.log(`  GLB validated: ${s.triangles} triangles`);
      assert.deepEqual(seeder.consoleErrors, [], `seed: zero console errors\n${seeder.consoleErrors.join("\n")}`);
      console.log("  seeded: validated GLB under the fixed cache id; benchmark saved as the active world");
    } finally {
      await seeder.close();
    }

    // --- PLAY (runtime): living world, composition, asset, paged stats, contract, completion --------
    let captured = null;
    const play = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(play.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);

      // (1) the living world + the authored composition
      const world = await evalValue(
        play.cdp,
        `(() => {
          const v0 = window.__VISUAL0_DEBUG__ ? window.__VISUAL0_DEBUG__() : null;
          const water = window.__WATER_DEBUG__ ? window.__WATER_DEBUG__() : null;
          const atmo = window.__ATMOSPHERE_DEBUG__ ? window.__ATMOSPHERE_DEBUG__() : null;
          const light = window.__LIGHTING_DEBUG__ ? window.__LIGHTING_DEBUG__() : null;
          const authoring = window.__AUTHORING__ ? window.__AUTHORING__() : null;
          const doc = window.__DOC_DEBUG__ ? window.__DOC_DEBUG__() : null;
          const assets = window.__PERF__.snapshot().assets;
          return {
            profile: v0?.profile ?? null,
            hasWater: !!water && (water.present !== false),
            fog: !!light?.fog,
            sun: light?.sunIntensity ?? null,
            atmoPresent: !!atmo,
            trailGroups: authoring?.runtime?.groups ?? 0,
            trailMarkers: authoring?.runtime?.markers ?? 0,
            authoredModifiers: authoring?.doc?.modifiers ?? 0,
            docObjects: doc?.objects ?? null,
            assetInstances: assets?.instances ?? 0,
          };
        })()`
      );
      assert.equal(world.profile, "alpine", "the glacial (alpine) valley terrain is active");
      assert.equal(world.hasWater, true, "glacial water is present");
      assert.equal(world.fog, true, "fog/atmosphere is active (readability, not soup)");
      assert.ok(Number.isFinite(world.sun) && world.sun > 0, "lighting is active (sun intensity > 0)");
      // Environment Polish-1: the per-scene lighting readability override reached the renderer (the
      // benchmark sun intensity is 2.55; the global glacial default is 2.3 — sun intensity is not
      // modulated by the atmosphere, so this is a clean live signal the override applied to THIS world).
      assert.ok(world.sun > 2.4, `per-scene lighting readability override applied (benchmark sun ${world.sun} > default 2.3)`);
      assert.ok(world.trailMarkers > 0, `the authored beacon-trail is derived + visible (${world.trailMarkers} markers)`);
      assert.ok(world.assetInstances >= 1, `the validated-GLB cache prop resolved as a rendered instance (${world.assetInstances})`);

      // Environment Polish-1: ambient particle feedback is LIVE in the runtime (emitters loaded from the
      // authored objects by ParticleRuntime — the relic shard, the cache pedestal, the crossing post).
      const liveEmitters = await evalValue(play.cdp, `window.__PARTICLE_RUNTIME__ ? window.__PARTICLE_RUNTIME__.emitters.length : -1`);
      assert.ok(liveEmitters >= 3, `ambient particle emitters are live in the runtime (${liveEmitters})`);

      // (2) landmarks + reference-only GLB in the loaded document
      const comp = await evalValue(
        play.cdp,
        `(async () => {
          const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
          const loaded = new WorldSerializer().load();
          const objs = loaded?.document?.objects ?? [];
          const landmarks = objs.filter((o) => typeof o.id === 'string' && o.id.startsWith('vb-'));
          const gltf = objs.filter((o) => o.type === 'gltf');
          const d = loaded?.document ?? {};
          return {
            landmarkCount: landmarks.length,
            gltfRefOnly: gltf.length === 1 && gltf[0].asset === null && typeof gltf[0].assetRef === 'string',
            encounters: (loaded?.document?.encounters?.items ?? []).length,
            particleEmitters: objs.filter((o) => o.particles).length,
            fogFar: d.lighting?.fog?.far ?? null,
            waterFresnel: d.water?.fresnel ?? null,
            mistStrength: d.atmosphere?.mistStrength ?? null,
          };
        })()`
      );
      assert.ok(comp.landmarkCount >= 10, `polished landmark set present in the loaded scene (${comp.landmarkCount})`);
      assert.equal(comp.gltfRefOnly, true, "the GLB cache prop is reference-only (asset:null + assetRef string)");
      assert.equal(comp.encounters, 1, "the authored combat beat is present");
      // Environment Polish-1: the per-scene readability overrides PERSISTED into the saved/loaded world
      // (each value differs from the global glacial default → a real, scoped readability pass).
      assert.equal(comp.fogFar, 380, "per-scene fog readability override persisted (benchmark 380, default 320)");
      assert.equal(comp.waterFresnel, 0.4, "per-scene water readability override persisted (benchmark 0.4, default 0.28)");
      assert.equal(comp.mistStrength, 0.32, "per-scene atmosphere readability override persisted (benchmark 0.32, default 0.4)");
      assert.ok(comp.particleEmitters >= 3, `ambient particle feedback authored in the loaded scene (${comp.particleEmitters} emitters)`);

      // (3) geometry stream — AVAILABLE + structurally measured (stats only; no production producer)
      const paged = await evalValue(
        play.cdp,
        `(async () => {
          const P = window.__PAGED__;
          if (!P) return { missing: true };
          const { createSyntheticTerrainProducer } = await import('/src/world/geometry/PagedGeometryProducer.js');
          P.mount({ maxVerticesPerChunk: 64000 });
          const pages = createSyntheticTerrainProducer({ rows: 400, cols: 200, seed: 'visual-benchmark', maxVerticesPerChunk: 64000 });
          const planned = pages.length;
          P.replacePages(pages);
          let guard = 0; while (P.snapshot().pendingPages > 0 && guard++ < 20) P.commitNext({ maxPages: 1 });
          const snap = P.snapshot();
          P.unmount();
          return { planned, committedPages: snap.committedPages, pendingPages: snap.pendingPages, vertices: snap.committedVertices };
        })()`
      );
      assert.ok(paged && !paged.missing, "the geometry stream harness is available");
      assert.ok(paged.planned >= 2, `the synthetic producer split into multiple pages (${paged.planned})`);
      assert.equal(paged.pendingPages, 0, "the geometry stream committed EVERY page (no stall / no silent guard exit)");
      assert.equal(paged.committedPages, paged.planned, `all ${paged.planned} planned pages committed (non-vacuous)`);
      assert.ok(paged.vertices > 0, `geometry stream structurally measured (${paged.committedPages} pages / ${paged.vertices} verts) — no production dependency`);

      // (4) performance contract — capture + assert within the visual-benchmark ceiling
      captured = await evalValue(
        play.cdp,
        `(() => {
          const perf = window.__PERF__.snapshot();
          const budget = window.__BUDGET__ ? window.__BUDGET__() : null;
          return { perf, budget };
        })()`
      );
      const metrics = extractMetrics({ perf: captured.perf, budget: captured.budget });
      console.log(
        `  benchmark  draws ${metrics.drawCalls}  tris ${metrics.triangles}  objs ${metrics.objects}  ` +
          `batches ${metrics.instancedBatches}  vegPatch ${metrics.visibleVegetationPatches}  rtAssets ${metrics.runtimeAssets}`
      );
      assertWithinBudget("visual-benchmark", metrics, GATED); // FAILS on breach (per-scene ceiling + global red)

      // (5) the encounter combat beat is completable — equip a weapon, defeat the sentinel
      const defeat = await evalValue(
        play.cdp,
        `(() => {
          const C = window.__ARSENAL_CARRY_DO__, D = window.__COMBAT_DO__;
          const beat = window.__ENCOUNTER__().encounters[0];
          const wid = C.place({ x: beat.position[0] + 3, z: beat.position[2] + 1 });
          C.equip(wid, 'rightHand');
          D.teleportNearTarget(beat.enemyId, 6);
          const fire = () => { D.aimAt(beat.position[0], beat.position[1] + 1.0, beat.position[2]); D.useActiveWeapon(); D.step(); };
          const before = window.__ENCOUNTER__().encounters[0].completed;
          const feedbackBefore = window.__RUNTIME_FEEDBACK__()?.cueAttempts ?? -1;
          fire(); fire(); fire();
          window.__ENEMY_DO__.step();
          window.__ENCOUNTER_DO__.step();
          const after = window.__ENCOUNTER__().encounters[0];
          const feedbackAfter = window.__RUNTIME_FEEDBACK__()?.cueAttempts ?? -1;
          return { before, completed: after.completed, enemyState: after.enemyState, feedbackBefore, feedbackAfter };
        })()`
      );
      assert.equal(defeat.before, false, "the beat was uncompleted before the strikes (non-vacuous)");
      assert.equal(defeat.enemyState, "defeated", "the sentinel was defeated by the Combat-0 hitscan");
      assert.equal(defeat.completed, true, "the encounter beat completed");
      // Environment Polish-1: the additive encounter-clear audio cue fired on completion. Audio no-ops in
      // headless (suspended AudioContext), so the cue counter is the provable signal the WIRING ran.
      assert.equal(defeat.feedbackBefore, 0, "no encounter cue before the beat cleared (non-vacuous)");
      assert.ok(defeat.feedbackAfter >= 1, `the additive encounter-clear audio cue fired (cueAttempts ${defeat.feedbackAfter})`);

      // (6) the relic objective is completable — equip relic, carry to cache, deposit
      const relic = await evalValue(
        play.cdp,
        `(() => {
          const O = window.__OBJECTIVE_DO__;
          O.equipRelic('rightHand');
          O.teleportToCache();
          const before = window.__OBJECTIVE_DEBUG__().completed;
          const deposited = O.deposit();
          O.save();
          const after = window.__OBJECTIVE_DEBUG__();
          return { before, deposited, completed: after.completed };
        })()`
      );
      assert.equal(relic.before, false, "the relic objective was incomplete before deposit (non-vacuous)");
      assert.equal(relic.completed, true, "the relic objective completed (find → carry → deposit)");

      assert.deepEqual(play.consoleErrors, [], `play: zero console errors\n${play.consoleErrors.join("\n")}`);
      console.log("  living world + composition + GLB + paged stats + contract; encounter AND relic completed");
    } finally {
      await play.close();
    }

    // --- RELOAD: completion persists, scene stable, 0 errors ----------------------------------------
    const replay = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(replay.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);
      const reloaded = await evalValue(
        replay.cdp,
        `(() => {
          const obj = window.__OBJECTIVE_DEBUG__();
          const enc = window.__ENCOUNTER__()?.encounters?.[0] ?? null;
          const perf = window.__PERF__.snapshot();
          return { objectiveCompleted: obj.completed, encounterCompleted: enc?.completed ?? null, profile: window.__VISUAL0_DEBUG__().profile, instances: perf.assets?.instances ?? 0 };
        })()`
      );
      assert.equal(reloaded.objectiveCompleted, true, "the relic objective completion persisted across reload");
      assert.equal(reloaded.encounterCompleted, true, "the encounter completion persisted across reload");
      assert.equal(reloaded.profile, "alpine", "the glacial valley re-loaded stably");
      assert.ok(reloaded.instances >= 1, "the GLB cache prop re-resolved after reload");
      assert.deepEqual(replay.consoleErrors, [], `reload: zero console errors\n${replay.consoleErrors.join("\n")}`);
      console.log("  reload: objective + encounter completion persisted; scene stable; GLB re-resolved");
    } finally {
      await replay.close();
    }

    console.log("\n  authored corridor: intentional (composition+GLB+trail) · measurable (contract) · playable (relic+encounter) · reload-safe; 0 console errors");
  }
);

if (run.skipped) console.log("browser visual-benchmark proof skipped (no browser)");
else console.log("browser visual-benchmark proof passed");
