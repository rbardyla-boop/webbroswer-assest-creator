// Stage 14B browser proof: the bush layer streams in the runtime. Editor authors
// + saves a bush-heavy world; the runtime loads it and proves bushes build and
// stream with a bounded draw-call budget (one instanced draw per visible patch)
// and the config round-trips — no console errors.
//
// Shared SwiftShader harness; skips cleanly when no Chromium is present.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5207;
const CDP_PORT = 9341;
const BASE = `http://127.0.0.1:${PORT}`;

const AUTHOR_WORLD = `(async () => {
  const { createWorldDocument } = await import('/src/world/WorldDocument.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  const doc = createWorldDocument({
    metadata: { name: 'Bush Proof' },
    bushes: { density: 0.12, clumpStrength: 0.4, slopeLimit: 1, seed: 1234, visibleDistance: 120 },
  });
  new WorldSerializer().save(doc);
  return true;
})()`;

async function waitForBushes(cdp, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const patches = await evalValue(cdp, `window.__BUSH_DEBUG__().activePatches`);
    if (patches > 0) return patches;
    await sleep(250);
  }
  throw new Error("bush patches never built");
}

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "bush-profile") },
  async () => {
    const editor = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(editor.cdp, "editor");
      assert.equal(await evalValue(editor.cdp, AUTHOR_WORLD), true);
    } finally {
      await editor.close();
    }

    const rt = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(rt.cdp, "runtime");
      const patches = await waitForBushes(rt.cdp);
      assert.ok(patches > 0, `bush patches should build, got ${patches}`);
      const debug = await evalValue(rt.cdp, `window.__BUSH_DEBUG__()`);
      // Config round-trips into the live system.
      assert.ok(Math.abs(debug.density - 0.12) < 1e-6, `bush density: ${debug.density}`);
      assert.ok(Math.abs(debug.clumpStrength - 0.4) < 1e-6, `bush clump: ${debug.clumpStrength}`);
      assert.equal(debug.seed, 1234, `bush seed: ${debug.seed}`);
      // Draw calls are bounded (one instanced draw per visible patch, not exploding).
      assert.equal(debug.drawCalls, debug.visiblePatches, "one draw call per visible patch");
      assert.ok(debug.drawCalls < 200, `bush draw calls should stay bounded, got ${debug.drawCalls}`);
      if (rt.consoleErrors.length) {
        throw new Error(`console errors during bush proof:\n${rt.consoleErrors.join("\n")}`);
      }
    } finally {
      await rt.close();
    }
  }
);

if (run.skipped) console.log("browser bush proof skipped (no browser)");
else console.log("browser bush proof passed");
