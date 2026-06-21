// test:enemy-archetypes-proof — Enemy-2 second archetype (`frost_wisp`) beside `glacial_sentinel` in a
// real (SwiftShader) WebGL runtime, on the dedicated Enemy Archetype Lab. The two archetypes share the
// FSM, the Combat-0 hit path, and the encounter projection — they differ only in DATA. End to end:
//   load → BOTH beats project an enemy (one sentinel, one wisp); BOTH register as combat targets; the
//     wisp is the only MOVING actor (kind "hover") →
//   hover → the wisp's live position DRIFTS, stays finite, within its encounter radius + a tight hover
//     bound, and floats above the ground (mode "hover", never defeated) → bounded + finite →
//   strike → ONE equipped weapon defeats the (stationary) sentinel AND lands a hit on the (hovering)
//     wisp — the SAME StrikeEvent.activeId for both (no forked targeting); the wisp's contact resolves to
//     the wisp's own target id →
//   independence → with the sentinel defeated, the wisp is still ALIVE and its beat NOT completed →
//   reload → the sentinel beat's completion persists (no sentinel re-projected) while the wisp beat is
//     LIVE again (it respawns idle) — defeating one neither completes nor defeats the other across reload →
//   then defeat the WISP → its movement freezes permanently → reload → BOTH beats completed, neither
//     re-projects an enemy → reload persists defeated states correctly.
//   Performance contract not red; 0 console errors. Combat-0 / the FSM / encounter orchestration unchanged.
// Skips without Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";
import { assertWithinBudget, evaluateContract, extractMetrics } from "../src/perf/PerformanceContract.js";

const ROOT = process.cwd();
const PORT = 5256;
const CDP_PORT = 9391;
const BASE = `http://127.0.0.1:${PORT}`;
const SETTLE_MS = 1400;

// Seed: save the Enemy Archetype Lab as the active world (so bare ?runtime=1 reloads load the saved,
// mutated world → completion persists). No GLB — the lab carries no validated-GLB prop.
const SEED = `(async () => {
  const { buildEnemyArchetypeLab } = await import('/src/world/samples/enemyArchetypeLab.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  new WorldSerializer().save(buildEnemyArchetypeLab());
  return { saved: true };
})()`;

// Staged: both beats present (one sentinel + one wisp), both project an idle enemy, both register as
// combat targets, and the wisp is the only MOVING actor (kind hover) in the live view.
const STAGED = `(() => {
  const enc = window.__ENCOUNTER__().encounters;
  const byType = {}; for (const e of enc) byType[e.enemyType] = e;
  const targetIds = window.__COMBAT__().targets.map((t) => t.id);
  const live = window.__ENEMY_LIVE__();
  const s = byType['glacial_sentinel'], w = byType['frost_wisp'];
  return {
    count: enc.length,
    types: enc.map((e) => e.enemyType).sort(),
    sentinel: s ? { enemyId: s.enemyId, state: s.enemyState } : null,
    wisp: w ? { enemyId: w.enemyId, state: w.enemyState, center: w.position, radius: w.radius } : null,
    targetIds,
    live: live.map((l) => ({ id: l.id, kind: l.kind, type: l.type, mode: l.mode })),
  };
})()`;

// Hover: drive the enemy update synchronously (the headless rAF is throttled ~5fps) while the player
// stays at spawn. Sample the wisp's live transform + a boundedness/float verdict each sample.
const HOVER_SAMPLES = `(() => {
  const w = window.__ENCOUNTER__().encounters.find((e) => e.enemyType === 'frost_wisp');
  const center = w.position, radius = w.radius, wispId = w.enemyId;
  const samples = [];
  for (let k = 0; k < 180; k++) {
    window.__ENEMY_DO__.step(1 / 30);
    if (k % 12 === 0) {
      const live = window.__ENEMY_LIVE__();
      const me = live.find((l) => l.id === wispId);
      const x = me.position[0], y = me.position[1], z = me.position[2];
      samples.push({
        x, y, z, mode: me.mode, defeated: me.defeated, liveCount: live.length,
        finite: Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z),
        within: Math.hypot(x - center[0], z - center[2]) <= radius,
        nearHome: Math.hypot(x - center[0], z - center[2]) <= 2.0,
        floatsAbove: (y - center[1]) > 0.8,
      });
    }
  }
  return { center, radius, samples };
})()`;

