// test:first-playable-hidden-proof — FP-3 hidden-issue sweep (browser half). The live/integrated
// hostile probes in a real (SwiftShader) runtime: a deliberately-submerged authored spawn resolves to
// dry/grounded ground (player + relic + cache); a poisoned weapon marker is refused without reparent/
// orphan; hostile dt keeps the player + objective finite + recoverable; repeated reloads never
// duplicate the relic/beacon/objective; the world is byte-stable across sessions (no drift); and a
// stored weapon round-trips a real reload. Zero console errors throughout. Skips cleanly w/o Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5230;
const CDP_PORT = 9364;
const BASE = `http://127.0.0.1:${PORT}`;

// Author a dense alpine world whose player.spawn is aimed at a SUBMERGED point (discovered live), so
// the runtime must relocate the player out of the water on load. Wildlife/ambient populate near spawn.
const AUTHOR_WORLD = `(async () => {
  const { createWorldDocument } = await import('/src/world/WorldDocument.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  const { setTerrainProfile, getHeight, getWaterLevel } = await import('/src/terrain/terrainSampling.js');
  const { createTerrainProfile } = await import('/src/terrain/profiles/index.js');
  setTerrainProfile(createTerrainProfile({}));
  let wet = null;
  for (let z = -60; z <= 160 && !wet; z += 2) for (let x = -120; x <= 120 && !wet; x += 2) {
    if (getHeight(x, z) < getWaterLevel(x, z)) wet = { x, z };
  }
  localStorage.removeItem('arsenal-export-queue');
  new WorldSerializer().save(createWorldDocument({
    metadata: { name: 'FP-3 Hidden Sweep' },
    wildlife: { density: 2.5, seed: 4242 },
    ambient: { density: 2.5, seed: 9137 },
    player: wet ? { spawn: { x: wet.x, y: 60, z: wet.z } } : {},
  }));
  return { wet };
})()`;

// Spawn safety: player not submerged + grounded; relic + cache on the SAME dry/walkable/below-snowline
// ground deriveSites guarantees (isWalkable, not just height≥water — so a deriveSites fallback onto a
// cliff/snowline would fail here too).
const SPAWN_CHECK = `(async () => {
  const { isWalkable } = await import('/src/world/objectives/RelicWeaponObjective.js');
  const v0 = window.__VISUAL0_DEBUG__(), water = window.__WATER_DEBUG__(), o = window.__OBJECTIVE_DEBUG__();
  const ok = (p) => !!p && isWalkable(p.x, p.z);
  return { groundDelta: v0.groundDelta, submerged: water.playerSubmerged, relicWalkable: ok(o.relicPos), cacheWalkable: ok(o.cache) };
})()`;

// Poisoned marker: place a weapon, corrupt its equip marker, attempt equip → refused, not reparented,
// still placed (not orphaned/lost from the runtime-asset set).
const POISON_CHECK = `(() => {
  const A = window.__ARSENAL_EQUIP_DO__, E = window.__ARSENAL_EQUIP__, W = window.__ARSENAL_WORLD__, V = window.__VISUAL0_DEBUG__;
  const p = V().player;
  const before = W().ids.length;
  const id = A.place({ x: p.x + 2, z: p.z });
  const poisoned = A.poisonEquipMarker(id);
  let result = null, threw = false;
  try { result = A.equip(id, 'rightHand'); } catch (e) { threw = true; } // must REFUSE cleanly, never throw
  const e = E();
  return { id, poisoned, result, threw, before, after: W().ids.length, equippedId: e.equippedId, equippedParentIsPlayer: e.equippedParentIsPlayer };
})()`;

// Hostile dt: step the player + objective with finite extremes, then prove a normal step recovers.
const HOSTILE_DT = `(() => {
  const M = window.__PLAYER_MOVE_DO__, V = window.__VISUAL0_DEBUG__, O = window.__OBJECTIVE_DEBUG__;
  const fin = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
  const perDt = [];
  for (const dt of [1e6, -1, 0]) { M.step(dt); perDt.push({ dt, finite: fin(V().player) }); }
  for (let i = 0; i < 8; i++) M.step(1 / 60); // recover
  const v = V(), o = O();
  return { perDt, recovered: fin(v.player), groundDelta: v.groundDelta, objFinite: fin(o.cache) && Number.isFinite(o.radius) };
})()`;

