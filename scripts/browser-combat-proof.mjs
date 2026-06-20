// test:combat-proof — Combat-0 in a real (SwiftShader) WebGL runtime. Authors a world with an inert
// combat_target_dummy + the relic objective, places + equips a generated weapon (via the arsenal
// carry hooks), then drives the SAME runtime path a left-click takes (__COMBAT_DO__ injects the
// Mouse0 edge; step runs combatRuntime.update) to prove:
//   - an EQUIPPED (rightHand) weapon produces a validated strike that hits the dummy + spawns feedback,
//   - a HOLSTERED (back/hip) weapon cannot fire (no event, dummy untouched),
//   - aiming away emits a strike with NO hit (a miss leaves the dummy untouched),
//   - reload re-registers the dummy with no leaked feedback, coexisting with the relic objective,
//   - combat works in PLAY mode (no editor).
// Zero console errors throughout. Skips cleanly without Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5231;
const CDP_PORT = 9365;
const BASE = `http://127.0.0.1:${PORT}`;
const SETTLE_MS = 1200;

// Author a world: an inert combat_target_dummy ~8 units north of the (0,0,0) spawn + nothing else.
const DUMMY_ID = "combat-dummy-1";
const AUTHOR_WORLD = `(async () => {
  const { createWorldDocument } = await import('/src/world/WorldDocument.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  localStorage.removeItem('arsenal-export-queue');
  const doc = createWorldDocument({
    metadata: { name: 'Combat-0 Proof' },
    player: { spawn: { x: 0, y: 0, z: 0 } },
    objects: [{
      id: '${DUMMY_ID}',
      name: 'combat_target_dummy',
      type: 'primitive',
      primitive: 'cylinder',
      assetRef: null,
      asset: null,
      transform: { position: { x: 0, y: 1.2, z: -8 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 2.4, z: 1 } },
      collider: { type: 'box', enabled: true },
      exclusion: { grass: true, trees: true },
    }],
  });
  new WorldSerializer().save(doc);
  return true;
})()`;

