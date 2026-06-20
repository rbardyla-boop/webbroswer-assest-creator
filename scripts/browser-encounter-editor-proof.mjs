// test:encounter-editor-proof — Encounter Editor-0 in a real (SwiftShader) WebGL runtime. Authors a
// combat beat THROUGH THE EDITOR placement tool, then plays it: the beat projects ONE ephemeral enemy the
// player defeats via the Combat-0 hitscan, the beat completes, and completion persists across reload —
// while the spawned enemy is NEVER baked into document.enemies.items. Proves, end to end:
//   - AUTHOR (editor): arm + place writes ONE encounter descriptor + draws a preview ring, spawning NO
//     enemy during authoring (the editor projects nothing),
//   - PLAY: the beat projects its enemy as a combat target; document.enemies.items stays length 0 (the
//     LOAD-BEARING no-baked-enemy assertion) while a GlacialSentinel exists in the scene,
//   - equip → strike ×3 → the enemy is defeated → the beat completes (completed false BEFORE, true AFTER),
//   - the scene stays within the Performance Contract's draw/object budget,
//   - RELOAD: completion persisted, the enemy does NOT respawn, document.enemies.items still length 0.
// Zero console errors throughout. Skips cleanly without Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5233;
const CDP_PORT = 9367;
const BASE = `http://127.0.0.1:${PORT}`;
const SETTLE_MS = 1200;

// Seed a CLEAN default world (no encounters) so the editor session authors deterministically from zero.
const SEED_CLEAN = `(async () => {
  const { createWorldDocument } = await import('/src/world/WorldDocument.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  localStorage.clear();
  const doc = createWorldDocument({ metadata: { name: 'Encounter-0 Proof' }, player: { spawn: { x: 0, y: 0, z: 0 } } });
  new WorldSerializer().save(doc);
  return true;
})()`;

// Author one combat beat ~8 units north of spawn through the REAL editor placement tool.
const AUTHOR_BEAT = `(() => {
  const E = window.__WORLD_EDITOR__;
  if (!E) return { missing: true };
  E._armEncounterPlacement(true);
  const armed = E.armedEncounter;
  const descriptor = E._placeEncounterAt(0, -8);
  // Count scene actors DURING authoring: the editor draws a preview ring but spawns NO enemy.
  let rings = 0, enemies = 0;
  E.scene.traverse((o) => { if (o.name === 'EncounterZone') rings++; if (o.name === 'GlacialSentinel') enemies++; });
  E.flushAutosave(); // persist now (so the play session loads it)
  const items = E.worldLoader.document.encounters.items;
  return {
    armed,
    placed: !!descriptor,
    count: items.length,
    id: items[0]?.id ?? null,
    completed: items[0]?.completed,
    persist: items[0]?.persistCompletion,
    enemyType: items[0]?.enemyType,
    enemyCount: items[0]?.enemyCount,
    rings,
    enemies,
  };
})()`;

