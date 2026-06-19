import assert from "node:assert/strict";
import path from "node:path";

import { evalValue, openPage, sleep, waitForReady, withBrowserProof } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5238;
const CDP_PORT = 9372;
const BASE = `http://127.0.0.1:${PORT}`;

const AUTHOR_WORLD = `(async () => {
  const { createWorldDocument } = await import('/src/world/WorldDocument.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  localStorage.clear();
  new WorldSerializer().save(createWorldDocument({ metadata: { name: 'Slice-0 Frozen Cache Proof' } }));
  return true;
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "frozen-cache-profile") },
  async () => {
    const editor = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(editor.cdp, "editor", 45000);
      assert.equal(await evalValue(editor.cdp, AUTHOR_WORLD), true);
    } finally {
      await editor.close();
    }

    const runtime = await openPage(CDP_PORT, `${BASE}/?play=1`);
    try {
      await waitForReady(runtime.cdp, "runtime", 75000);
      await sleep(500);
      const arrival = await evalValue(runtime.cdp, `window.__FROZEN_CACHE_DEBUG__()`);
      assert.equal(arrival.present, true, "slice runtime present");
      assert.equal(arrival.beat, "arrival", "arrival beat active");
      assert.match(arrival.banner, /FROZEN CACHE/, "arrival banner visible");
      assert.equal(arrival.beaconVisible, true, "objective beacon visible");
      assert.equal(arrival.tutorialWeaponPresent, true, "optional tutorial weapon authored");
      assert.deepEqual(arrival.landmarks, ["SliceLandmarkOverlook", "SliceLandmarkRuin", "SliceLandmarkPass"]);
      assert.equal(arrival.prompt?.key, "F", "optional pickup teaches F in context");

      const tutorialFlow = await evalValue(runtime.cdp, `(() => {
        const A = window.__FROZEN_CACHE_DO__;
        A.teleportTo(A.tutorialWeaponId());
        const before = window.__FROZEN_CACHE_DEBUG__();
        const picked = A.pickUp();
        const afterPick = window.__FROZEN_CACHE_DEBUG__();
        const holstered = A.holster();
        return { before, picked, afterPick, holstered, afterHolster: window.__FROZEN_CACHE_DEBUG__() };
      })()`);
      assert.equal(tutorialFlow.before.prompt?.key, "F", "field weapon pickup prompt appears");
      assert.ok(tutorialFlow.picked, "field weapon picked up");
      assert.equal(tutorialFlow.afterPick.prompt?.key, "H", "pickup teaches holster");
      assert.equal(tutorialFlow.holstered, true, "field weapon holstered");

      const relicFlow = await evalValue(runtime.cdp, `(() => {
        const A = window.__FROZEN_CACHE_DO__;
        A.teleportTo(A.relicId());
        const before = window.__FROZEN_CACHE_DEBUG__();
        const picked = A.pickUp();
        const afterPick = window.__FROZEN_CACHE_DEBUG__();
        const cycled = A.cycle();
        A.teleportToCache();
        const atCache = window.__FROZEN_CACHE_DEBUG__();
        const deposited = A.deposit();
        return { before, picked, afterPick, cycled, atCache, deposited, done: window.__FROZEN_CACHE_DEBUG__() };
      })()`);
      assert.equal(relicFlow.before.prompt?.key, "F", "relic prompt appears");
      assert.ok(relicFlow.picked, "relic picked up");
      assert.equal(relicFlow.afterPick.prompt?.key, "R", "multiple carried weapons teach R");
      assert.equal(relicFlow.cycled, true, "carried weapons cycle");
      assert.equal(relicFlow.atCache.prompt?.key, "G", "cache prompts deposit");
      assert.equal(relicFlow.deposited, true, "relic deposited");
      assert.equal(relicFlow.done.completed, true, "slice completes");
      assert.equal(relicFlow.done.completionCardVisible, true, "completion card appears");
      assert.equal(relicFlow.done.trophyPresent, true, "trophy presentation appears");
      if (runtime.consoleErrors.length) throw new Error(`console errors (session 1):\n${runtime.consoleErrors.join("\n")}`);
    } finally {
      await runtime.close();
    }

    const reloaded = await openPage(CDP_PORT, `${BASE}/?play=1`);
    try {
      await waitForReady(reloaded.cdp, "runtime", 75000);
      await sleep(500);
      const state = await evalValue(reloaded.cdp, `window.__FROZEN_CACHE_DEBUG__()`);
      assert.equal(state.completed, true, "completion survives reload");
      assert.equal(state.completionCardVisible, true, "completion card restores on reload");
      assert.equal(state.trophyPresent, true, "trophy restores on reload");
      if (reloaded.consoleErrors.length) throw new Error(`console errors (session 2):\n${reloaded.consoleErrors.join("\n")}`);
    } finally {
      await reloaded.close();
    }
  }
);

if (run.skipped) console.log("browser frozen-cache proof skipped (no browser)");
else console.log("browser frozen-cache proof passed");
