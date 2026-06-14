// Fixture-backed browser proof for the rigged-asset runtime (Stage 10B).
//
// Generates a tiny animated GLB in-page (no committed binary), imports it through
// the real Asset Library, authors a world with two animated instances, saves it,
// then loads RUNTIME mode and proves — via the debug-safe __ANIM_RUNTIME__ hook —
// that two independent mixers run and their animation time advances. Verifies no
// console errors and leaves no orphaned vite dev server.
//
// Skips cleanly (exit 0) when no Chromium is available, so it is CI-safe.

import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5310;
const CDP_PORT = 9350;
const PROFILE = `${ROOT}/tmp/anim-proof-profile`;
const BASE = `http://127.0.0.1:${PORT}`;

const run = await withBrowserProof({ root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: PROFILE }, async () => {
  // --- 1. Editor: import the generated fixture, author + save a world ---------
  const editor = await openPage(CDP_PORT, `${BASE}/`);
  try {
    await waitForReady(editor.cdp, "editor");
    const authored = await evalValue(editor.cdp, `(async () => {
      const { exportAnimatedFixtureGLB, FIXTURE_CLIP_NAMES } = await import('/src/animation/fixtures/animatedFixture.js');
      const { AssetLibrary } = await import('/src/assets/AssetLibrary.js');
      const { AssetImporter } = await import('/src/assets/AssetImporter.js');
      const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
      const { createWorldDocument } = await import('/src/world/WorldDocument.js');

      const glb = await exportAnimatedFixtureGLB();
      const file = new File([new Blob([glb])], 'anim-fixture.glb', { type: 'model/gltf-binary' });

      const lib = await new AssetLibrary().init();
      const asset = await new AssetImporter(lib).importGLTF(file);
      const manifestItem = lib.createManifest().items.find((i) => i.id === asset.id);

      const placed = (id, x) => ({ id, name: 'Rig', type: 'gltf', assetRef: asset.id, primitive: null, asset: null,
        transform: { position: { x, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        collider: { type: 'box', enabled: true }, exclusion: { grass: false, trees: false },
        animation: { clip: 'Slide', autoplay: true, loop: true } });
      const doc = createWorldDocument({
        metadata: { name: 'Animation Proof' },
        player: { spawn: { x: 0, y: 0, z: -20 }, cameraMode: 'third' },
        objects: [placed('obj-rig-a', 6), placed('obj-rig-b', 10)],
      });
      new WorldSerializer().save(doc);

      return {
        assetId: asset.id,
        clips: (asset.animation?.clips ?? []).map((c) => c.name),
        hasSkinned: !!asset.animation?.hasSkinnedMesh,
        manifestHasAnimation: !!(manifestItem?.animation?.clips?.length),
      };
    })()`);

    if (!authored.clips.includes("Slide")) throw new Error(`asset library missing 'Slide' clip: ${JSON.stringify(authored.clips)}`);
    if (!authored.manifestHasAnimation) throw new Error("asset manifest did not carry animation metadata");
    console.log(`  editor: imported fixture ${authored.assetId} — clips=${JSON.stringify(authored.clips)} skinned=${authored.hasSkinned}; world saved`);
    if (editor.consoleErrors.length) throw new Error(`editor console errors:\n${editor.consoleErrors.join("\n")}`);
  } finally {
    await editor.close();
  }

  // --- 2. Runtime: load the saved world and observe two independent mixers ----
  const runtime = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
  try {
    await waitForReady(runtime.cdp, "runtime");
    const snap1 = await evalValue(runtime.cdp, `window.__ANIM_RUNTIME__ ? window.__ANIM_RUNTIME__.debugSnapshot() : null`);
    if (!snap1) throw new Error("__ANIM_RUNTIME__ hook missing in runtime");
    if (snap1.count !== 2) throw new Error(`expected 2 independent mixers, got ${snap1.count}`);
    const ids = snap1.objects.map((o) => o.id).sort();
    if (ids.join(",") !== "obj-rig-a,obj-rig-b") throw new Error(`unexpected mixer object ids: ${ids}`);
    if (!snap1.objects.every((o) => o.clip === "Slide" && o.running)) throw new Error(`mixers not running the Slide clip: ${JSON.stringify(snap1.objects)}`);

    await sleep(400);
    const snap2 = await evalValue(runtime.cdp, `window.__ANIM_RUNTIME__.debugSnapshot()`);
    const advanced = snap1.objects.every((o1) => {
      const o2 = snap2.objects.find((o) => o.id === o1.id);
      return o2 && o2.time !== o1.time; // playback head moved (advanced or wrapped)
    });
    if (!advanced) throw new Error(`animation time did not advance: ${JSON.stringify(snap1.objects)} -> ${JSON.stringify(snap2.objects)}`);
    if (runtime.consoleErrors.length) throw new Error(`runtime console errors:\n${runtime.consoleErrors.join("\n")}`);
    console.log(`  runtime: 2 independent mixers playing 'Slide'; time advanced ${JSON.stringify(snap1.objects.map((o) => o.time))} -> ${JSON.stringify(snap2.objects.map((o) => o.time))}`);
  } finally {
    await runtime.close();
  }
});

if (run.skipped) {
  console.log("browser animation proof skipped (no browser)");
} else {
  console.log("browser animation proof passed");
}