// Strike: ONE equipped weapon. Defeat the stationary sentinel; confirm the wisp is independent (alive,
// beat not completed); then land ONE hit on the hovering wisp with the SAME weapon (aim at its live spot).
const STRIKE_BOTH = `(() => {
  const enc = () => window.__ENCOUNTER__().encounters;
  const sBeat = () => enc().find((e) => e.enemyType === 'glacial_sentinel');
  const wBeat = () => enc().find((e) => e.enemyType === 'frost_wisp');
  const D = window.__COMBAT_DO__, E = window.__ENEMY_DO__, K = window.__ENCOUNTER_DO__, live = window.__ENEMY_LIVE__;
  const tgt = () => { const m = {}; for (const t of window.__COMBAT__().targets) m[t.id] = t; return m; };
  const sId = sBeat().enemyId, wId = wBeat().enemyId;

  const sc = sBeat().position;
  const wid = window.__ARSENAL_CARRY_DO__.place({ x: sc[0] + 1, z: sc[2] + 1 });
  window.__ARSENAL_CARRY_DO__.equip(wid, 'rightHand');

  // (A) defeat the SENTINEL (stationary) — re-teleport + __SCENE_SYNC__ + aim at centre, fire-until-hit.
  const fireSentinel = () => { D.teleportNearTarget(sId, 6); window.__SCENE_SYNC__(); const c = sBeat().position; D.aimAt(c[0], c[1] + 1.0, c[2]); D.useActiveWeapon(); D.step(); E.step(); };
  let sHit = null, g = 0;
  while (sBeat().enemyState !== 'defeated' && g < 24) { fireSentinel(); const ev = D.lastEvent(); if (ev && ev.hit && ev.hit.targetId === sId) sHit = ev; g++; }
  K.step();
  const sentinelDefeated = sBeat().enemyState === 'defeated';
  const sentinelCompleted = sBeat().completed;

  // (B) independence at the moment of the sentinel's defeat.
  const wAlive = wBeat().enemyState !== 'defeated';
  const wNotCompleted = wBeat().completed === false;
  const wHitsBefore = tgt()[wId] ? tgt()[wId].hitCount : null;

  // (C) the SAME equipped weapon also HITS the wisp (hover → aim at its LIVE position). One hit only.
  const fireWisp = () => { D.teleportNearTarget(wId, 5); window.__SCENE_SYNC__(); const q = live().find((l) => l.id === wId).position; D.aimAt(q[0], q[1], q[2]); D.useActiveWeapon(); D.step(); E.step(); };
  let wHit = null, wg = 0;
  while (!wHit && wg < 24) { fireWisp(); const ev = D.lastEvent(); if (ev && ev.hit && ev.hit.targetId === wId) wHit = ev; wg++; }
  const wHitsAfter = tgt()[wId] ? tgt()[wId].hitCount : null;

  return {
    wid,
    sActiveId: sHit ? sHit.weaponId : null, sHitTarget: sHit ? sHit.hit.targetId : null,
    wActiveId: wHit ? wHit.weaponId : null, wHitTarget: wHit ? wHit.hit.targetId : null,
    sentinelDefeated, sentinelCompleted, wAlive, wNotCompleted,
    wHitsBefore, wHitsAfter, wState: wBeat().enemyState,
  };
})()`;

const captureExpr = `(() => ({ perf: window.__PERF__.snapshot(), budget: window.__BUDGET__ ? window.__BUDGET__() : null }))()`;

