// test:content-4-threat-aware-polish-proof — Content-4 (threat-aware encounter polish) in a real (SwiftShader)
// WebGL runtime, on the benchmark's mixed cache engagement. It proves the Combat-1 threat now READS well
// WITHOUT new combat rules: (1) at the mixed gate the overlapping danger rings DE-NOISE to ONE prominent ring;
// (2) the threat warning NAMES the moment ("The pass — fall back" / "The crossing — fall back"); (3) an
// authored teaching sign explains the (non-lethal) wards; (4) the player can recover + the encounters stay
// completable; reload-safe; benchmark within budget; 0 console errors. ThreatLogic (the state machine + its
// constants) is unchanged — only presentation + authored data. Skips without Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";
import { assertWithinBudget, extractMetrics } from "../src/perf/PerformanceContract.js";
import { visualBenchmarkScene } from "../src/perf/BenchmarkScenes.js";

const ROOT = process.cwd();
const PORT = 5262;
const CDP_PORT = 9397;
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

// Outside the zone: identify the cache pair + the crossing, and capture a clean perf baseline (rings hidden).
const STAGE = `(() => {
  const enc = window.__ENCOUNTER__().encounters;
  const f = (id) => enc.find((e) => e.id === id);
  window.__THREAT_DO__.step();
  return {
    cacheS: { id: f('vb-cache-sentinel').enemyId, centre: f('vb-cache-sentinel').position, label: f('vb-cache-sentinel').label },
    cacheW: { id: f('vb-cache-wisp').enemyId, centre: f('vb-cache-wisp').position, label: f('vb-cache-wisp').label },
    crossing: { id: f('vb-crossing-sentinel').enemyId, centre: f('vb-crossing-sentinel').position, label: f('vb-crossing-sentinel').label },
    events: window.__THREAT__().events,
  };
})()`;

const captureExpr = `(() => ({ perf: window.__PERF__.snapshot(), budget: window.__BUDGET__ ? window.__BUDGET__() : null }))()`;

// De-noise: stand the player inside BOTH cache outer zones but outside both danger windows (no fire), on the
// side nearer the sentinel. Read live enemy positions so the wisp's drift can't flip "nearest". Assert BOTH
// rings are visible yet EXACTLY ONE is prominent (the nearer sentinel) — never a two-ring blob.
const denoise = (sId, wId) => `(() => {
  const prox = window.__ENEMY_PROXIMITY__();
  const s = prox.find((p) => p.id === '${sId}'), w = prox.find((p) => p.id === '${wId}');
  const sx = s.position[0], sz = s.position[2], wx = w.position[0], wz = w.position[2];
  let ux = wx - sx, uz = wz - sz; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul; // S→W unit
  const vx = -uz, vz = ux; // perpendicular
  const px = sx + ux * 0.5 + vx * 4, pz = sz + uz * 0.5 + vz * 4; // inside both zones, outside both windows, nearer S
  window.__COMBAT_DO__.teleportTo(px, pz);
  window.__THREAT_DO__.step();
  const th = window.__THREAT__().threats;
  const ts = th.find((q) => q.id === '${sId}'), tw = th.find((q) => q.id === '${wId}');
  const prominentCount = th.filter((q) => q.prominent).length;
  return {
    sVisible: ts.ringVisible, wVisible: tw.ringVisible,
    sProminent: ts.prominent, wProminent: tw.prominent,
    sOpacity: ts.ringOpacity, wOpacity: tw.ringOpacity,
    prominentCount, events: window.__THREAT__().events,
  };
})()`;

// Moment-named warning: reset clean, cross into ONE enemy's danger window (computed from live position), and
// read the warning copy. `ref` is the enemy whose live position frames the crossing; `dr` its danger radius.
const fireMoment = (eid, otherId) => `(() => {
  const D = window.__COMBAT_DO__, T = window.__THREAT_DO__;
  const here = () => window.__ENEMY_PROXIMITY__().find((p) => p.id === '${eid}');
  const there = () => window.__ENEMY_PROXIMITY__().find((p) => p.id === '${otherId}');
  // clean reset: far away clears cooldown + prev
  const far = there() || here();
  for (let k = 0; k < 220; k++) { D.teleportTo(far.position[0], far.position[2] + 300); T.step(1 / 60); }
  const e0 = window.__THREAT__().events;
  // approach: a point ~1.4 m from this enemy on the side AWAY from the other (so only THIS one fires)
  const me = here(); const ot = there();
  let ax = me.position[0] - (ot ? ot.position[0] : me.position[0] - 1);
  let az = me.position[2] - (ot ? ot.position[2] : me.position[2]);
  const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
  D.teleportTo(me.position[0] + ax * 1.4, me.position[2] + az * 1.4);
  T.step(1 / 60);
  const snap = window.__THREAT__();
  return { fired: snap.events - e0, warning: snap.feedback && snap.feedback.lastWarning };
})()`;

