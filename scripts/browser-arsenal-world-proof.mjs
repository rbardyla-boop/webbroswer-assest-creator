// test:arsenal-world-proof — a generated weapon enters the world runtime, renders,
// carries its anchor markers, survives save/reload, and the arsenal handoff queue is
// drained into the world. SwiftShader; no FPS/GPU claim; skips cleanly w/o Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5217;
const CDP_PORT = 9351;
const BASE = `http://127.0.0.1:${PORT}`;
const SETTLE_MS = 1200;

// Author a saved world (in an editor page) that already contains a runtimeAssets weapon.
const AUTHOR_WEAPON_WORLD = `(async () => {
  const { generateWeaponRecipe } = await import('/src/arsenal/WeaponGrammar.js');
  const { rollConfig } = await import('/src/arsenal/WeaponConfig.js');
  const { weaponAssetId } = await import('/src/arsenal/WeaponRecipe.js');
  const { createWorldDocument } = await import('/src/world/WorldDocument.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  localStorage.removeItem('arsenal-export-queue');
  const recipe = generateWeaponRecipe(rollConfig('proof-world', 'heavy'));
  const item = { kind:'generated.weapon', id: weaponAssetId(recipe), recipe,
    transform:{ position:{x:3,y:2,z:4}, rotation:{x:0,y:0,z:0}, scale:{x:1,y:1,z:1} } };
  new WorldSerializer().save(createWorldDocument({ metadata:{name:'Weapon World'}, runtimeAssets:{ version:1, items:[item] } }));
  return { authored: 1 };
})()`;

// Author an EMPTY world + queue a weapon in the arsenal handoff queue (the "Send to
// World" path); the world should drain it on load.
const AUTHOR_QUEUE = `(async () => {
  const { generateWeaponRecipe } = await import('/src/arsenal/WeaponGrammar.js');
  const { rollConfig } = await import('/src/arsenal/WeaponConfig.js');
  const { weaponAssetId } = await import('/src/arsenal/WeaponRecipe.js');
  const { createWorldDocument } = await import('/src/world/WorldDocument.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  new WorldSerializer().save(createWorldDocument({ metadata:{name:'Empty'}, runtimeAssets:{ version:1, items:[] } }));
  const recipe = generateWeaponRecipe(rollConfig('proof-queue', 'sidearm'));
  const asset = { kind:'generated.weapon', id: weaponAssetId(recipe), recipe,
    transform:{ position:{x:0,y:0,z:0}, rotation:{x:0,y:0,z:0}, scale:{x:1,y:1,z:1} } };
  localStorage.setItem('arsenal-export-queue', JSON.stringify([asset]));
  return { queued: 1 };
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "arsenal-world-profile") },
  async () => {
    const author = async (js) => {
      const ed = await openPage(CDP_PORT, `${BASE}/`);
      try {
        await waitForReady(ed.cdp, "editor", 45000);
        await evalValue(ed.cdp, js);
      } finally {
        await ed.close();
      }
    };
    const runtimeSnapshot = async () => {
      const rt = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
      try {
        await waitForReady(rt.cdp, "runtime", 75000);
        await sleep(SETTLE_MS);
        const snap = await evalValue(rt.cdp, `window.__ARSENAL_WORLD__ ? window.__ARSENAL_WORLD__() : null`);
        const queue = await evalValue(rt.cdp, `localStorage.getItem('arsenal-export-queue')`);
        return { snap, queue, consoleErrors: rt.consoleErrors.slice() };
      } finally {
        await rt.close();
      }
    };

    // --- A: a persisted runtimeAssets weapon renders in the runtime with markers -----
    await author(AUTHOR_WEAPON_WORLD);
    const a = await runtimeSnapshot();
    if (!a.snap) throw new Error("__ARSENAL_WORLD__ hook missing");
    assert.ok(a.snap.count >= 1, `weapon placed in world (${a.snap.count})`);
    assert.ok(a.snap.markers && ["muzzle", "core", "equip", "socket"].every((k) => Array.isArray(a.snap.markers[k])), "anchor markers exposed");
    if (a.consoleErrors.length) throw new Error(`console errors:\n${a.consoleErrors.join("\n")}`);

    // --- B: persistence — reopen the runtime (no re-author), weapon is still there ----
    const b = await runtimeSnapshot();
    assert.ok(b.snap.count >= 1, `weapon survives save/reload (${b.snap.count})`);

    // --- C: the arsenal handoff queue is drained into the world on load --------------
    await author(AUTHOR_QUEUE);
    const c = await runtimeSnapshot();
    assert.ok(c.snap.count >= 1, `handoff-queued weapon placed (${c.snap.count})`);
    assert.equal(c.queue, null, "handoff queue cleared after drain");
    if (c.consoleErrors.length) throw new Error(`console errors:\n${c.consoleErrors.join("\n")}`);

    console.log(`  world weapon renders (count ${a.snap.count}), persists (${b.snap.count}), queue drains (${c.snap.count}); markers ${Object.keys(a.snap.markers).join("/")}`);
  }
);

if (run.skipped) console.log("browser arsenal-world proof skipped (no browser)");
else console.log("browser arsenal-world proof passed");
