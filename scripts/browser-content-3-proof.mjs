// test:content-3-proof — Content-3 mixed enemy encounter composition in a real (SwiftShader) WebGL
// runtime, on visual-benchmark-1. The cache gate is now a MIXED final guardian: a glacial_sentinel AND a
// frost_wisp, two INDEPENDENT single-enemy beats whose zones overlap. Proven through authored composition
// alone — no new enemy systems, no schema change, no waves. End to end:
//   load → the benchmark stages THREE beats; the CACHE gate pairs a sentinel + a hovering wisp, BOTH
//     combat targets, the wisp the lone hover actor; the crossing is a separate engagement →
//   approach → standing at the cache gate telegraphs BOTH cache beats (neither dormant) — one engagement →
//   strike → ONE equipped weapon defeats the cache sentinel AND the cache wisp (same weaponId); defeating
//     the sentinel leaves the wisp ALIVE + its beat incomplete (independent), and never touches the crossing →
//   reload → both cache completions persist while the crossing beat stays live; 0 console errors,
//     benchmark within the Performance Contract.
// Combat-0 / the enemy FSM / EncounterRuntime / EncounterPresentation are unchanged. Skips without Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";
import { assertWithinBudget, extractMetrics } from "../src/perf/PerformanceContract.js";
import { visualBenchmarkScene } from "../src/perf/BenchmarkScenes.js";

const ROOT = process.cwd();
const PORT = 5257;
const CDP_PORT = 9392;
const BASE = `http://127.0.0.1:${PORT}`;
const SETTLE_MS = 1400;
const GATED = visualBenchmarkScene().gated;

// Seed identical to the sibling benchmark proofs: register the clean GLB under the benchmark cache id and
// save visual-benchmark-1 as the active world (so bare ?runtime=1 reloads load the saved world).
const SEED = `(async () => {
  const e = window.__WORLD_EDITOR__;
  if (!e) return { missing: true };
  const { exportCleanAssetGLB } = await import('/src/assets/fixtures/assetBudgetFixtures.js');
  const { buildVisualBenchmarkV1, BENCHMARK_CACHE_ASSET_ID } = await import('/src/world/samples/visualBenchmarkV1.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  const glb = await exportCleanAssetGLB();
  const file = new File([new Blob([glb])], 'benchmark-cache.glb', { type: 'model/gltf-binary' });
  try { await e._importGLTF(file); } catch (err) {}
  const imported = e.selectedAsset;
  const blob = imported && imported.type === 'gltf' ? await e.assetLibrary.store.getBlob(imported.id) : null;
  if (blob) {
    if (e.assetLibrary.get(BENCHMARK_CACHE_ASSET_ID)) await e.assetLibrary.delete(BENCHMARK_CACHE_ASSET_ID);
    await e.assetLibrary.storeAsset({ ...imported, id: BENCHMARK_CACHE_ASSET_ID, name: 'Visual Benchmark Cache' }, blob);
  }
  new WorldSerializer().save(buildVisualBenchmarkV1());
  return { saved: true, fixedPresent: !!e.assetLibrary.get(BENCHMARK_CACHE_ASSET_ID) };
})()`;

// Staged: three beats; the cache gate pairs a sentinel + a wisp (both combat targets); the wisp is the
// lone hover actor; the two cache zones overlap.
const STAGED = `(() => {
  const enc = window.__ENCOUNTER__().encounters;
  const by = (id) => enc.find((e) => e.id === id);
  const cs = by('vb-cache-sentinel'), cw = by('vb-cache-wisp'), cx = by('vb-crossing-sentinel');
  const targetIds = window.__COMBAT__().targets.map((t) => t.id);
  const live = window.__ENEMY_LIVE__();
  const sep = Math.hypot(cs.position[0] - cw.position[0], cs.position[2] - cw.position[2]);
  return {
    ids: enc.map((e) => e.id),
    types: enc.map((e) => e.enemyType),
    cacheSentinel: cs ? { enemyId: cs.enemyId, type: cs.enemyType, state: cs.enemyState, radius: cs.radius } : null,
    cacheWisp: cw ? { enemyId: cw.enemyId, type: cw.enemyType, state: cw.enemyState, radius: cw.radius } : null,
    crossing: cx ? { enemyId: cx.enemyId } : null,
    zonesOverlap: sep < cs.radius + cw.radius,
    targetIds,
    live: live.map((l) => ({ id: l.id, kind: l.kind })),
  };
})()`;

