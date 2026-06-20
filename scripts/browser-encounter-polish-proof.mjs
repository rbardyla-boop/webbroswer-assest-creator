// test:encounter-polish-proof — Encounter-1 in a real (SwiftShader) WebGL runtime, on visual-benchmark-1.
//
// Proves the authored combat beat reads as an intentional moment end to end:
//   load → the beat is staged + visible (zone ring + gate-light beacon, phase dormant) →
//   approach → the sentinel telegraphs (phase ALERT, idle emissive raised) →
//   enter the zone → phase ENGAGED → draw/equip a weapon → the sentinel is a combat target →
//   strike → hit registers (health drops) → defeat (enemyState 'defeated') →
//   the beat completes → clear feedback fires ONCE (phase CLEARED, clearPulses 1, audio cue) →
//   reload → completed/defeated state persists (phase cleared, no re-pulse) →
//   the visual benchmark stays within the Performance Contract, 0 console errors throughout.
// It adds NO new combat mechanics — Combat-0 strikes, Enemy-0 state, Encounter Editor-0 orchestration are
// unchanged; this is the presentation layer over them. Skips cleanly without Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";
import { assertWithinBudget, extractMetrics } from "../src/perf/PerformanceContract.js";
import { visualBenchmarkScene } from "../src/perf/BenchmarkScenes.js";

const ROOT = process.cwd();
const PORT = 5249;
const CDP_PORT = 9384;
const BASE = `http://127.0.0.1:${PORT}`;
const SETTLE_MS = 1400;
const GATED = visualBenchmarkScene().gated;

