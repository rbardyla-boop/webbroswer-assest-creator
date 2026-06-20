// test:enemy-proof — Enemy-0 in a real (SwiftShader) WebGL runtime. Authors a world with a doc-
// authored glacial_sentinel, then drives the SAME path a left-click takes (__COMBAT_DO__ injects the
// Mouse0 edge; step runs combatRuntime.update) to prove the enemy CONSUMES the Combat-0 seam:
//   - the enemy registers as a combat target (appears in __COMBAT__().targets), IDLE at full health,
//   - an equipped weapon's strike resolves to the enemy + decreases its health (state → hit-react),
//   - repeated strikes DEFEAT it; further strikes never reduce below 0 / re-defeat (latched),
//   - the enemy scene stays within the Performance Contract's draw/object budget,
//   - a reload PERSISTS the defeated state, coexisting with the relic objective,
//   - a world WITHOUT an enemy descriptor has zero enemies (Frozen Cache / first-playable unaffected).
// Zero console errors throughout. Skips cleanly without Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5232;
const CDP_PORT = 9366;
const BASE = `http://127.0.0.1:${PORT}`;
const SETTLE_MS = 1200;

const ENEMY_ID = "sentinel-1";
const ENEMY_TYPE = "glacial_sentinel";

// Author a world with one doc-authored sentinel ~8 units north of the (0,0,0) spawn (grounded onto
// the terrain on load), maxHealth 3. The relic objective auto-spawns in runtime, proving coexistence.
const AUTHOR_WORLD = `(async () => {
  const { createWorldDocument } = await import('/src/world/WorldDocument.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  localStorage.removeItem('arsenal-export-queue');
  const doc = createWorldDocument({
    metadata: { name: 'Enemy-0 Proof' },
    player: { spawn: { x: 0, y: 0, z: 0 } },
    enemies: { version: 1, items: [
      { type: '${ENEMY_TYPE}', id: '${ENEMY_ID}', position: { x: 0, y: 0, z: -8 }, maxHealth: 3, defeated: false },
    ] },
  });
  new WorldSerializer().save(doc);
  return true;
})()`;

// Author a default world with NO enemy descriptor (Frozen Cache / first-playable shape).
const AUTHOR_EMPTY = `(async () => {
  const { createWorldDocument } = await import('/src/world/WorldDocument.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  const doc = createWorldDocument({ metadata: { name: 'No-Enemy World' }, player: { spawn: { x: 0, y: 0, z: 0 } } });
  new WorldSerializer().save(doc);
  return true;
})()`;

