// test:enemy-proximity-proof — Enemy-3 light proximity response in a real (SwiftShader) WebGL runtime, on
// the benchmark's mixed cache engagement (a stationary glacial_sentinel + a hovering frost_wisp). The
// response is a MOTION overlay — orient/lean toward the player + bias the hover drift — NEVER attacks/damage/
// chase. End to end:
//   load → outside the zone: both cache enemies report responding:false; the sentinel yaw is stable, lean 0;
//     the wisp drifts unbiased →
//   inside the zone (player to the SIDE of the sentinel): the sentinel ORIENTS toward the player (yaw
//     converges to the bearing) + leans; the wisp's drift BIASES away from the player yet stays in-zone
//     (bounded) — both responding:true →
//   strike → both remain combat targets; ONE weapon defeats both (same StrikeEvent path) →
//   defeated → the response STOPS permanently (responding:false, pose frozen) →
//   reload → the cache completions persist; benchmark within the Performance Contract; 0 console errors.
// CombatRuntime / EnemyTargetAdapter / the patrol facing / EncounterPresentation are unchanged. Skips without Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";
import { assertWithinBudget, extractMetrics } from "../src/perf/PerformanceContract.js";
import { visualBenchmarkScene } from "../src/perf/BenchmarkScenes.js";

const ROOT = process.cwd();
const PORT = 5258;
const CDP_PORT = 9393;
const BASE = `http://127.0.0.1:${PORT}`;
const SETTLE_MS = 1400;
const GATED = visualBenchmarkScene().gated;

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

// Outside the zone (player at the overlook): both cache enemies dormant. Return their ids + positions.
const STAGED = `(() => {
  const enc = window.__ENCOUNTER__().encounters;
  const by = (id) => enc.find((e) => e.id === id);
  const cs = by('vb-cache-sentinel'), cw = by('vb-cache-wisp');
  window.__ENEMY_DO__.step(); // one tick so proximityView sees the current (far) player
  const prox = window.__ENEMY_PROXIMITY__();
  const pv = (eid) => prox.find((p) => p.id === eid) ?? null;
  return {
    sentinel: { enemyId: cs.enemyId, centre: cs.position },
    wisp: { enemyId: cw.enemyId, home: cw.position, radius: cw.radius },
    sProx: pv(cs.enemyId), wProx: pv(cw.enemyId),
  };
})()`;

// Sentinel: stand the player to the +X SIDE of the sentinel (in-zone), drive steps → it orients toward the
// player (yaw converges to the bearing) + leans; responding:true.
const sentinelTurn = (eid, sx, sz) => `(() => {
  const D = window.__COMBAT_DO__, E = window.__ENEMY_DO__;
  const px = ${sx} + 4, pz = ${sz};
  D.teleportTo(px, pz);
  for (let k = 0; k < 50; k++) E.step(1 / 30);
  const me = window.__ENEMY_PROXIMITY__().find((p) => p.id === '${eid}');
  const expectedYaw = Math.atan2(px - ${sx}, pz - ${sz});
  return { responding: me.responding, yaw: me.yaw, lean: me.lean, expectedYaw, defeated: me.defeated };
})()`;

// Wisp: read the EXACT bias vector (recorded per frame in proximityView) with the player FAR (no bias) then
// at a fixed in-zone point (bias active). Non-flaky: checks the bias directly, not a drift-confounded mean.
const wispBias = (eid, hx, hz, radius, px, pz) => `(() => {
  const E = window.__ENEMY_DO__;
  const get = () => window.__ENEMY_PROXIMITY__().find((p) => p.id === '${eid}');
  // (a) FAR: player well outside the zone → no bias.
  window.__COMBAT_DO__.teleportTo(${hx}, ${hz} + 60);
  for (let k = 0; k < 5; k++) E.step(1 / 30);
  const out = get();
  // (b) IN-ZONE: player at the fixed point → bias active, bounded, away-from-player, body stays in-zone.
  window.__COMBAT_DO__.teleportTo(${px}, ${pz});
  let maxMag = 0, minMag = Infinity, allBounded = true, allAway = true, allFinite = true, inResp = true;
  for (let k = 0; k < 40; k++) {
    E.step(1 / 30);
    const me = get();
    const mag = Math.hypot(me.bias[0], me.bias[1]);
    maxMag = Math.max(maxMag, mag); minMag = Math.min(minMag, mag);
    const ax = me.position[0] - ${px}, az = me.position[2] - ${pz}; // actor relative to the player
    if (me.bias[0] * ax + me.bias[1] * az <= 0) allAway = false; // bias must point AWAY from the player
    if (Math.hypot(me.position[0] - ${hx}, me.position[2] - ${hz}) > ${radius}) allBounded = false;
    if (!Number.isFinite(me.position[0]) || !Number.isFinite(me.position[2])) allFinite = false;
    inResp = inResp && me.responding;
  }
  return { outBias: Math.hypot(out.bias[0], out.bias[1]), outResp: out.responding, maxMag, minMag, allBounded, allAway, allFinite, inResp };
})()`;

