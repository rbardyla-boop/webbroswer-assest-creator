// Stage 14A browser proof: the grass v2 shader (clumping + distance/Fresnel tip
// tint) compiles and renders. Editor authors + saves a world with non-default
// clump/tint/fresnel; the runtime loads it and proves the grass streams visible
// blades AND the shader uniforms reflect the authored config, with no console
// errors (a GLSL compile error would surface here).
//
// Shared SwiftShader harness; skips cleanly when no Chromium is present.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5206;
const CDP_PORT = 9340;
const BASE = `http://127.0.0.1:${PORT}`;

const AUTHOR_WORLD = `(async () => {
  const { createWorldDocument } = await import('/src/world/WorldDocument.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  const doc = createWorldDocument({
    metadata: { name: 'Vegetation Proof' },
    grass: { clumpStrength: 0.4, clumpScale: 0.05, distanceTint: 0.5, fresnelIntensity: 0.6 },
  });
  new WorldSerializer().save(doc);
  return true;
})()`;

async function waitForGrass(cdp, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const blades = await evalValue(cdp, `window.__GRASS_DEBUG__().visibleBlades`);
    if (blades > 0) return blades;
    await sleep(250);
  }
  throw new Error("grass never produced visible blades");
}

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "vegetation-profile") },
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
      const blades = await waitForGrass(rt.cdp);
      assert.ok(blades > 0, `grass should render visible blades, got ${blades}`);
      const debug = await evalValue(rt.cdp, `window.__GRASS_DEBUG__()`);
      assert.ok(Math.abs(debug.distanceTint - 0.5) < 1e-6, `distanceTint uniform: ${debug.distanceTint}`);
      assert.ok(Math.abs(debug.fresnelIntensity - 0.6) < 1e-6, `fresnel uniform: ${debug.fresnelIntensity}`);
      assert.ok(Math.abs(debug.clumpStrength - 0.4) < 1e-6, `clumpStrength: ${debug.clumpStrength}`);
      if (rt.consoleErrors.length) {
        throw new Error(`console errors during vegetation proof:\n${rt.consoleErrors.join("\n")}`);
      }
    } finally {
      await rt.close();
    }
  }
);

if (run.skipped) console.log("browser vegetation proof skipped (no browser)");
else console.log("browser vegetation proof passed");
