// test:content-5-slice-completion-proof — Content-5 (playable slice completion pass) in a real (SwiftShader)
// WebGL runtime: the benchmark run reads as ONE coherent slice with a deliberate beginning + ending, through
// authored pacing + the EXISTING feedback stack (no new combat rules). It proves, end to end:
//   opening   — the live slice resolves THIS scene's identity ("The Relic Overlook", not "The Frozen Cache")
//               and the authored orientation sign loads + surfaces the loop/recovery framing.
//   combat    — the mixed cache gate's overlapping threat rings de-noise to ONE prominent ring (Content-4);
//               a threat fires + names the moment (the player is shoved, never blocked → recoverable).
//   completion— equip the relic → carry to the cache → deposit completes the run; the completion CARD shows
//               THIS scene's name + ending copy ("The Relic Overlook"), with the trophy + the "Cache sealed" cue.
//   replay    — reload: completion + trophy persist, the identity stays the overlook (NOT reverted), 0 errors.
// The DEFAULT identity (frozen-cache / first-playable) is unchanged — proven byte-exact in the Node regression
// and by their own proofs still showing "The Frozen Cache". Skips without Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";
import { assertWithinBudget, extractMetrics } from "../src/perf/PerformanceContract.js";
import { visualBenchmarkScene } from "../src/perf/BenchmarkScenes.js";

const ROOT = process.cwd();
const PORT = 5264;
const CDP_PORT = 9399;
const BASE = `http://127.0.0.1:${PORT}`;
const SETTLE_MS = 1400;
const GATED = visualBenchmarkScene().gated;

// Seed the benchmark as the active world (the validated GLB cache prop + the authored doc), exactly as the
// other benchmark proofs do.
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

// OPENING: the live slice wrapper resolved THIS scene's completion identity (not the default frozen cache).
const OPENING = `(() => {
  const fc = window.__FROZEN_CACHE_DEBUG__();
  return { present: fc.present, identity: fc.identity, completed: fc.completed };
})()`;

const captureExpr = `(() => ({ perf: window.__PERF__.snapshot(), budget: window.__BUDGET__ ? window.__BUDGET__() : null }))()`;

// The opening orientation sign: loaded by the interaction runtime + surfaces its loop/recovery framing on approach.
const SIGN = `(async () => {
  const { buildVisualBenchmarkV1 } = await import('/src/world/samples/visualBenchmarkV1.js');
  const sign = buildVisualBenchmarkV1().objects.find((o) => o.id === 'vb-orientation-sign');
  const p = sign.transform.position;
  const before = window.__INTERACTION_RUNTIME__.debugSnapshot().counts.signs;
  window.__COMBAT_DO__.teleportTo(p.x, p.z);
  window.__INTERACTION_RUNTIME__.update(0);
  return { signs: before, message: window.__INTERACTION_RUNTIME__.debugSnapshot().message };
})()`;

// Identify the mixed cache pair (for the de-noise read).
const STAGE = `(() => {
  const enc = window.__ENCOUNTER__().encounters;
  const f = (id) => enc.find((e) => e.id === id);
  window.__THREAT_DO__.step();
  return {
    cacheS: { id: f('vb-cache-sentinel').enemyId, label: f('vb-cache-sentinel').label },
    cacheW: { id: f('vb-cache-wisp').enemyId, label: f('vb-cache-wisp').label },
    crossing: { id: f('vb-crossing-sentinel').enemyId, label: f('vb-crossing-sentinel').label },
  };
})()`;

// COMBAT readability (Content-4 invariant): at the mixed gate both rings are visible but EXACTLY ONE is
// prominent. Live positions so the wisp's drift can't flip "nearest".
const denoise = (sId, wId) => `(() => {
  const prox = window.__ENEMY_PROXIMITY__();
  const s = prox.find((p) => p.id === '${sId}'), w = prox.find((p) => p.id === '${wId}');
  const sx = s.position[0], sz = s.position[2], wx = w.position[0], wz = w.position[2];
  let ux = wx - sx, uz = wz - sz; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
  const vx = -uz, vz = ux;
  const px = sx + ux * 0.5 + vx * 4, pz = sz + uz * 0.5 + vz * 4;
  window.__COMBAT_DO__.teleportTo(px, pz);
  window.__THREAT_DO__.step();
  const th = window.__THREAT__().threats;
  const ts = th.find((q) => q.id === '${sId}'), tw = th.find((q) => q.id === '${wId}');
  return { sVisible: ts.ringVisible, wVisible: tw.ringVisible, prominentCount: th.filter((q) => q.prominent).length, sProminent: ts.prominent };
})()`;

