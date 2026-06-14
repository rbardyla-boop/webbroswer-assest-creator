// Stage 13B browser proof: a data-only particle emitter previews in the editor
// and runs in the runtime. Editor authors + saves a world with a smoke emitter,
// loads it (preview runs), and asserts particles spawn; the runtime page loads
// the same world and proves its ParticleRuntime spawns within the pool cap.
//
// Shared SwiftShader harness; skips cleanly when no Chromium is present.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5205;
const CDP_PORT = 9339;
const BASE = `http://127.0.0.1:${PORT}`;

const AUTHOR_AND_PREVIEW = `(async () => {
  const { createWorldDocument } = await import('/src/world/WorldDocument.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  const doc = createWorldDocument({
    metadata: { name: 'Particle Proof' },
    objects: [{
      id: 'smoke-1', name: 'smoke', type: 'primitive', assetRef: 'primitive-cube', primitive: 'cube',
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      exclusion: { grass: false, trees: false },
      particles: { kind: 'smoke', rate: 60, max: 150, lifetime: 1.5 },
    }],
  });
  new WorldSerializer().save(doc);
  const e = window.__WORLD_EDITOR__;
  e.open();
  await e._load();                       // load the saved world → preview indexes the emitter
  for (let i = 0; i < 20; i++) e.particlePreview.update(0.05);
  return e.particlePreview.debugSnapshot();
})()`;

const RUN_RUNTIME = `(() => {
  const r = window.__PARTICLE_RUNTIME__;
  for (let i = 0; i < 20; i++) r.update(0.05);
  return r.debugSnapshot();
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "particles-profile") },
  async () => {
    // 1) Editor: author, load, and preview — particles must spawn.
    const editor = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(editor.cdp, "editor");
      const preview = await evalValue(editor.cdp, AUTHOR_AND_PREVIEW);
      assert.equal(preview.emitters.length, 1, `editor preview emitters: ${JSON.stringify(preview)}`);
      assert.equal(preview.emitters[0].kind, "smoke");
      assert.ok(preview.totalAlive > 0, `editor preview should spawn particles: ${JSON.stringify(preview)}`);
      assert.ok(preview.emitters[0].alive <= 150, "alive within max");
    } finally {
      await editor.close();
    }

    // 2) Runtime: the saved emitter runs on boot.
    const rt = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(rt.cdp, "runtime");
      const snap = await evalValue(rt.cdp, RUN_RUNTIME);
      assert.equal(snap.emitters.length, 1, `runtime emitters: ${JSON.stringify(snap)}`);
      assert.equal(snap.emitters[0].kind, "smoke");
      assert.ok(snap.totalAlive > 0, `runtime should spawn particles: ${JSON.stringify(snap)}`);
      assert.ok(snap.emitters[0].alive <= 150, "alive within max");
      if (rt.consoleErrors.length) {
        throw new Error(`console errors during particles proof:\n${rt.consoleErrors.join("\n")}`);
      }
    } finally {
      await rt.close();
    }
  }
);

if (run.skipped) console.log("browser particles proof skipped (no browser)");
else console.log("browser particles proof passed");