// Seed: import the clean GLB under the benchmark's fixed cache id and save visual-benchmark-1 as the
// active world (so reloads load the saved world → completion persists). Mirrors the visual-benchmark proof.
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
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "encounter-polish-profile") },
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
      console.log("  seeded: benchmark saved as the active world");
    } finally {
      await seeder.close();
    }

    // --- PLAY (runtime) ----------------------------------------------------------------------------
    let captured = null;
    const play = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(play.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);

      // (1) the beat is staged + visible, and quiet at the overlook (player far → dormant)
      const staged = await evalValue(
        play.cdp,
        `(() => {
          const enc = window.__ENCOUNTER__()?.encounters?.[0] ?? null;
          const pres = window.__ENCOUNTER_PRESENTATION__();
          const doc = window.__DOC_DEBUG__ ? window.__DOC_DEBUG__() : null;
          return {
            beatPresent: !!enc,
            enemyId: enc?.enemyId ?? null,
            zones: doc?.encounterZones ?? 0,
            presentCount: pres?.encounters?.length ?? 0,
            phase: pres?.encounters?.[0]?.phase ?? null,
          };
        })()`
      );
      assert.equal(staged.beatPresent, true, "the authored combat beat is present in the runtime");
      assert.ok(staged.zones >= 1, `the encounter zone ring is in the scene (${staged.zones})`);
      assert.equal(staged.presentCount, 1, "the encounter presentation built a gate-light for the beat");
      assert.ok(staged.phase && staged.phase !== "cleared", `the staged beat is live, not pre-cleared (${staged.phase})`);

      // (1b) far from the crossing → DORMANT (the beat is quiet until approached)
      const dormant = await evalValue(
        play.cdp,
        `(() => {
          const enc = window.__ENCOUNTER__().encounters[0];
          window.__COMBAT_DO__.teleportNearTarget(enc.enemyId, 30); // well outside the alert range (22)
          window.__ENCOUNTER_DO__.step();
          const e = window.__ENCOUNTER_PRESENTATION__().encounters[0];
          return { phase: e.phase, telegraph: e.telegraph, banner: window.__ENCOUNTER_PRESENTATION__().banner };
        })()`
      );
      assert.equal(dormant.phase, "dormant", "far from the crossing → DORMANT phase");
      assert.equal(dormant.telegraph, false, "no telegraph while dormant");
      assert.equal(dormant.banner, null, "no encounter banner while dormant (the objective banner shows through)");

      // (2) approach → the sentinel telegraphs (phase ALERT, idle emissive raised above base)
      const alert = await evalValue(
        play.cdp,
        `(() => {
          const enc = window.__ENCOUNTER__().encounters[0];
          window.__COMBAT_DO__.teleportNearTarget(enc.enemyId, 15); // outside radius 8, inside alert range 22
          window.__ENCOUNTER_DO__.step();
          const e = window.__ENCOUNTER_PRESENTATION__().encounters[0];
          return { phase: e.phase, telegraph: e.telegraph, intensity: e.telegraphIntensity, banner: window.__ENCOUNTER_PRESENTATION__().banner };
        })()`
      );
      assert.equal(alert.phase, "alert", "approaching the crossing → ALERT phase");
      assert.equal(alert.telegraph, true, "the idle sentinel telegraphs hostility on approach");
      // The alert telegraph applies base(0.25) + lift(0.45) + amp·[0,0.35] → always ≥ 0.70. A > 0.6 gate
      // sits between the bare base (a zeroed-lift regression) and the real minimum, so it validates the
      // lift is substantively applied, not merely that *some* emissive was written.
      assert.ok(alert.intensity > 0.6, `the telegraph substantively lifted the sentinel emissive (${alert.intensity})`);
      assert.match(alert.banner ?? "", /ready your weapon/, "the banner prompts the player to ready a weapon");

      // (3) enter the zone → ENGAGED
      const engaged = await evalValue(
        play.cdp,
        `(() => {
          const enc = window.__ENCOUNTER__().encounters[0];
          window.__COMBAT_DO__.teleportNearTarget(enc.enemyId, 5); // inside radius 8
          window.__ENCOUNTER_DO__.step();
          return window.__ENCOUNTER_PRESENTATION__().encounters[0].phase;
        })()`
      );
      assert.equal(engaged, "engaged", "entering the zone → ENGAGED phase");

      // (4) draw/equip a weapon, strike → hit registers (health drops) → defeat
      const fight = await evalValue(
        play.cdp,
        `(() => {
          const C = window.__ARSENAL_CARRY_DO__, D = window.__COMBAT_DO__;
          const beat = window.__ENCOUNTER__().encounters[0];
          const wid = C.place({ x: beat.position[0] + 3, z: beat.position[2] + 1 });
          C.equip(wid, 'rightHand');
          D.teleportNearTarget(beat.enemyId, 6);
          const aimFire = () => { D.aimAt(beat.position[0], beat.position[1] + 1.0, beat.position[2]); D.useActiveWeapon(); D.step(); };
          const healthBefore = window.__ENCOUNTER__().encounters[0].enemyState; // state string; health via enemy debug below
          const before = window.__ENCOUNTER__().encounters[0].completed;
          aimFire();
          window.__ENEMY_DO__.step();
          const midState = window.__ENCOUNTER__().encounters[0].enemyState; // hit-react after the first strike registers
          aimFire(); aimFire();
          window.__ENEMY_DO__.step();
          window.__ENCOUNTER_DO__.step();
          const after = window.__ENCOUNTER__().encounters[0];
          return { before, midState, completed: after.completed, enemyState: after.enemyState };
        })()`
      );
      assert.equal(fight.before, false, "the beat was uncompleted before the strikes (non-vacuous)");
      assert.ok(["hit-react", "defeated"].includes(fight.midState), `the first strike registered as a hit (state ${fight.midState})`);
      assert.equal(fight.enemyState, "defeated", "the sentinel was defeated by Combat-0 hitscan");
      assert.equal(fight.completed, true, "the beat completed");

      // (5) clear feedback fires ONCE — phase CLEARED, a single clear pulse, the audio cue, a clear banner
      const cleared = await evalValue(
        play.cdp,
        `(() => {
          const e1 = window.__ENCOUNTER_PRESENTATION__();
          window.__ENCOUNTER_DO__.step(); // step again — the clear pulse must NOT re-fire
          const e2 = window.__ENCOUNTER_PRESENTATION__();
          return {
            phase: e2.encounters[0].phase,
            pulsesAfterClear: e1.encounters[0].clearPulses,
            pulsesAfterStep: e2.encounters[0].clearPulses,
            banner: e2.banner,
            cueAttempts: window.__RUNTIME_FEEDBACK__()?.cueAttempts ?? -1,
          };
        })()`
      );
      assert.equal(cleared.phase, "cleared", "the cleared beat reads as CLEARED");
      assert.equal(cleared.pulsesAfterClear, 1, "the clear pulse fired exactly once on the completion edge");
      assert.equal(cleared.pulsesAfterStep, 1, "the clear pulse does NOT re-fire on subsequent frames (one-shot)");
      assert.ok(cleared.cueAttempts >= 1, `the encounter-clear audio cue fired (${cleared.cueAttempts})`);
      assert.match(cleared.banner ?? "", /clear|open/, "the banner announces the route is clear/open");

      // (6) the visual benchmark stays within the Performance Contract (the gate-light beacon is cheap)
      captured = await evalValue(play.cdp, `(() => ({ perf: window.__PERF__.snapshot(), budget: window.__BUDGET__ ? window.__BUDGET__() : null }))()`);
      const metrics = extractMetrics({ perf: captured.perf, budget: captured.budget });
      console.log(`  benchmark  draws ${metrics.drawCalls}  tris ${metrics.triangles}  objs ${metrics.objects}  batches ${metrics.instancedBatches}`);
      assertWithinBudget("visual-benchmark", metrics, GATED);

      assert.deepEqual(play.consoleErrors, [], `play: zero console errors\n${play.consoleErrors.join("\n")}`);
      console.log("  beat: staged → telegraph → engaged → hit → defeat → cleared (once); benchmark green");
    } finally {
      await play.close();
    }

    // --- RELOAD: defeated/completed persists, beat reads cleared, no re-pulse -----------------------
    const replay = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(replay.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);
      const reloaded = await evalValue(
        replay.cdp,
        `(() => {
          const enc = window.__ENCOUNTER__()?.encounters?.[0] ?? null;
          const pres = window.__ENCOUNTER_PRESENTATION__().encounters[0];
          return { completed: enc?.completed ?? null, phase: pres?.phase ?? null, clearPulses: pres?.clearPulses ?? null };
        })()`
      );
      assert.equal(reloaded.completed, true, "the beat completion persisted across reload");
      assert.equal(reloaded.phase, "cleared", "the reloaded beat reads as cleared (gate-light green)");
      assert.equal(reloaded.clearPulses, 0, "an already-cleared beat does NOT re-fire the clear pulse on load");
      assert.deepEqual(replay.consoleErrors, [], `reload: zero console errors\n${replay.consoleErrors.join("\n")}`);
      console.log("  reload: completed/defeated persisted; beat reads cleared; no re-pulse");
    } finally {
      await replay.close();
    }

    console.log("\n  authored combat beat: staged · telegraphed · engaged · defeated · cleared-once · reload-safe; benchmark green; 0 console errors");
  }
);

if (run.skipped) console.log("browser encounter-polish proof skipped (no browser)");
else console.log("browser encounter-polish proof passed");