// RECOVERY: cross into the cache sentinel's danger window (from live position) → it fires once + names the
// moment; the knockback leaves the player on finite walkable ground (never a soft-lock → the run continues).
const fireRecover = (eid, otherId) => `(() => {
  const D = window.__COMBAT_DO__, T = window.__THREAT_DO__;
  const here = () => window.__ENEMY_PROXIMITY__().find((p) => p.id === '${eid}');
  const there = () => window.__ENEMY_PROXIMITY__().find((p) => p.id === '${otherId}');
  const far = there() || here();
  for (let k = 0; k < 220; k++) { D.teleportTo(far.position[0], far.position[2] + 300); T.step(1 / 60); }
  const e0 = window.__THREAT__().events;
  const me = here(); const ot = there();
  let ax = me.position[0] - (ot ? ot.position[0] : me.position[0] - 1);
  let az = me.position[2] - (ot ? ot.position[2] : me.position[2]);
  const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
  D.teleportTo(me.position[0] + ax * 1.4, me.position[2] + az * 1.4);
  T.step(1 / 60);
  const snap = window.__THREAT__();
  const pos = window.__PLAYER_POS__ ? window.__PLAYER_POS__() : null; // [x, y, z]
  return { fired: snap.events - e0, warning: snap.feedback && snap.feedback.lastWarning, posFinite: !!pos && Number.isFinite(pos[0]) && Number.isFinite(pos[2]) };
})()`;

