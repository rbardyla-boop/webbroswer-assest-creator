// Stage 17A browser proof: the Visibility + Streaming Kernel in the live runtime.
// Authors a world with two animated rigs — one NEAR the spawn, one FAR away — then
// loads runtime and proves, end to end, that the kernel:
//   - registers the animated objects as agents,
//   - sleeps the FAR rig's per-frame mixer update (its animation time stays frozen)
//     while the NEAR rig keeps animating,
//   - NEVER hides a mesh (the no-pop / shadow-safe invariant: every agent stays
//     object3D.visible === true),
//   - classifies tiers consistently, with zero console errors.
//
// Shared SwiftShader harness; skips cleanly when no Chromium is present.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5211;
const CDP_PORT = 9345;
const BASE = `http://127.0.0.1:${PORT}`;

const AUTHOR = `(async () => {
  const { exportAnimatedFixtureGLB } = await import('/src/animation/fixtures/animatedFixture.js');
  const { AssetLibrary } = await import('/src/assets/AssetLibrary.js');
  const { AssetImporter } = await import('/src/assets/AssetImporter.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  const { createWorldDocument } = await import('/src/world/WorldDocument.js');

  const glb = await exportAnimatedFixtureGLB();
  const file = new File([new Blob([glb])], 'anim-fixture.glb', { type: 'model/gltf-binary' });
  const lib = await new AssetLibrary().init();
  const asset = await new AssetImporter(lib).importGLTF(file);

  const placed = (id, z) => ({ id, name: 'Rig', type: 'gltf', assetRef: asset.id, primitive: null, asset: null,
    transform: { position: { x: 0, y: 0, z }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    collider: { type: 'box', enabled: true }, exclusion: { grass: false, trees: false },
    animation: { clip: 'Slide', autoplay: true, loop: true } });

  const doc = createWorldDocument({
    metadata: { name: 'Visibility Proof' },
    player: { spawn: { x: 0, y: 0, z: -20 }, cameraMode: 'third' },
    // 'near' sits beside the spawn (stays awake); 'far' is 800 units away (sleeps).
    objects: [placed('obj-near', -26), placed('obj-far', 800)],
  });
  new WorldSerializer().save(doc);
  return asset.id;
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "visibility-profile") },
  async () => {
    const editor = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(editor.cdp, "editor");
      const assetId = await evalValue(editor.cdp, AUTHOR);
      assert.ok(assetId, "authored an animated world");
    } finally {
      await editor.close();
    }

    const rt = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(rt.cdp, "runtime");
      await sleep(600); // let the near rig animate for several frames

      const vis = await evalValue(rt.cdp, `window.__VISIBILITY_DEBUG__()`);
      assert.ok(vis, "__VISIBILITY_DEBUG__ hook present in runtime");
      assert.equal(vis.enabled, true, "kernel enabled");

      const near = vis.agents.find((a) => a.id === "obj-near");
      const far = vis.agents.find((a) => a.id === "obj-far");
      assert.ok(near && far, "both authored rigs present in snapshot");

      // The kernel registers EVERY placed agent. This world authors two animated rigs; since FP-1 the
      // objective also auto-spawns the relic weapon in any runtime world, which the kernel registers as
      // a third agent. Assert the intended set explicitly (rather than a bare count) so the expected
      // total tracks real runtime state and a future change to what auto-registers trips this on purpose.
      const relic = vis.agents.find((a) => a.id === "relic-weapon-fp1");
      assert.ok(relic, "the FP-1 relic weapon is registered with the kernel (auto-spawned in runtime)");
      assert.equal(vis.total, 3, `2 authored rigs + 1 auto-spawned relic = 3 agents, got ${vis.total}`);
      assert.equal(vis.visible + vis.warm + vis.sleeping + vis.unloaded, vis.total, "tiers sum to total");
      assert.equal(near.awake, true, `near rig awake (tier ${near.tier})`);
      assert.equal(far.awake, false, `far rig asleep (tier ${far.tier})`);

      // The no-hide invariant in the LIVE runtime: nothing is ever hidden.
      assert.ok(vis.agents.every((a) => a.visible === true), "kernel never hides a mesh (shadow/pop-safe)");

      // End to end: the asleep far mixer is frozen; the awake near mixer advanced.
      const anim = await evalValue(rt.cdp, `window.__ANIM_RUNTIME__.debugSnapshot()`);
      const nearMixer = anim.objects.find((o) => o.id === "obj-near");
      const farMixer = anim.objects.find((o) => o.id === "obj-far");
      assert.ok(nearMixer && farMixer, "both mixers exist");
      assert.ok(nearMixer.time > 0.05, `near (awake) mixer advanced, t=${nearMixer.time}`);
      assert.ok(farMixer.time < 1e-4, `far (asleep) mixer is frozen, t=${farMixer.time}`);

      if (rt.consoleErrors.length) {
        throw new Error(`console errors during visibility proof:\n${rt.consoleErrors.join("\n")}`);
      }
      console.log(`  runtime: near=${near.tier}(t=${nearMixer.time.toFixed(2)}) far=${far.tier}(t=${farMixer.time.toFixed(2)}); no mesh hidden, no console errors`);
    } finally {
      await rt.close();
    }
  }
);

if (run.skipped) console.log("browser visibility proof skipped (no browser)");
else console.log("browser visibility proof passed");