// Defeat both cache enemies with ONE weapon (Content-3 recipe); then confirm the response stops + freezes.
const DEFEAT = `(() => {
  const enc = () => window.__ENCOUNTER__().encounters;
  const by = (id) => enc().find((e) => e.id === id);
  const D = window.__COMBAT_DO__, E = window.__ENEMY_DO__, K = window.__ENCOUNTER_DO__, live = window.__ENEMY_LIVE__;
  const sId = by('vb-cache-sentinel').enemyId, wId = by('vb-cache-wisp').enemyId;
  const sc = by('vb-cache-sentinel').position;
  const wid = window.__ARSENAL_CARRY_DO__.place({ x: sc[0] + 3, z: sc[2] + 1 });
  window.__ARSENAL_CARRY_DO__.equip(wid, 'rightHand');
  const fireSentinel = () => { D.teleportNearTarget(sId, 6); window.__SCENE_SYNC__(); const c = by('vb-cache-sentinel').position; D.aimAt(c[0], c[1] + 1.0, c[2]); D.useActiveWeapon(); D.step(); E.step(); };
  let g = 0; while (by('vb-cache-sentinel').enemyState !== 'defeated' && g < 24) { fireSentinel(); g++; }
  const fireWisp = () => { D.teleportNearTarget(wId, 5); window.__SCENE_SYNC__(); const q = live().find((l) => l.id === wId).position; D.aimAt(q[0], q[1], q[2]); D.useActiveWeapon(); D.step(); E.step(); };
  let wg = 0; while (by('vb-cache-wisp').enemyState !== 'defeated' && wg < 40) { fireWisp(); wg++; }
  K.step();

  // Response stops + pose frozen: sample proximity now, drive steps, sample again — identical positions.
  const prox0 = window.__ENEMY_PROXIMITY__();
  const f = (id) => { const p = prox0.find((q) => q.id === id); return { responding: p.responding, defeated: p.defeated, pos: p.position.slice() }; };
  const s0 = f(sId), w0 = f(wId);
  for (let k = 0; k < 30; k++) { D.teleportTo(sc[0] + 2, sc[2]); E.step(); } // player stays in-zone, but they are defeated → no response
  const prox1 = window.__ENEMY_PROXIMITY__();
  const g1 = (id) => prox1.find((q) => q.id === id).position;
  return {
    sentinelDefeated: by('vb-cache-sentinel').enemyState === 'defeated', wispDefeated: by('vb-cache-wisp').enemyState === 'defeated',
    sentinelCompleted: by('vb-cache-sentinel').completed, wispCompleted: by('vb-cache-wisp').completed,
    sResp: s0.responding, wResp: w0.responding,
    sFrozen: JSON.stringify(s0.pos) === JSON.stringify(g1(sId)), wFrozen: JSON.stringify(w0.pos) === JSON.stringify(g1(wId)),
  };
})()`;

