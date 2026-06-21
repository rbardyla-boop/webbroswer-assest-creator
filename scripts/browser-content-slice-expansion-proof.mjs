// test:content-slice-expansion-proof — Content-2 in a real (SwiftShader) WebGL runtime, on visual-benchmark-1.
//
// Proves the expanded slice plays end to end with EXISTING systems only:
//   load → the off-route frozen shrine is staged + visible (its primitives + a readable sign) →
//   the sign surfaces its wayfinding text when the player reaches the shrine →
//   the optional exotic reward weapon is findable and CLAIMED (picked up + carried) →
//   BOTH combat beats still complete INDEPENDENTLY (Content-1 unbroken) →
//   the relic objective still completes (find → carry → deposit) →
//   the visual benchmark stays within the Performance Contract, 0 console errors →
//   reload → the objective + BOTH encounters persist.
// No new runtime code, no movement AI, no renderer work — only authored data (shrine objects + a sign + a
// fog emitter + a runtimeAssets weapon). Skips cleanly without Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";
import { assertWithinBudget, extractMetrics } from "../src/perf/PerformanceContract.js";
import { visualBenchmarkScene } from "../src/perf/BenchmarkScenes.js";

const ROOT = process.cwd();
const PORT = 5253;
const CDP_PORT = 9388;
const BASE = `http://127.0.0.1:${PORT}`;
const SETTLE_MS = 1400;
const GATED = visualBenchmarkScene().gated;
const SHRINE_WEAPON_ID = "vb-shrine-relic-weapon";

// Seed: import the clean GLB under the benchmark's fixed cache id + save visual-benchmark-1 as the active
// world (so reloads load the saved world). Identical to the sibling benchmark proofs.
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

