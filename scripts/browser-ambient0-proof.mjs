// test:ambient0 — streamed firefly motes (Ambient-0) render in a real (SwiftShader) WebGL
// context and honour the hover contract: motes are present + instanced, every mote sits
// ABOVE the terrain and the water surface (and below the snowline), the player is
// unaffected, and — the parity check — the GROUNDED + FLOCK wildlife counters are UNCHANGED
// in the same scene (motes didn't perturb the other two streamed consumers). Zero console
// errors (a thrown exception / NaN matrix would surface here). Skips cleanly w/o Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5225;
const CDP_PORT = 9359;
const BASE = `http://127.0.0.1:${PORT}`;

// A dense fixed-seed alpine world so motes + herds + flocks all populate near the spawn.
const AUTHOR_WORLD = `(async () => {
  const { createWorldDocument } = await import('/src/world/WorldDocument.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  new WorldSerializer().save(createWorldDocument({
    metadata: { name: 'Ambient Proof' },
    wildlife: { density: 2.5, seed: 4242 },
    ambient: { density: 2.5, seed: 9137 },
  }));
  return true;
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "ambient0-profile") },
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
      await sleep(1100); // let streaming + prewarm + several drift frames settle

      // --- the mote hover contract ---
      const a = await evalValue(rt.cdp, `window.__AMBIENT_DEBUG__()`);
      assert.equal(a.present, true, "ambient system present");
      assert.equal(a.enabled, true, "ambient enabled on the default alpine world");
      assert.ok(a.instancedMeshes >= 1, `mote instanced mesh built (${a.instancedMeshes})`);
      assert.ok(a.activeMotes > 0, `motes streamed in near the player (${a.activeMotes})`);
      assert.ok(a.renderedInstances > 0, `motes are rendered (${a.renderedInstances})`);
      assert.equal(a.motesBelowGround, 0, "no mote is below the terrain");
      assert.equal(a.motesInWater, 0, "no mote is at/under the water surface");
      assert.equal(a.motesAboveSnowline, 0, "no mote above the snowline");

      // --- the OTHER two streamed consumers are unchanged in the same scene ---
      const w = await evalValue(rt.cdp, `window.__WILDLIFE_DEBUG__()`);
      assert.ok(w.activeAnimals > 0, `grounded herds still present (${w.activeAnimals})`);
      assert.equal(w.groundedFloating, 0, "grounded animals still on the terrain");
      assert.equal(w.groundedSubmerged, 0, "grounded animals still out of the water");
      assert.equal(w.aboveSnowline, 0, "grounded animals still below the snowline");
      assert.ok(w.flocks?.present === true && w.flocks.renderedInstances > 0, "flocks still rendered");
      assert.equal(w.flocks.birdsBelowTerrain, 0, "flock birds still above terrain");
      assert.equal(w.flocks.birdsInWater, 0, "flock birds still above water");

      // --- player unaffected ---
      const v0 = await evalValue(rt.cdp, `window.__VISUAL0_DEBUG__()`);
      assert.ok(v0.groundDelta <= 2.0, `player still grounded (delta ${v0.groundDelta.toFixed(3)})`);

      if (rt.consoleErrors.length) {
        throw new Error(`console errors during ambient0 proof:\n${rt.consoleErrors.join("\n")}`);
      }
    } finally {
      await rt.close();
    }
  }
);

if (run.skipped) console.log("browser ambient0 proof skipped (no browser)");
else console.log("browser ambient0 proof passed");
