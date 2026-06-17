// test:visual1 — the glacial water + valley atmosphere render in a real (SwiftShader)
// WebGL context. The decisive check is GPU-only: the water material's onBeforeCompile
// (discard + transparent + depthWrite:false + procedural flow) only compiles on the
// GPU, so a broken chunk surfaces here as a WebGLProgram error. Also proves: the
// default (alpine) world builds a water mesh with submerged verts; the live runtime
// places NO grass underwater; the player is not spawned submerged; the atmosphere fog
// is wired and sane; zero console errors. Skips cleanly when no Chromium is present.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5221;
const CDP_PORT = 9355;
const BASE = `http://127.0.0.1:${PORT}`;

// A default world — no overrides — so it carries the alpine profile (water) + glacial fog.
const AUTHOR_WORLD = `(async () => {
  const { createWorldDocument } = await import('/src/world/WorldDocument.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  new WorldSerializer().save(createWorldDocument({ metadata: { name: 'Glacial Water Proof' } }));
  return true;
})()`;

// In the live runtime, no grass blade may sit below the water table. Sample the trough
// and assert the active placement predicate rejects every submerged point.
const NO_GRASS_UNDERWATER = `(async () => {
  const t = await import('/src/terrain/terrainSampling.js');
  let submergedTested = 0, violations = 0;
  for (let z = -200; z <= 200; z += 8) {
    for (let x = -100; x <= 100; x += 4) {
      if (t.getHeight(x, z) < t.getWaterLevel(x, z)) {
        submergedTested++;
        if (t.canPlaceGrass(x, z, 0)) violations++; // rng01=0 → only the hard gates can reject
      }
    }
  }
  return { submergedTested, violations };
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "visual1-profile") },
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
      // Let several frames render so the water program actually compiles and the
      // player settles + the atmosphere eases.
      await sleep(800);

      // Water surface present + submerged + player not under it.
      const w = await evalValue(rt.cdp, `window.__WATER_DEBUG__()`);
      assert.equal(w.present, true, "alpine default world built a water surface mesh");
      assert.ok(w.triangles > 0, `water mesh has geometry (${w.triangles} tris)`);
      assert.ok(w.submergedVerts > 0, `water actually pools in the trough (${w.submergedVerts} submerged verts)`);
      assert.equal(w.playerSubmerged, false, "player is not spawned underwater");

      // Visual-1 identity snapshot.
      const v1 = await evalValue(rt.cdp, `window.__VISUAL1_DEBUG__()`);
      assert.equal(v1.profile, "alpine", "default world is alpine");
      assert.equal(v1.waterPresent, true, "water present in the alpine world");
      assert.ok(v1.grassBlades > 0, `grass still renders (${v1.grassBlades} blades)`);

      // No grass underwater in the live runtime.
      const g = await evalValue(rt.cdp, NO_GRASS_UNDERWATER);
      assert.ok(g.submergedTested > 0, `tested submerged points exist (${g.submergedTested})`);
      assert.equal(g.violations, 0, "zero grass placed underwater");

      // Atmosphere fog wired + sane (modulation correctness is covered by test:atmosphere).
      const atmo = await evalValue(rt.cdp, `window.__ATMOSPHERE_DEBUG__()`);
      assert.equal(atmo.present, true, "valley atmosphere is wired");
      assert.ok(atmo.fog && atmo.fog.near > 0 && atmo.fog.near < atmo.fog.far, "fog is present and sane");

      // The decisive check: a bad water GLSL injection logs a shader error here.
      if (rt.consoleErrors.length) {
        throw new Error(`console errors during visual1 proof (water shader likely failed to compile):\n${rt.consoleErrors.join("\n")}`);
      }
    } finally {
      await rt.close();
    }
  }
);

if (run.skipped) console.log("browser visual1 proof skipped (no browser)");
else console.log("browser visual1 proof passed");
