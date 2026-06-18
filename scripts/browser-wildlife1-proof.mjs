// test:wildlife1 — aloft snow_finch flocks render in a real (SwiftShader) WebGL context and
// honour the sky-life contract at runtime: flocks are present + instanced, every bird is
// above the terrain AND above the water surface (not below ground, not in the lake), the
// GROUNDED Wildlife-0 animals STILL pass all their checks in the same scene (proves the
// grounded path is untouched), the player is unaffected, and there are ZERO console errors
// (a thrown exception / NaN instance matrix in the flock path would surface here and red the
// whole proof suite). Skips cleanly when no Chromium is present.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5224;
const CDP_PORT = 9358;
const BASE = `http://127.0.0.1:${PORT}`;

// A dense, fixed-seed alpine world so flocks reliably populate near the spawn.
const AUTHOR_WORLD = `(async () => {
  const { createWorldDocument } = await import('/src/world/WorldDocument.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  new WorldSerializer().save(createWorldDocument({
    metadata: { name: 'Flock Proof' },
    wildlife: { density: 2.5, seed: 4242 },
  }));
  return true;
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "wildlife1-profile") },
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
      await sleep(1100); // let streaming + prewarm + several flock FSM frames settle

      const w = await evalValue(rt.cdp, `window.__WILDLIFE_DEBUG__()`);
      assert.equal(w.present, true, "wildlife system present");

      // --- the aloft flock contract ---
      const f = w.flocks;
      assert.ok(f && f.present === true, "aloft flock system present");
      assert.ok(f.instancedMeshes >= 1, `flock instanced mesh built (${f.instancedMeshes})`);
      assert.ok(f.activeFlocks > 0, `flocks streamed in near the player (${f.activeFlocks} flocks)`);
      assert.ok(f.renderedInstances > 0, `birds are rendered (${f.renderedInstances} instances)`);
      assert.equal(f.birdsBelowTerrain, 0, "no bird is below the terrain");
      assert.equal(f.birdsInWater, 0, "no bird is at/under the water surface");

      // --- grounded Wildlife-0 still holds in the SAME scene (untouched) ---
      assert.ok(w.activeAnimals > 0, `grounded herds still present (${w.activeAnimals})`);
      assert.equal(w.groundedFloating, 0, "grounded animals still sit on the terrain");
      assert.equal(w.groundedSubmerged, 0, "grounded animals still out of the water");
      assert.equal(w.aboveSnowline, 0, "grounded animals still below the snowline");

      // --- the flock didn't perturb the player's grounding ---
      const v0 = await evalValue(rt.cdp, `window.__VISUAL0_DEBUG__()`);
      assert.ok(v0.groundDelta <= 2.0, `player still grounded (delta ${v0.groundDelta.toFixed(3)})`);

      if (rt.consoleErrors.length) {
        throw new Error(`console errors during wildlife1 proof:\n${rt.consoleErrors.join("\n")}`);
      }
    } finally {
      await rt.close();
    }
  }
);

if (run.skipped) console.log("browser wildlife1 proof skipped (no browser)");
else console.log("browser wildlife1 proof passed");
