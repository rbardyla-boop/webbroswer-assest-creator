// Stage 17C browser proof: the Procedural Build System (city generator) end to end.
//
// PART 1 (editor): drive the Procedural panel — Generate emits NORMAL WorldObjects
// through the manager (tagged with the generator instance), the layout is
// deterministic for a fixed seed, streets are receive-only (no shadow cast), and
// Lock detaches the objects from the generator (they stay as permanent objects).
//
// PART 2 (runtime): author a city world, load it in real (SwiftShader) WebGL, and
// confirm the generated objects load + render with zero console errors — i.e. the
// emitted descriptors flow through the normal placement/lighting/material pipeline.
//
// Shared SwiftShader harness; skips cleanly when no Chromium is present.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5212;
const CDP_PORT = 9346;
const BASE = `http://127.0.0.1:${PORT}`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "procedural-profile") },
  async () => {
    // --- PART 1: editor workflow --------------------------------------------
    const editor = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(editor.cdp, "editor");

      const gen1 = await evalValue(editor.cdp, `(async () => {
        const ed = window.__WORLD_EDITOR__;
        if (!ed?.proceduralPanel) throw new Error("procedural panel missing");
        ed.open();
        await ed._loadSample();
        const p = ed.proceduralPanel;
        p.seedInput.value = 'proofcity'; p.styleSelect.value = 'town'; p.blocksInput.value = '3'; p.densityInput.value = '0.7';
        await p.generate();
        const owned = ed.manager.objectsByGeneratorId('gen-city');
        const bld = owned.find(o => o.name === 'Building');
        const street = owned.find(o => o.name === 'Street');
        let streetCast = null;
        street && street.traverse(c => { if (c.isMesh && streetCast === null) streetCast = c.castShadow; });
        return {
          count: owned.length,
          bx: bld ? +bld.position.x.toFixed(3) : null,
          bz: bld ? +bld.position.z.toFixed(3) : null,
          instances: ed.worldLoader.document.generators.instances.length,
          streetCast,
        };
      })()`);
      assert.ok(gen1.count > 0, `generate emitted objects, got ${gen1.count}`);
      assert.ok(gen1.instances >= 1, "generator instance recorded in the document");
      assert.equal(gen1.streetCast, false, "streets are receive-only (do not cast shadows)");

      // Deterministic: clear + regenerate the same seed → identical layout.
      const gen2 = await evalValue(editor.cdp, `(async () => {
        const ed = window.__WORLD_EDITOR__; const p = ed.proceduralPanel;
        p.clear();
        p.seedInput.value = 'proofcity'; p.styleSelect.value = 'town'; p.blocksInput.value = '3'; p.densityInput.value = '0.7';
        await p.generate();
        const owned = ed.manager.objectsByGeneratorId('gen-city');
        const bld = owned.find(o => o.name === 'Building');
        return { count: owned.length, bx: bld ? +bld.position.x.toFixed(3) : null, bz: bld ? +bld.position.z.toFixed(3) : null };
      })()`);
      assert.equal(gen2.count, gen1.count, "same seed → same object count");
      assert.equal(gen2.bx, gen1.bx, "same seed → same building x");
      assert.equal(gen2.bz, gen1.bz, "same seed → same building z");

      // Lock detaches the objects from the generator (they remain as objects).
      const locked = await evalValue(editor.cdp, `(() => {
        const ed = window.__WORLD_EDITOR__; const p = ed.proceduralPanel;
        const before = ed.manager.objectsByGeneratorId('gen-city').length;
        const total = ed.manager.objects.size;
        p.lock();
        return { before, ownedAfter: ed.manager.objectsByGeneratorId('gen-city').length, totalAfter: ed.manager.objects.size, total };
      })()`);
      assert.ok(locked.before > 0, "objects were owned before lock");
      assert.equal(locked.ownedAfter, 0, "lock detaches objects from the generator");
      assert.equal(locked.totalAfter, locked.total, "locked objects remain in the world");

      if (editor.consoleErrors.length) {
        throw new Error(`editor console errors:\n${editor.consoleErrors.join("\n")}`);
      }
      console.log(`  editor: generated ${gen1.count} objects (deterministic), streets receive-only, lock keeps ${locked.totalAfter} objects`);
    } finally {
      await editor.close();
    }

    // --- PART 2: runtime renders the generated city -------------------------
    const authored = await (async () => {
      const page = await openPage(CDP_PORT, `${BASE}/`);
      try {
        await waitForReady(page.cdp, "editor");
        return await evalValue(page.cdp, `(async () => {
          const { generateCityLayout } = await import('/src/generators/CityLayout.js');
          const { cityLayoutToWorldObjects } = await import('/src/generators/cityEmitter.js');
          const { createCityConfig } = await import('/src/generators/GeneratorConfig.js');
          const { createWorldDocument } = await import('/src/world/WorldDocument.js');
          const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
          const cfg = createCityConfig({ seed: 'rtcity', style: 'grid', blocks: 3, density: 0.8 });
          const layout = generateCityLayout(cfg);
          const objects = cityLayoutToWorldObjects(layout, 'gen-city');
          const doc = createWorldDocument({
            metadata: { name: 'City RT' },
            generators: { instances: [{ id: 'gen-city', type: 'city', config: cfg }] },
            objects,
          });
          new WorldSerializer().save(doc);
          return objects.length;
        })()`);
      } finally {
        await page.close();
      }
    })();
    assert.ok(authored > 0, "authored a non-empty city world");

    const rt = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(rt.cdp, "runtime");
      const world = await evalValue(rt.cdp, `window.__WORLD_DEBUG__()`);
      assert.ok(world.objects >= authored, `runtime loaded the generated objects (${world.objects} >= ${authored})`);
      if (rt.consoleErrors.length) {
        throw new Error(`runtime console errors:\n${rt.consoleErrors.join("\n")}`);
      }
      console.log(`  runtime: ${world.objects} generated objects rendered, no console errors`);
    } finally {
      await rt.close();
    }
  }
);

if (run.skipped) console.log("browser procedural proof skipped (no browser)");
else console.log("browser procedural proof passed");
