// Stage 14C browser proof: terrain material v2 compiles + renders in a real
// (SwiftShader) WebGL context. The onBeforeCompile injection only runs at GPU
// compile time — Node can't exercise it — so this is the gate that proves the
// injected GLSL is valid, fog/shadow/vertex-color stay wired, and the authored
// material settings round-trip into the live uniforms with NO console errors.
//
// A broken shader injection surfaces as a "THREE.WebGLProgram: Shader Error"
// console.error here; the zero-console-error assertion catches it.
//
// Shared SwiftShader harness; skips cleanly when no Chromium is present.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5208;
const CDP_PORT = 9342;
const BASE = `http://127.0.0.1:${PORT}`;

const AUTHOR_WORLD = `(async () => {
  const { createWorldDocument } = await import('/src/world/WorldDocument.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  const doc = createWorldDocument({
    metadata: { name: 'Terrain Material Proof' },
    terrain: { material: { macroIntensity: 0.7, slopeRock: 0.4, macroScale: 0.02, heightTint: 0.5, detailIntensity: 0.3 } },
  });
  new WorldSerializer().save(doc);
  return true;
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "terrain-profile") },
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
      // Let several frames render so the terrain program is actually compiled.
      await sleep(500);

      const debug = await evalValue(rt.cdp, `window.__TERRAIN_DEBUG__()`);
      // The upgrade is wired and the lighting-critical chunks were preserved.
      assert.equal(debug.hasUpgrade, true, "onBeforeCompile upgrade present");
      assert.equal(debug.vertexColors, true, "vertex colors remain the base signal");
      assert.equal(debug.fog, true, "material fog stays on → scene fog applies");
      assert.equal(debug.receiveShadow, true, "terrain still receives shadows");
      // Authored settings round-trip through validation into the live material.
      assert.ok(Math.abs(debug.settings.macroIntensity - 0.7) < 1e-6, `macroIntensity: ${debug.settings.macroIntensity}`);
      assert.ok(Math.abs(debug.settings.slopeRock - 0.4) < 1e-6, `slopeRock: ${debug.settings.slopeRock}`);
      assert.ok(Math.abs(debug.macroIntensity - 0.7) < 1e-6, `live uniform macroIntensity: ${debug.macroIntensity}`);

      // The decisive check: a bad GLSL injection logs a WebGL shader error here.
      if (rt.consoleErrors.length) {
        throw new Error(`console errors during terrain proof (shader likely failed to compile):\n${rt.consoleErrors.join("\n")}`);
      }
    } finally {
      await rt.close();
    }
  }
);

if (run.skipped) console.log("browser terrain proof skipped (no browser)");
else console.log("browser terrain proof passed");
