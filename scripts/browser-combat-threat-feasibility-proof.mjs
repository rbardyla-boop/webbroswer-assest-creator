// test:combat-threat-feasibility-proof — Combat-1 enemy threat in a real (SwiftShader) WebGL runtime, on the
// benchmark's mixed cache engagement. The threat is a SEPARATE, transient seam from CombatRuntime (which owns
// player→enemy strikes): an enemy telegraphs a danger window, the player CROSSING in gets ONE bounded
// non-lethal feedback event (a terrain-clamped knockback + a warning), a cooldown blocks re-fire spam, a
// defeated enemy never threatens, the encounter stays completable, and a reload drops every transient threat.
//
// The cache sentinel is STATIONARY; the cache wisp shares its gate (its radius-6 zone overlaps), so the proof
// stands the player inside the sentinel's danger window but on the side AWAY from the wisp — isolating one
// enemy so the per-enemy `fires` count + the single knockback are clean. End to end:
//   load → OUTSIDE the zone: zero events, ring hidden, benchmark within budget →
//   ENTER (isolated side): the sentinel fires exactly ONE event; the player is knocked back a bounded
//     distance AWAY onto walkable ground →
//   COOLDOWN: a clean crossing fires once, standing inside never re-fires (no spam), exit + cooldown re-arms →
//   DEFEAT (Content-3 recipe): the defeated sentinel never threatens again + its ring hides; the beat
//     completes → RELOAD: the transient threat is gone (events 0); the completion persists; 0 console errors.
// CombatRuntime / EnemyTargetAdapter / EncounterPresentation / both player controllers are unchanged. Skips without Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";
import { assertWithinBudget, extractMetrics } from "../src/perf/PerformanceContract.js";
import { visualBenchmarkScene } from "../src/perf/BenchmarkScenes.js";
import { THREAT_KNOCKBACK } from "../src/world/combat/ThreatLogic.js";

const ROOT = process.cwd();
const PORT = 5260;
const CDP_PORT = 9395;
const BASE = `http://127.0.0.1:${PORT}`;
const SETTLE_MS = 1400;
const GATED = visualBenchmarkScene().gated;
const CAP = THREAT_KNOCKBACK;

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

// OUTSIDE the zone (player at the overlook): the cache sentinel is dormant. Return the sentinel + wisp
// centres (to isolate the sentinel) + the derived danger radius + the threat baseline.
const STAGED = `(() => {
  const enc = window.__ENCOUNTER__().encounters;
  const cs = enc.find((e) => e.id === 'vb-cache-sentinel');
  const cw = enc.find((e) => e.id === 'vb-cache-wisp');
  window.__THREAT_DO__.step(); // one tick so the threat snapshot sees the current (far) player
  const snap = window.__THREAT__();
  const t = snap.threats.find((q) => q.id === cs.enemyId) ?? null;
  return {
    enemyId: cs.enemyId, centre: cs.position, wispCentre: cw ? cw.position : null,
    events: snap.events, dangerRadius: t ? t.dangerRadius : null,
    fires: t ? t.fires : null, inWindow: t ? t.inWindow : null, ringVisible: t ? t.ringVisible : null,
  };
})()`;

const captureExpr = `(() => ({ perf: window.__PERF__.snapshot(), budget: window.__BUDGET__ ? window.__BUDGET__() : null }))()`;

// ENTER: reset to a clean far state, then cross INTO the sentinel's danger window (isolated side) → that
// sentinel fires exactly once + a bounded terrain-clamped knockback away from it. Synchronous → no interleave.
const enterAndKnockback = (eid, ox, oz, cx, cz) => `(() => {
  const D = window.__COMBAT_DO__, T = window.__THREAT_DO__;
  const sFires = () => { const t = window.__THREAT__().threats.find((q) => q.id === '${eid}'); return t ? t.fires : 0; };
  for (let k = 0; k < 220; k++) { D.teleportTo(${cx}, ${cz} + 200); T.step(1 / 60); } // far → clears cooldown + prev
  const f0 = sFires(), e0 = window.__THREAT__().events;
  D.teleportTo(${ox}, ${oz});
  const p0 = window.__PLAYER_POS__();
  T.step(1 / 60); // the crossing → fires + knockback
  const snap = window.__THREAT__();
  const p1 = window.__PLAYER_POS__();
  const dx = p1[0] - p0[0], dz = p1[2] - p0[2]; // how far the knockback moved the player (planar)
  const ax = p0[0] - ${cx}, az = p0[2] - ${cz}; // player-relative-to-enemy before the push
  return {
    sentinelFired: sFires() - f0, totalFired: snap.events - e0, lastId: snap.lastEvent && snap.lastEvent.id,
    kb: snap.feedback && snap.feedback.lastKnockback,
    moved: Math.hypot(dx, dz), away: dx * ax + dz * az, // away>0 ⇒ pushed away from the enemy
  };
})()`;

