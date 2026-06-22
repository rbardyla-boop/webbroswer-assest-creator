// test:slice-1-proof — Slice-1 ("The Ice Chapel") as a live, playable run in a real (SwiftShader) WebGL
// runtime. Proves the SECOND authored slice is genuinely playable end to end, reusing the shipped systems:
//   opening   — load ?world=ice-chapel-1 → the live slice resolves THIS scene's identity ("The Ice Chapel",
//               not "The Frozen Cache"); the authored broken-stair orientation sign loads + reads.
//   reward    — the optional shrine weapon instantiated (claimable, off-route).
//   combat    — the descent staged a MOVING sentinel patrol + a wisp guardian at the seal; ONE equipped weapon
//               defeats BOTH (independently); a threat fires + names the moment + the shove is recoverable.
//   completion— equip the relic → descend to the seal → deposit completes the run; the completion CARD shows
//               "The Ice Chapel" with the trophy + the "Cache sealed" cue.
//   replay    — reload: completion + trophy + identity + both encounter clears + the reward persist; 0 errors;
//               perf within the Performance Contract.
// The benchmark + frozen slices are untouched (proven byte-stable in their own gates). Skips without Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";
import { assertWithinBudget, extractMetrics } from "../src/perf/PerformanceContract.js";

const ROOT = process.cwd();
const PORT = 5266;
const CDP_PORT = 9401;
const BASE = `http://127.0.0.1:${PORT}`;
const SETTLE_MS = 1400;

// Seed the Ice Chapel as the active world (no GLB — a self-contained primitive scene), so bare ?runtime=1
// reloads load the saved world (and mutations like completion persist across reload).
const SEED = `(async () => {
  const e = window.__WORLD_EDITOR__;
  if (!e) return { missing: true };
  const { buildIceChapelV1 } = await import('/src/world/samples/iceChapelV1.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  new WorldSerializer().save(buildIceChapelV1());
  return { saved: true };
})()`;

// OPENING: the live slice wrapper resolved THIS scene's completion identity (not the default frozen cache).
const OPENING = `(() => {
  const fc = window.__FROZEN_CACHE_DEBUG__();
  return { present: fc.present, identity: fc.identity, completed: fc.completed };
})()`;

// The opening orientation sign: loaded by the interaction runtime + surfaces its loop/recovery framing on approach.
const SIGN = `(async () => {
  const { buildIceChapelV1 } = await import('/src/world/samples/iceChapelV1.js');
  const sign = buildIceChapelV1().objects.find((o) => o.id === 'ic-orientation-sign');
  const p = sign.transform.position;
  const before = window.__INTERACTION_RUNTIME__.debugSnapshot().counts.signs;
  window.__COMBAT_DO__.teleportTo(p.x, p.z);
  window.__INTERACTION_RUNTIME__.update(0);
  return { signs: before, message: window.__INTERACTION_RUNTIME__.debugSnapshot().message };
})()`;

const captureExpr = `(() => ({ perf: window.__PERF__.snapshot(), budget: window.__BUDGET__ ? window.__BUDGET__() : null }))()`;

// STAGED: two beats — a moving sentinel patrol on the descent + a wisp guardian at the seal; both combat
// targets; the wisp is the lone hover actor; its zone overlaps the cache (the seal).
const STAGED = `(() => {
  const enc = window.__ENCOUNTER__().encounters;
  const by = (id) => enc.find((e) => e.id === id);
  const d = by('ic-descent-sentinel'), w = by('ic-seal-wisp');
  const targetIds = window.__COMBAT__().targets.map((t) => t.id);
  const live = window.__ENEMY_LIVE__();
  const reward = window.__ARSENAL_WORLD__();
  return {
    ids: enc.map((e) => e.id),
    descent: d ? { enemyId: d.enemyId, type: d.enemyType, label: d.label } : null,
    seal: w ? { enemyId: w.enemyId, type: w.enemyType, label: w.label } : null,
    targetIds,
    hoverIds: live.filter((l) => l.kind === 'hover').map((l) => l.id),
    patrolIds: live.filter((l) => l.kind === 'patrol').map((l) => l.id),
    rewardIds: reward ? reward.ids : [],
  };
})()`;

