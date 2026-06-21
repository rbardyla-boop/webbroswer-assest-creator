// test:audio-feedback-proof — Audio/Feedback-1 in a real (SwiftShader) WebGL runtime, on visual-benchmark-1.
//
// Proves the slice sensory layer fires the right cues, in order, once each, and reload-safe — using the
// EXISTING ProceduralAudio engine + the existing seams (audio no-ops headless, so the cue counters /
// ordered log are the proof of wiring):
//   load visual-benchmark-1 → the sensory layer is ACTIVE + the ambient bed is engaged →
//   shrine discovery cue fires ONCE on entry (+ the visual toast mirrors it) →
//   the optional exotic reward pickup cue fires ONCE →
//   combat hit → defeat → clear cues fire in that ORDER (and RuntimeFeedback's clear chord fired) →
//   the relic deposit/completion cue (the cache payoff) fires ONCE →
//   reload → the completed one-shots do NOT replay; objective + the cleared beat persist; 0 console errors.
// No new runtime code beyond the observe-only sensory owner; no movement AI, no renderer work. Skips
// cleanly without Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5254;
const CDP_PORT = 9389;
const BASE = `http://127.0.0.1:${PORT}`;
const SETTLE_MS = 1400;
const REWARD_ID = "vb-shrine-relic-weapon";