// COOLDOWN / no-spam: reset clean → a crossing fires once → holding inside never re-fires → exit + cooldown
// re-arms. Tracks the SENTINEL's per-enemy fire count (the adjacent wisp never reaches this isolated point).
const cooldownNoSpam = (eid, ox, oz, cx, cz) => `(() => {
  const D = window.__COMBAT_DO__, T = window.__THREAT_DO__;
  const sFires = () => { const t = window.__THREAT__().threats.find((q) => q.id === '${eid}'); return t ? t.fires : 0; };
  for (let k = 0; k < 220; k++) { D.teleportTo(${cx}, ${cz} + 200); T.step(1 / 60); } // clean reset
  const base = sFires();
  D.teleportTo(${ox}, ${oz}); T.step(1 / 60); // a clean crossing → +1
  const afterEnter = sFires();
  for (let k = 0; k < 300; k++) { D.teleportTo(${ox}, ${oz}); T.step(1 / 60); } // hold inside 5 s → no spam
  const afterHold = sFires();
  for (let k = 0; k < 220; k++) { D.teleportTo(${cx}, ${cz} + 200); T.step(1 / 60); } // exit + cooldown
  const afterExit = sFires();
  D.teleportTo(${ox}, ${oz}); T.step(1 / 60); // re-enter after the cooldown → re-arms
  const afterRearm = sFires();
  return { base, afterEnter, afterHold, afterExit, afterRearm };
})()`;

