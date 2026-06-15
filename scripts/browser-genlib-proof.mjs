// Stage 18 browser proof: Generator Library v1 (camp / ruin / forest).
//
// PART 1 (editor): drive the Procedural panel across the new generator types. Each
// emits NORMAL WorldObjects through the manager, tagged with its own instance id;
// the camp emits DATA-ONLY gameplay objects (spawn / trigger / sign / pickup) that
// are selectable like any object; a camp and a ruin coexist independently; tents
// are prefab-backed (builtin hut) and a missing prefab falls back to a primitive;
// regenerate with the same seed is deterministic; Lock detaches a type's objects.
//
// PART 2 (runtime): author a camp world (scenery + interaction objects), load it in
// real (SwiftShader) WebGL, and confirm it renders + the interaction objects wire
// up with zero console errors.
//
// Shared SwiftShader harness; skips cleanly when no Chromium is present.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5216;
const CDP_PORT = 9350;
const BASE = `http://127.0.0.1:${PORT}`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "genlib-profile") },
  async () => {
    // --- PART 1: editor workflow across generator types ---------------------
    const editor = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(editor.cdp, "editor");

      // Camp: prefab-backed tents + data-only spawn/trigger/sign/pickup objects.
      const camp = await evalValue(editor.cdp, `(async () => {
        const ed = window.__WORLD_EDITOR__;
        if (!ed?.proceduralPanel) throw new Error("procedural panel missing");
        ed.open();
        await ed._loadSample();
        const p = ed.proceduralPanel;
        p.setType('camp');
        p.seedInput.value = 'proofcamp'; p.styleSelect.value = 'camp'; p.blocksInput.value = '5'; p.densityInput.value = '0.9';
        const dropdownHasHut = [...p.buildingPrefabSelect.options].some(o => o.value === 'builtin-hut');
        p.buildingPrefabSelect.value = 'builtin-hut';
        await p.generate();
        const owned = ed.manager.objectsByGeneratorId('gen-camp');
        const roles = owned.map(o => o.userData.interaction?.role).filter(Boolean);
        const hutParts = owned.filter(o => o.userData.prefabRef === 'builtin-hut');
        const hasParticles = owned.some(o => o.userData.particles?.kind === 'spark');
        const sign = owned.find(o => o.userData.interaction?.role === 'sign');
        ed._select(sign);
        return {
          count: owned.length, roles, hutParts: hutParts.length, hasParticles,
          dropdownHasHut, signSelected: ed.selection.primary === sign,
        };
      })()`);
      assert.equal(camp.dropdownHasHut, true, "builtin hut available as a Tents prefab");
      assert.ok(camp.count > 0, `camp generated objects, got ${camp.count}`);
      assert.ok(camp.hutParts > 0, "camp tents expand from the prefab");
      for (const role of ["spawn", "trigger", "sign", "pickup"]) {
        assert.ok(camp.roles.includes(role), `camp emits a ${role} interaction object`);
      }
      assert.equal(camp.hasParticles, true, "camp fire pit carries spark particles");
      assert.equal(camp.signSelected, true, "a generated interaction object is individually selectable");

      // Ruin coexists with the camp (independent instance ids).
      const ruin = await evalValue(editor.cdp, `(async () => {
        const ed = window.__WORLD_EDITOR__; const p = ed.proceduralPanel;
        p.setType('ruin');
        p.seedInput.value = 'proofruin'; p.styleSelect.value = 'temple'; p.blocksInput.value = '5'; p.densityInput.value = '0.7';
        await p.generate();
        return {
          ruin: ed.manager.objectsByGeneratorId('gen-ruin').length,
          campStill: ed.manager.objectsByGeneratorId('gen-camp').length,
        };
      })()`);
      assert.ok(ruin.ruin > 0, "ruin generated objects");
      assert.ok(ruin.campStill > 0, "camp objects coexist while a ruin is generated");

      // Forest: prefab-backed trees, deterministic, with primitive fallback.
      const forest = await evalValue(editor.cdp, `(async () => {
        const ed = window.__WORLD_EDITOR__; const p = ed.proceduralPanel;
        p.setType('forest');
        p.seedInput.value = 'proofwoods'; p.styleSelect.value = 'grove'; p.blocksInput.value = '5'; p.densityInput.value = '0.8';
        p.buildingPrefabSelect.value = 'builtin-tree-cluster'; // Trees slot for forest
        await p.generate();
        const a = ed.manager.objectsByGeneratorId('gen-forest').length;
        p.clear();
        p.buildingPrefabSelect.value = ''; // primitive trees
        await p.generate();
        const owned = ed.manager.objectsByGeneratorId('gen-forest');
        const primTrees = owned.some(o => o.name === 'Trunk');
        // determinism: clear + regenerate same seed → same primitive count.
        p.clear();
        await p.generate();
        const b = ed.manager.objectsByGeneratorId('gen-forest').length;
        return { prefabCount: a, primCount: owned.length, redo: b, primTrees };
      })()`);
      assert.ok(forest.prefabCount > 0 && forest.primCount > 0, "forest generated both prefab + primitive");
      assert.equal(forest.primTrees, true, "primitive trees fall back to trunk+canopy");
      assert.equal(forest.redo, forest.primCount, "same seed → deterministic forest");

      // Lock detaches just the active type's objects.
      const locked = await evalValue(editor.cdp, `(() => {
        const ed = window.__WORLD_EDITOR__; const p = ed.proceduralPanel;
        p.setType('camp');
        const before = ed.manager.objectsByGeneratorId('gen-camp').length;
        const total = ed.manager.objects.size;
        p.lock();
        return { before, after: ed.manager.objectsByGeneratorId('gen-camp').length, totalAfter: ed.manager.objects.size, total };
      })()`);
      assert.ok(locked.before > 0, "camp objects owned before lock");
      assert.equal(locked.after, 0, "lock detaches the camp objects from the generator");
      assert.equal(locked.totalAfter, locked.total, "locked objects remain in the world");

      if (editor.consoleErrors.length) throw new Error(`editor console errors:\n${editor.consoleErrors.join("\n")}`);
      console.log(`  editor: camp (${camp.count} objs, roles ${camp.roles.join("/")}), ruin (${ruin.ruin}), forest prefab/prim ${forest.prefabCount}/${forest.primCount}; lock keeps ${locked.totalAfter}`);
    } finally {
      await editor.close();
    }

    // --- PART 2: runtime renders + wires a camp world -----------------------
    const authored = await (async () => {
      const page = await openPage(CDP_PORT, `${BASE}/`);
      try {
        await waitForReady(page.cdp, "editor");
        return await evalValue(page.cdp, `(async () => {
          const { generateCampLayout, campLayoutToWorldObjects } = await import('/src/generators/CampGenerator.js');
          const { createCampConfig } = await import('/src/generators/GeneratorConfig.js');
          const { createBuiltinPrefabs } = await import('/src/prefabs/BuiltinKits.js');
          const { createWorldDocument } = await import('/src/world/WorldDocument.js');
          const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
          const hut = createBuiltinPrefabs().find(p => p.id === 'builtin-hut');
          const cfg = createCampConfig({ seed: 'rtcamp', style: 'camp', size: 4, density: 0.9, buildingPrefab: 'builtin-hut' });
          const objects = campLayoutToWorldObjects(generateCampLayout(cfg), 'gen-camp', { buildingPrefab: hut });
          new WorldSerializer().save(createWorldDocument({ metadata: { name: 'Camp RT' }, generators: { instances: [{ id: 'gen-camp', type: 'camp', config: cfg }] }, objects }));
          return { count: objects.length, interactions: objects.filter(o => o.interaction).length };
        })()`);
      } finally {
        await page.close();
      }
    })();
    assert.ok(authored.interactions > 0, "authored a camp with interaction objects");

    const rt = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(rt.cdp, "runtime");
      const world = await evalValue(rt.cdp, `window.__WORLD_DEBUG__()`);
      assert.ok(world.objects >= authored.count, `runtime loaded the camp objects (${world.objects} >= ${authored.count})`);
      if (rt.consoleErrors.length) throw new Error(`runtime console errors:\n${rt.consoleErrors.join("\n")}`);
      console.log(`  runtime: ${world.objects} objects (${authored.interactions} interaction objects) rendered + wired, no console errors`);
    } finally {
      await rt.close();
    }
  }
);

if (run.skipped) console.log("browser genlib proof skipped (no browser)");
else console.log("browser genlib proof passed");