// Strike: ONE weapon defeats the cache SENTINEL then the cache WISP. Returns telegraph + completion +
// independence + the weapon ids. Aims the sentinel at its centre, the wisp at its live hover position.
const STRIKE = `(() => {
  const enc = () => window.__ENCOUNTER__().encounters;
  const by = (id) => enc().find((e) => e.id === id);
  const D = window.__COMBAT_DO__, E = window.__ENEMY_DO__, K = window.__ENCOUNTER_DO__, live = window.__ENEMY_LIVE__;
  const pres = () => window.__ENCOUNTER_PRESENTATION__().encounters;
  const presOf = (id) => pres().find((p) => p.id === id);
  const tgt = () => { const m = {}; for (const t of window.__COMBAT__().targets) m[t.id] = t; return m; };

  const sId = by('vb-cache-sentinel').enemyId, wId = by('vb-cache-wisp').enemyId;
  const sc = by('vb-cache-sentinel').position;

  // ONE weapon, equipped once, used for BOTH.
  const wid = window.__ARSENAL_CARRY_DO__.place({ x: sc[0] + 3, z: sc[2] + 1 });
  window.__ARSENAL_CARRY_DO__.equip(wid, 'rightHand');

  // (A) approach: stand at the cache gate → BOTH cache beats telegraph (neither dormant) = one engagement.
  D.teleportNearTarget(sId, 6);
  E.step(); K.step();
  const telegraph = { sentinel: presOf('vb-cache-sentinel')?.phase, wisp: presOf('vb-cache-wisp')?.phase };

  // (B) defeat the cache SENTINEL (stationary) — re-teleport + __SCENE_SYNC__ + aim at centre, fire-until-hit.
  const fireSentinel = () => { D.teleportNearTarget(sId, 6); window.__SCENE_SYNC__(); const c = by('vb-cache-sentinel').position; D.aimAt(c[0], c[1] + 1.0, c[2]); D.useActiveWeapon(); D.step(); E.step(); };
  let sHit = null, g = 0;
  while (by('vb-cache-sentinel').enemyState !== 'defeated' && g < 24) { fireSentinel(); const ev = D.lastEvent(); if (ev && ev.hit && ev.hit.targetId === sId) sHit = ev; g++; }
  K.step();
  const sentinelDefeated = by('vb-cache-sentinel').enemyState === 'defeated';
  const sentinelCompleted = by('vb-cache-sentinel').completed;

  // (C) INDEPENDENCE at the moment of the sentinel's defeat: the wisp is alive, its beat incomplete, and
  //     the CROSSING beat (a separate engagement) is untouched.
  const wAlive = by('vb-cache-wisp').enemyState !== 'defeated';
  const wNotCompleted = by('vb-cache-wisp').completed === false;
  const crossingUntouched = by('vb-crossing-sentinel').completed === false && typeof by('vb-crossing-sentinel').enemyId === 'string';
  const wHitsBefore = tgt()[wId] ? tgt()[wId].hitCount : null;

  // (D) the SAME weapon defeats the hovering WISP (aim at its live position).
  const fireWisp = () => { D.teleportNearTarget(wId, 5); window.__SCENE_SYNC__(); const q = live().find((l) => l.id === wId).position; D.aimAt(q[0], q[1], q[2]); D.useActiveWeapon(); D.step(); E.step(); };
  let wHit = null, wg = 0;
  while (by('vb-cache-wisp').enemyState !== 'defeated' && wg < 40) { fireWisp(); const ev = D.lastEvent(); if (ev && ev.hit && ev.hit.targetId === wId) wHit = ev; wg++; }
  K.step();
  const wHitsAfter = tgt()[wId] ? tgt()[wId].hitCount : null;

  return {
    wid,
    sActiveId: sHit ? sHit.weaponId : null, sHitTarget: sHit ? sHit.hit.targetId : null,
    wActiveId: wHit ? wHit.weaponId : null, wHitTarget: wHit ? wHit.hit.targetId : null,
    telegraph, sentinelDefeated, sentinelCompleted, wAlive, wNotCompleted, crossingUntouched,
    wHitsBefore, wHitsAfter, wDefeated: by('vb-cache-wisp').enemyState === 'defeated', wCompleted: by('vb-cache-wisp').completed,
  };
})()`;

