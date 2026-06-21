// test:enemy-patrol-proof — Enemy-1 bounded sentinel patrol in a real (SwiftShader) WebGL runtime, on
// visual-benchmark-1. Movement is a MOTION OVERLAY on the Enemy-0 combat target (authored points only,
// terrain-safe, zone-bounded, deterministic) — NOT AI. End to end:
//   load → the crossing sentinel PATROLS (its live position moves between authored points) while the
//     player is outside the zone, stays WITHIN the encounter radius, and never leaves safe ground
//     (dry / below-snowline / walkable) — and the cache sentinel is STATIC (not a patroller) →
//   approach → the player entering the zone triggers the "halt" telegraph: the sentinel STOPS + the
//     mode reads "alert", frozen at the (displaced) endpoint its patrol carried it to →
//   strike → the strike resolves a HIT whose CONTACT POINT is ≈3 m off the authored centre: combat hit
//     the sentinel where its patrol carried it, not where it was authored. (A position-caching bug would
//     miss — aim at the live spot, mesh queried at the centre — so the contact-off-centre check is
//     non-tautological: it fails unless combat raycasts the LIVE scene-graph transform.) →
//   defeat → movement stops PERMANENTLY (the defeated body's position is frozen across further steps) →
//   the visual benchmark stays within the Performance Contract, 0 console errors →
//   reload → the crossing beat's completion persists (no enemy re-projected) and the cache beat is intact.
// Combat-0 strikes / Enemy-0 FSM / Encounter Editor-0 orchestration are unchanged. Skips without Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";
import { assertWithinBudget, extractMetrics } from "../src/perf/PerformanceContract.js";
import { visualBenchmarkScene } from "../src/perf/BenchmarkScenes.js";

const ROOT = process.cwd();
const PORT = 5255;
const CDP_PORT = 9390;
const BASE = `http://127.0.0.1:${PORT}`;
const SETTLE_MS = 1400;
const GATED = visualBenchmarkScene().gated;

// Seed identical to the sibling benchmark proofs: register the clean GLB under the benchmark cache id and
// save visual-benchmark-1 as the active world (so reloads load the saved world → completion persists).
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

// Drive the enemy update synchronously (the headless rAF is throttled ~5fps) while the player stays put
// at the overlook (OUTSIDE the crossing zone → the sentinel patrols, not alerts). Sample the live patrol
// transform + a terrain-safety verdict for each sample, against the authored zone centre + radius.
const PATROL_SAMPLES = `(async () => {
  const T = await import('/src/terrain/terrainSampling.js');
  const prof = T.getActiveTerrainProfile();
  const dry = (x, z) => T.getHeight(x, z) >= T.getWaterLevel(x, z);            // never in water
  const belowSnow = (x, z) => T.getHeight(x, z) <= prof.snowlineAt(x, z);       // never on ice cap
  const walkable = (x, z) => T.getSlope(x, z) <= 0.7;                            // never on a cliff
  const enc = window.__ENCOUNTER__().encounters[0];
  const center = enc.position;
  const radius = enc.radius;
  const samples = [];
  for (let k = 0; k < 180; k++) {
    window.__ENEMY_DO__.step(1 / 30);
    if (k % 12 === 0) {
      const view = window.__ENEMY_PATROL__();
      const me = view[0];
      const x = me.position[0], z = me.position[2];
      samples.push({
        x, z, mode: me.mode, defeated: me.defeated,
        within: Math.hypot(x - center[0], z - center[2]) <= radius,
        safe: dry(x, z) && belowSnow(x, z) && walkable(x, z),
        count: view.length,
      });
    }
  }
  return { center, radius, samples };
})()`;