// Seed: register the clean GLB under the benchmark cache id + save visual-benchmark-1 as the active world
// (so reloads load it). Identical to the sibling benchmark proofs.
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

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "audio-feedback-profile") },
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
      console.log("  seeded: visual-benchmark-1 saved as the active world");
    } finally {
      await seeder.close();
    }

    // --- PLAY (runtime) ----------------------------------------------------------------------------
    const play = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(play.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);

      // (1) the sensory layer is ACTIVE on this slice, its ambient bed is engaged, and it shares ONE
      // audio engine with RuntimeFeedback (no third wind — the single-engine invariant the bed rests on).
      const armed = await evalValue(play.cdp, `(() => { const s = window.__SLICE_SENSORY__(); return { active: s?.active, ambient: s?.ambient, shared: window.__AUDIO_SHARED__() }; })()`);
      assert.equal(armed.active, true, "the slice sensory layer is active on visual-benchmark-1");
      assert.equal(armed.ambient, true, "the ambient bed is engaged for the slice");
      assert.equal(armed.shared, true, "the sensory layer + RuntimeFeedback share ONE audio engine (no third wind bed)");

      // (2) shrine discovery: standing at the shrine fires the discovery cue ONCE (+ a visual toast).
      // S.step() before moving guarantees a seeded baseline at SPAWN (no dependence on the throttled rAF).
      const discovery = await evalValue(
        play.cdp,
        `(() => {
          const S = window.__SLICE_SENSORY_DO__;
          S.step(); // seed the baseline at spawn
          S.step(); // OBSERVE at spawn (seeded → _observeSigns runs); discovery stays 0 only because the spawn is OUTSIDE the 7m shrine radius (non-vacuous)
          const atSpawn = window.__SLICE_SENSORY__().cues.discovery;
          window.__FROZEN_CACHE_DO__.teleportTo('${REWARD_ID}'); // stand at the shrine offering (inside the 7m sign radius)
          S.step();
          const d1 = window.__SLICE_SENSORY__().cues.discovery;
          S.step(); // still inside → no replay
          const d2 = window.__SLICE_SENSORY__().cues.discovery;
          const snap = window.__SLICE_SENSORY__();
          const toast = document.querySelector('.cue-overlay');
          return { atSpawn, d1, d2, lastLabel: snap.lastLabel, toastText: toast ? toast.textContent : null };
        })()`
      );
      assert.equal(discovery.atSpawn, 0, "no discovery cue at spawn (non-vacuous — the player wasn't at the shrine)");
      assert.equal(discovery.d1, 1, "entering the shrine alcove fired the discovery cue once");
      assert.equal(discovery.d2, 1, "staying inside does NOT re-fire the discovery cue (one-shot)");
      assert.ok(/discover/i.test(discovery.lastLabel ?? ""), `the milestone toast label mirrors discovery (${JSON.stringify(discovery.lastLabel)})`);
      assert.ok(/discover/i.test(discovery.toastText ?? ""), `the visual toast shows the discovery label (${JSON.stringify(discovery.toastText)})`);

      // (3) the optional exotic reward: picking it up fires the reward cue ONCE.
      const reward = await evalValue(
        play.cdp,
        `(() => {
          const S = window.__SLICE_SENSORY_DO__;
          const before = window.__SLICE_SENSORY__().cues.reward;
          window.__FROZEN_CACHE_DO__.teleportTo('${REWARD_ID}');
          const picked = window.__ARSENAL_CARRY_DO__.pickUp();
          S.step();
          const r1 = window.__SLICE_SENSORY__().cues.reward;
          S.step(); // still carried → no replay
          const r2 = window.__SLICE_SENSORY__().cues.reward;
          return { before, picked, r1, r2 };
        })()`
      );
      assert.equal(reward.before, 0, "no reward cue before the pickup (non-vacuous)");
      assert.equal(reward.picked, REWARD_ID, "the player claimed the shrine's exotic reward specifically");
      assert.equal(reward.r1, 1, "claiming the exotic reward fired the reward cue once");
      assert.equal(reward.r2, 1, "holding the reward does NOT re-fire the cue (one-shot)");

      // (4) combat: hit → defeat → clear cues fire in ORDER. Tick the sensory layer BETWEEN strikes so the
      // hit-react edge is observed (a synchronous eval never interleaves an rAF frame). The crossing beat
      // only; the cache-gate beat stays live.
      const combat = await evalValue(
        play.cdp,
        `(() => {
          const C = window.__ARSENAL_CARRY_DO__, D = window.__COMBAT_DO__, S = window.__SLICE_SENSORY_DO__;
          const beat = window.__ENCOUNTER__().encounters[0];
          const wid = C.place({ x: beat.position[0] + 3, z: beat.position[2] + 1 });
          C.equip(wid, 'rightHand');
          D.teleportNearTarget(beat.enemyId, 6);
          const strike = () => { D.aimAt(beat.position[0], beat.position[1] + 1.0, beat.position[2]); D.useActiveWeapon(); D.step(); S.step(); };
          const completedBefore = window.__ENCOUNTER__().encounters[0].completed;
          strike(); strike(); strike();   // three hits defeat the sentinel
          window.__ENCOUNTER_DO__.step();  // poll defeat → completed (also ticks the sensory layer → clear)
          S.step();
          const s = window.__SLICE_SENSORY__();
          return {
            completedBefore,
            completed: window.__ENCOUNTER__().encounters[0].completed,
            cues: s.cues,
            log: s.log,
            runtimeFeedback: window.__RUNTIME_FEEDBACK__().cueAttempts,
          };
        })()`
      );
      assert.equal(combat.completedBefore, false, "the crossing beat was live before the fight (non-vacuous)");
      assert.equal(combat.completed, true, "the crossing beat completed after the fight");
      assert.ok(combat.cues.hit >= 1, `at least one hit cue fired (${combat.cues.hit})`);
      assert.equal(combat.cues.defeat, 1, "exactly one defeat cue fired");
      assert.equal(combat.cues.clear, 1, "exactly one clear cue fired");
      const iHit = combat.log.indexOf("hit");
      const iDefeat = combat.log.indexOf("defeat");
      const iClear = combat.log.indexOf("clear");
      assert.ok(iHit >= 0 && iHit < iDefeat, `hit precedes defeat in the cue log (${JSON.stringify(combat.log)})`);
      assert.ok(iDefeat < iClear, `defeat precedes clear in the cue log (${JSON.stringify(combat.log)})`);
      assert.ok(combat.runtimeFeedback >= 1, "RuntimeFeedback fired the clear COMPLETE chord on the cleared edge");

      // (5) the cache payoff: depositing the relic completes the objective → the completion cue fires once.
      const payoff = await evalValue(
        play.cdp,
        `(() => {
          const O = window.__OBJECTIVE_DO__, S = window.__SLICE_SENSORY_DO__;
          const before = window.__SLICE_SENSORY__().cues.complete;
          O.equipRelic('rightHand');
          S.step(); // the relic is now CARRIED — but it is a runtime SYSTEM weapon, not loot → no reward cue
          const rewardAfterRelic = window.__SLICE_SENSORY__().cues.reward;
          O.teleportToCache();
          const objBefore = window.__OBJECTIVE_DEBUG__().completed;
          O.deposit();
          O.save();
          S.step();
          const s = window.__SLICE_SENSORY__();
          return { before, rewardAfterRelic, objBefore, objAfter: window.__OBJECTIVE_DEBUG__().completed, complete: s.cues.complete, lastLabel: s.lastLabel };
        })()`
      );
      assert.equal(payoff.before, 0, "no completion cue before the deposit (non-vacuous)");
      assert.equal(payoff.rewardAfterRelic, 1, "carrying the runtime relic does NOT fire a reward cue (only the authored exotic did — system weapons excluded)");
      assert.equal(payoff.objBefore, false, "the relic objective was incomplete before deposit");
      assert.equal(payoff.objAfter, true, "the relic objective completed on deposit");
      assert.equal(payoff.complete, 1, "the deposit/completion payoff cue fired once");
      assert.ok(/cache|seal/i.test(payoff.lastLabel ?? ""), `the toast mirrors the completion payoff (${JSON.stringify(payoff.lastLabel)})`);

      assert.deepEqual(play.consoleErrors, [], `play: zero console errors\n${play.consoleErrors.join("\n")}`);
      console.log("  cues: ambient + discovery + reward + (hit→defeat→clear) + cache payoff — once each, in order");
    } finally {
      await play.close();
    }

    // --- RELOAD: completed one-shots do NOT replay -------------------------------------------------
    const replay = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(replay.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);
      const reloaded = await evalValue(
        replay.cdp,
        `(() => {
          const S = window.__SLICE_SENSORY_DO__;
          S.step(); S.step(); S.step(); // seed + a few observations on the reloaded (resolved) slice
          const s = window.__SLICE_SENSORY__();
          const enc = window.__ENCOUNTER__()?.encounters ?? [];
          return {
            active: s.active,
            cues: s.cues,
            crossingCompleted: enc[0]?.completed,
            objectiveCompleted: window.__OBJECTIVE_DEBUG__().completed,
            rewardPresent: (window.__ARSENAL_WORLD__().ids || []).includes('${REWARD_ID}'),
          };
        })()`
      );
      assert.equal(reloaded.active, true, "the sensory layer is active again on the reloaded slice");
      assert.equal(reloaded.cues.complete, 0, "the completion cue does NOT replay on reload");
      assert.equal(reloaded.cues.clear, 0, "the clear cue does NOT replay on reload");
      assert.equal(reloaded.cues.defeat, 0, "the defeat cue does NOT replay on reload");
      assert.equal(reloaded.cues.discovery, 0, "the discovery cue does NOT replay on reload (player at spawn)");
      assert.equal(reloaded.cues.reward, 0, "the reward cue does NOT replay on reload (reward not carried)");
      assert.equal(reloaded.crossingCompleted, true, "the cleared crossing beat persisted across reload");
      assert.equal(reloaded.objectiveCompleted, true, "the relic objective completion persisted across reload");
      assert.equal(reloaded.rewardPresent, true, "the shrine's reward weapon re-instantiates after reload");
      assert.deepEqual(replay.consoleErrors, [], `reload: zero console errors\n${replay.consoleErrors.join("\n")}`);
      console.log("  reload: no one-shot replay; objective + cleared beat persisted; reward re-instantiated");
    } finally {
      await replay.close();
    }

    console.log("\n  audio/feedback: ambient + discovery + reward + combat(hit→defeat→clear) + cache payoff; visual toast mirrors; reload-safe; 0 console errors");
  }
);

if (run.skipped) console.log("browser audio-feedback proof skipped (no browser)");
else console.log("browser audio-feedback proof passed");