const RELOAD = `(() => {
  const enc = window.__ENCOUNTER__().encounters;
  const by = (id) => enc.find((e) => e.id === id);
  const live = window.__ENEMY_LIVE__();
  return {
    cacheSentinelCompleted: by('vb-cache-sentinel').completed, cacheSentinelEnemy: by('vb-cache-sentinel').enemyId,
    cacheWispCompleted: by('vb-cache-wisp').completed, cacheWispEnemy: by('vb-cache-wisp').enemyId,
    crossingCompleted: by('vb-crossing-sentinel').completed, crossingEnemy: by('vb-crossing-sentinel').enemyId,
    liveKinds: live.map((l) => l.kind),
    hoverCount: live.filter((l) => l.kind === 'hover').length,
  };
})()`;

const captureExpr = `(() => ({ perf: window.__PERF__.snapshot(), budget: window.__BUDGET__ ? window.__BUDGET__() : null }))()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "content-3-profile") },
  async () => {
    // --- SEED (editor) -----------------------------------------------------------------------------
    const seeder = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(seeder.cdp, "editor", 45000);
      await sleep(SETTLE_MS);
      const s = await evalValue(seeder.cdp, SEED);
      assert.ok(s && !s.missing, "the editor DEV hook is available");
      assert.equal(s.fixedPresent, true, "the validated GLB is registered under the benchmark cache id");
      assert.deepEqual(seeder.consoleErrors, [], `seed: zero console errors\n${seeder.consoleErrors.join("\n")}`);
      console.log("  seeded: benchmark (mixed cache engagement) saved as the active world");
    } finally {
      await seeder.close();
    }

    // --- PLAY (runtime) ----------------------------------------------------------------------------
    const play = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(play.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);

      // (1) staged: three beats; the cache pairs a sentinel + a wisp; both combat targets; wisp lone hover.
      const staged = await evalValue(play.cdp, STAGED);
      assert.equal(staged.ids.length, 3, "the benchmark stages three combat beats");
      assert.deepEqual(staged.ids.slice(0, 2), ["vb-crossing-sentinel", "vb-cache-sentinel"], "the crossing + cache sentinel stay items[0]/[1] (byte-stable)");
      assert.ok(staged.cacheSentinel && staged.cacheWisp, "the cache gate authors BOTH a sentinel beat and a wisp beat");
      assert.equal(staged.cacheSentinel.type, "glacial_sentinel", "the cache sentinel is a glacial_sentinel");
      assert.equal(staged.cacheWisp.type, "frost_wisp", "the cache wisp is a frost_wisp");
      assert.ok(staged.cacheSentinel.enemyId && staged.cacheWisp.enemyId && staged.cacheSentinel.enemyId !== staged.cacheWisp.enemyId, "the mixed pair project DISTINCT enemies");
      assert.ok(staged.targetIds.includes(staged.cacheSentinel.enemyId), "the cache sentinel registered as a combat target");
      assert.ok(staged.targetIds.includes(staged.cacheWisp.enemyId), "the cache wisp registered as a combat target (same StrikeEvent path)");
      assert.ok(staged.zonesOverlap, "the cache sentinel + wisp zones OVERLAP (one mixed engagement)");
      assert.equal(staged.live.filter((l) => l.kind === "hover").length, 1, "exactly ONE hover actor (the cache wisp)");
      assert.equal(staged.live.find((l) => l.kind === "hover").id, staged.cacheWisp.enemyId, "the lone hover actor is the cache wisp");
      console.log("  staged: cache gate = sentinel + wisp (overlapping zones, both combat-targeted); crossing separate");

      // perf BEFORE placing weapons (clean baseline): the benchmark stays within the Performance Contract.
      const cap = await evalValue(play.cdp, captureExpr);
      const metrics = extractMetrics({ perf: cap.perf, budget: cap.budget });
      console.log(`  benchmark  draws ${metrics.drawCalls}  tris ${metrics.triangles}  objs ${metrics.objects}  batches ${metrics.instancedBatches}`);
      assertWithinBudget("visual-benchmark", metrics, GATED);

      // (2) approach telegraphs BOTH; (3) ONE weapon defeats both; (4) independence (wisp + crossing).
      const strike = await evalValue(play.cdp, STRIKE);
      assert.notEqual(strike.telegraph.sentinel, "dormant", "standing at the cache gate, the sentinel beat telegraphs (not dormant)");
      assert.notEqual(strike.telegraph.wisp, "dormant", "standing at the cache gate, the wisp beat ALSO telegraphs (one mixed engagement)");
      assert.equal(strike.sentinelDefeated, true, "the cache sentinel was defeated");
      assert.equal(strike.sentinelCompleted, true, "the cache sentinel beat completed");
      assert.equal(strike.sHitTarget, staged.cacheSentinel.enemyId, "the sentinel strike resolved to the sentinel");
      assert.equal(strike.wAlive, true, "INDEPENDENCE: the wisp is still ALIVE when the sentinel dies");
      assert.equal(strike.wNotCompleted, true, "INDEPENDENCE: the wisp beat is NOT completed by the sentinel's defeat");
      assert.equal(strike.crossingUntouched, true, "the separate crossing engagement is untouched (still live)");
      assert.ok(strike.wHitsAfter > strike.wHitsBefore, `the same weapon registered a hit on the wisp (${strike.wHitsBefore}→${strike.wHitsAfter})`);
      assert.equal(strike.wHitTarget, staged.cacheWisp.enemyId, "the wisp strike resolved to the WISP (not the adjacent sentinel — combat distinguished them)");
      assert.equal(strike.wDefeated, true, "the cache wisp was defeated by the same hit path");
      assert.equal(strike.wCompleted, true, "the cache wisp beat completed");
      assert.ok(strike.sActiveId && strike.sActiveId === strike.wid && strike.wActiveId === strike.wid, "the SAME equipped weapon defeated BOTH archetypes (one weaponId)");
      console.log("  strike: cache gate telegraphs both → one weapon defeats sentinel + wisp (same weaponId, independent) → crossing untouched");

      assert.deepEqual(play.consoleErrors, [], `play: zero console errors\n${play.consoleErrors.join("\n")}`);
    } finally {
      await play.close();
    }

    // --- RELOAD: both cache completions persist; the crossing beat stays live ------------------------
    const replay = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(replay.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);
      const r = await evalValue(replay.cdp, RELOAD);
      assert.equal(r.cacheSentinelCompleted, true, "the cache sentinel completion persisted across reload");
      assert.equal(r.cacheSentinelEnemy, null, "a completed cache sentinel beat re-projects no enemy");
      assert.equal(r.cacheWispCompleted, true, "the cache wisp completion persisted across reload");
      assert.equal(r.cacheWispEnemy, null, "a completed cache wisp beat re-projects no enemy");
      assert.equal(r.crossingCompleted, false, "the separate crossing beat stayed LIVE (its completion did not leak)");
      assert.ok(typeof r.crossingEnemy === "string" && r.crossingEnemy.length, "the crossing beat still projects its sentinel");
      assert.equal(r.hoverCount, 0, "the defeated cache wisp is GONE after reload (no hover actor remains)");
      assert.deepEqual(r.liveKinds, ["patrol"], "the only live mover after reload is the crossing patroller (the cache beats cleared)");
      assert.deepEqual(replay.consoleErrors, [], `reload: zero console errors\n${replay.consoleErrors.join("\n")}`);
      console.log("  reload: both cache completions persisted (no enemies); the crossing engagement stayed live");
    } finally {
      await replay.close();
    }

    console.log("\n  mixed cache engagement: sentinel + wisp coexist · both telegraph · one weapon defeats both · independent · crossing untouched · reload-persists · benchmark green · 0 console errors");
  }
);

if (run.skipped) console.log("browser content-3 proof skipped (no browser)");
else console.log("browser content-3 proof passed");
