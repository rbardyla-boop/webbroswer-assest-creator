// test:arsenal-proof — the Arsenal Lab renders under a real (SwiftShader) browser.
//
// Loads /arsenal.html, confirms a weapon is built and rendered, re-rolls each of the
// four base types and asserts each produces a non-empty mesh set, checks in-browser
// determinism (same seed+type → identical counts), and requires zero console errors.
// No FPS/GPU claim (SwiftShader). Skips cleanly when no Chromium is present.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5215;
const CDP_PORT = 9349;
const BASE = `http://127.0.0.1:${PORT}`;
const TYPES = ["sidearm", "longarm", "heavy", "exotic"];

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "arsenal-profile") },
  async () => {
    const page = await openPage(CDP_PORT, `${BASE}/arsenal.html`);
    try {
      await waitForReady(page.cdp, "arsenal", 45000);

      // A weapon is built + rendered on load.
      const initial = await evalValue(page.cdp, `window.__ARSENAL_DEBUG__ ? window.__ARSENAL_DEBUG__() : null`);
      if (!initial) throw new Error("__ARSENAL_DEBUG__ hook missing");
      assert.ok(initial.meshCount >= 1, `initial weapon has meshes (${initial.meshCount})`);
      assert.ok(initial.triangles > 0, `initial weapon has triangles (${initial.triangles})`);
      assert.ok(initial.recipe && initial.recipe.family, "initial recipe exposed");

      const hasReroll = await evalValue(page.cdp, `typeof window.__ARSENAL_REROLL__ === "function"`);
      if (!hasReroll) throw new Error("__ARSENAL_REROLL__ hook missing (DEV mode required)");

      // Each base type re-rolls into a non-empty, on-type weapon.
      const seen = [];
      for (const type of TYPES) {
        const snap = await evalValue(page.cdp, `window.__ARSENAL_REROLL__(${JSON.stringify("proof-" + type)}, ${JSON.stringify(type)})`);
        assert.equal(snap.type, type, `re-roll produced a ${type}`);
        assert.ok(snap.meshCount >= 1 && snap.triangles > 0, `${type}: renders (${snap.meshCount} meshes, ${snap.triangles} tris)`);
        assert.ok(snap.recipe.counts.energy >= 1, `${type}: has an energy core`);
        seen.push(`${type}:${snap.meshCount}/${snap.triangles}`);
      }

      // In-browser TOPOLOGY determinism: same seed+type → identical mesh + triangle
      // counts (full-recipe determinism is proven by deepEqual in test:arsenal).
      const a = await evalValue(page.cdp, `window.__ARSENAL_REROLL__("det", "heavy")`);
      const b = await evalValue(page.cdp, `window.__ARSENAL_REROLL__("det", "heavy")`);
      assert.equal(a.meshCount, b.meshCount, "deterministic mesh count");
      assert.equal(a.triangles, b.triangles, "deterministic triangle count");

      if (page.consoleErrors.length) throw new Error(`console errors:\n${page.consoleErrors.join("\n")}`);
      console.log(`  arsenal renders; types ${seen.join(" ")}`);
    } finally {
      await page.close();
    }
  }
);

if (run.skipped) console.log("browser arsenal proof skipped (no browser)");
else console.log("browser arsenal proof passed");