// Defeat both cache enemies with ONE weapon (Content-3 recipe), then prove the DEFEATED sentinel never
// threatens again (its ring hides), and the beat completes.
const defeatAndDisable = (eid, ox, oz, cx, cz) => `(() => {
  const enc = () => window.__ENCOUNTER__().encounters;
  const by = (id) => enc().find((e) => e.id === id);
  const D = window.__COMBAT_DO__, E = window.__ENEMY_DO__, K = window.__ENCOUNTER_DO__, T = window.__THREAT_DO__, live = window.__ENEMY_LIVE__;
  const sId = by('vb-cache-sentinel').enemyId, wId = by('vb-cache-wisp').enemyId;
  const sc = by('vb-cache-sentinel').position;
  const wid = window.__ARSENAL_CARRY_DO__.place({ x: sc[0] + 3, z: sc[2] + 1 });
  window.__ARSENAL_CARRY_DO__.equip(wid, 'rightHand');
  const fireS = () => { D.teleportNearTarget(sId, 6); window.__SCENE_SYNC__(); const c = by('vb-cache-sentinel').position; D.aimAt(c[0], c[1] + 1.0, c[2]); D.useActiveWeapon(); D.step(); E.step(); };
  let g = 0; while (by('vb-cache-sentinel').enemyState !== 'defeated' && g < 24) { fireS(); g++; }
  const fireW = () => { D.teleportNearTarget(wId, 5); window.__SCENE_SYNC__(); const q = live().find((l) => l.id === wId).position; D.aimAt(q[0], q[1], q[2]); D.useActiveWeapon(); D.step(); E.step(); };
  let wg = 0; while (by('vb-cache-wisp').enemyState !== 'defeated' && wg < 40) { fireW(); wg++; }
  K.step();

  const sFires = () => { const t = window.__THREAT__().threats.find((q) => q.id === '${eid}'); return t ? t.fires : 0; };
  for (let k = 0; k < 220; k++) { D.teleportTo(${cx}, ${cz} + 200); T.step(1 / 60); } // clean reset
  const base = sFires();
  for (let k = 0; k < 120; k++) { D.teleportTo(${ox}, ${oz}); T.step(1 / 60); } // stand inside the (defeated) window
  const after = sFires();
  const ring = window.__THREAT__().threats.find((q) => q.id === '${eid}');
  return {
    sentinelDefeated: by('vb-cache-sentinel').enemyState === 'defeated',
    wispDefeated: by('vb-cache-wisp').enemyState === 'defeated',
    completed: by('vb-cache-sentinel').completed,
    base, after, ringVisible: ring ? ring.ringVisible : null,
  };
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "combat-threat-profile") },
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

      // (1) OUTSIDE the zone: dormant — zero events, danger ring hidden.
      const staged = await evalValue(play.cdp, STAGED);
      assert.ok(staged.enemyId && staged.wispCentre, "the cache sentinel + wisp are present (zone-bearing)");
      assert.equal(staged.events, 0, "no threat events while the player is outside the zone");
      assert.ok(staged.dangerRadius > 0, `the cache sentinel has a danger window (radius ${staged.dangerRadius?.toFixed(2)})`);
      assert.equal(staged.inWindow, false, "the player is NOT in the danger window at the overlook");
      assert.equal(staged.ringVisible, false, "the danger ring is HIDDEN while the player is far (benchmark-safe)");
      console.log(`  outside: dormant (0 events, ring hidden); danger radius ${staged.dangerRadius.toFixed(2)} m`);

      // perf: clean baseline (player far, rings hidden) stays within the Performance Contract → no re-lock.
      const cap = await evalValue(play.cdp, captureExpr);
      const metrics = extractMetrics({ perf: cap.perf, budget: cap.budget });
      console.log(`  benchmark  draws ${metrics.drawCalls}  tris ${metrics.triangles}  objs ${metrics.objects}  batches ${metrics.instancedBatches}`);
      assertWithinBudget("visual-benchmark", metrics, GATED);

      // Isolate the sentinel: a point inside its danger window, on the side AWAY from the overlapping wisp.
      const dirx = staged.centre[0] - staged.wispCentre[0];
      const dirz = staged.centre[2] - staged.wispCentre[2];
      const dlen = Math.hypot(dirx, dirz) || 1;
      const ox = staged.centre[0] + (dirx / dlen) * (staged.dangerRadius * 0.6);
      const oz = staged.centre[2] + (dirz / dlen) * (staged.dangerRadius * 0.6);

      // (2) ENTER the danger window: ONE event (this sentinel) + a bounded terrain-clamped knockback away.
      const enter = await evalValue(play.cdp, enterAndKnockback(staged.enemyId, ox, oz, staged.centre[0], staged.centre[2]));
      assert.equal(enter.sentinelFired, 1, "crossing INTO the danger window fires this sentinel exactly ONCE");
      assert.equal(enter.totalFired, 1, "only the isolated sentinel fired (the adjacent wisp is out of range)");
      assert.equal(enter.lastId, staged.enemyId, "the event is attributed to the cache sentinel");
      assert.ok(enter.kb && enter.kb.applied === true, "the knockback was applied (the destination was walkable)");
      assert.ok(enter.moved > 1e-3, `the player was physically knocked back (${enter.moved.toFixed(3)} m)`);
      assert.ok(enter.moved <= CAP + 1e-6, `the knockback is BOUNDED ≤ ${CAP} m (moved ${enter.moved.toFixed(3)})`);
      assert.ok(enter.away > 0, "the knockback pushes the player AWAY from the enemy");
      console.log(`  enter: 1 event + bounded knockback ${enter.moved.toFixed(2)} m away from the enemy (onto walkable ground)`);

      // (3) COOLDOWN / no-spam: clean crossing → +1; hold inside → +0; exit + cooldown → re-arms.
      const cd = await evalValue(play.cdp, cooldownNoSpam(staged.enemyId, ox, oz, staged.centre[0], staged.centre[2]));
      assert.equal(cd.afterEnter, cd.base + 1, "a clean crossing fires exactly once");
      assert.equal(cd.afterHold, cd.afterEnter, "standing inside for 5 s does NOT re-fire (no spam)");
      assert.equal(cd.afterExit, cd.afterHold, "no events fire while the player is outside the window");
      assert.equal(cd.afterRearm, cd.afterHold + 1, "exit + cooldown re-arms → a fresh crossing fires again");
      console.log("  cooldown: one event per crossing, no spam while inside, re-arms after exit + cooldown");

      // (4)+(5) DEFEAT → the defeated enemy never threatens again; the beat completes.
      const def = await evalValue(play.cdp, defeatAndDisable(staged.enemyId, ox, oz, staged.centre[0], staged.centre[2]));
      assert.equal(def.sentinelDefeated, true, "the cache sentinel was defeated (still a combat target)");
      assert.equal(def.wispDefeated, true, "the cache wisp was defeated (still a combat target)");
      assert.equal(def.after, def.base, "a DEFEATED enemy never fires a threat (0 new events while standing inside)");
      assert.equal(def.ringVisible, false, "the defeated enemy's danger ring is hidden (no telegraph)");
      assert.equal(def.completed, true, "the encounter beat still COMPLETES (threat never blocked completion)");
      console.log("  defeat: the defeated enemy stops threatening + its ring hides; the beat completes");

      assert.deepEqual(play.consoleErrors, [], `play: zero console errors\n${play.consoleErrors.join("\n")}`);
    } finally {
      await play.close();
    }

    // RELOAD: the transient threat state is dropped (events 0); the cache completion persists.
    const replay = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(replay.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);
      const r = await evalValue(
        replay.cdp,
        `(() => { window.__THREAT_DO__.step(); const enc = window.__ENCOUNTER__().encounters; const by = (id) => enc.find((e) => e.id === id); return { events: window.__THREAT__().events, cacheDone: by('vb-cache-sentinel').completed, crossingLive: by('vb-crossing-sentinel').completed }; })()`
      );
      assert.equal(r.events, 0, "the transient threat state does NOT persist across reload (events reset to 0)");
      assert.equal(r.cacheDone, true, "the cache completion persisted across reload (threat never touched logical state)");
      assert.equal(r.crossingLive, false, "the separate crossing beat stayed live");
      assert.deepEqual(replay.consoleErrors, [], `reload: zero console errors\n${replay.consoleErrors.join("\n")}`);
      console.log("  reload: transient threat dropped (0 events); the cache completion persisted");
    } finally {
      await replay.close();
    }

    console.log("\n  enemy threat feasibility: dormant outside · one bounded knockback per crossing · no spam · re-arms · defeat disables · completable · reload-safe · benchmark green · 0 console errors");
  }
);

if (run.skipped) console.log("browser combat-threat-feasibility proof skipped (no browser)");
else console.log("browser combat-threat-feasibility proof passed");