// Place + equip a generated weapon to the active (rightHand) slot via the arsenal carry hooks.
const EQUIP_WEAPON = `(() => {
  const C = window.__ARSENAL_CARRY_DO__;
  if (!C) return { missing: true };
  const id = C.place({ x: 3, z: 1 });
  C.equip(id, 'rightHand');
  return { id, snap: C.snapshot() };
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "combat-0-profile") },
  async () => {
    // Author the world in the editor session.
    const editor = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(editor.cdp, "editor", 45000);
      assert.equal(await evalValue(editor.cdp, AUTHOR_WORLD), true, "authored the combat world");
    } finally {
      await editor.close();
    }

    // --- runtime: equip → fire → hit → holstered-blocked → miss --------------------------------
    const rt = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(rt.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);

      // the dummy registered as a combat target; nothing equipped yet → cannot fire
      const pre = await evalValue(rt.cdp, `window.__COMBAT__()`);
      assert.ok(pre, "combat runtime present");
      assert.equal(pre.targets.length, 1, "the inert dummy registered as a combat target");
      assert.equal(pre.targets[0].id, DUMMY_ID, "target is the authored dummy");
      assert.equal(pre.canFire, false, "no weapon equipped yet → cannot fire");
      const dummyPos = pre.targets[0].position;
      assert.ok(Array.isArray(dummyPos) && dummyPos.every(Number.isFinite), "dummy has a finite world position");

      // equip a generated weapon to the active hand
      const eq = await evalValue(rt.cdp, EQUIP_WEAPON);
      assert.ok(eq && !eq.missing, "arsenal carry hooks present");
      assert.ok(eq.id, "placed a weapon");
      const canFire = await evalValue(rt.cdp, `window.__COMBAT__().canFire`);
      assert.equal(canFire, true, "equipped rightHand weapon → canFire");

      // stand the player a few metres from the dummy (deterministic; the default spawn relocates far
      // from the authored dummy), then aim + fire through the real input path (inject Mouse0 → step)
      const hitResult = await evalValue(
        rt.cdp,
        `(() => {
          const D = window.__COMBAT_DO__;
          D.teleportNearTarget('${DUMMY_ID}', 6);
          const p = window.__COMBAT__().targets[0].position;
          D.aimAt(p[0], p[1], p[2]);
          D.useActiveWeapon();
          D.step();
          const snap = window.__COMBAT__();
          return { event: snap.lastEvent, hitCount: snap.targets[0].hitCount, marks: snap.activeMarks };
        })()`
      );
      assert.ok(hitResult.event, "a strike event was produced");
      assert.ok(hitResult.event.hit, "the strike hit the dummy");
      assert.equal(hitResult.event.hit.targetId, DUMMY_ID, "hit carries the dummy's target id");
      assert.equal(hitResult.event.weaponId, eq.id, "event carries the equipped weapon id");
      assert.ok(
        hitResult.event.hit.point.every(Number.isFinite) && hitResult.event.hit.normal.every(Number.isFinite),
        "hit point + normal are finite"
      );
      assert.equal(hitResult.hitCount, 1, "the dummy recorded exactly one hit");
      assert.ok(hitResult.marks >= 1, "impact feedback spawned");
      console.log(`  equipped weapon ${eq.id.slice(0, 10)} struck the dummy @ dist ${hitResult.event.hit.distance.toFixed(1)} (feedback ${hitResult.marks})`);

      // holster the active weapon → rightHand empties → cannot fire → firing produces NO new event
      const holstered = await evalValue(
        rt.cdp,
        `(() => {
          window.__ARSENAL_CARRY_DO__.holsterOrDraw();
          const D = window.__COMBAT_DO__;
          const before = JSON.stringify(window.__COMBAT__().lastEvent);
          const canFire = window.__COMBAT__().canFire;
          D.aimAt(${dummyPos[0]}, ${dummyPos[1]}, ${dummyPos[2]});
          D.useActiveWeapon();
          D.step();
          const after = JSON.stringify(window.__COMBAT__().lastEvent);
          return { canFire, hitCount: window.__COMBAT__().targets[0].hitCount, eventUnchanged: before === after };
        })()`
      );
      assert.equal(holstered.canFire, false, "holstered weapon (back/hip) → cannot fire");
      assert.equal(holstered.hitCount, 1, "a holstered weapon produced no new hit (still 1)");
      assert.equal(holstered.eventUnchanged, true, "a holstered weapon emitted no new event (lastEvent unchanged)");

      // re-draw + aim AWAY → a strike with no hit (a miss leaves the dummy untouched)
      const miss = await evalValue(
        rt.cdp,
        `(() => {
          window.__ARSENAL_CARRY_DO__.holsterOrDraw(); // hand empty → draw the holstered weapon back
          const D = window.__COMBAT_DO__;
          D.aimAt(${dummyPos[0]}, ${dummyPos[1]}, ${-dummyPos[2] + 50}); // aim the opposite way
          D.useActiveWeapon();
          D.step();
          const snap = window.__COMBAT__();
          return { canFire: snap.canFire, hit: snap.lastEvent ? snap.lastEvent.hit : 'none', hitCount: snap.targets[0].hitCount };
        })()`
      );
      assert.equal(miss.canFire, true, "weapon re-drawn to the active hand");
      assert.equal(miss.hit, null, "aiming away → a strike with no hit (miss)");
      assert.equal(miss.hitCount, 1, "a miss never increments the dummy (still 1)");

      assert.deepEqual(rt.consoleErrors, [], `runtime: zero console errors\n${rt.consoleErrors.join("\n")}`);
      console.log(`  holstered weapon blocked; miss left the dummy untouched`);
    } finally {
      await rt.close();
    }

    // --- reload: targets re-register, no leaked feedback, relic objective coexists --------------
    const rt2 = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(rt2.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);
      const reloaded = await evalValue(
        rt2.cdp,
        `(() => {
          const c = window.__COMBAT__();
          const d = window.__DOC_DEBUG__ ? window.__DOC_DEBUG__() : null;
          return { targets: c.targets.length, hitCount: c.targets[0]?.hitCount ?? -1, marks: c.activeMarks, objectives: d?.objectives ?? null, cacheBeacons: d?.cacheBeacons ?? null };
        })()`
      );
      assert.equal(reloaded.targets, 1, "reload re-registered the dummy as a target");
      assert.equal(reloaded.hitCount, 0, "the reloaded target starts fresh (no stale hit)");
      assert.equal(reloaded.marks, 0, "no leaked impact feedback after reload");
      assert.equal(reloaded.objectives, 1, "the relic objective coexists (exactly one objective)");
      assert.equal(reloaded.cacheBeacons, 1, "the relic cache beacon coexists (no leak)");
      assert.deepEqual(rt2.consoleErrors, [], `reload: zero console errors\n${rt2.consoleErrors.join("\n")}`);
      console.log(`  reload: dummy re-registered (hitCount 0, 0 marks); relic objective intact`);
    } finally {
      await rt2.close();
    }

    // --- play mode: combat present, no editor ---------------------------------------------------
    const play = await openPage(CDP_PORT, `${BASE}/?play=1`);
    try {
      await waitForReady(play.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);
      const p = await evalValue(play.cdp, `(() => ({ targets: window.__COMBAT__().targets.length, hasEditor: !!window.__WORLD_EDITOR__ }))()`);
      assert.equal(p.targets, 1, "the combat seam runs in play mode (dummy registered)");
      assert.equal(p.hasEditor, false, "no editor exists in play mode");
      assert.deepEqual(play.consoleErrors, [], `play: zero console errors\n${play.consoleErrors.join("\n")}`);
      console.log(`  play: combat seam active on the dummy, no editor`);
    } finally {
      await play.close();
    }

    console.log("\n  equipped→hit + holstered-blocked + miss + reload-stable + in-play; 0 console errors");
  }
);

if (run.skipped) console.log("browser combat-0 proof skipped (no browser)");
else console.log("browser combat-0 proof passed");
