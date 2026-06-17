// test:visual0 — the glacial valley renders in a real (SwiftShader) WebGL context:
// the default world loads the ALPINE profile, the player rests on the single height
// source, the snow/scree terrain shader compiles (zero console errors), grass renders
// where it's allowed, and the glacial atmosphere (cool fog) is applied. The snow/scree
// onBeforeCompile injection only runs at GPU compile time — Node can't exercise it —
// so a broken chunk surfaces here as a WebGLProgram shader error.
//
// Shared SwiftShader harness; skips cleanly when no Chromium is present.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5219;
const CDP_PORT = 9353;
const BASE = `http://127.0.0.1:${PORT}`;

// A default world — no overrides — so it carries the alpine profile + glacial lighting.
const AUTHOR_WORLD = `(async () => {
  const { createWorldDocument } = await import('/src/world/WorldDocument.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  new WorldSerializer().save(createWorldDocument({ metadata: { name: 'Glacial Valley Proof' } }));
  return true;
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "visual0-profile") },
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
      // Let several frames render so the terrain program is actually compiled and the
      // player settles onto the ground.
      await sleep(700);

      // Profile identity + single-source grounding.
      const v0 = await evalValue(rt.cdp, `window.__VISUAL0_DEBUG__()`);
      assert.equal(v0.profile, "alpine", "default world loads the alpine profile");
      assert.ok(v0.snowlineY > 0 && Number.isFinite(v0.snowlineY), `finite snowline (${v0.snowlineY})`);
      assert.ok(v0.groundDelta <= 2.0, `player grounded on the single source (delta ${v0.groundDelta.toFixed(3)})`);

      // Terrain material v2 still wired (fog/shadow/vertex-color preserved).
      const terr = await evalValue(rt.cdp, `window.__TERRAIN_DEBUG__()`);
      assert.equal(terr.hasUpgrade, true, "terrain material upgrade present");
      assert.equal(terr.fog, true, "material fog stays on → scene fog applies");
      assert.equal(terr.vertexColors, true, "vertex colors remain the base signal");

      // Glacial atmosphere applied (cool fog from glacialLighting()).
      const light = await evalValue(rt.cdp, `window.__LIGHTING_DEBUG__()`);
      assert.ok(light.fog && light.fog.color === "#bcd2e0", `glacial fog color (${light.fog?.color})`);

      // Grass renders where it's allowed (valley floor meadows).
      const grass = await evalValue(rt.cdp, `window.__GRASS_DEBUG__()`);
      assert.ok(grass.visibleBlades > 0, `grass renders on the valley floor (${grass.visibleBlades} blades)`);

      // The decisive check: a bad snow/scree GLSL injection logs a shader error here.
      if (rt.consoleErrors.length) {
        throw new Error(`console errors during visual0 proof (terrain shader likely failed to compile):\n${rt.consoleErrors.join("\n")}`);
      }
    } finally {
      await rt.close();
    }
  }
);

if (run.skipped) console.log("browser visual0 proof skipped (no browser)");
else console.log("browser visual0 proof passed");