// The authored teaching sign: loaded by the interaction runtime + surfaces its (non-lethal) wards text on approach.
const SIGN = `(async () => {
  const { buildVisualBenchmarkV1 } = await import('/src/world/samples/visualBenchmarkV1.js');
  const sign = buildVisualBenchmarkV1().objects.find((o) => o.id === 'vb-threat-sign');
  const p = sign.transform.position;
  const before = window.__INTERACTION_RUNTIME__.debugSnapshot().counts.signs;
  window.__COMBAT_DO__.teleportTo(p.x, p.z);
  window.__INTERACTION_RUNTIME__.update(0); // resolve the nearest sign deterministically
  return { signs: before, message: window.__INTERACTION_RUNTIME__.debugSnapshot().message };
})()`;

// Recovery + completable: defeat the cache pair with ONE weapon (Content-3 recipe) → the gate clears despite
// the threat. (The relic deposit loop is covered by first-playable; here we prove the beats stay completable.)
const COMPLETE = `(() => {
  const enc = () => window.__ENCOUNTER__().encounters;
  const by = (id) => enc().find((e) => e.id === id);
  const D = window.__COMBAT_DO__, E = window.__ENEMY_DO__, K = window.__ENCOUNTER_DO__, live = window.__ENEMY_LIVE__;
  const sId = by('vb-cache-sentinel').enemyId, wId = by('vb-cache-wisp').enemyId;
  const sc = by('vb-cache-sentinel').position;
  const wid = window.__ARSENAL_CARRY_DO__.place({ x: sc[0] + 3, z: sc[2] + 1 });
  window.__ARSENAL_CARRY_DO__.equip(wid, 'rightHand');
  const fireS = () => { D.teleportNearTarget(sId, 6); window.__SCENE_SYNC__(); const c = by('vb-cache-sentinel').position; D.aimAt(c[0], c[1] + 1.0, c[2]); D.useActiveWeapon(); D.step(); E.step(); };
  let g = 0; while (by('vb-cache-sentinel').enemyState !== 'defeated' && g < 24) { fireS(); g++; }
  const fireW = () => { D.teleportNearTarget(wId, 5); window.__SCENE_SYNC__(); const q = live().find((l) => l.id === wId).position; D.aimAt(q[0], q[1], q[2]); D.useActiveWeapon(); D.step(); E.step(); };
  let wg = 0; while (by('vb-cache-wisp').enemyState !== 'defeated' && wg < 40) { fireW(); wg++; }
  K.step();
  return { sDone: by('vb-cache-sentinel').completed, wDone: by('vb-cache-wisp').completed };
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "content-4-profile") },
  async () => {
    const seeder = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(seeder.cdp, "editor", 45000);
      await sleep(SETTLE_MS);
      const s = await evalValue(seeder.cdp, SEED);
      assert.ok(s && !s.missing, "the editor DEV hook is available");
      assert.equal(s.fixedPresent, true, "the validated GLB is registered under the benchmark cache id");
      assert.deepEqual(seeder.consoleErrors, [], `seed: zero console errors\n${seeder.consoleErrors.join("\n")}`);
      console.log("  seeded: benchmark (mixed cache engagement + threat sign) saved as the active world");
    } finally {
      await seeder.close();
    }

    const play = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(play.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);

      const stage = await evalValue(play.cdp, STAGE);
      assert.equal(stage.cacheS.label, "the pass", "the cache sentinel is 'the pass'");
      assert.equal(stage.crossing.label, "the crossing", "the crossing sentinel is 'the crossing'");

      // perf baseline (player far, rings hidden) — the +1 teaching sign keeps the benchmark within budget.
      const cap = await evalValue(play.cdp, captureExpr);
      const metrics = extractMetrics({ perf: cap.perf, budget: cap.budget });
      console.log(`  benchmark  draws ${metrics.drawCalls}  tris ${metrics.triangles}  objs ${metrics.objects}  batches ${metrics.instancedBatches}`);
      assertWithinBudget("visual-benchmark", metrics, GATED);

      // (1) DE-NOISE: both cache rings visible, exactly ONE prominent.
      const dn = await evalValue(play.cdp, denoise(stage.cacheS.id, stage.cacheW.id));
      assert.equal(dn.events, 0, "the de-noise vantage is outside both danger windows (no threat fired)");
      assert.ok(dn.sVisible && dn.wVisible, "both overlapping cache danger rings are visible at the mixed gate");
      assert.equal(dn.prominentCount, 1, "EXACTLY ONE ring is prominent (the overlap de-noises to a single clear ring)");
      assert.equal(dn.sProminent, true, "the nearer (sentinel) ring is the prominent one");
      assert.equal(dn.wProminent, false, "the farther (wisp) ring is dimmed, not a second equal ring");
      assert.ok(dn.sOpacity > dn.wOpacity, `the prominent ring is brighter than the dimmed one (${dn.sOpacity.toFixed(2)} > ${dn.wOpacity.toFixed(2)})`);
      console.log(`  de-noise: both rings visible, ONE prominent (sentinel ${dn.sOpacity.toFixed(2)} vs wisp ${dn.wOpacity.toFixed(2)})`);

      // (2) MOMENT-NAMED WARNING: the cache names "the pass", the crossing names "the crossing".
      const wPass = await evalValue(play.cdp, fireMoment(stage.cacheS.id, stage.cacheW.id));
      assert.equal(wPass.fired, 1, "crossing the cache sentinel's window fires once");
      assert.equal(wPass.warning, "The pass — fall back", `the cache warning names the moment (${JSON.stringify(wPass.warning)})`);
      const wCross = await evalValue(play.cdp, fireMoment(stage.crossing.id, stage.cacheS.id));
      assert.equal(wCross.fired, 1, "crossing the crossing sentinel's window fires once");
      assert.equal(wCross.warning, "The crossing — fall back", `the crossing warning names the moment (${JSON.stringify(wCross.warning)})`);
      console.log("  warning: names the moment — 'The pass — fall back' / 'The crossing — fall back'");

      // (3) the authored teaching sign is loaded + surfaces the non-lethal wards text.
      const sign = await evalValue(play.cdp, SIGN);
      assert.ok(sign.signs >= 2, `the threat-teaching sign is loaded alongside the shrine sign (${sign.signs} signs)`);
      assert.ok(typeof sign.message === "string" && /ward|shove|fell you|fall back/i.test(sign.message), `the sign surfaces the (non-lethal) wards teaching (${JSON.stringify(sign.message)})`);
      console.log("  sign: the threat-teaching sign is loaded + surfaces its recovery text");

      // (4) recovery + completable: the threat never blocks the gate — both cache beats complete.
      const done = await evalValue(play.cdp, COMPLETE);
      assert.equal(done.sDone, true, "the cache sentinel beat still completes despite the threat");
      assert.equal(done.wDone, true, "the cache wisp beat still completes despite the threat");
      console.log("  completable: the gate clears despite the threat (both cache beats complete)");

      assert.deepEqual(play.consoleErrors, [], `play: zero console errors\n${play.consoleErrors.join("\n")}`);
    } finally {
      await play.close();
    }

    // RELOAD: the authored sign persists; the transient threat state is dropped (events 0); completions persist.
    const replay = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(replay.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);
      const r = await evalValue(
        replay.cdp,
        `(async () => {
          window.__THREAT_DO__.step();
          const signs = window.__INTERACTION_RUNTIME__.debugSnapshot().counts.signs;
          const enc = window.__ENCOUNTER__().encounters; const by = (id) => enc.find((e) => e.id === id);
          return { events: window.__THREAT__().events, signs, cacheDone: by('vb-cache-sentinel').completed };
        })()`
      );
      assert.equal(r.events, 0, "the transient threat state does NOT persist across reload (events 0)");
      assert.ok(r.signs >= 2, "the authored teaching sign persists across reload");
      assert.equal(r.cacheDone, true, "the cache completion persisted across reload");
      assert.deepEqual(replay.consoleErrors, [], `reload: zero console errors\n${replay.consoleErrors.join("\n")}`);
      console.log("  reload: sign persists, transient threat dropped (0 events), completion persisted");
    } finally {
      await replay.close();
    }

    console.log("\n  threat-aware polish: mixed-gate rings de-noise to ONE prominent ring · warning names the moment · teaching sign reads · completable · reload-safe · benchmark green · 0 console errors");
  }
);

if (run.skipped) console.log("browser content-4-threat-aware-polish proof skipped (no browser)");
else console.log("browser content-4-threat-aware-polish proof passed");
