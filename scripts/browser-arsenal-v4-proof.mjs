// test:arsenal-v4 — oriented equip slots + multi-slot attachment in a real (SwiftShader) WebGL
// runtime. Places a generated weapon, equips it to the rightHand, then cycles it through back and
// hip (each: re-attached to the Player, oriented, equip marker finite, correct slot), then proves
// a persist-mode equip on a NON-default slot (hip) survives a full page reload and re-attaches to
// that same slot. Player + wildlife + ambient stay unaffected; zero console errors. Skips cleanly
// w/o Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5227;
const CDP_PORT = 9361;
const BASE = `http://127.0.0.1:${PORT}`;

// Author an ordinary alpine world (so wildlife/ambient also populate) with no weapons yet.
const AUTHOR_WORLD = `(async () => {
  const { createWorldDocument } = await import('/src/world/WorldDocument.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  localStorage.removeItem('arsenal-export-queue');
  new WorldSerializer().save(createWorldDocument({ metadata: { name: 'Arsenal v4 Proof' } }));
  return true;
})()`;

// One action sequence inside the runtime page: place → equip rightHand → cycle to back → cycle to
// hip → persist-equip a second weapon on the hip + save. Returns every observation for assertion.
const SEQUENCE = `(() => {
  const A = window.__ARSENAL_EQUIP_DO__;
  if (!A) return { missing: true };
  const id1 = A.place({ x: 6, z: 6 });
  const placedCount = window.__ARSENAL_WORLD__().count;
  A.equip(id1, 'rightHand');
  const hand = window.__ARSENAL_EQUIP__();
  A.cycle();
  const back = window.__ARSENAL_EQUIP__();
  A.cycle();
  const hip = window.__ARSENAL_EQUIP__();
  A.unequip('drop');         // park the first weapon back in the world
  A.setPersist(true);
  const id2 = A.place({ x: -4, z: 7 });
  A.equip(id2, 'hip');       // persist-mode equip on a NON-default slot
  A.save();
  const persisted = window.__ARSENAL_EQUIP__();
  const v0 = window.__VISUAL0_DEBUG__ ? window.__VISUAL0_DEBUG__() : null;
  const wildlife = window.__WILDLIFE_DEBUG__ ? window.__WILDLIFE_DEBUG__().present : false;
  const ambient = window.__AMBIENT_DEBUG__ ? window.__AMBIENT_DEBUG__().present : false;
  return { id1, id2, placedCount, hand, back, hip, persisted, v0, wildlife, ambient };
})()`;

function assertSlot(o, slot, id) {
  assert.equal(o.equippedId, id, `equipped id at ${slot}`);
  assert.equal(o.equippedSlot, slot, `equipped slot is ${slot}`);
  assert.equal(o.equippedParentIsPlayer, true, `${slot}: weapon parented to the player`);
  assert.equal(o.markersFinite, true, `${slot}: markers finite`);
  assert.equal(o.markerTransformsFinite, true, `${slot}: marker transforms finite`);
  assert.equal(o.slotsFinite, true, `${slot}: all slot matrices finite`);
  assert.ok(o.equipMarkerWorld?.finite, `${slot}: equip marker world finite`);
}

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "arsenal-v4-profile") },
  async () => {
    const editor = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(editor.cdp, "editor", 45000);
      assert.equal(await evalValue(editor.cdp, AUTHOR_WORLD), true);
    } finally {
      await editor.close();
    }

    // --- session 1: place / equip / cycle slots / persist-equip on hip + save ----------------
    let id2 = null;
    const rt = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(rt.cdp, "runtime", 75000);
      await sleep(1000);
      const r = await evalValue(rt.cdp, SEQUENCE);
      assert.ok(r && !r.missing, "arsenal v4 DEV hooks present");

      assert.ok(r.id1, "place returns a weapon id");
      assert.ok(r.placedCount >= 1, `weapon placed in the world (${r.placedCount})`);

      assertSlot(r.hand, "rightHand", r.id1);
      assertSlot(r.back, "back", r.id1);
      assertSlot(r.hip, "hip", r.id1);

      assert.ok(r.id2, "second weapon placed");
      assertSlot(r.persisted, "hip", r.id2);

      assert.ok(r.v0 && r.v0.groundDelta <= 2.0, `player unaffected (groundDelta ${r.v0?.groundDelta?.toFixed?.(3)})`);
      assert.equal(r.wildlife, true, "wildlife still present");
      assert.equal(r.ambient, true, "ambient still present");
      id2 = r.id2;

      if (rt.consoleErrors.length) throw new Error(`console errors (session 1):\n${rt.consoleErrors.join("\n")}`);
    } finally {
      await rt.close();
    }

    // --- session 2: reload — the persisted hip-equipped weapon re-attaches to the hip ---------
    const rt2 = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(rt2.cdp, "runtime", 75000);
      await sleep(1000);
      const e = await evalValue(rt2.cdp, `window.__ARSENAL_EQUIP__()`);
      assert.equal(e.equippedId, id2, "persisted equip survives a full reload");
      assert.equal(e.equippedSlot, "hip", "re-attaches to the persisted slot (hip), not the default");
      assert.equal(e.equippedParentIsPlayer, true, "re-attached to the player on reload");
      assert.equal(e.markersFinite, true, "markers still finite after reload");
      assert.ok(e.equipMarkerWorld?.finite, "equip marker world finite after reload");
      if (rt2.consoleErrors.length) throw new Error(`console errors (session 2):\n${rt2.consoleErrors.join("\n")}`);
    } finally {
      await rt2.close();
    }
  }
);

if (run.skipped) console.log("browser arsenal-v4 proof skipped (no browser)");
else console.log("browser arsenal-v4 proof passed");
