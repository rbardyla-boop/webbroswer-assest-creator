// test:first-playable-proof — the INTEGRATED first-playable loop in one real (SwiftShader) WebGL
// session (FP-2). This is the gate the per-subsystem proofs do NOT cover: it loads a living world,
// proves the environment is actually alive (terrain · water · fog · wildlife · flocks · ambient
// motes), exercises the full weapon interaction (place · equip · slot-cycle · store), then plays the
// relic objective for real — equip the relic and **physically WALK** it to the cache (no teleport),
// deposit it on the pedestal, complete — and proves the completion + trophy + runtime assets all
// survive a full page reload, with ZERO console errors across both sessions. Skips cleanly w/o Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5229;
const CDP_PORT = 9363;
const BASE = `http://127.0.0.1:${PORT}`;

const WALK_MAX_STEPS = 600; // fixed sim steps (1/60s each) — the spawn→cache carry is ~26 units at 8.5 u/s (~184 steps)

// A dense fixed-seed alpine world with NO weapons, so herds/flocks/motes all populate near the
// spawn (same proven seeds as ambient0) and the relic + cache auto-spawn on the first runtime load.
const AUTHOR_WORLD = `(async () => {
  const { createWorldDocument } = await import('/src/world/WorldDocument.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  localStorage.removeItem('arsenal-export-queue');
  new WorldSerializer().save(createWorldDocument({
    metadata: { name: 'FP-2 First Playable Proof' },
    wildlife: { density: 2.5, seed: 4242 },
    ambient: { density: 2.5, seed: 9137 },
  }));
  return true;
})()`;

// The living-world snapshot: every environment system read once, plus the player's grounding/water.
const ENVIRONMENT = `(() => ({
  v0: window.__VISUAL0_DEBUG__ ? window.__VISUAL0_DEBUG__() : null,
  water: window.__WATER_DEBUG__ ? window.__WATER_DEBUG__() : null,
  atmosphere: window.__ATMOSPHERE_DEBUG__ ? window.__ATMOSPHERE_DEBUG__() : null,
  wildlife: window.__WILDLIFE_DEBUG__ ? window.__WILDLIFE_DEBUG__() : null,
  ambient: window.__AMBIENT_DEBUG__ ? window.__AMBIENT_DEBUG__() : null,
}))()`;

// Weapon interaction: place a fresh weapon near the player, equip it, slot-cycle it, store it.
const WEAPON_FLOW = `(() => {
  const A = window.__ARSENAL_EQUIP_DO__;
  const W = window.__ARSENAL_WORLD__;
  const E = window.__ARSENAL_EQUIP__;
  if (!A || !W || !E) return { missing: true };
  const p = window.__VISUAL0_DEBUG__().player;
  const before = W().ids.length;
  const id = A.place({ x: p.x + 2, z: p.z });
  const placed = W().ids.length;
  A.equip(id, 'rightHand');
  const equipped = E();
  A.cycle();
  const cycled = E();
  A.unequip('store');
  const stored = E();
  return { id, before, placed, equipped, cycled, stored };
})()`;

// Start the objective carry: snapshot the find state + cache, equip the relic (→ carry phase).
const OBJECTIVE_START = `(() => {
  const D = window.__OBJECTIVE_DEBUG__, A = window.__OBJECTIVE_DO__, V = window.__VISUAL0_DEBUG__;
  if (!D || !A || !window.__PLAYER_MOVE_DO__) return { missing: true };
  const start = D();
  A.equipRelic('rightHand');
  return { relicId: A.relicId(), start, carrying: D(), player: V().player };
})()`;

// Walk the player to (cx,cz): re-aim + hold forward each tick, advance fixed simulation steps via
// the real per-frame update, stop on zone entry. Deterministic (independent of headless rAF rate);
// the player still moves through the real movement/collision/grounding pipeline. Reports progress.
const WALK = (cx, cz) => `(() => {
  const M = window.__PLAYER_MOVE_DO__, O = window.__OBJECTIVE_DEBUG__, V = window.__VISUAL0_DEBUG__, Wd = window.__WATER_DEBUG__;
  let steps = 0;
  try {
    for (; steps < ${WALK_MAX_STEPS}; steps++) {
      M.faceXZ(${cx}, ${cz});
      M.hold(1, 0);
      M.step(1 / 60);
      if (O().inZone) break;
    }
  } finally {
    M.stop(); // always release the held keys, even if a step threw mid-walk
  }
  M.step(1 / 60); // settle one grounded frame with no input held
  const v = V(), o = O(), w = Wd();
  return { steps, inZone: o.inZone, phase: o.phase, player: v.player, groundDelta: v.groundDelta, submerged: w.playerSubmerged };
})()`;