// Defeat the encounter beat at `index` (same shape as the content-combat-beats proof).
const defeatBeat = (index) => `(() => {
  const C = window.__ARSENAL_CARRY_DO__, D = window.__COMBAT_DO__;
  const beat = window.__ENCOUNTER__().encounters[${index}];
  const wid = C.place({ x: beat.position[0] + 3, z: beat.position[2] + 1 });
  C.equip(wid, 'rightHand');
  D.teleportNearTarget(beat.enemyId, 6);
  const fire = () => { D.aimAt(beat.position[0], beat.position[1] + 1.0, beat.position[2]); D.useActiveWeapon(); D.step(); };
  const before = window.__ENCOUNTER__().encounters.map((e) => e.completed);
  fire(); window.__ENEMY_DO__.step(); fire(); fire();
  window.__ENEMY_DO__.step();
  window.__ENCOUNTER_DO__.step();
  return { before, after: window.__ENCOUNTER__().encounters.map((e) => ({ id: e.id, completed: e.completed, enemyState: e.enemyState })) };
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "content-slice-expansion-profile") },
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
      console.log("  seeded: expanded benchmark (shrine + reward) saved as the active world");
    } finally {
      await seeder.close();
    }

    // --- PLAY (runtime) ----------------------------------------------------------------------------
    let captured = null;
    const play = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(play.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);

      // (1) the exploration beat is staged + visible: the shrine primitives loaded + a readable sign.
      const explore = await evalValue(
        play.cdp,
        `(async () => {
          const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
          const loaded = new WorldSerializer().load();
          const objs = loaded?.document?.objects ?? [];
          const shrine = objs.filter((o) => typeof o.id === 'string' && o.id.startsWith('vb-shrine-'));
          const ix = window.__INTERACTION_RUNTIME__ ? window.__INTERACTION_RUNTIME__.debugSnapshot() : null;
          return { shrineCount: shrine.length, shrineIds: shrine.map((o) => o.id), signs: ix?.counts?.signs ?? -1 };
        })()`
      );
      assert.equal(explore.shrineCount, 4, "the four shrine primitives are present in the loaded slice");
      assert.ok(explore.signs >= 1, `the readable sign is loaded by the interaction runtime (${explore.signs})`);

      // (2) reach the shrine → the sign surfaces its wayfinding text (and the optional weapon is here).
      // Drive interactionRuntime.update(0) synchronously right after the teleport (update reads the player
      // position that was just set), so the nearest sign resolves DETERMINISTICALLY — no dependence on the
      // throttled headless rAF loop (which could leave the message null on a slow first frame).
      const sign = await evalValue(
        play.cdp,
        `(() => {
          const moved = window.__FROZEN_CACHE_DO__.teleportTo('${SHRINE_WEAPON_ID}'); // stand at the shrine offering
          window.__INTERACTION_RUNTIME__.update(0); // resolve the nearest sign now (deterministic)
          return { moved, message: window.__INTERACTION_RUNTIME__.debugSnapshot().message };
        })()`
      );
      assert.equal(sign.moved, true, "the player can reach the shrine (the optional weapon is a resolvable placed asset)");
      assert.ok(typeof sign.message === "string" && /cache|crossing|pass|shrine/i.test(sign.message), `the shrine sign surfaced its wayfinding text (${JSON.stringify(sign.message)})`);

      // (3) the optional reward weapon is findable + CLAIMED (picked up, carried).
      const reward = await evalValue(
        play.cdp,
        `(() => {
          const W = window.__ARSENAL_WORLD__();
          const before = window.__ARSENAL_CARRY_DO__.snapshot();
          window.__FROZEN_CACHE_DO__.teleportTo('${SHRINE_WEAPON_ID}');
          const picked = window.__ARSENAL_CARRY_DO__.pickUp();
          const after = window.__ARSENAL_CARRY_DO__.snapshot();
          return { present: (W.ids || []).includes('${SHRINE_WEAPON_ID}'), carriedBefore: before.carriedCount, picked, carriedAfter: after.carriedCount, activeId: after.activeId };
        })()`
      );
      assert.equal(reward.present, true, "the optional exotic reward weapon is placed in the world");
      assert.equal(reward.carriedBefore, 0, "the player carries nothing before claiming the reward (non-vacuous)");
      assert.equal(reward.picked, SHRINE_WEAPON_ID, "pressing pick-up claimed the shrine's exotic weapon specifically");
      assert.equal(reward.carriedAfter, 1, "the reward is now carried");
      assert.equal(reward.activeId, SHRINE_WEAPON_ID, "the claimed reward is the active carried weapon");

      // (4) BOTH combat beats still complete INDEPENDENTLY (Content-1 unbroken by the new content).
      const first = await evalValue(play.cdp, defeatBeat(0));
      assert.deepEqual(first.before, [false, false, false], "all three beats were live before the first fight (non-vacuous)");
      assert.equal(first.after[0].completed, true, "beat #1 (the crossing) completed");
      assert.equal(first.after[1].completed, false, "beat #2 (the cache gate) stayed live — independent completion");
      const second = await evalValue(play.cdp, defeatBeat(1));
      assert.equal(second.after[1].completed, true, "beat #2 (the cache gate) completed");
      assert.equal(second.after[0].completed, true, "beat #1 stayed completed (latched)");

      // (5) the relic objective still completes (the new content didn't break the carry loop).
      const relic = await evalValue(
        play.cdp,
        `(() => {
          const O = window.__OBJECTIVE_DO__;
          O.equipRelic('rightHand');
          O.teleportToCache();
          const before = window.__OBJECTIVE_DEBUG__().completed;
          O.deposit();
          O.save();
          return { before, completed: window.__OBJECTIVE_DEBUG__().completed };
        })()`
      );
      assert.equal(relic.before, false, "the relic objective was incomplete before deposit (non-vacuous)");
      assert.equal(relic.completed, true, "the relic objective completed (find → carry → deposit)");

      // (6) the expanded slice stays within the Performance Contract.
      captured = await evalValue(play.cdp, `(() => ({ perf: window.__PERF__.snapshot(), budget: window.__BUDGET__ ? window.__BUDGET__() : null }))()`);
      const metrics = extractMetrics({ perf: captured.perf, budget: captured.budget });
      console.log(`  benchmark  draws ${metrics.drawCalls}  tris ${metrics.triangles}  objs ${metrics.objects}  rtAssets ${metrics.runtimeAssets}  batches ${metrics.instancedBatches}`);
      assertWithinBudget("visual-benchmark", metrics, GATED);

      assert.deepEqual(play.consoleErrors, [], `play: zero console errors\n${play.consoleErrors.join("\n")}`);
      console.log("  slice: shrine visible → sign surfaced → reward claimed → both beats → objective; benchmark green");
    } finally {
      await play.close();
    }

    // --- RELOAD: the objective + both encounters persist -------------------------------------------
    const replay = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(replay.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);
      const reloaded = await evalValue(
        replay.cdp,
        `(() => {
          const enc = window.__ENCOUNTER__()?.encounters ?? [];
          const obj = window.__OBJECTIVE_DEBUG__();
          const shrinePresent = (window.__ARSENAL_WORLD__().ids || []).includes('${SHRINE_WEAPON_ID}');
          return { completed: enc.map((e) => e.completed), objectiveCompleted: obj.completed, shrinePresent };
        })()`
      );
      assert.deepEqual(reloaded.completed, [true, true, false], "the two defeated sentinel beats persisted; the untouched cache wisp stayed live");
      assert.equal(reloaded.objectiveCompleted, true, "the relic objective completion persisted across reload");
      assert.equal(reloaded.shrinePresent, true, "the shrine's reward weapon re-instantiates after reload (recipe-rebuilt)");
      assert.deepEqual(replay.consoleErrors, [], `reload: zero console errors\n${replay.consoleErrors.join("\n")}`);
      console.log("  reload: objective + both beats persisted; shrine reward re-instantiated");
    } finally {
      await replay.close();
    }

    console.log("\n  expanded slice: shrine + readable sign + claimable reward + fog moment · two beats · objective · reload-safe; benchmark green; 0 console errors");
  }
);

if (run.skipped) console.log("browser content-slice-expansion proof skipped (no browser)");
else console.log("browser content-slice-expansion proof passed");