// Reload-1: the sentinel beat's completion persists (no sentinel re-projected) while the wisp beat is
// LIVE again (respawns idle). Independence held across reload.
const RELOAD_INDEP = `(() => {
  const enc = window.__ENCOUNTER__().encounters;
  const s = enc.find((e) => e.enemyType === 'glacial_sentinel');
  const w = enc.find((e) => e.enemyType === 'frost_wisp');
  const live = window.__ENEMY_LIVE__();
  return { sCompleted: s.completed, sEnemyId: s.enemyId, wCompleted: w.completed, wEnemyId: w.enemyId, wState: w.enemyState, liveCount: live.length, liveKinds: live.map((l) => l.kind) };
})()`;

// Defeat the WISP fully on the reloaded page; confirm its movement freezes permanently.
const DEFEAT_WISP = `(() => {
  const enc = () => window.__ENCOUNTER__().encounters;
  const wBeat = () => enc().find((e) => e.enemyType === 'frost_wisp');
  const D = window.__COMBAT_DO__, E = window.__ENEMY_DO__, K = window.__ENCOUNTER_DO__, live = window.__ENEMY_LIVE__;
  const wId = wBeat().enemyId, wc = wBeat().position;
  const wid = window.__ARSENAL_CARRY_DO__.place({ x: wc[0] + 1, z: wc[2] + 1 });
  window.__ARSENAL_CARRY_DO__.equip(wid, 'rightHand');
  const fireWisp = () => { D.teleportNearTarget(wId, 5); window.__SCENE_SYNC__(); const q = live().find((l) => l.id === wId).position; D.aimAt(q[0], q[1], q[2]); D.useActiveWeapon(); D.step(); E.step(); };
  let g = 0;
  while (wBeat().enemyState !== 'defeated' && g < 40) { fireWisp(); g++; }
  const f0 = live().find((l) => l.id === wId)?.position.slice() ?? null;
  for (let k = 0; k < 30; k++) E.step();
  const f1 = live().find((l) => l.id === wId)?.position.slice() ?? null;
  K.step();
  return { wDefeated: wBeat().enemyState === 'defeated', wCompleted: wBeat().completed, f0, f1 };
})()`;

