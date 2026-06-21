// test:content-combat-beats-proof — Content-1 in a real (SwiftShader) WebGL runtime, on visual-benchmark-1.
//
// Proves the authoring model is REPEATABLE: the benchmark corridor now stages TWO authored combat beats
// (the glacial-crossing skirmish + a final guardian at the cache gate) on the SAME systems with NO new
// runtime code. End to end:
//   load → BOTH beats are staged + visible (two zone rings + two gate-lights), with INDEPENDENT phase
//     (the near crossing reads alert while the far cache gate is still dormant) →
//   defeat beat #1 (the crossing) → it completes while beat #2 stays live (independent completion) →
//     and the banner now names the SECOND beat's location ("the pass") →
//   defeat beat #2 (the cache gate) → it completes too; each fired its OWN one-shot clear →
//   the relic objective is still completable (find → carry → deposit) →
//   the visual benchmark stays within the Performance Contract, 0 console errors →
//   reload → BOTH completions AND the objective persist; neither beat re-pulses.
// Combat-0 strikes / Enemy-0 state / Encounter Editor-0 orchestration are unchanged. Skips without Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";
import { assertWithinBudget, extractMetrics } from "../src/perf/PerformanceContract.js";
import { visualBenchmarkScene } from "../src/perf/BenchmarkScenes.js";

const ROOT = process.cwd();
const PORT = 5251;
const CDP_PORT = 9386;
const BASE = `http://127.0.0.1:${PORT}`;
const SETTLE_MS = 1400;
const GATED = visualBenchmarkScene().gated;

// Seed: import the clean GLB under the benchmark's fixed cache id + save visual-benchmark-1 as the active
// world (so reloads load the saved world → completion persists). Identical to the sibling benchmark proofs.
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

