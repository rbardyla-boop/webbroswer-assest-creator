// Stage 19 browser proof: asset/prefab generator integration.
//
// PART 1 (editor): the city generator places PREFAB-backed buildings (the builtin
// "hut"). The expanded objects are normal individual WorldObjects carrying prefabRef
// — selectable, lockable, regenerable — and a missing prefab safely falls back to a
// primitive.
//
// PART 2 (runtime): a prefab-backed city loads and renders in real (SwiftShader)
// WebGL with zero console errors; the generated prefab objects are present.
//
// Shared SwiftShader harness; skips cleanly when no Chromium is present.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5214;
const CDP_PORT = 9348;
const BASE = `http://127.0.0.1:${PORT}`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "prefab-gen-profile") },
  async () => {
    // --- PART 1: editor prefab-backed generation ----------------------------
    const editor = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(editor.cdp, "editor");

      const gen = await evalValue(editor.cdp, `(async () => {
        const ed = window.__WORLD_EDITOR__;
        ed.open();
        await ed._loadSample();
        const p = ed.proceduralPanel;
        p.seedInput.value = 'prefabcity'; p.styleSelect.value = 'town'; p.blocksInput.value = '3'; p.densityInput.value = '0.8';
        const dropdownHasHut = [...p.buildingPrefabSelect.options].some(o => o.value === 'builtin-hut');
        p.buildingPrefabSelect.value = 'builtin-hut';
        await p.generate();
        const owned = ed.manager.objectsByGeneratorId('gen-city');
        const hutParts = owned.filter(o => o.userData.prefabRef === 'builtin-hut');
        ed._select(hutParts[0]);
        const selected = ed.selection.primary === hutParts[0];
        return { count: owned.length, hutParts: hutParts.length, selected, dropdownHasHut };
      })()`);
      assert.equal(gen.dropdownHasHut, true, "builtin hut appears in the Buildings dropdown");
      assert.ok(gen.hutParts > 0, `generated prefab-backed buildings (hut parts), got ${gen.hutParts}`);
      assert.equal(gen.selected, true, "a prefab-expanded object is individually selectable");

      const locked = await evalValue(editor.cdp, `(() => {
        const ed = window.__WORLD_EDITOR__;
        const before = ed.manager.objectsByGeneratorId('gen-city').length;
        const total = ed.manager.objects.size;
        ed.proceduralPanel.lock();
        return { before, ownedAfter: ed.manager.objectsByGeneratorId('gen-city').length, totalAfter: ed.manager.objects.size, total };
      })()`);
      assert.ok(locked.before > 0, "prefab objects were owned before lock");
      assert.equal(locked.ownedAfter, 0, "lock detaches the prefab instances");
      assert.equal(locked.totalAfter, locked.total, "locked prefab objects remain in the world");

      // Missing prefab → safe primitive fallback.
      const fallback = await evalValue(editor.cdp, `(async () => {
        const ed = window.__WORLD_EDITOR__; const p = ed.proceduralPanel;
        p.clear();
        const opt = document.createElement('option'); opt.value = 'no-such-prefab'; opt.textContent = 'Missing'; p.buildingPrefabSelect.appendChild(opt);
        p.buildingPrefabSelect.value = 'no-such-prefab';
        await p.generate();
        const owned = ed.manager.objectsByGeneratorId('gen-city');
        return { primitiveBuildings: owned.filter(o => o.name === 'Building' && o.userData.asset?.type === 'primitive').length, anyPrefab: owned.some(o => o.userData.prefabRef) };
      })()`);
      assert.ok(fallback.primitiveBuildings > 0, "missing prefab falls back to primitive buildings");
      assert.equal(fallback.anyPrefab, false, "fallback produces no prefab-backed objects");

      if (editor.consoleErrors.length) throw new Error(`editor console errors:\n${editor.consoleErrors.join("\n")}`);
      console.log(`  editor: ${gen.hutParts} prefab-backed objects (selectable, lockable); missing prefab → ${fallback.primitiveBuildings} primitive buildings`);
    } finally {
      await editor.close();
    }

    // --- PART 2: runtime renders a prefab-backed city -----------------------
    const authored = await (async () => {
      const page = await openPage(CDP_PORT, `${BASE}/`);
      try {
        await waitForReady(page.cdp, "editor");
        return await evalValue(page.cdp, `(async () => {
          const { generateCityLayout } = await import('/src/generators/CityLayout.js');
          const { cityLayoutToWorldObjects } = await import('/src/generators/cityEmitter.js');
          const { createCityConfig } = await import('/src/generators/GeneratorConfig.js');
          const { createBuiltinPrefabs } = await import('/src/prefabs/BuiltinKits.js');
          const { createWorldDocument } = await import('/src/world/WorldDocument.js');
          const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
          const hut = createBuiltinPrefabs().find(p => p.id === 'builtin-hut');
          const cfg = createCityConfig({ seed: 'prefabrt', style: 'town', blocks: 3, density: 0.8, buildingPrefab: 'builtin-hut' });
          const objects = cityLayoutToWorldObjects(generateCityLayout(cfg), 'gen-city', { buildingPrefab: hut });
          new WorldSerializer().save(createWorldDocument({ metadata: { name: 'Prefab RT' }, generators: { instances: [{ id: 'gen-city', type: 'city', config: cfg }] }, objects }));
          return { count: objects.length, hutParts: objects.filter(o => o.prefabRef === 'builtin-hut').length };
        })()`);
      } finally {
        await page.close();
      }
    })();
    assert.ok(authored.hutParts > 0, "authored a prefab-backed city");

    const rt = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(rt.cdp, "runtime");
      const world = await evalValue(rt.cdp, `window.__WORLD_DEBUG__()`);
      assert.ok(world.objects >= authored.count, `runtime loaded the prefab-backed objects (${world.objects} >= ${authored.count})`);
      if (rt.consoleErrors.length) throw new Error(`runtime console errors:\n${rt.consoleErrors.join("\n")}`);
      console.log(`  runtime: ${world.objects} objects (${authored.hutParts} prefab parts) rendered, no console errors`);
    } finally {
      await rt.close();
    }
  }
);

if (run.skipped) console.log("browser prefab-gen proof skipped (no browser)");
else console.log("browser prefab-gen proof passed");