// World-stability snapshot for the cross-session drift check (deterministic anchors + camera-eased fog).
const DRIFT = `(async () => {
  const { getHeight, getWaterLevel, getSlope } = await import('/src/terrain/terrainSampling.js');
  const o = window.__OBJECTIVE_DEBUG__(), a = window.__ATMOSPHERE_DEBUG__();
  return {
    height: [getHeight(0, 0), getHeight(50, 30), getHeight(-40, 80)],
    water: [getWaterLevel(0, 0), getWaterLevel(50, 30)],
    slope: [getSlope(10, 10), getSlope(-20, 40)],
    cache: o.cache, relicPos: o.relicPos, relicId: o.relicId,
    fog: a.fog ? { near: a.fog.near, far: a.fog.far } : null,
  };
})()`;

function approxEqual(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}
function assertSameWorld(s1, s2, label) {
  for (let i = 0; i < s1.height.length; i++) assert.ok(approxEqual(s1.height[i], s2.height[i]), `${label}: terrain height[${i}] stable`);
  for (let i = 0; i < s1.water.length; i++) assert.ok(approxEqual(s1.water[i], s2.water[i]), `${label}: water level[${i}] stable`);
  for (let i = 0; i < s1.slope.length; i++) assert.ok(approxEqual(s1.slope[i], s2.slope[i]), `${label}: slope[${i}] stable`);
  assert.ok(approxEqual(s1.cache.x, s2.cache.x) && approxEqual(s1.cache.z, s2.cache.z), `${label}: cache position stable`);
  assert.ok(approxEqual(s1.relicPos.x, s2.relicPos.x) && approxEqual(s1.relicPos.z, s2.relicPos.z), `${label}: relic position stable`);
  assert.equal(s1.relicId, s2.relicId, `${label}: relic id stable`);
  assert.equal(!!s1.fog, !!s2.fog, `${label}: fog presence is stable across sessions (no fog appearing/vanishing)`);
  if (s1.fog && s2.fog) {
    assert.ok(Math.abs(s1.fog.near - s2.fog.near) < 2 && Math.abs(s1.fog.far - s2.fog.far) < 2, `${label}: fog stable (camera-eased, within tolerance)`);
  }
}

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "first-playable-hidden-profile") },
  async () => {
    // Open a runtime page, wait for readiness, run fn, assert no console errors, close.
    async function runtimeSession(fn) {
      const rt = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
      try {
        await waitForReady(rt.cdp, "runtime", 75000);
        await sleep(1100);
        const result = await fn(rt);
        if (rt.consoleErrors.length) throw new Error(`console errors:\n${rt.consoleErrors.join("\n")}`);
        return result;
      } finally {
        await rt.close();
      }
    }

    // --- author the hostile world (submerged spawn) ------------------------------------------------
    const editor = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(editor.cdp, "editor", 45000);
      const authored = await evalValue(editor.cdp, AUTHOR_WORLD);
      assert.ok(authored && authored.wet, "found a submerged point to author the spawn into (the relocation guard is exercised)");
    } finally {
      await editor.close();
    }

    // --- session 1: spawn-in-water + poisoned marker + hostile dt ---------------------------------
    await runtimeSession(async (rt) => {
      const spawn = await evalValue(rt.cdp, SPAWN_CHECK);
      assert.equal(spawn.submerged, false, "player resolved out of the water (not submerged)");
      assert.ok(spawn.groundDelta <= 2.0, `player grounded after spawn relocation (delta ${spawn.groundDelta?.toFixed?.(3)})`);
      assert.equal(spawn.relicWalkable, true, "relic spawned on dry, walkable, below-snowline ground");
      assert.equal(spawn.cacheWalkable, true, "cache placed on dry, walkable, below-snowline ground");

      const poison = await evalValue(rt.cdp, POISON_CHECK);
      assert.equal(poison.poisoned, true, "the equip marker was poisoned");
      assert.equal(poison.threw, false, "the poisoned equip is refused cleanly (no exception thrown)");
      assert.equal(poison.result, false, "equip is refused for a poisoned marker");
      assert.notEqual(poison.equippedId, poison.id, "the poisoned weapon is NOT equipped");
      assert.equal(poison.equippedParentIsPlayer, false, "the poisoned weapon was not reparented to the player");
      assert.equal(poison.after, poison.before + 1, "the poisoned weapon stays placed (not orphaned/lost)");

      const hostile = await evalValue(rt.cdp, HOSTILE_DT);
      for (const r of hostile.perDt) assert.equal(r.finite, true, `player stays finite under dt=${r.dt}`);
      assert.equal(hostile.recovered, true, "player is finite after a normal recovery step");
      assert.ok(hostile.groundDelta <= 2.0, `player re-grounds after hostile dt (delta ${hostile.groundDelta?.toFixed?.(3)})`);
      assert.equal(hostile.objFinite, true, "objective state stays finite under hostile dt");
    });

    // --- sessions 2-4: repeated reloads never duplicate; world is byte-stable (drift) -------------
    let drift0 = null;
    for (let reload = 1; reload <= 3; reload++) {
      await runtimeSession(async (rt) => {
        const d = await evalValue(rt.cdp, `window.__DOC_DEBUG__()`);
        assert.equal(d.relicWeapons, 1, `reload ${reload}: exactly one relic weapon (no duplicate)`);
        assert.equal(d.cacheBeacons, 1, `reload ${reload}: exactly one cache beacon (no leak)`);
        assert.ok(d.relicMarkers <= 1, `reload ${reload}: at most one relic marker (no leak) — got ${d.relicMarkers}`);
        assert.equal(d.objectives, 1, `reload ${reload}: exactly one objective entry (no append)`);
        assert.equal(d.runtimeAssets, 1, `reload ${reload}: runtime-asset count stable at 1 (only the relic)`);

        const drift = await evalValue(rt.cdp, DRIFT);
        if (drift0 === null) drift0 = drift;
        else assertSameWorld(drift0, drift, `reload ${reload}`);
      });
    }

    // --- sessions 5-6: a stored weapon round-trips a real reload ----------------------------------
    let storedId = null;
    await runtimeSession(async (rt) => {
      const r = await evalValue(rt.cdp, `(() => {
        const A = window.__ARSENAL_EQUIP_DO__, E = window.__ARSENAL_EQUIP__, V = window.__VISUAL0_DEBUG__;
        const p = V().player;
        A.setPersist(true);
        const id = A.place({ x: p.x + 2, z: p.z });
        A.equip(id, 'back');
        A.unequip('store');
        A.save();
        return { id, equippedId: E().equippedId, assets: window.__DOC_DEBUG__().runtimeAssets };
      })()`);
      assert.ok(r.id, "placed a weapon to store");
      assert.equal(r.equippedId, null, "the weapon is stored (not equipped) before reload");
      assert.equal(r.assets, 2, "runtime-asset set now holds the relic + the stored weapon");
      storedId = r.id;
    });
    await runtimeSession(async (rt) => {
      const r = await evalValue(rt.cdp, `(() => {
        const E = window.__ARSENAL_EQUIP__(), W = window.__ARSENAL_WORLD__(), D = window.__DOC_DEBUG__();
        return { equippedId: E.equippedId, ids: W.ids, assets: D.runtimeAssets, relicWeapons: D.relicWeapons };
      })()`);
      assert.equal(r.equippedId, null, "a stored weapon reloads NOT equipped");
      assert.ok(r.ids.includes(storedId), "the stored weapon still exists in the world after reload");
      assert.equal(r.assets, 2, "runtime assets persist across the reload (relic + stored weapon)");
      assert.equal(r.relicWeapons, 1, "still exactly one relic after the store/reload cycle");
    });
  }
);

if (run.skipped) console.log("browser first-playable hidden proof skipped (no browser)");
else console.log("browser first-playable hidden proof passed");
