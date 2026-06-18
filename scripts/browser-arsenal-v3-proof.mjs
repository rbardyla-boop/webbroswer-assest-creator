// test:arsenal-v3 — interactive weapon placement + equip-to-hand in a real (SwiftShader)
// WebGL runtime. Places a generated weapon, equips it onto the player (reparented at the
// equip marker, markers finite), drops it back to the world, stores (hides) it, and proves
// persist-mode equip survives a full page reload. Player + wildlife + ambient stay
// unaffected; zero console errors. Skips cleanly w/o Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5226;
const CDP_PORT = 9360;
const BASE = `http://127.0.0.1:${PORT}`;

// Author an ordinary alpine world (so wildlife/ambient also populate) with no weapons yet.
const AUTHOR_WORLD = `(async () => {
  const { createWorldDocument } = await import('/src/world/WorldDocument.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  localStorage.removeItem('arsenal-export-queue');
  new WorldSerializer().save(createWorldDocument({ metadata: { name: 'Arsenal v3 Proof' } }));
  return true;
})()`;

// One action sequence run inside the runtime page: place → equip → drop → store →
// persist-equip + save. Returns every observation for assertion on the Node side.
const SEQUENCE = `(() => {
  const A = window.__ARSENAL_EQUIP_DO__;
  if (!A) return { missing: true };
  const id1 = A.place({ x: 6, z: 6 });
  const placedCount = window.__ARSENAL_WORLD__().count;
  A.equip(id1);
  const equipped = window.__ARSENAL_EQUIP__();
  A.unequip('drop');
  const afterDrop = window.__ARSENAL_EQUIP__();
  A.equip(id1);
  A.unequip('store');
  const afterStore = window.__ARSENAL_EQUIP__();
  A.setPersist(true);
  const id2 = A.place({ x: -4, z: 7 });
  A.equip(id2);
  A.save();
  const afterPersist = window.__ARSENAL_EQUIP__();
  const v0 = window.__VISUAL0_DEBUG__ ? window.__VISUAL0_DEBUG__() : null;
  const wildlife = window.__WILDLIFE_DEBUG__ ? window.__WILDLIFE_DEBUG__().present : false;
  const ambient = window.__AMBIENT_DEBUG__ ? window.__AMBIENT_DEBUG__().present : false;
  return { id1, id2, placedCount, equipped, afterDrop, afterStore, afterPersist, v0, wildlife, ambient };
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "arsenal-v3-profile") },
  async () => {
    const editor = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(editor.cdp, "editor", 45000);
      assert.equal(await evalValue(editor.cdp, AUTHOR_WORLD), true);
    } finally {
      await editor.close();
    }

    // --- session 1: place / equip / drop / store / persist-equip + save -------------
    let id2 = null;
    const rt = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(rt.cdp, "runtime", 75000);
      await sleep(1000);
      const r = await evalValue(rt.cdp, SEQUENCE);
      assert.ok(r && !r.missing, "arsenal v3 DEV hooks present");

      assert.ok(r.id1, "place returns a weapon id");
      assert.ok(r.placedCount >= 1, `weapon placed in the world (${r.placedCount})`);

      assert.equal(r.equipped.equippedId, r.id1, "weapon equipped by id");
      assert.equal(r.equipped.equippedParentIsPlayer, true, "equipped weapon is parented to the player");
      assert.equal(r.equipped.markersFinite, true, "markers finite after equip");
      assert.ok(r.equipped.equipMarkerWorld?.finite, "equip marker world position finite after equip");

      assert.equal(r.afterDrop.equippedId, null, "drop unequips (back to the world)");
      assert.equal(r.afterStore.equippedId, null, "store unequips (hidden)");

      assert.ok(r.id2, "second weapon placed");
      assert.equal(r.afterPersist.equippedId, r.id2, "persist-mode weapon equipped before save");
      id2 = r.id2;

      assert.ok(r.v0 && r.v0.groundDelta <= 2.0, `player unaffected (groundDelta ${r.v0?.groundDelta?.toFixed?.(3)})`);
      assert.equal(r.wildlife, true, "wildlife still present");
      assert.equal(r.ambient, true, "ambient still present");

      if (rt.consoleErrors.length) throw new Error(`console errors (session 1):\n${rt.consoleErrors.join("\n")}`);
    } finally {
      await rt.close();
    }

    // --- session 2: reload the runtime — the persisted equipped weapon re-attaches ---
    const rt2 = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(rt2.cdp, "runtime", 75000);
      await sleep(1000);
      const e = await evalValue(rt2.cdp, `window.__ARSENAL_EQUIP__()`);
      assert.equal(e.equippedId, id2, "persisted equip survives a full reload");
      assert.equal(e.equippedParentIsPlayer, true, "re-attached to the player on reload");
      assert.equal(e.markersFinite, true, "markers still finite after reload");
      if (rt2.consoleErrors.length) throw new Error(`console errors (session 2):\n${rt2.consoleErrors.join("\n")}`);
    } finally {
      await rt2.close();
    }
  }
);

if (run.skipped) console.log("browser arsenal-v3 proof skipped (no browser)");
else console.log("browser arsenal-v3 proof passed");