const EQUIP_WEAPON = `(() => {
  const C = window.__ARSENAL_CARRY_DO__;
  if (!C) return { missing: true };
  const id = C.place({ x: 3, z: 1 });
  C.equip(id, 'rightHand');
  return { id };
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "encounter-0-profile") },
  async () => {
    // --- seed a clean world ---------------------------------------------------------------------
    const seeder = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(seeder.cdp, "editor", 45000);
      assert.equal(await evalValue(seeder.cdp, SEED_CLEAN), true, "seeded a clean default world");
    } finally {
      await seeder.close();
    }

    // --- AUTHOR: place a combat beat through the editor (no enemy spawns while authoring) --------
    const editor = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(editor.cdp, "editor", 45000);
      await sleep(SETTLE_MS);
      const a = await evalValue(editor.cdp, AUTHOR_BEAT);
      assert.ok(a && !a.missing, "the editor DEV hook is available");
      assert.equal(a.armed, true, "encounter placement armed");
      assert.equal(a.placed, true, "_placeEncounterAt returned a descriptor");
      assert.equal(a.count, 1, "exactly one encounter authored");
      assert.equal(a.completed, false, "the fresh beat is not completed");
      assert.equal(a.persist, true, "persistCompletion defaults true");
      assert.equal(a.enemyType, "glacial_sentinel", "the beat names the Enemy-0 type");
      assert.equal(a.enemyCount, 1, "the beat projects exactly one enemy");
      assert.equal(a.rings, 1, "a preview ring was drawn in the editor");
      assert.equal(a.enemies, 0, "NO enemy spawned during authoring (the editor projects nothing)");
      assert.deepEqual(editor.consoleErrors, [], `editor: zero console errors\n${editor.consoleErrors.join("\n")}`);
      console.log(`  authored beat ${a.id}: 1 descriptor + 1 preview ring, 0 enemies while editing`);
    } finally {
      await editor.close();
    }

    // --- PLAY: the beat projects its enemy as a combat target; no baked enemy -------------------
    const play = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    let encounterId = null;
    try {
      await waitForReady(play.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);

      const pre = await evalValue(
        play.cdp,
        `(() => {
          const enc = window.__ENCOUNTER__();
          const c = window.__COMBAT__();
          const d = window.__DOC_DEBUG__();
          return {
            encounters: enc.encounters,
            targetIds: c.targets.map((t) => t.id),
            docEnemies: d.enemies, docEncounters: d.encounters, sceneSentinels: d.sentinels,
          };
        })()`
      );
      assert.equal(pre.encounters.length, 1, "exactly one encounter projected");
      const beat = pre.encounters[0];
      encounterId = beat.id;
      assert.equal(beat.completed, false, "the beat starts uncompleted");
      assert.ok(beat.enemyId, "the beat has a projected enemy id");
      assert.equal(beat.enemyState, "idle", "the projected enemy starts IDLE");
      assert.ok(pre.targetIds.includes(beat.enemyId), "the projected enemy registered as a combat target (consumes the seam)");
      // THE load-bearing invariant: the enemy lives in the scene but NOT in the document.
      assert.equal(pre.docEnemies, 0, "document.enemies.items is EMPTY — the projected enemy is NOT baked");
      assert.equal(pre.docEncounters, 1, "the document stores the encounter DESCRIPTOR");
      assert.equal(pre.sceneSentinels, 1, "the projected sentinel exists in the scene (ephemeral, not baked)");

      // equip a generated weapon
      const eq = await evalValue(play.cdp, EQUIP_WEAPON);
      assert.ok(eq && !eq.missing && eq.id, "equipped a generated weapon");
      assert.equal(await evalValue(play.cdp, `window.__COMBAT__().canFire`), true, "equipped rightHand weapon → canFire");

      // stand near the projected enemy, strike it three times → defeated → beat completes
      const defeat = await evalValue(
        play.cdp,
        `(() => {
          const D = window.__COMBAT_DO__;
          const beat = window.__ENCOUNTER__().encounters[0];
          D.teleportNearTarget(beat.enemyId, 6);
          const p = beat.position; // grounded encounter centre == enemy spawn
          const fire = () => { D.aimAt(p[0], p[1] + 1.0, p[2]); D.useActiveWeapon(); D.step(); };
          const before = window.__ENCOUNTER__().encounters[0].completed;
          fire(); fire(); fire();          // 3 strikes (maxHealth 3) → defeated
          window.__ENEMY_DO__.step();       // advance the enemy FSM
          window.__ENCOUNTER_DO__.step();   // poll completion + flush the completion-persist
          const after = window.__ENCOUNTER__().encounters[0];
          const c = window.__COMBAT__();
          const d = window.__DOC_DEBUG__();
          return {
            before,
            completedAfter: after.completed,
            enemyState: after.enemyState,
            hitTarget: c.lastEvent?.hit?.targetId ?? null,
            docEnemies: d.enemies, docEncountersCompleted: d.encountersCompleted,
          };
        })()`
      );
      assert.equal(defeat.before, false, "the beat was uncompleted BEFORE the strikes (non-vacuous)");
      assert.equal(defeat.hitTarget, encounterIdEnemy(encounterId), "the strike resolved to the projected enemy");
      assert.equal(defeat.enemyState, "defeated", "three strikes DEFEATED the projected enemy");
      assert.equal(defeat.completedAfter, true, "the beat COMPLETED once its enemy was defeated");
      assert.equal(defeat.docEnemies, 0, "document.enemies.items STILL empty after defeat (never baked)");
      assert.equal(defeat.docEncountersCompleted, 1, "the encounter's completion was written to the document");

      // budget stays green (the ring + ephemeral enemy are cheap free-standing actors)
      const budget = await evalValue(
        play.cdp,
        `(() => { const b = window.__BUDGET__ ? window.__BUDGET__() : null; return b ? { ev: b.evaluated } : null; })()`
      );
      assert.ok(budget && budget.ev, "a performance budget snapshot is available");
      assert.notEqual(budget.ev.draws?.status, "red", "the encounter scene stays within the draw-call budget");
      assert.notEqual(budget.ev.objects?.status, "red", "the encounter adds no managed objects → object budget unaffected");

      assert.deepEqual(play.consoleErrors, [], `play: zero console errors\n${play.consoleErrors.join("\n")}`);
      console.log(`  beat ${encounterId}: projected enemy registered + struck to defeat (3 hits) → completed; enemies.items stayed empty`);
    } finally {
      await play.close();
    }

    // --- RELOAD: completion persists, the enemy does NOT respawn --------------------------------
    const replay = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(replay.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);
      const reloaded = await evalValue(
        replay.cdp,
        `(() => {
          const enc = window.__ENCOUNTER__().encounters[0];
          const d = window.__DOC_DEBUG__();
          const c = window.__COMBAT__();
          return {
            completed: enc?.completed,
            enemyId: enc?.enemyId,
            docEnemies: d.enemies,
            docEncountersCompleted: d.encountersCompleted,
            sceneSentinels: d.sentinels,
            targetHasEnemy: c.targets.some((t) => String(t.id).startsWith('enc:')),
          };
        })()`
      );
      assert.equal(reloaded.completed, true, "the beat's completion PERSISTED across reload");
      assert.equal(reloaded.docEncountersCompleted, 1, "the completed encounter persisted in the document");
      assert.equal(reloaded.enemyId, null, "a completed beat does NOT respawn its enemy");
      assert.equal(reloaded.sceneSentinels, 0, "no projected enemy in the scene after reload");
      assert.equal(reloaded.targetHasEnemy, false, "no ephemeral combat target after reload");
      assert.equal(reloaded.docEnemies, 0, "document.enemies.items still EMPTY after reload (never baked)");
      assert.deepEqual(replay.consoleErrors, [], `reload: zero console errors\n${replay.consoleErrors.join("\n")}`);
      console.log(`  reload: the beat persisted COMPLETED; no enemy respawned; enemies.items still empty`);
    } finally {
      await replay.close();
    }

    console.log("\n  author-in-editor → project enemy (not baked) → strike to defeat → complete → reload-persists; 0 console errors");
  }
);

// The projected enemy's id is `enc:<encounterId>:0` (EncounterRuntime.ephemeralEnemyId).
function encounterIdEnemy(encounterId) {
  return `enc:${encounterId}:0`;
}

if (run.skipped) console.log("browser encounter-editor proof skipped (no browser)");
else console.log("browser encounter-editor proof passed");
