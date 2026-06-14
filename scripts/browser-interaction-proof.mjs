// Stage 12 browser proof: a data-only interactive world authored in the editor
// runs in the runtime. Editor page builds + saves a world (trigger→door, pickup,
// sign); runtime page (?runtime=1) loads it and, via __INTERACTION_RUNTIME__,
// proves the player entering the trigger opens the door, the pickup is collected
// + emits, and the sign overlay shows its literal text.
//
// Shared SwiftShader harness (direct vite spawn + guaranteed teardown — no
// orphaned dev server). Skips cleanly when no Chromium is present.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5203;
const CDP_PORT = 9337;
const BASE = `http://127.0.0.1:${PORT}`;

const AUTHOR_WORLD = `(async () => {
  const { createWorldDocument } = await import('/src/world/WorldDocument.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  const obj = (id, position, interaction) => ({
    id, name: id, type: 'primitive', assetRef: 'primitive-cube', primitive: 'cube',
    transform: { position, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    exclusion: { grass: false, trees: false },
    interaction,
  });
  const doc = createWorldDocument({
    metadata: { name: 'Interaction Proof' },
    player: { spawn: { x: 0, y: 0, z: 0 }, cameraMode: 'third' },
    objects: [
      obj('door-1', { x: 0, y: 0, z: 0 }, { role: 'door', channel: 'default', listenOpen: ['open'], move: { x: 0, y: 4, z: 0 }, duration: 1 }),
      obj('trig-1', { x: 0, y: 0, z: -20 }, { role: 'trigger', channel: 'default', radius: 4, emitOnEnter: ['open'] }),
      obj('pick-1', { x: 30, y: 0, z: 0 }, { role: 'pickup', radius: 3, emitOnCollect: ['coin'] }),
      obj('sign-1', { x: -30, y: 0, z: 0 }, { role: 'sign', text: 'Welcome to the proof', showRadius: 5 }),
    ],
  });
  new WorldSerializer().save(doc);
  return true;
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "interaction-profile") },
  async () => {
    // 1) Author + save the interactive world from the editor page.
    const editor = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(editor.cdp, "editor");
      assert.equal(await evalValue(editor.cdp, AUTHOR_WORLD), true);
    } finally {
      await editor.close();
    }

    // 2) Runtime page loads the saved world and indexes its interactive objects.
    const rt = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(rt.cdp, "runtime");

      const counts = await evalValue(rt.cdp, `window.__INTERACTION_RUNTIME__.debugSnapshot().counts`);
      assert.ok(
        counts.doors === 1 && counts.triggers === 1 && counts.pickups === 1 && counts.signs === 1,
        `runtime did not index interactions: ${JSON.stringify(counts)}`
      );

      // Trigger → event → door opens (player parked in the trigger; door run to open).
      const doorRes = await evalValue(rt.cdp, `(() => {
        const r = window.__INTERACTION_RUNTIME__;
        r.player.position.set(0, 0, -20);
        for (let i = 0; i < 6; i++) r.update(0.5);
        const s = r.debugSnapshot();
        return { events: s.events.map((e) => e.channel + '/' + e.name), door: s.doors[0] };
      })()`);
      assert.ok(doorRes.events.includes("default/open"), `door open event not fired: ${JSON.stringify(doorRes.events)}`);
      assert.equal(doorRes.door.open, true);

      // Pickup collected + event fired, object hidden.
      const pickRes = await evalValue(rt.cdp, `(() => {
        const r = window.__INTERACTION_RUNTIME__;
        r.player.position.set(30, 0, 0);
        r.update(0.1);
        const s = r.debugSnapshot();
        return { collected: s.pickups[0].collected, visible: s.pickups[0].visible, events: s.events.map((e) => e.channel + '/' + e.name) };
      })()`);
      assert.equal(pickRes.collected, true);
      assert.equal(pickRes.visible, false);
      assert.ok(pickRes.events.includes("default/coin"));

      // Sign proximity shows the literal text in the overlay.
      const signRes = await evalValue(rt.cdp, `(() => {
        const r = window.__INTERACTION_RUNTIME__;
        r.player.position.set(-30, 0, 0);
        r.update(0.1);
        const overlay = [...document.querySelectorAll('div')].find((d) => d.textContent === 'Welcome to the proof');
        return { message: r.debugSnapshot().message, overlayShown: !!overlay && overlay.style.display !== 'none' };
      })()`);
      assert.equal(signRes.message, "Welcome to the proof");
      assert.equal(signRes.overlayShown, true);

      if (rt.consoleErrors.length) {
        throw new Error(`console errors during interaction proof:\n${rt.consoleErrors.join("\n")}`);
      }
    } finally {
      await rt.close();
    }
  }
);

if (run.skipped) console.log("browser interaction proof skipped (no browser)");
else console.log("browser interaction proof passed");