// COMPLETION: equip the relic → carry to the cache → deposit. The deposit drives the slice wrapper, so the
// completion CARD shows THIS scene's name + ending copy. Read the live card DOM (what the player actually sees).
const COMPLETE = `(() => {
  const O = window.__OBJECTIVE_DO__, FC = window.__FROZEN_CACHE_DO__;
  O.equipRelic('rightHand');
  O.teleportToCache();
  const before = window.__OBJECTIVE_DEBUG__().completed;
  const deposited = FC.deposit(); // tryDeposit + frozenCacheSlice.update(0) → completion card shows synchronously
  window.__SLICE_SENSORY_DO__.step(); // tick the sensory layer so the completion cue fires on the edge
  const fc = window.__FROZEN_CACHE_DEBUG__();
  const card = document.querySelector('.completion-card');
  const h1 = card ? card.querySelector('h1') : null;
  const body = card ? card.querySelector('p') : null;
  return {
    before, deposited,
    completed: window.__OBJECTIVE_DEBUG__().completed,
    cardVisible: fc.completionCardVisible,
    cardTitle: h1 ? h1.textContent : null,
    cardBody: body ? body.textContent : null,
    trophyPresent: fc.trophyPresent,
    completeCues: window.__SLICE_SENSORY__().cues.complete,
  };
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "content-5-profile") },
  async () => {
    const seeder = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(seeder.cdp, "editor", 45000);
      await sleep(SETTLE_MS);
      const s = await evalValue(seeder.cdp, SEED);
      assert.ok(s && !s.missing, "the editor DEV hook is available");
      assert.equal(s.fixedPresent, true, "the validated GLB is registered under the benchmark cache id");
      assert.deepEqual(seeder.consoleErrors, [], `seed: zero console errors\n${seeder.consoleErrors.join("\n")}`);
      console.log("  seeded: the Relic Overlook benchmark saved as the active world");
    } finally {
      await seeder.close();
    }

    const play = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(play.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);

      // OPENING: the live slice names THIS scene (the completion-identity fix) — not "The Frozen Cache".
      const open = await evalValue(play.cdp, OPENING);
      assert.equal(open.present, true, "the playable-slice wrapper is active on the benchmark");
      assert.equal(open.identity.title, "The Relic Overlook", `the slice resolves THIS scene's name (${JSON.stringify(open.identity.title)})`);
      assert.notEqual(open.identity.title, "The Frozen Cache", "the benchmark no longer inherits the frozen-cache name");
      assert.equal(open.identity.arrivalTagline, "Bear the relic to the cache beyond the pass", "the arrival banner tagline names the goal");
      console.log(`  opening: the slice names itself — "${open.identity.title} · ${open.identity.arrivalTagline}"`);

      // the orientation sign loads + surfaces the loop/recovery framing.
      const sign = await evalValue(play.cdp, SIGN);
      assert.ok(sign.signs >= 3, `the orientation sign is loaded alongside the shrine + threat signs (${sign.signs} signs)`);
      assert.ok(typeof sign.message === "string" && /relic|cache|pass|fall back/i.test(sign.message), `the orientation sign surfaces the loop/recovery framing (${JSON.stringify(sign.message)})`);
      console.log("  opening: the orientation sign loads + reads at the overlook");

      // perf baseline — the +1 orientation sign keeps the benchmark within the Performance Contract.
      const cap = await evalValue(play.cdp, captureExpr);
      const metrics = extractMetrics({ perf: cap.perf, budget: cap.budget });
      console.log(`  benchmark  draws ${metrics.drawCalls}  tris ${metrics.triangles}  objs ${metrics.objects}  batches ${metrics.instancedBatches}`);
      assertWithinBudget("visual-benchmark", metrics, GATED);

      // COMBAT readability: the mixed gate de-noises to ONE prominent ring.
      const stage = await evalValue(play.cdp, STAGE);
      const dn = await evalValue(play.cdp, denoise(stage.cacheS.id, stage.cacheW.id));
      assert.ok(dn.sVisible && dn.wVisible, "both overlapping cache danger rings are visible at the mixed gate");
      assert.equal(dn.prominentCount, 1, "EXACTLY ONE ring is prominent (the mixed gate reads as one clear ring)");
      assert.equal(dn.sProminent, true, "the nearer (sentinel) ring is the prominent one");
      console.log("  combat: the mixed cache gate de-noises to one prominent ring");

      // RECOVERY: a threat fires + names the moment; the shove leaves the player on finite ground (continuable).
      const rec = await evalValue(play.cdp, fireRecover(stage.cacheS.id, stage.cacheW.id));
      assert.equal(rec.fired, 1, "crossing the cache sentinel's window fires the threat once");
      assert.equal(rec.warning, "The pass — fall back", `the warning names the moment (${JSON.stringify(rec.warning)})`);
      assert.equal(rec.posFinite, true, "after the shove the player is on finite ground (recoverable — never a soft-lock)");
      console.log("  combat: the threat fires + names the moment; the shove is recoverable");

      // COMPLETION: deposit completes the run; the card shows THIS scene's ending (not the frozen cache).
      const done = await evalValue(play.cdp, COMPLETE);
      assert.equal(done.before, false, "the run was incomplete before deposit (non-vacuous)");
      assert.equal(done.completed, true, "depositing the relic completes the run");
      assert.equal(done.cardVisible, true, "the completion card shows on completion");
      assert.equal(done.cardTitle, "The Relic Overlook", `the completion card names THIS scene, not the frozen cache (${JSON.stringify(done.cardTitle)})`);
      assert.ok(typeof done.cardBody === "string" && /relic rests|valley stands quiet/i.test(done.cardBody), `the completion card shows the authored ending (${JSON.stringify(done.cardBody)})`);
      assert.equal(done.trophyPresent, true, "the trophy aura frames the deposited relic");
      assert.ok(done.completeCues >= 1, `the "Cache sealed" completion cue fired (${done.completeCues})`);
      console.log(`  completion: the card names the run's ending — "${done.cardTitle}" · trophy + completion cue land`);

      assert.deepEqual(play.consoleErrors, [], `play: zero console errors\n${play.consoleErrors.join("\n")}`);
    } finally {
      await play.close();
    }

    // REPLAY: reload — completion + trophy persist, and the identity STAYS the overlook (not reverted).
    const replay = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(replay.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);
      const r = await evalValue(
        replay.cdp,
        `(() => {
          const fc = window.__FROZEN_CACHE_DEBUG__();
          const card = document.querySelector('.completion-card');
          const h1 = card ? card.querySelector('h1') : null;
          window.__THREAT_DO__.step();
          return {
            objectiveCompleted: window.__OBJECTIVE_DEBUG__().completed,
            identityTitle: fc.identity.title,
            trophyPresent: fc.trophyPresent,
            cardTitle: h1 ? h1.textContent : null,
            threatEvents: window.__THREAT__().events,
          };
        })()`
      );
      assert.equal(r.objectiveCompleted, true, "the completion persisted across reload");
      assert.equal(r.identityTitle, "The Relic Overlook", "the scene identity persisted across reload (NOT reverted to 'The Frozen Cache')");
      assert.equal(r.cardTitle, "The Relic Overlook", "the reloaded completion card shows THIS scene's name");
      assert.equal(r.trophyPresent, true, "the trophy persisted across reload");
      assert.equal(r.threatEvents, 0, "the transient threat state does NOT replay across reload");
      assert.deepEqual(replay.consoleErrors, [], `reload: zero console errors\n${replay.consoleErrors.join("\n")}`);
      console.log("  replay: completion + trophy + identity persist; transient threat dropped; 0 errors");
    } finally {
      await replay.close();
    }

    console.log("\n  slice run: opening names the slice + sign reads · mixed gate de-noises · threat recoverable · completion card names THIS ending · reload-safe · benchmark green · 0 console errors");
  }
);

if (run.skipped) console.log("browser content-5-slice-completion proof skipped (no browser)");
else console.log("browser content-5-slice-completion proof passed");