const captureExpr = `(() => ({ perf: window.__PERF__.snapshot(), budget: window.__BUDGET__ ? window.__BUDGET__() : null }))()`;
const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d <= -Math.PI) d += Math.PI * 2; return Math.abs(d); };

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "enemy-proximity-profile") },
  async () => {
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

    const play = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(play.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);

      // (1) OUTSIDE the zone: both cache enemies dormant.
      const staged = await evalValue(play.cdp, STAGED);
      assert.ok(staged.sProx && staged.wProx, "both cache enemies appear in the proximity view (zone-bearing)");
      assert.equal(staged.sProx.responding, false, "the cache sentinel is DORMANT outside the zone");
      assert.equal(staged.wProx.responding, false, "the cache wisp is DORMANT outside the zone");
      assert.ok(Math.abs(staged.sProx.lean) < 1e-6, "the sentinel is not leaning outside the zone");
      console.log("  outside: both cache enemies dormant (no proximity response at the overlook)");

      // (2) sentinel ORIENTS toward an in-zone player + leans.
      const turn = await evalValue(play.cdp, sentinelTurn(staged.sentinel.enemyId, staged.sentinel.centre[0], staged.sentinel.centre[2]));
      assert.equal(turn.responding, true, "the sentinel RESPONDS to the in-zone player");
      assert.ok(angDiff(turn.yaw, turn.expectedYaw) < 0.2, `the sentinel yaw converged toward the player (Δ ${angDiff(turn.yaw, turn.expectedYaw).toFixed(3)} rad)`);
      assert.ok(turn.lean > 0, `the sentinel leans toward the in-zone player (${turn.lean.toFixed(3)} rad)`);
      console.log(`  sentinel: orients toward the player (yaw Δ ${angDiff(turn.yaw, turn.expectedYaw).toFixed(3)}) + leans ${turn.lean.toFixed(3)}`);

      // (3) wisp drift BIASES away from the player yet stays bounded.
      const w = staged.wisp;
      const bias = await evalValue(play.cdp, wispBias(w.enemyId, w.home[0], w.home[2], w.radius, staged.sentinel.centre[0], staged.sentinel.centre[2]));
      assert.equal(bias.outResp, false, "the wisp is dormant when the player is far (out of zone)");
      assert.ok(bias.outBias < 1e-6, `no drift bias when the player is out of zone (${bias.outBias.toExponential(1)})`);
      assert.equal(bias.inResp, true, "the wisp RESPONDS to the in-zone player");
      assert.ok(bias.minMag > 0, "the in-zone drift bias is always ACTIVE (non-zero)");
      assert.ok(bias.maxMag <= 0.5 + 1e-9, `the drift bias is BOUNDED ≤ maxBias 0.5 (peak ${bias.maxMag.toFixed(3)})`);
      assert.ok(bias.allAway, "the drift bias always points AWAY from the player");
      assert.ok(bias.allBounded, "every biased wisp sample stays WITHIN the encounter radius (bounded)");
      assert.ok(bias.allFinite, "every biased wisp sample is finite");
      console.log(`  wisp: drift biases away from the player (≤${bias.maxMag.toFixed(2)} m) + stays bounded`);

      // perf (clean baseline before weapons): the benchmark stays within the Performance Contract.
      const cap = await evalValue(play.cdp, captureExpr);
      const metrics = extractMetrics({ perf: cap.perf, budget: cap.budget });
      console.log(`  benchmark  draws ${metrics.drawCalls}  tris ${metrics.triangles}  objs ${metrics.objects}  batches ${metrics.instancedBatches}`);
      assertWithinBudget("visual-benchmark", metrics, GATED);

      // (4) both still combat targets; one weapon defeats both; (5) defeated → response stops + frozen.
      const def = await evalValue(play.cdp, DEFEAT);
      assert.equal(def.sentinelDefeated, true, "the cache sentinel was defeated (still a combat target)");
      assert.equal(def.wispDefeated, true, "the cache wisp was defeated (still a combat target)");
      assert.equal(def.sResp, false, "the defeated sentinel STOPS responding (permanently)");
      assert.equal(def.wResp, false, "the defeated wisp STOPS responding (permanently)");
      assert.equal(def.sFrozen, true, "the defeated sentinel's pose is FROZEN across further steps");
      assert.equal(def.wFrozen, true, "the defeated wisp's pose is FROZEN across further steps");
      console.log("  defeat: one weapon defeats both → the proximity response stops + the pose freezes");

      assert.deepEqual(play.consoleErrors, [], `play: zero console errors\n${play.consoleErrors.join("\n")}`);
    } finally {
      await play.close();
    }

    // RELOAD: the cache completions persist (the proximity overlay never touched logical state).
    const replay = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(replay.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);
      const r = await evalValue(
        replay.cdp,
        `(() => { const enc = window.__ENCOUNTER__().encounters; const by = (id) => enc.find((e) => e.id === id); return { s: by('vb-cache-sentinel').completed, w: by('vb-cache-wisp').completed, x: by('vb-crossing-sentinel').completed }; })()`
      );
      assert.equal(r.s, true, "the cache sentinel completion persisted across reload");
      assert.equal(r.w, true, "the cache wisp completion persisted across reload");
      assert.equal(r.x, false, "the separate crossing beat stayed live");
      assert.deepEqual(replay.consoleErrors, [], `reload: zero console errors\n${replay.consoleErrors.join("\n")}`);
      console.log("  reload: cache completions persisted (the proximity overlay is transform-only)");
    } finally {
      await replay.close();
    }

    console.log("\n  light proximity response: dormant outside · sentinel orients+leans · wisp biases+bounded · combat-target-stable · defeat stops it · reload-safe · benchmark green · 0 console errors");
  }
);

if (run.skipped) console.log("browser enemy-proximity proof skipped (no browser)");
else console.log("browser enemy-proximity proof passed");
