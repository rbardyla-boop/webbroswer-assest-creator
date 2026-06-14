// Stage 13A browser proof: the lighting editor applies live and round-trips into
// the runtime. Editor page drives the LightingPanel and asserts the live rig
// changed immediately; it saves the world; the runtime page loads it and proves
// the same sun/fog were applied on boot (via the DEV-only __LIGHTING_DEBUG__).
//
// Shared SwiftShader harness; skips cleanly when no Chromium is present.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5204;
const CDP_PORT = 9338;
const BASE = `http://127.0.0.1:${PORT}`;

const DRIVE_PANEL = `(() => {
  const e = window.__WORLD_EDITOR__;
  if (!e) throw new Error("editor hook missing");
  e.open();
  e.lightingPanel.setLighting({
    sun: { color: '#ff3300', intensity: 5.5, azimuth: 120, elevation: 60, castShadow: true },
    hemisphere: { skyColor: '#223344', groundColor: '#556677', intensity: 0.4 },
    fog: { color: '#102030', near: 50, far: 350, enabled: true },
  });
  e.lightingPanel._emit(); // apply live + write into worldLoader.document.lighting
  const u = e.grassSystem.grassMaterial.material.uniforms;
  return { ...window.__LIGHTING_DEBUG__(), grassFogFar: u.uFogFar.value, grassSunColor: '#' + u.uSunColor.value.getHexString() };
})()`;

const SAVE_WORLD = `(async () => {
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  new WorldSerializer().save(window.__WORLD_EDITOR__.worldLoader.document);
  return true;
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "lighting-profile") },
  async () => {
    // 1) Editor: drive the panel, assert the live rig updated immediately.
    const editor = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(editor.cdp, "editor");
      const live = await evalValue(editor.cdp, DRIVE_PANEL);
      assert.equal(live.sunColor, "#ff3300", `live sun color: ${JSON.stringify(live)}`);
      assert.ok(Math.abs(live.sunIntensity - 5.5) < 1e-6, `live sun intensity: ${live.sunIntensity}`);
      assert.equal(live.fog.far, 350);
      assert.equal(live.fog.color, "#102030");
      // The grass shader must track the live edit too (it is manually fogged).
      assert.equal(live.grassFogFar, 350, `grass fog far: ${live.grassFogFar}`);
      assert.equal(live.grassSunColor, "#ff3300", `grass sun color: ${live.grassSunColor}`);
      assert.equal(await evalValue(editor.cdp, SAVE_WORLD), true);
    } finally {
      await editor.close();
    }

    // 2) Runtime: the saved lighting is applied on boot.
    const rt = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(rt.cdp, "runtime");
      const applied = await evalValue(rt.cdp, `window.__LIGHTING_DEBUG__()`);
      assert.equal(applied.sunColor, "#ff3300", `runtime sun color: ${JSON.stringify(applied)}`);
      assert.ok(Math.abs(applied.sunIntensity - 5.5) < 1e-6, `runtime sun intensity: ${applied.sunIntensity}`);
      assert.equal(applied.fog.far, 350);
      assert.equal(applied.fog.color, "#102030");
      if (rt.consoleErrors.length) {
        throw new Error(`console errors during lighting proof:\n${rt.consoleErrors.join("\n")}`);
      }
    } finally {
      await rt.close();
    }
  }
);

if (run.skipped) console.log("browser lighting proof skipped (no browser)");
else console.log("browser lighting proof passed");