const EQUIP_WEAPON = `(() => {
  const C = window.__ARSENAL_CARRY_DO__;
  if (!C) return { missing: true };
  const id = C.place({ x: 3, z: 1 });
  C.equip(id, 'rightHand');
  return { id };
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "enemy-0-profile") },
  async () => {
    // Author the enemy world in an editor session.
    const editor = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(editor.cdp, "editor", 45000);
      assert.equal(await evalValue(editor.cdp, AUTHOR_WORLD), true, "authored the enemy world");
    } finally {
      await editor.close();
    }

    // --- runtime: register → strike → defeat → persist-flush ------------------------------------
    const rt = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(rt.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);

      // the sentinel registered as a combat target + an IDLE enemy at full health
      const pre = await evalValue(
        rt.cdp,
        `(() => {
          const e = window.__ENEMY__();
          const c = window.__COMBAT__();
          return { enemies: e.enemies, targetIds: c.targets.map(t => t.id), canFire: c.canFire };
        })()`
      );
      assert.equal(pre.enemies.length, 1, "exactly one enemy spawned");
      assert.equal(pre.enemies[0].id, ENEMY_ID, "the enemy is the authored sentinel");
      assert.equal(pre.enemies[0].type, ENEMY_TYPE, "the enemy is a glacial_sentinel");
      assert.equal(pre.enemies[0].state, "idle", "the enemy starts IDLE");
      assert.equal(pre.enemies[0].health, 3, "the enemy starts at full health");
      assert.ok(pre.targetIds.includes(ENEMY_ID), "the enemy is registered as a combat target");
      assert.equal(pre.canFire, false, "no weapon equipped yet → cannot fire");

      // equip a generated weapon to the active hand
      const eq = await evalValue(rt.cdp, EQUIP_WEAPON);
      assert.ok(eq && !eq.missing && eq.id, "equipped a generated weapon");
      assert.equal(await evalValue(rt.cdp, `window.__COMBAT__().canFire`), true, "equipped rightHand weapon → canFire");

      // stand near the enemy, aim at its body, fire once → the strike resolves to the enemy + hurts it
      const firstHit = await evalValue(
        rt.cdp,
        `(() => {
          const D = window.__COMBAT_DO__;
          D.teleportNearTarget('${ENEMY_ID}', 6);
          const p = window.__ENEMY__().enemies[0].position;
          D.aimAt(p[0], p[1] + 1.0, p[2]); // aim at the body, not the grounded base
          D.useActiveWeapon();
          D.step();
          const c = window.__COMBAT__();
          const e = window.__ENEMY__().enemies[0];
          return { hitTarget: c.lastEvent?.hit?.targetId ?? null, weaponId: c.lastEvent?.weaponId ?? null, health: e.health, state: e.state };
        })()`
      );
      assert.equal(firstHit.hitTarget, ENEMY_ID, "the strike resolved to the enemy (combat's own raycast)");
      assert.equal(firstHit.weaponId, eq.id, "the strike carries the equipped weapon id");
      assert.equal(firstHit.health, 2, "the enemy lost health through combat's registerHit (no duplicate detection)");
      assert.equal(firstHit.state, "hit-react", "the enemy reacted to the strike");

      // two more strikes → defeated; an extra strike never reduces below 0 / re-defeats (latched)
      const defeat = await evalValue(
        rt.cdp,
        `(() => {
          const D = window.__COMBAT_DO__;
          const p = window.__ENEMY__().enemies[0].position;
          const fire = () => { D.aimAt(p[0], p[1] + 1.0, p[2]); D.useActiveWeapon(); D.step(); };
          fire(); fire();          // → 0 health
          const downed = window.__ENEMY__().enemies[0];
          fire();                  // extra strike on the corpse
          const after = window.__ENEMY__().enemies[0];
          window.__ENEMY_DO__.step(); // flush the defeat-persist exactly as the main loop does
          return { downedHealth: downed.health, downedState: downed.state, afterHealth: after.health, afterState: after.state };
        })()`
      );
      assert.equal(defeat.downedHealth, 0, "repeated strikes drop the enemy to 0 health");
      assert.equal(defeat.downedState, "defeated", "repeated strikes DEFEAT the enemy");
      assert.equal(defeat.afterHealth, 0, "an extra strike never drives health below 0 (latched)");
      assert.equal(defeat.afterState, "defeated", "an extra strike never re-defeats (latched)");

      // the enemy scene stays within the draw/object budget (grass triangles are the pre-existing
      // baseline; the enemy is a cheap free-standing actor that adds no managed objects)
      const budget = await evalValue(
        rt.cdp,
        `(() => { const b = window.__BUDGET__ ? window.__BUDGET__() : null; return b ? { ev: b.evaluated, metrics: b.metrics } : null; })()`
      );
      assert.ok(budget && budget.ev, "a performance budget snapshot is available");
      assert.notEqual(budget.ev.draws?.status, "red", "the enemy scene stays within the draw-call budget");
      assert.notEqual(budget.ev.objects?.status, "red", "the enemy adds no managed objects → object budget unaffected");

      assert.deepEqual(rt.consoleErrors, [], `runtime: zero console errors\n${rt.consoleErrors.join("\n")}`);
      console.log(`  sentinel ${ENEMY_ID} registered as a combat target, struck to defeat (3 hits), latched`);
    } finally {
      await rt.close();
    }

    // --- reload: the defeated state persists, relic objective coexists --------------------------
    const rt2 = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(rt2.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);
      const reloaded = await evalValue(
        rt2.cdp,
        `(() => {
          const e = window.__ENEMY__().enemies[0];
          const d = window.__DOC_DEBUG__ ? window.__DOC_DEBUG__() : null;
          const c = window.__COMBAT__();
          return { state: e?.state, health: e?.health, registered: c.targets.some(t => t.id === '${ENEMY_ID}'), objectives: d?.objectives ?? null };
        })()`
      );
      assert.equal(reloaded.state, "defeated", "the defeated state PERSISTED across reload");
      assert.equal(reloaded.health, 0, "the reloaded enemy is at 0 health");
      assert.equal(reloaded.registered, true, "the defeated enemy re-registers as a combat target (corpse, latched)");
      assert.equal(reloaded.objectives, 1, "the relic objective coexists (exactly one objective)");
      assert.deepEqual(rt2.consoleErrors, [], `reload: zero console errors\n${rt2.consoleErrors.join("\n")}`);
      console.log(`  reload: the sentinel persisted DEFEATED; relic objective intact`);
    } finally {
      await rt2.close();
    }

    // --- a world with no enemy descriptor has zero enemies (shipped world unaffected) -----------
    const editor2 = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(editor2.cdp, "editor", 45000);
      assert.equal(await evalValue(editor2.cdp, AUTHOR_EMPTY), true, "authored a default no-enemy world");
    } finally {
      await editor2.close();
    }
    const empty = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(empty.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);
      const e = await evalValue(empty.cdp, `(() => ({ enemies: window.__ENEMY__().enemies.length, combat: !!window.__COMBAT__() }))()`);
      assert.equal(e.enemies, 0, "a world without an enemy descriptor has zero enemies");
      assert.equal(e.combat, true, "the combat seam still runs (no enemies → it is simply inert)");
      assert.deepEqual(empty.consoleErrors, [], `no-enemy: zero console errors\n${empty.consoleErrors.join("\n")}`);
      console.log(`  no-enemy world: zero enemies registered (Frozen Cache / first-playable unaffected)`);
    } finally {
      await empty.close();
    }

    console.log("\n  register → strike → defeat(latched) → reload-persists + zero-enemy world + budget-ok; 0 console errors");
  }
);

if (run.skipped) console.log("browser enemy-0 proof skipped (no browser)");
else console.log("browser enemy-0 proof passed");
