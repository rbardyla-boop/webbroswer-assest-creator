// test:wildlife0 — ambient wildlife renders in a real (SwiftShader) WebGL context and
// honours the biome contract at runtime: animals are present + instanced, every
// grounded animal sits ON the terrain single source (not floating, not submerged, not
// above the snowline), the player is unaffected, and there are ZERO console errors (a
// thrown exception in wildlife load/update would surface here — and would red the whole
// proof suite). Skips cleanly when no Chromium is present.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5223;
const CDP_PORT = 9357;
const BASE = `http://127.0.0.1:${PORT}`;

// A dense, fixed-seed alpine world so herds reliably populate near the spawn.
const AUTHOR_WORLD = `(async () => {
  const { createWorldDocument } = await import('/src/world/WorldDocument.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  new WorldSerializer().save(createWorldDocument({
    metadata: { name: 'Wildlife Proof' },
    wildlife: { density: 2.5, seed: 4242 },
  }));
  return true;
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "wildlife0-profile") },
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
      // Let streaming + prewarm + several FSM frames settle.
      await sleep(900);

      const w = await evalValue(rt.cdp, `window.__WILDLIFE_DEBUG__()`);
      assert.equal(w.present, true, "wildlife system present");
      assert.equal(w.enabled, true, "wildlife enabled on the default alpine world");
      assert.ok(w.instancedMeshes >= 1, `per-species instanced meshes built (${w.instancedMeshes})`);
      assert.ok(w.activeAnimals > 0, `herds streamed in near the player (${w.activeAnimals} animals)`);
      assert.ok(w.renderedInstances > 0, `animals are rendered (${w.renderedInstances} instances)`);

      // The biome contract at runtime — every grounded animal obeys the masks.
      assert.equal(w.groundedFloating, 0, "no grounded animal floats off the terrain");
      assert.equal(w.groundedSubmerged, 0, "no grounded animal stands in water");
      assert.equal(w.aboveSnowline, 0, "no grounded animal above the snowline");

      // Wildlife didn't perturb the player's own grounding.
      const v0 = await evalValue(rt.cdp, `window.__VISUAL0_DEBUG__()`);
      assert.ok(v0.groundDelta <= 2.0, `player still grounded (delta ${v0.groundDelta.toFixed(3)})`);

      // The decisive gate: any thrown exception / NaN matrix logs a console error here.
      if (rt.consoleErrors.length) {
        throw new Error(`console errors during wildlife0 proof:\n${rt.consoleErrors.join("\n")}`);
      }
    } finally {
      await rt.close();
    }
  }
);

if (run.skipped) console.log("browser wildlife0 proof skipped (no browser)");
else console.log("browser wildlife0 proof passed");