// RECOVERY: reset (park the player far so the window re-arms), then cross into the descent sentinel's danger
// window from live position → it fires ONCE + names the moment; the knockback leaves the player on finite
// walkable ground (never a soft-lock → the run continues). __THREAT_DO__.step ticks only threat, so the
// sentinel stays put for a deterministic crossing.
const RECOVER = (eid, otherId) => `(() => {
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

// STRIKE: ONE equipped weapon defeats the moving descent sentinel, then the seal wisp (each aimed at its live
// position). Defeating the sentinel leaves the wisp ALIVE + its beat incomplete (independent). Both complete.
const STRIKE = `(() => {
  const enc = () => window.__ENCOUNTER__().encounters;
  const by = (id) => enc().find((e) => e.id === id);
  const D = window.__COMBAT_DO__, E = window.__ENEMY_DO__, K = window.__ENCOUNTER_DO__, live = window.__ENEMY_LIVE__;
  const dId = by('ic-descent-sentinel').enemyId, wId = by('ic-seal-wisp').enemyId;
  const dc = by('ic-descent-sentinel').position;

  // ONE weapon, equipped once, used for BOTH.
  const wid = window.__ARSENAL_CARRY_DO__.place({ x: dc[0] + 3, z: dc[2] + 1 });
  window.__ARSENAL_CARRY_DO__.equip(wid, 'rightHand');

  // (A) defeat the MOVING descent sentinel — aim at its live position, fire-until-defeated.
  const fireSentinel = () => { D.teleportNearTarget(dId, 6); window.__SCENE_SYNC__(); const q = live().find((l) => l.id === dId); if (q) { D.aimAt(q.position[0], q.position[1] + 1.0, q.position[2]); D.useActiveWeapon(); D.step(); E.step(); } };
  let sHit = null, g = 0;
  while (by('ic-descent-sentinel').enemyState !== 'defeated' && g < 48) { fireSentinel(); const ev = D.lastEvent(); if (ev && ev.hit && ev.hit.targetId === dId) sHit = ev; g++; }
  K.step();
  const sentinelDefeated = by('ic-descent-sentinel').enemyState === 'defeated';
  const sentinelCompleted = by('ic-descent-sentinel').completed;

  // (B) INDEPENDENCE: at the sentinel's defeat the seal wisp is alive + its beat incomplete.
  const wAlive = by('ic-seal-wisp').enemyState !== 'defeated';
  const wNotCompleted = by('ic-seal-wisp').completed === false;

  // (C) the SAME weapon defeats the hovering seal WISP (aim at its live hover position).
  const fireWisp = () => { D.teleportNearTarget(wId, 5); window.__SCENE_SYNC__(); const q = live().find((l) => l.id === wId); if (q) { D.aimAt(q.position[0], q.position[1], q.position[2]); D.useActiveWeapon(); D.step(); E.step(); } };
  let wHit = null, wg = 0;
  while (by('ic-seal-wisp').enemyState !== 'defeated' && wg < 56) { fireWisp(); const ev = D.lastEvent(); if (ev && ev.hit && ev.hit.targetId === wId) wHit = ev; wg++; }
  K.step();

  return {
    wid,
    sActiveId: sHit ? sHit.weaponId : null, sHitTarget: sHit ? sHit.hit.targetId : null,
    wActiveId: wHit ? wHit.weaponId : null, wHitTarget: wHit ? wHit.hit.targetId : null,
    sentinelDefeated, sentinelCompleted, wAlive, wNotCompleted,
    wDefeated: by('ic-seal-wisp').enemyState === 'defeated', wCompleted: by('ic-seal-wisp').completed,
  };
})()`;

// COMPLETION: equip the relic (a free slot — rightHand holds the strike weapon) → descend to the seal →
// deposit. The deposit drives the slice wrapper, so the completion CARD shows THIS scene's name + ending.
const COMPLETE = `(() => {
  const O = window.__OBJECTIVE_DO__, FC = window.__FROZEN_CACHE_DO__;
  O.equipRelic('back');
  O.teleportToCache();
  const before = window.__OBJECTIVE_DEBUG__().completed;
  const deposited = FC.deposit();
  window.__SLICE_SENSORY_DO__.step();
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
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "slice-1-profile") },
  async () => {
    // --- SEED (editor) -----------------------------------------------------------------------------
    const seeder = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(seeder.cdp, "editor", 45000);
      await sleep(SETTLE_MS);
      const s = await evalValue(seeder.cdp, SEED);
      assert.ok(s && !s.missing, "the editor DEV hook is available");
      assert.equal(s.saved, true, "the Ice Chapel saved as the active world");
      assert.deepEqual(seeder.consoleErrors, [], `seed: zero console errors\n${seeder.consoleErrors.join("\n")}`);
      console.log("  seeded: The Ice Chapel saved as the active world");
    } finally {
      await seeder.close();
    }

    // --- PLAY (runtime) ----------------------------------------------------------------------------
    const play = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(play.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);

      // OPENING: the live slice names THIS scene.
      const open = await evalValue(play.cdp, OPENING);
      assert.equal(open.present, true, "the playable-slice wrapper is active on the chapel");
      assert.equal(open.identity.title, "The Ice Chapel", `the slice resolves THIS scene's name (${JSON.stringify(open.identity.title)})`);
      assert.notEqual(open.identity.title, "The Frozen Cache", "the chapel does not inherit the frozen-cache name");
      assert.equal(open.identity.arrivalTagline, "Bear the relic down to the chapel seal", "the arrival banner tagline names the goal");
      console.log(`  opening: the slice names itself — "${open.identity.title} · ${open.identity.arrivalTagline}"`);

      // the orientation sign loads + surfaces the loop/recovery framing.
      const sign = await evalValue(play.cdp, SIGN);
      assert.ok(sign.signs >= 3, `the orientation sign is loaded alongside the shrine + threat signs (${sign.signs} signs)`);
      assert.ok(typeof sign.message === "string" && /relic|seal|descent|fall back/i.test(sign.message), `the orientation sign surfaces the loop/recovery framing (${JSON.stringify(sign.message)})`);
      console.log("  opening: the broken-stair orientation sign loads + reads");

      // perf: the compact chapel stays within the Performance Contract (no RED metric).
      const cap = await evalValue(play.cdp, captureExpr);
      const metrics = extractMetrics({ perf: cap.perf, budget: cap.budget });
      console.log(`  chapel  draws ${metrics.drawCalls}  tris ${metrics.triangles}  objs ${metrics.objects}  batches ${metrics.instancedBatches}`);
      assertWithinBudget("ice-chapel-1", metrics, {});

      // STAGED: two beats; a moving sentinel patrol + a hovering seal wisp; both combat targets; reward present.
      const staged = await evalValue(play.cdp, STAGED);
      assert.equal(staged.ids.length, 2, "the chapel stages two combat beats");
      assert.deepEqual(staged.ids, ["ic-descent-sentinel", "ic-seal-wisp"], "the descent sentinel + the seal wisp");
      assert.equal(staged.descent.type, "glacial_sentinel", "the descent beat is a glacial_sentinel");
      assert.equal(staged.descent.label, "the descent", "the descent beat is labelled");
      assert.equal(staged.seal.type, "frost_wisp", "the seal beat is a frost_wisp");
      assert.equal(staged.seal.label, "the seal", "the seal beat is labelled");
      assert.ok(staged.descent.enemyId && staged.seal.enemyId && staged.descent.enemyId !== staged.seal.enemyId, "the two beats project DISTINCT enemies");
      assert.ok(staged.targetIds.includes(staged.descent.enemyId) && staged.targetIds.includes(staged.seal.enemyId), "both enemies registered as combat targets");
      assert.ok(staged.patrolIds.includes(staged.descent.enemyId), "the descent sentinel is a moving patrol actor");
      assert.deepEqual(staged.hoverIds, [staged.seal.enemyId], "the lone hover actor is the seal wisp");
      assert.ok(staged.rewardIds.includes("ic-shrine-relic-weapon"), "the optional shrine reward instantiated (claimable)");
      console.log("  staged: descent sentinel patrol + seal wisp guardian (both combat-targeted); shrine reward present");

      // RECOVERY: a threat fires + names the moment; the shove leaves the player on finite ground (continuable).
      const rec = await evalValue(play.cdp, RECOVER(staged.descent.enemyId, staged.seal.enemyId));
      assert.equal(rec.fired, 1, "crossing the descent sentinel's window fires the threat once");
      assert.ok(typeof rec.warning === "string" && /fall back/i.test(rec.warning), `the warning names the recovery moment (${JSON.stringify(rec.warning)})`);
      assert.equal(rec.posFinite, true, "after the shove the player is on finite ground (recoverable — never a soft-lock)");
      console.log(`  combat: the threat fires + names the moment ("${rec.warning}"); the shove is recoverable`);

      // STRIKE: ONE weapon defeats both beats, independently.
      const strike = await evalValue(play.cdp, STRIKE);
      assert.equal(strike.sentinelDefeated, true, "the descent sentinel was defeated");
      assert.equal(strike.sentinelCompleted, true, "the descent beat completed");
      assert.equal(strike.sHitTarget, staged.descent.enemyId, "the sentinel strike resolved to the sentinel");
      assert.equal(strike.wAlive, true, "INDEPENDENCE: the seal wisp is still ALIVE when the sentinel dies");
      assert.equal(strike.wNotCompleted, true, "INDEPENDENCE: the seal beat is NOT completed by the sentinel's defeat");
      assert.equal(strike.wDefeated, true, "the same weapon defeated the seal wisp");
      assert.equal(strike.wCompleted, true, "the seal beat completed");
      assert.equal(strike.wHitTarget, staged.seal.enemyId, "the wisp strike resolved to the WISP (combat distinguished them)");
      assert.ok(strike.sActiveId && strike.sActiveId === strike.wid && strike.wActiveId === strike.wid, "the SAME equipped weapon defeated BOTH archetypes (one weaponId)");
      console.log("  strike: one weapon defeats the descent sentinel + the seal wisp (same weaponId, independent)");

      // COMPLETION: deposit completes the run; the card shows THIS scene's ending.
      const done = await evalValue(play.cdp, COMPLETE);
      assert.equal(done.before, false, "the run was incomplete before deposit (non-vacuous)");
      assert.equal(done.completed, true, "depositing the relic completes the run");
      assert.equal(done.cardVisible, true, "the completion card shows on completion");
      assert.equal(done.cardTitle, "The Ice Chapel", `the completion card names THIS scene (${JSON.stringify(done.cardTitle)})`);
      assert.ok(typeof done.cardBody === "string" && /sealed|valley floor|silence/i.test(done.cardBody), `the completion card shows the authored ending (${JSON.stringify(done.cardBody)})`);
      assert.equal(done.trophyPresent, true, "the trophy aura frames the deposited relic");
      assert.ok(done.completeCues >= 1, `the "Cache sealed" completion cue fired (${done.completeCues})`);
      console.log(`  completion: the card names the run's ending — "${done.cardTitle}" · trophy + completion cue land`);

      assert.deepEqual(play.consoleErrors, [], `play: zero console errors\n${play.consoleErrors.join("\n")}`);
    } finally {
      await play.close();
    }

    // --- REPLAY: reload — completion + identity + trophy + both clears + the reward persist ----------
    const replay = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(replay.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);
      const r = await evalValue(
        replay.cdp,
        `(() => {
          const fc = window.__FROZEN_CACHE_DEBUG__();
          const enc = window.__ENCOUNTER__().encounters;
          const by = (id) => enc.find((e) => e.id === id);
          const card = document.querySelector('.completion-card');
          const h1 = card ? card.querySelector('h1') : null;
          window.__THREAT_DO__.step();
          return {
            objectiveCompleted: window.__OBJECTIVE_DEBUG__().completed,
            identityTitle: fc.identity.title,
            trophyPresent: fc.trophyPresent,
            cardTitle: h1 ? h1.textContent : null,
            descentCompleted: by('ic-descent-sentinel').completed,
            descentEnemy: by('ic-descent-sentinel').enemyId,
            sealCompleted: by('ic-seal-wisp').completed,
            sealEnemy: by('ic-seal-wisp').enemyId,
            rewardIds: window.__ARSENAL_WORLD__().ids,
            liveCount: window.__ENEMY_LIVE__().length,
            threatEvents: window.__THREAT__().events,
          };
        })()`
      );
      assert.equal(r.objectiveCompleted, true, "the completion persisted across reload");
      assert.equal(r.identityTitle, "The Ice Chapel", "the scene identity persisted across reload (NOT reverted)");
      assert.equal(r.cardTitle, "The Ice Chapel", "the reloaded completion card shows THIS scene's name");
      assert.equal(r.trophyPresent, true, "the trophy persisted across reload");
      assert.equal(r.descentCompleted, true, "the descent beat completion persisted across reload");
      assert.equal(r.descentEnemy, null, "a completed descent beat re-projects no enemy");
      assert.equal(r.sealCompleted, true, "the seal beat completion persisted across reload");
      assert.equal(r.sealEnemy, null, "a completed seal beat re-projects no enemy");
      assert.equal(r.liveCount, 0, "no live enemies after reload (both beats cleared)");
      assert.ok(r.rewardIds.includes("ic-shrine-relic-weapon"), "the optional shrine reward persisted across reload");
      assert.equal(r.threatEvents, 0, "the transient threat state does NOT replay across reload");
      assert.deepEqual(replay.consoleErrors, [], `reload: zero console errors\n${replay.consoleErrors.join("\n")}`);
      console.log("  replay: completion + identity + trophy + both clears + reward persist; transient threat dropped; 0 errors");
    } finally {
      await replay.close();
    }

    console.log("\n  ice chapel run: opening names the slice + sign reads · two beats (patrol + wisp) one weapon defeats both · threat recoverable · completion card names THIS ending · reload-safe · 0 console errors");
  }
);

if (run.skipped) console.log("browser slice-1 proof skipped (no browser)");
else console.log("browser slice-1 proof passed");