// Stop, deposit on the pedestal, save.
const DEPOSIT_AND_SAVE = `(() => {
  window.__PLAYER_MOVE_DO__.stop();
  const A = window.__OBJECTIVE_DO__, D = window.__OBJECTIVE_DEBUG__;
  A.deposit();
  const done = D();
  A.save();
  return { done };
})()`;

function distXZ(a, b) {
  return Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.z ?? 0) - (b?.z ?? 0));
}

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "first-playable-profile") },
  async () => {
    const editor = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(editor.cdp, "editor", 45000);
      assert.equal(await evalValue(editor.cdp, AUTHOR_WORLD), true);
    } finally {
      await editor.close();
    }

    // --- session 1: living world → weapon flow → walk the relic to the cache → complete + save ---
    const rt = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(rt.cdp, "runtime", 75000);
      await sleep(1100); // let streaming + prewarm + several FSM/drift frames settle

      // 1) the world is actually alive ------------------------------------------------------------
      const env = await evalValue(rt.cdp, ENVIRONMENT);
      assert.ok(env.v0, "visual-0 debug hook present");
      assert.equal(env.v0.profile, "alpine", "alpine valley profile active");
      assert.ok(env.v0.groundDelta <= 2.0, `player grounded at spawn (delta ${env.v0.groundDelta?.toFixed?.(3)})`);

      assert.equal(env.water.present, true, "water surface present");
      assert.equal(env.water.playerSubmerged, false, "player not submerged at spawn");

      assert.equal(env.atmosphere.present, true, "atmosphere present");
      assert.ok(env.atmosphere.fog && Number.isFinite(env.atmosphere.fog.near) && Number.isFinite(env.atmosphere.fog.far), "fog visible");

      assert.equal(env.wildlife.present, true, "wildlife present");
      assert.ok(env.wildlife.activeAnimals > 0, `grounded herds active (${env.wildlife.activeAnimals})`);
      assert.equal(env.wildlife.groundedFloating, 0, "no grounded animal floats");
      assert.equal(env.wildlife.groundedSubmerged, 0, "no grounded animal submerged");
      const flocks = env.wildlife.flocks;
      assert.ok(flocks && flocks.present === true, "flock system present");
      assert.ok(flocks.activeFlocks > 0, `flocks active near the player (${flocks.activeFlocks})`);
      assert.ok(flocks.renderedInstances > 0, `birds rendered (${flocks.renderedInstances})`);
      assert.equal(flocks.birdsBelowTerrain, 0, "no bird below terrain");
      assert.equal(flocks.birdsInWater, 0, "no bird in water");

      assert.equal(env.ambient.present, true, "ambient motes present");
      assert.ok(env.ambient.activeMotes > 0, `motes active near the player (${env.ambient.activeMotes})`);
      assert.ok(env.ambient.renderedInstances > 0, `motes rendered (${env.ambient.renderedInstances})`);
      assert.equal(env.ambient.motesBelowGround, 0, "no mote below terrain");
      assert.equal(env.ambient.motesInWater, 0, "no mote in water");

      // 2) weapon place → equip → slot-cycle → store ----------------------------------------------
      const wf = await evalValue(rt.cdp, WEAPON_FLOW);
      assert.ok(wf && !wf.missing, "arsenal DEV hooks present");
      assert.ok(wf.id, "a fresh weapon was placed");
      assert.equal(wf.placed, wf.before + 1, "placing a weapon grows the runtime-asset set by one");
      assert.equal(wf.equipped.equippedId, wf.id, "the placed weapon equips");
      assert.equal(wf.equipped.equippedSlot, "rightHand", "equips to the right hand");
      assert.equal(wf.cycled.equippedId, wf.id, "still the same weapon after slot-cycle");
      assert.notEqual(wf.cycled.equippedSlot, "rightHand", `slot-cycled to a new slot (${wf.cycled.equippedSlot})`);
      assert.ok(!wf.stored.equippedId, "storing the weapon clears the equipped slot");

      // 3) objective: equip the relic and WALK it to the cache (no teleport) -----------------------
      const os = await evalValue(rt.cdp, OBJECTIVE_START);
      assert.ok(os && !os.missing, "objective + movement DEV hooks present");
      assert.ok(os.relicId, "objective has a relic id");
      assert.equal(os.start.phase, "find", "objective starts in the find phase");
      assert.equal(os.start.relicExists, true, "relic spawned in the world");
      assert.equal(os.start.beaconPresent, true, "cache beacon present");
      assert.equal(os.start.completed, false, "objective starts incomplete");
      assert.equal(os.carrying.phase, "carry", "equipping the relic → carry phase");
      const cache = os.start.cache;
      const startPos = os.player;

      const walk = await evalValue(rt.cdp, WALK(cache.x, cache.z));
      assert.ok(
        walk.inZone,
        `player WALKED into the cache zone within ${WALK_MAX_STEPS} steps (phase ${walk.phase}, ${walk.steps} steps, ${distXZ(walk.player, cache).toFixed(1)} units short of the cache — likely stuck on terrain/collision)`,
      );
      const walked = distXZ(startPos, walk.player);
      assert.ok(walked > 5, `player physically traversed the world (moved ${walked.toFixed(2)} units, not a teleport)`);
      assert.ok(walk.groundDelta <= 2.0, `player still grounded after the walk (delta ${walk.groundDelta?.toFixed?.(3)})`);
      assert.equal(walk.submerged, false, "player not submerged at the cache");

      // 4) deposit on the pedestal → complete, then save ------------------------------------------
      const dep = await evalValue(rt.cdp, DEPOSIT_AND_SAVE);
      assert.equal(dep.done.completed, true, "deposit completes the objective");
      assert.equal(dep.done.phase, "complete", "complete phase after deposit");
      assert.ok(dep.done.relicExists, "relic still exists as a visible trophy");
      assert.ok(distXZ(dep.done.relicPos, dep.done.cache) < 0.5, "relic sits on the cache pedestal");

      const placedCount = await evalValue(rt.cdp, `window.__ARSENAL_WORLD__().ids.length`);

      if (rt.consoleErrors.length) throw new Error(`console errors (session 1):\n${rt.consoleErrors.join("\n")}`);

      // --- session 2: reload — completion + trophy + runtime assets persist ----------------------
      const rt2 = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
      try {
        await waitForReady(rt2.cdp, "runtime", 75000);
        await sleep(1000);
        const o = await evalValue(rt2.cdp, `window.__OBJECTIVE_DEBUG__()`);
        assert.equal(o.completed, true, "completion survives a full reload");
        assert.equal(o.phase, "complete", "still in the complete phase after reload");
        assert.equal(o.relicExists, true, "relic rebuilt on reload");
        assert.equal(o.beaconPresent, true, "cache beacon rebuilt on reload");
        assert.ok(distXZ(o.relicPos, o.cache) < 0.5, "relic still on the pedestal after reload");

        const ids2 = await evalValue(rt2.cdp, `window.__ARSENAL_WORLD__().ids.length`);
        assert.ok(ids2 >= placedCount, `runtime assets persist across reload (${ids2} >= ${placedCount})`);

        const live = await evalValue(rt2.cdp, `({ wildlife: window.__WILDLIFE_DEBUG__().present, ambient: window.__AMBIENT_DEBUG__().present })`);
        assert.equal(live.wildlife, true, "wildlife rebuilt on reload");
        assert.equal(live.ambient, true, "ambient rebuilt on reload");

        if (rt2.consoleErrors.length) throw new Error(`console errors (session 2):\n${rt2.consoleErrors.join("\n")}`);
      } finally {
        await rt2.close();
      }
    } finally {
      await rt.close();
    }
  }
);

if (run.skipped) console.log("browser first-playable proof skipped (no browser)");
else console.log("browser first-playable proof passed");