// Reload-2: BOTH beats completed; neither re-projects an enemy; no moving actor.
const RELOAD_FINAL = `(() => {
  const enc = window.__ENCOUNTER__().encounters;
  const s = enc.find((e) => e.enemyType === 'glacial_sentinel');
  const w = enc.find((e) => e.enemyType === 'frost_wisp');
  return { sCompleted: s.completed, sEnemyId: s.enemyId, wCompleted: w.completed, wEnemyId: w.enemyId, liveCount: window.__ENEMY_LIVE__().length };
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "enemy-archetypes-profile") },
  async () => {
    // --- SEED (editor) -----------------------------------------------------------------------------
    const seeder = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(seeder.cdp, "editor", 45000);
      await sleep(SETTLE_MS);
      const s = await evalValue(seeder.cdp, SEED);
      assert.equal(s?.saved, true, "the Enemy Archetype Lab was saved as the active world");
      assert.deepEqual(seeder.consoleErrors, [], `seed: zero console errors\n${seeder.consoleErrors.join("\n")}`);
      console.log("  seeded: enemy-archetype-lab (sentinel + wisp) saved as the active world");
    } finally {
      await seeder.close();
    }

    // --- PLAY-1 (runtime): stage → hover → same-weapon-both → independence -------------------------
    const play = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(play.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);

      // (1) staged: both archetypes project an idle enemy; both are combat targets; only the wisp moves.
      const staged = await evalValue(play.cdp, STAGED);
      assert.equal(staged.count, 2, "exactly two beats");
      assert.deepEqual(staged.types, ["frost_wisp", "glacial_sentinel"], "one sentinel beat + one wisp beat");
      assert.ok(staged.sentinel?.enemyId && staged.wisp?.enemyId, "both beats project an enemy (non-null enemyId)");
      assert.equal(staged.sentinel.state, "idle", "the sentinel starts idle");
      assert.equal(staged.wisp.state, "idle", "the wisp starts idle");
      assert.ok(staged.targetIds.includes(staged.sentinel.enemyId), "the sentinel registered as a combat target");
      assert.ok(staged.targetIds.includes(staged.wisp.enemyId), "the wisp registered as a combat target (same StrikeEvent path)");
      assert.equal(staged.live.length, 1, "exactly ONE moving actor (the sentinel is stationary in the lab)");
      assert.equal(staged.live[0].id, staged.wisp.enemyId, "the moving actor is the wisp");
      assert.equal(staged.live[0].kind, "hover", "the wisp moves by HOVER (not patrol)");
      assert.equal(staged.live[0].type, "frost_wisp", "the moving actor's type is frost_wisp");
      console.log("  staged: sentinel + wisp both projected + combat-targeted; wisp is the lone hover actor");

      // perf BEFORE placing weapons (clean baseline): the lab classifies within the contract (not red).
      const cap = await evalValue(play.cdp, captureExpr);
      const metrics = extractMetrics({ perf: cap.perf, budget: cap.budget });
      const verdict = evaluateContract(metrics);
      assertWithinBudget("enemy-archetype-lab", metrics); // throws only on a RED design-ceiling breach
      assert.notEqual(verdict.overall, "red", "the lab scene is within the performance contract (not red)");
      console.log(`  perf  draws ${metrics.drawCalls}  tris ${metrics.triangles}  objs ${metrics.objects}  batches ${metrics.instancedBatches}  overall ${verdict.overall}`);

      // (2) the wisp hover is bounded + finite: it drifts, stays in-zone + near home, and floats.
      const hover = await evalValue(play.cdp, HOVER_SAMPLES);
      assert.ok(hover.samples.length >= 4, "hover was sampled over time");
      const xs = hover.samples.map((s) => s.x), zs = hover.samples.map((s) => s.z);
      const spread = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
      assert.ok(spread > 0.5, `the wisp drifts (position spread ${spread.toFixed(2)}m)`);
      assert.ok(hover.samples.every((s) => s.finite), "every sampled wisp position is finite");
      assert.ok(hover.samples.every((s) => s.within), "every sampled position stays WITHIN the encounter radius (bounded)");
      assert.ok(hover.samples.every((s) => s.nearHome), "every sampled position stays within the tight hover bound (≤2m of home)");
      assert.ok(hover.samples.every((s) => s.floatsAbove), "the wisp FLOATS above the ground (hover, not grounded)");
      assert.ok(hover.samples.every((s) => s.mode === "hover" && !s.defeated), "the wisp is hovering + undefeated throughout");
      assert.ok(hover.samples.every((s) => s.liveCount === 1), "only the wisp is in the moving-actor view (the sentinel stays static)");
      console.log(`  hover: drifts ${spread.toFixed(2)}m, bounded + finite + floating across ${hover.samples.length} samples`);

      // (3) ONE weapon hits BOTH; (4) defeating the sentinel leaves the wisp independent.
      const strike = await evalValue(play.cdp, STRIKE_BOTH);
      assert.equal(strike.sentinelDefeated, true, "the sentinel was defeated");
      assert.equal(strike.sentinelCompleted, true, "the sentinel beat completed");
      assert.equal(strike.sHitTarget, staged.sentinel.enemyId, "the sentinel strike resolved to the sentinel");
      assert.equal(strike.wAlive, true, "INDEPENDENCE: the wisp is still ALIVE when the sentinel dies");
      assert.equal(strike.wNotCompleted, true, "INDEPENDENCE: the wisp beat is NOT completed by the sentinel's defeat");
      assert.equal(strike.wHitTarget, staged.wisp.enemyId, "the wisp strike resolved to the WISP (not forked)");
      assert.ok(strike.wHitsAfter > strike.wHitsBefore, `the same weapon registered a hit on the wisp (${strike.wHitsBefore}→${strike.wHitsAfter})`);
      assert.ok(["hit-react", "defeated"].includes(strike.wState), `the wisp reacted to the hit (state ${strike.wState})`);
      assert.ok(strike.sActiveId && strike.sActiveId === strike.wid && strike.wActiveId === strike.wid, "the SAME equipped weapon struck both archetypes (one activeId)");
      console.log("  strike: one weapon defeats the sentinel AND hits the wisp (same activeId); wisp independent");

      assert.deepEqual(play.consoleErrors, [], `play: zero console errors\n${play.consoleErrors.join("\n")}`);
    } finally {
      await play.close();
    }

    // --- RELOAD-1: independence persists; the wisp respawns; then defeat the wisp ------------------
    const replay = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(replay.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);

      const r = await evalValue(replay.cdp, RELOAD_INDEP);
      assert.equal(r.sCompleted, true, "the sentinel beat's completion persisted across reload");
      assert.equal(r.sEnemyId, null, "a completed sentinel beat re-projects NO enemy (no corpse resurrected)");
      assert.equal(r.wCompleted, false, "the wisp beat stayed LIVE (defeating the sentinel did not complete it)");
      assert.ok(typeof r.wEnemyId === "string" && r.wEnemyId.length, "the wisp beat re-projects its enemy");
      assert.equal(r.wState, "idle", "the respawned wisp is fresh/idle (a partial hit did not persist)");
      assert.equal(r.liveCount, 1, "only the wisp hovers after reload");
      assert.deepEqual(r.liveKinds, ["hover"], "the lone moving actor is the wisp (hover)");
      console.log("  reload-1: sentinel stays defeated (no enemy); wisp respawns idle — independence held across reload");

      const dw = await evalValue(replay.cdp, DEFEAT_WISP);
      assert.equal(dw.wDefeated, true, "the wisp was defeated by the same hit path");
      assert.equal(dw.wCompleted, true, "the wisp beat completed once the wisp was defeated");
      assert.ok(dw.f0 && dw.f1, "the defeated wisp's position was sampled");
      assert.deepEqual(dw.f1, dw.f0, "a defeated wisp's position is FROZEN across further steps (movement stopped permanently)");
      console.log("  defeat-wisp: wisp defeated → movement frozen permanently → beat completed");

      assert.deepEqual(replay.consoleErrors, [], `reload-1: zero console errors\n${replay.consoleErrors.join("\n")}`);
    } finally {
      await replay.close();
    }

    // --- RELOAD-2: both beats completed; neither re-projects an enemy -------------------------------
    const final = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(final.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);
      const f = await evalValue(final.cdp, RELOAD_FINAL);
      assert.equal(f.sCompleted, true, "the sentinel beat is still completed");
      assert.equal(f.wCompleted, true, "the wisp beat completion persisted across reload");
      assert.equal(f.sEnemyId, null, "the completed sentinel beat re-projects no enemy");
      assert.equal(f.wEnemyId, null, "the completed wisp beat re-projects no enemy");
      assert.equal(f.liveCount, 0, "no moving actor remains (both beats cleared)");
      assert.deepEqual(final.consoleErrors, [], `reload-2: zero console errors\n${final.consoleErrors.join("\n")}`);
      console.log("  reload-2: both beats completed + persisted; neither re-projects an enemy");
    } finally {
      await final.close();
    }

    console.log("\n  second archetype: sentinel + wisp coexist · both combat-targeted · wisp hover bounded+finite · one weapon hits both · independent defeat · reload-persists · perf green · 0 console errors");
  }
);

if (run.skipped) console.log("browser enemy-archetypes proof skipped (no browser)");
else console.log("browser enemy-archetypes proof passed");