// Approach the patroller straight-on (→ halt telegraph) and prove combat reads its LIVE transform: the
// strike lands a HIT whose contact point is ≈3 m off the authored centre (the displaced live position).
const STRIKE = `(() => {
  const C = window.__ARSENAL_CARRY_DO__, D = window.__COMBAT_DO__, P = window.__ENEMY_PATROL__;
  const E = window.__ENEMY_DO__, K = window.__ENCOUNTER_DO__;
  const enc0 = () => window.__ENCOUNTER__().encounters[0];
  const enemyId = enc0().enemyId;
  const center = enc0().position;

  // The patrol line runs THROUGH the centre, so mid-segment displacement is small. Advance it (the player
  // is still outside the zone → it keeps patrolling) until it dwells AT an authored endpoint — maximal,
  // deterministic displacement (≈3 m off-centre).
  let guard = 0;
  while (P()[0].mode !== 'paused' && guard < 600) { E.step(); guard++; }
  const L0 = P()[0].position;
  const wid = C.place({ x: L0[0] + 1, z: L0[2] + 1 });
  C.equip(wid, 'rightHand');

  // (A) halt telegraph: step close into the zone → the sentinel halts, mode reads "alert", frozen at its
  // displaced endpoint (no strike here — just observe the reaction).
  D.teleportNearTarget(enemyId, 2);
  E.step();
  const a = P()[0];
  const disp = Math.hypot(a.position[0] - center[0], a.position[2] - center[2]);
  const alertMode = a.mode;

  // (B) strike the displaced target from a shallower stand-off (the reliable hitscan angle the sibling beat
  // proofs use — a steep, close down-shot can pass under a thin body from the weapon muzzle). Aim at the
  // LIVE position each shot and fire until one lands (capped). Because combat raycasts the live mesh, the
  // contact point lands at the displaced body (≈3 m off the authored centre), NOT at the centre.
  D.teleportNearTarget(enemyId, 6);
  // __SCENE_SYNC__ refreshes the moved body's child world matrices (the synchronous driver runs no render
  // between steps, and combat's per-target updateWorldMatrix updates the group, not its children).
  const fireLive = () => { window.__SCENE_SYNC__(); const q = P()[0].position; D.aimAt(q[0], q[1] + 1.0, q[2]); D.useActiveWeapon(); D.step(); E.step(); };
  let hitPoint = null;
  for (let s = 0; s < 10 && !hitPoint; s++) {
    fireLive();
    const ev = D.lastEvent();
    if (ev && ev.hit) hitPoint = ev.hit.point;
  }
  const afterStrike = enc0().enemyState;
  const hitOffCentre = hitPoint ? Math.hypot(hitPoint[0] - center[0], hitPoint[2] - center[2]) : null;

  // keep striking until defeated (capped) → then complete the beat
  let dguard = 0;
  while (enc0().enemyState !== 'defeated' && dguard < 12) { fireLive(); dguard++; }
  K.step();
  const beat = enc0();

  // defeat freezes movement permanently: the position must be identical across further steps
  const f0 = P()[0] ? P()[0].position.slice() : null;
  for (let k = 0; k < 30; k++) E.step();
  const f1 = P()[0] ? P()[0].position.slice() : null;

  return { disp, mode: alertMode, afterStrike, hitOffCentre, completed: beat.completed, enemyState: beat.enemyState, f0, f1, patrolDefeated: P()[0]?.defeated ?? null };
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "enemy-patrol-profile") },
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
      console.log("  seeded: benchmark (patrol crossing + static cache) saved as the active world");
    } finally {
      await seeder.close();
    }

    // --- PLAY (runtime) ----------------------------------------------------------------------------
    let captured = null;
    const play = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(play.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);

      // (1) staged: the crossing carries an authored patrol; the cache is stationary; exactly one
      //     patroller (the crossing ephemeral) appears in the live patrol view.
      const staged = await evalValue(
        play.cdp,
        `(() => {
          const enc = window.__ENCOUNTER__().encounters;
          const view = window.__ENEMY_PATROL__();
          return {
            ids: enc.map((e) => e.id),
            crossingPatrol: enc[0].patrol ? { points: enc[0].patrol.points.length, alert: enc[0].patrol.alert } : null,
            cachePatrol: enc[1].patrol ?? null,
            patrolIds: view.map((p) => p.id),
            crossingEnemyId: enc[0].enemyId,
          };
        })()`
      );
      assert.deepEqual(staged.ids, ["vb-crossing-sentinel", "vb-cache-sentinel"], "both beats present (crossing first)");
      assert.ok(staged.crossingPatrol && staged.crossingPatrol.points === 2, "the crossing sentinel carries a 2-point patrol");
      assert.equal(staged.crossingPatrol.alert, "halt", "the crossing patrol uses the halt telegraph");
      assert.equal(staged.cachePatrol, null, "the cache sentinel is stationary (no patrol)");
      assert.deepEqual(staged.patrolIds, [staged.crossingEnemyId], "exactly ONE patroller in the live view — the crossing ephemeral (the cache sentinel is static)");

      // (2) the sentinel actually MOVES, stays IN the zone, never leaves safe ground. The mode reads
      //     "patrol"/"paused" (never "alert") — proving the observation happens with the player OUT of the
      //     zone (an in-zone player would halt it → no travel).
      const patrol = await evalValue(play.cdp, PATROL_SAMPLES);
      assert.ok(patrol.samples.length >= 4, "patrol was sampled over time");
      const xs = patrol.samples.map((s) => s.x);
      const zs = patrol.samples.map((s) => s.z);
      const spread = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
      assert.ok(spread > 0.5, `the sentinel travels between points (position spread ${spread.toFixed(2)}m)`);
      assert.ok(patrol.samples.every((s) => s.mode === "patrol" || s.mode === "paused"), "the sentinel is patrolling (mode never alert → player is outside the zone)");
      assert.ok(patrol.samples.every((s) => s.within), "every sampled position stays WITHIN the encounter radius (bounded)");
      assert.ok(patrol.samples.every((s) => s.safe), "every sampled position is on safe ground (dry, below snowline, walkable)");
      assert.ok(patrol.samples.every((s) => s.count === 1 && !s.defeated), "the patrol view holds the one live (undefeated) patroller throughout");
      console.log(`  patrol: moves ${spread.toFixed(2)}m, in-zone + terrain-safe across ${patrol.samples.length} samples`);

      // (3) approach → halt telegraph; (4) strike lands on the LIVE displaced mesh (contact ≈3 m off the
      //     authored centre — non-tautological live-transform proof); (5) defeat freezes movement.
      const strike = await evalValue(play.cdp, STRIKE);
      assert.ok(strike.disp > 2.0, `the sentinel had moved well off its authored centre before the strike (${strike.disp.toFixed(2)}m)`);
      assert.equal(strike.mode, "alert", "entering the zone triggered the halt telegraph (mode reads alert)");
      assert.ok(["hit-react", "defeated"].includes(strike.afterStrike), `the strike HIT the displaced target (state ${strike.afterStrike})`);
      assert.ok(strike.hitOffCentre != null && strike.hitOffCentre > 2.0, `the strike's CONTACT POINT is ≈3 m off the authored centre (${strike.hitOffCentre == null ? "no hit" : strike.hitOffCentre.toFixed(2) + "m"}) — combat resolved against the LIVE displaced mesh, not the authored spawn`);
      assert.equal(strike.completed, true, "the crossing beat completed once the sentinel was defeated");
      assert.equal(strike.enemyState, "defeated", "the sentinel is defeated");
      assert.equal(strike.patrolDefeated, true, "the patrol view reports the actor defeated");
      assert.deepEqual(strike.f1, strike.f0, "a defeated sentinel's position is FROZEN across further steps (movement stopped permanently)");
      console.log("  strike: halt telegraph → live-mesh hit (contact ≈" + strike.hitOffCentre.toFixed(1) + "m off-centre) → defeat freezes movement");

      // (6) the visual benchmark stays within the Performance Contract (patrol adds no scene geometry).
      captured = await evalValue(play.cdp, `(() => ({ perf: window.__PERF__.snapshot(), budget: window.__BUDGET__ ? window.__BUDGET__() : null }))()`);
      const metrics = extractMetrics({ perf: captured.perf, budget: captured.budget });
      console.log(`  benchmark  draws ${metrics.drawCalls}  tris ${metrics.triangles}  objs ${metrics.objects}  batches ${metrics.instancedBatches}`);
      assertWithinBudget("visual-benchmark", metrics, GATED);

      assert.deepEqual(play.consoleErrors, [], `play: zero console errors\n${play.consoleErrors.join("\n")}`);
    } finally {
      await play.close();
    }

    // --- RELOAD: crossing completion persists (no enemy re-projected); cache beat intact ------------
    const replay = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(replay.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);
      const reloaded = await evalValue(
        replay.cdp,
        `(() => {
          const enc = window.__ENCOUNTER__().encounters;
          const view = window.__ENEMY_PATROL__();
          return {
            completed: enc.map((e) => e.completed),
            crossingEnemyId: enc[0].enemyId,
            cacheEnemyId: enc[1].enemyId,
            patrolCount: view.length,
          };
        })()`
      );
      assert.equal(reloaded.completed[0], true, "the crossing beat completion persisted across reload");
      assert.equal(reloaded.completed[1], false, "the cache beat stayed LIVE (its completion did not leak)");
      assert.equal(reloaded.crossingEnemyId, null, "a completed crossing beat re-projects NO enemy (no defeated patroller resurrected)");
      assert.ok(typeof reloaded.cacheEnemyId === "string" && reloaded.cacheEnemyId.length, "the cache beat still projects its (static) sentinel");
      assert.equal(reloaded.patrolCount, 0, "no patroller after reload (the crossing is cleared; the cache is static)");
      assert.deepEqual(replay.consoleErrors, [], `reload: zero console errors\n${replay.consoleErrors.join("\n")}`);
      console.log("  reload: crossing completion persisted (no enemy); cache beat intact; no patroller");
    } finally {
      await replay.close();
    }

    console.log("\n  bounded sentinel patrol: moves in-zone + terrain-safe · halt telegraph · live-tracked strike · defeat-freeze · benchmark green · reload-safe · 0 console errors");
  }
);

if (run.skipped) console.log("browser enemy-patrol proof skipped (no browser)");
else console.log("browser enemy-patrol proof passed");