// Drive a full Combat-0 strike on the beat at `index`: place + equip a weapon (idempotent — the first
// defeat leaves one equipped, later beats reuse it), teleport to the sentinel, aim + fire three times,
// then advance the enemy FSM + poll the encounter. Returns the per-beat completion snapshot.
const defeatBeat = (index) => `(() => {
  const C = window.__ARSENAL_CARRY_DO__, D = window.__COMBAT_DO__;
  const beat = window.__ENCOUNTER__().encounters[${index}];
  const wid = C.place({ x: beat.position[0] + 3, z: beat.position[2] + 1 });
  C.equip(wid, 'rightHand');
  D.teleportNearTarget(beat.enemyId, 6);
  // Enemy-1: the crossing sentinel patrols, so aim at its LIVE position (a patroller appears in the patrol
  // view); a static beat (the cache gate) falls back to its authored centre. Correct for both.
  const live = () => window.__ENEMY_PATROL__().find((p) => p.id === beat.enemyId)?.position ?? beat.position;
  const fire = () => { const q = live(); D.aimAt(q[0], q[1] + 1.0, q[2]); D.useActiveWeapon(); D.step(); };
  const before = window.__ENCOUNTER__().encounters.map((e) => e.completed);
  fire();
  window.__ENEMY_DO__.step();
  const midState = window.__ENCOUNTER__().encounters[${index}].enemyState;
  fire(); fire();
  window.__ENEMY_DO__.step();
  window.__ENCOUNTER_DO__.step();
  const after = window.__ENCOUNTER__().encounters.map((e) => ({ id: e.id, completed: e.completed, enemyState: e.enemyState }));
  const pres = window.__ENCOUNTER_PRESENTATION__();
  return { before, midState, after, banner: pres.banner, pres: pres.encounters.map((p) => ({ phase: p.phase, clearPulses: p.clearPulses, bannerText: p.bannerText })) };
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "content-combat-beats-profile") },
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
      console.log("  seeded: benchmark (two combat beats) saved as the active world");
    } finally {
      await seeder.close();
    }

    // --- PLAY (runtime) ----------------------------------------------------------------------------
    let captured = null;
    const play = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(play.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);

      // (1) BOTH beats are staged + visible, with INDEPENDENT phase at the overlook: the near crossing
      //     reads live (alert) while the far cache gate is still dormant — each phase derives from its
      //     OWN distance, not a shared one.
      const staged = await evalValue(
        play.cdp,
        `(() => {
          const enc = window.__ENCOUNTER__()?.encounters ?? [];
          const pres = window.__ENCOUNTER_PRESENTATION__();
          const doc = window.__DOC_DEBUG__ ? window.__DOC_DEBUG__() : null;
          return {
            beatCount: enc.length,
            ids: enc.map((e) => e.id),
            enemyIds: enc.map((e) => e.enemyId),
            labels: enc.map((e) => e.label),
            zones: doc?.encounterZones ?? 0,
            presentCount: pres?.encounters?.length ?? 0,
            phases: pres?.encounters?.map((p) => p.phase) ?? [],
          };
        })()`
      );
      // Content-3 appended a THIRD beat (the frost_wisp sharing the cache gate). This Content-1 proof stays
      // about the two SENTINEL beats completing independently; the full mixed-clear is test:content-3-proof.
      assert.equal(staged.beatCount, 3, "three authored combat beats are present (Content-3 added the mixed cache wisp)");
      assert.deepEqual(staged.ids, ["vb-crossing-sentinel", "vb-cache-sentinel", "vb-cache-wisp"], "the crossing + cache sentinel stay items[0]/[1]; the wisp is appended at [2]");
      assert.ok(staged.enemyIds.every((id) => typeof id === "string" && id.length), "each live beat projected a combat target (ephemeral enemy id)");
      assert.equal(new Set(staged.enemyIds).size, 3, "the three beats project DISTINCT enemies");
      assert.deepEqual(staged.labels, ["the crossing", "the pass", "the pass"], "each beat carries its banner label (the wisp shares the cache location)");
      assert.ok(staged.zones >= 3, `all three encounter zone rings are in the scene (${staged.zones})`);
      assert.equal(staged.presentCount, 3, "the presentation built a gate-light for EACH beat");
      // Independent phase (geometry-grounded): the far cache beats are dormant while the near crossing is not.
      assert.equal(staged.phases[1], "dormant", "the far cache-gate sentinel reads dormant at the overlook");
      assert.equal(staged.phases[2], "dormant", "the far cache wisp reads dormant at the overlook");
      assert.notEqual(staged.phases[0], "dormant", "the near crossing beat reads live (independent phase derivation)");
      assert.notEqual(staged.phases[0], staged.phases[1], "the crossing + cache beats hold independent phases at the same instant");

      // (2) defeat beat #1 (the crossing) → it completes while beat #2 stays LIVE (independent completion),
      //     and the banner now names the SECOND beat's location.
      const first = await evalValue(play.cdp, defeatBeat(0));
      assert.deepEqual(first.before, [false, false, false], "all three beats were uncompleted before the first strikes (non-vacuous)");
      assert.ok(["hit-react", "defeated"].includes(first.midState), `the first strike registered as a hit (state ${first.midState})`);
      assert.equal(first.after[0].completed, true, "beat #1 (the crossing) completed");
      assert.equal(first.after[0].enemyState, "defeated", "beat #1's sentinel was defeated by Combat-0");
      assert.equal(first.after[1].completed, false, "beat #2 (the cache gate) is STILL LIVE — completion did not leak");
      assert.equal(first.pres[0].phase, "cleared", "beat #1 reads cleared");
      assert.notEqual(first.pres[1].phase, "cleared", "beat #2 does NOT read cleared (independent phase)");
      assert.equal(first.pres[0].clearPulses, 1, "beat #1 fired its clear pulse exactly once");
      assert.equal(first.pres[1].clearPulses, 0, "beat #2 has NOT pulsed (still live)");
      // The per-beat label reaches the player-facing text. The two beats are ~10.5m apart (well inside the
      // 22m alert range), so once the crossing clears the still-live cache gate is in ALERT — and ALERT
      // (priority 2) outbids the crossing's CLEARED (priority 1) — so the on-screen banner names "the pass".
      // The per-beat line is the direct, precedence-independent signal; the global banner confirms it live.
      assert.match(first.pres[1].bannerText ?? "", /the pass/, `the cache-gate beat's OWN banner line names its location (${JSON.stringify(first.pres[1].bannerText)})`);
      assert.match(first.banner ?? "", /the pass/, `the on-screen banner names the live second beat (${JSON.stringify(first.banner)})`);

      // (3) defeat beat #2 (the cache gate) → it completes too; each beat owns its clear feedback.
      const second = await evalValue(play.cdp, defeatBeat(1));
      assert.equal(second.after[1].completed, true, "beat #2 (the cache sentinel) completed");
      assert.equal(second.after[1].enemyState, "defeated", "beat #2's sentinel was defeated by Combat-0");
      assert.equal(second.after[0].completed, true, "beat #1 stayed completed (latched)");
      // The two SENTINEL beats now read cleared; the MIXED cache WISP (beat 2) stays LIVE — defeating the
      // sentinels never touched it (independence; the full mixed clear is test:content-3-proof).
      assert.deepEqual(second.pres.slice(0, 2).map((p) => p.phase), ["cleared", "cleared"], "both SENTINEL beats now read cleared");
      assert.equal(second.after[2].completed, false, "the mixed cache WISP beat is STILL LIVE (defeating the sentinels did not complete it)");
      assert.notEqual(second.pres[2].phase, "cleared", "the cache wisp does NOT read cleared (independent, still live)");
      assert.deepEqual(second.pres.slice(0, 2).map((p) => p.clearPulses), [1, 1], "each sentinel beat fired its OWN one-shot clear (no shared pulse)");
      assert.equal(second.pres[2].clearPulses, 0, "the live cache wisp has NOT pulsed");

      // (4) the relic objective is still completable (the two beats did not break the carry loop)
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
      assert.equal(relic.completed, true, "the relic objective completed (find → carry → deposit) alongside both beats");

      // (5) the visual benchmark stays within the Performance Contract (two cheap sentinels + gate-lights)
      captured = await evalValue(play.cdp, `(() => ({ perf: window.__PERF__.snapshot(), budget: window.__BUDGET__ ? window.__BUDGET__() : null }))()`);
      const metrics = extractMetrics({ perf: captured.perf, budget: captured.budget });
      console.log(`  benchmark  draws ${metrics.drawCalls}  tris ${metrics.triangles}  objs ${metrics.objects}  batches ${metrics.instancedBatches}`);
      assertWithinBudget("visual-benchmark", metrics, GATED);

      assert.deepEqual(play.consoleErrors, [], `play: zero console errors\n${play.consoleErrors.join("\n")}`);
      console.log("  two beats: staged → defeat #1 (independent) → defeat #2 → objective; benchmark green");
    } finally {
      await play.close();
    }

    // --- RELOAD: both completions + the objective persist; neither beat re-pulses --------------------
    const replay = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(replay.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);
      const reloaded = await evalValue(
        replay.cdp,
        `(() => {
          const enc = window.__ENCOUNTER__()?.encounters ?? [];
          const pres = window.__ENCOUNTER_PRESENTATION__();
          const obj = window.__OBJECTIVE_DEBUG__();
          return {
            completed: enc.map((e) => e.completed),
            phases: pres.encounters.map((p) => p.phase),
            pulses: pres.encounters.map((p) => p.clearPulses),
            objectiveCompleted: obj.completed,
          };
        })()`
      );
      assert.deepEqual(reloaded.completed, [true, true, false], "the two SENTINEL completions persisted; the untouched cache wisp stayed live");
      assert.deepEqual(reloaded.phases, ["cleared", "cleared", "dormant"], "the two cleared sentinels read cleared; the live cache wisp reads dormant at the overlook");
      assert.deepEqual(reloaded.pulses, [0, 0, 0], "no beat re-fires the clear pulse on load");
      assert.equal(reloaded.objectiveCompleted, true, "the relic objective completion persisted across reload");
      assert.deepEqual(replay.consoleErrors, [], `reload: zero console errors\n${replay.consoleErrors.join("\n")}`);
      console.log("  reload: both beats + objective persisted; no re-pulse");
    } finally {
      await replay.close();
    }

    console.log("\n  two authored combat beats: staged · independently completed · banner-correct · objective-safe · reload-safe; benchmark green; 0 console errors");
  }
);

if (run.skipped) console.log("browser content-combat-beats proof skipped (no browser)");
else console.log("browser content-combat-beats proof passed");
