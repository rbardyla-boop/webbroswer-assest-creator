// Stage 17C-2 browser proof: procedural rendering optimization + placement validation.
//
// PART 1 (editor): generated city stays INDIVIDUAL WorldObjects — no instancing in
// the editor, source meshes visible, objects selectable, and the Validate tool runs
// (identity is never sacrificed for draw-call reduction).
//
// PART 2 (runtime): the same city loads and is BATCHED into a few InstancedMeshes
// (draw calls << object count), source meshes hidden, while the WorldObjects remain
// in the manager (identity preserved) — all in real (SwiftShader) WebGL with zero
// console errors.
//
// Shared SwiftShader harness; skips cleanly when no Chromium is present.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5213;
const CDP_PORT = 9347;
const BASE = `http://127.0.0.1:${PORT}`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "instancing-profile") },
  async () => {
    // --- PART 1: editor keeps generated objects individual --------------------
    const editor = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(editor.cdp, "editor");
      const ed = await evalValue(editor.cdp, `(async () => {
        const ed = window.__WORLD_EDITOR__;
        ed.open();
        await ed._loadSample();
        const p = ed.proceduralPanel;
        p.seedInput.value = 'instcity'; p.styleSelect.value = 'grid'; p.blocksInput.value = '4'; p.densityInput.value = '0.8';
        await p.generate();
        const owned = ed.manager.objectsByGeneratorId('gen-city');
        // No instancing in the editor: no instanced group, source meshes visible.
        const hasInstancedGroup = ed.scene.children.some(c => c.name === 'InstancedWorldObjects' && c.children.length > 0);
        let visibleMeshes = 0;
        const bld = owned.find(o => o.name === 'Building');
        bld && bld.traverse(c => { if (c.isMesh && c.visible) visibleMeshes++; });
        // Selectable as an individual object.
        ed._select(bld);
        const selected = ed.selection.primary === bld;
        // Validate tool runs.
        const v = p.validate();
        const bldOverlaps = v.overlaps.filter(o => o.aName === 'Building' && o.bName === 'Building').length;
        return { count: owned.length, hasInstancedGroup, visibleMeshes, selected, validated: v.checked, bldOverlaps };
      })()`);
      assert.ok(ed.count > 0, `editor generated a city, got ${ed.count}`);
      assert.equal(ed.hasInstancedGroup, false, "editor does NOT instance (objects stay individual)");
      assert.ok(ed.visibleMeshes >= 1, "generated object's source mesh is visible in the editor");
      assert.equal(ed.selected, true, "generated object is individually selectable");
      assert.ok(ed.validated > 0, "Validate tool ran over the generated objects");
      assert.equal(ed.bldOverlaps, 0, "lot-separated buildings do not overlap");
      if (editor.consoleErrors.length) throw new Error(`editor console errors:\n${editor.consoleErrors.join("\n")}`);
      console.log(`  editor: ${ed.count} individual selectable objects, no instancing, validate ok (${ed.bldOverlaps} building overlaps)`);
    } finally {
      await editor.close();
    }

    // --- PART 2: runtime batches the city into instanced draws ----------------
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
          const cfg = createCityConfig({ seed: 'instrt', style: 'grid', blocks: 4, density: 0.85 });
          const objects = cityLayoutToWorldObjects(generateCityLayout(cfg), 'gen-city');
          new WorldSerializer().save(createWorldDocument({ metadata: { name: 'Inst RT' }, generators: { instances: [{ id: 'gen-city', type: 'city', config: cfg }] }, objects }));
          return objects.length;
        })()`);
      } finally {
        await page.close();
      }
    })();
    assert.ok(authored > 20, `authored a sizable city (${authored})`);

    const rt = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(rt.cdp, "runtime");
      const inst = await evalValue(rt.cdp, `window.__INSTANCING_DEBUG__()`);
      const world = await evalValue(rt.cdp, `window.__WORLD_DEBUG__()`);
      assert.ok(inst, "__INSTANCING_DEBUG__ present in runtime");
      assert.ok(inst.batches >= 1, `runtime built instanced batches, got ${inst.batches}`);
      assert.ok(inst.instances > 0, "instances created");
      assert.equal(inst.hiddenSources, inst.instances, "each instanced object's source mesh is hidden");
      assert.ok(inst.drawCalls < authored, `instancing cuts draw calls (${inst.drawCalls} batches << ${authored} objects)`);
      // Identity preserved: the WorldObjects are still in the manager.
      assert.ok(world.objects >= authored, `objects remain WorldObjects in the runtime (${world.objects})`);
      if (rt.consoleErrors.length) throw new Error(`runtime console errors:\n${rt.consoleErrors.join("\n")}`);
      console.log(`  runtime: ${authored} objects → ${inst.batches} instanced batches (${inst.instances} instances), identity preserved, no console errors`);
    } finally {
      await rt.close();
    }
  }
);

if (run.skipped) console.log("browser instancing proof skipped (no browser)");
else console.log("browser instancing proof passed");
