// test:first-objective-proof — the FP-1 relic objective played end-to-end in a real (SwiftShader)
// WebGL runtime. An empty alpine world is authored; on the first runtime load the objective spawns
// the relic + cache. The proof then drives the full loop via DEV hooks — find → equip → carry
// (teleport to the cache) → deposit on the pedestal → complete — and proves completion + the relic's
// pedestal transform survive a full page reload. Wildlife + ambient stay present; zero console errors.
// Skips cleanly w/o Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5228;
const CDP_PORT = 9362;
const BASE = `http://127.0.0.1:${PORT}`;

// Author an ordinary alpine world (so wildlife/ambient populate) with NO weapons — the objective
// spawns the relic itself on the first runtime load.
const AUTHOR_WORLD = `(async () => {
  const { createWorldDocument } = await import('/src/world/WorldDocument.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  localStorage.removeItem('arsenal-export-queue');
  new WorldSerializer().save(createWorldDocument({ metadata: { name: 'FP-1 Objective Proof' } }));
  return true;
})()`;

// One action sequence inside the runtime page: observe the start state, equip the relic, carry it to
// the cache (teleport), deposit it, and save. Returns every observation for assertion.
const SEQUENCE = `(() => {
  const D = window.__OBJECTIVE_DEBUG__;
  const A = window.__OBJECTIVE_DO__;
  if (!D || !A) return { missing: true };
  const start = D();
  const relicId = A.relicId();
  A.equipRelic('rightHand');
  const carrying = D();
  A.teleportToCache();
  const atCache = D();
  A.deposit();
  const done = D();
  A.save();
  const wildlife = window.__WILDLIFE_DEBUG__ ? window.__WILDLIFE_DEBUG__().present : false;
  const ambient = window.__AMBIENT_DEBUG__ ? window.__AMBIENT_DEBUG__().present : false;
  const v0 = window.__VISUAL0_DEBUG__ ? window.__VISUAL0_DEBUG__() : null;
  return { relicId, start, carrying, atCache, done, wildlife, ambient, v0 };
})()`;

function distXZ(a, b) {
  return Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.z ?? 0) - (b?.z ?? 0));
}

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "first-objective-profile") },
  async () => {
    const editor = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(editor.cdp, "editor", 45000);
      assert.equal(await evalValue(editor.cdp, AUTHOR_WORLD), true);
    } finally {
      await editor.close();
    }

    // --- session 1: find → equip → carry → deposit → complete + save -------------------------
    const rt = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(rt.cdp, "runtime", 75000);
      await sleep(1000);
      const r = await evalValue(rt.cdp, SEQUENCE);
      assert.ok(r && !r.missing, "FP-1 objective DEV hooks present");

      assert.ok(r.relicId, "objective has a relic id");
      assert.equal(r.start.present, true, "objective present");
      assert.equal(r.start.phase, "find", "starts in the find phase");
      assert.equal(r.start.relicExists, true, "relic spawned in the world");
      assert.equal(r.start.beaconPresent, true, "cache beacon present");
      assert.equal(r.start.completed, false, "objective starts incomplete");

      assert.equal(r.carrying.phase, "carry", "equipping the relic → carry phase");
      assert.equal(r.atCache.inZone, true, "teleport puts the player in the cache zone");
      assert.equal(r.atCache.phase, "atCache", "in-zone while carrying → atCache phase");

      assert.equal(r.done.completed, true, "deposit completes the objective");
      assert.equal(r.done.phase, "complete", "complete phase after deposit");
      assert.ok(r.done.relicExists, "relic still exists (a visible trophy)");
      assert.ok(distXZ(r.done.relicPos, r.done.cache) < 0.5, "relic sits on the cache pedestal");

      assert.ok(r.v0 && r.v0.groundDelta <= 2.0, `player unaffected (groundDelta ${r.v0?.groundDelta?.toFixed?.(3)})`);
      assert.equal(r.wildlife, true, "wildlife still present");
      assert.equal(r.ambient, true, "ambient still present");

      if (rt.consoleErrors.length) throw new Error(`console errors (session 1):\n${rt.consoleErrors.join("\n")}`);
    } finally {
      await rt.close();
    }

    // --- session 2: reload — completion + the relic's pedestal transform persist --------------
    const rt2 = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(rt2.cdp, "runtime", 75000);
      await sleep(1000);
      const e = await evalValue(rt2.cdp, `window.__OBJECTIVE_DEBUG__()`);
      assert.equal(e.completed, true, "completion survives a full reload");
      assert.equal(e.phase, "complete", "still in the complete phase after reload");
      assert.equal(e.relicExists, true, "relic rebuilt on reload");
      assert.equal(e.beaconPresent, true, "cache beacon rebuilt on reload");
      assert.ok(distXZ(e.relicPos, e.cache) < 0.5, "relic still on the pedestal after reload");
      if (rt2.consoleErrors.length) throw new Error(`console errors (session 2):\n${rt2.consoleErrors.join("\n")}`);
    } finally {
      await rt2.close();
    }
  }
);

if (run.skipped) console.log("browser first-objective proof skipped (no browser)");
else console.log("browser first-objective proof passed");
