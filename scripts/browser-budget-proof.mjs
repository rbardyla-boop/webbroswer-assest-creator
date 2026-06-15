// Stage 20A browser proof: the live performance budget HUD.
//
// PART 1 (editor): the budget HUD overlay is present and visible while authoring,
// and the DEV-only __BUDGET__ hook is available.
//
// PART 2 (runtime): authors representative scenes, loads each, and reads __BUDGET__
// to confirm the budget status tells the real story:
//   - a connected generated world is green on draw calls + triangles,
//   - a vegetation-heavy scene surfaces triangle pressure (not green) while draw
//     calls stay green,
//   - a large generated city keeps draw calls + instanced batches green (instancing),
//   - an animation scene reports rig/update pressure separately from draw calls.
//
// No FPS / GPU claim is made (the harness renders with SwiftShader). Shared harness;
// skips cleanly when no Chromium is present.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";
import { PERFORMANCE_BUDGETS } from "../src/perf/PerformanceBudget.js";

const ROOT = process.cwd();
const PORT = 5222;
const CDP_PORT = 9356;
const BASE = `http://127.0.0.1:${PORT}`;
const SETTLE_MS = 2000; // let grass/object streaming settle so triangle counts are real

const SCENES = {
  connected: `(async () => {
    const { generateCityLayout } = await import('/src/generators/CityLayout.js');
    const { cityLayoutToWorldObjects } = await import('/src/generators/cityEmitter.js');
    const { generateCampLayout, campLayoutToWorldObjects } = await import('/src/generators/CampGenerator.js');
    const { generateForestLayout, forestLayoutToWorldObjects } = await import('/src/generators/ForestGenerator.js');
    const { generatePlazaLayout, plazaLayoutToWorldObjects } = await import('/src/generators/PlazaGenerator.js');
    const C = await import('/src/generators/GeneratorConfig.js');
    const { createWorldDocument } = await import('/src/world/WorldDocument.js');
    const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
    const objects = [
      ...cityLayoutToWorldObjects(generateCityLayout(C.createCityConfig({ seed:'c', blocks:3, density:0.7 })), 'gen-city'),
      ...campLayoutToWorldObjects(generateCampLayout(C.createCampConfig({ seed:'k', size:4, origin:{x:-70,z:0} })), 'gen-camp'),
      ...forestLayoutToWorldObjects(generateForestLayout(C.createForestConfig({ seed:'f', size:4, origin:{x:70,z:0} })), 'gen-forest'),
      ...plazaLayoutToWorldObjects(generatePlazaLayout(C.createPlazaConfig({ seed:'pz', size:3, origin:{x:0,z:60} })), 'gen-plaza'),
    ];
    new WorldSerializer().save(createWorldDocument({ metadata:{name:'Connected'}, grass:{density:6}, objects }));
    return { objects: objects.length };
  })()`,
  vegetation: `(async () => {
    const { createWorldDocument } = await import('/src/world/WorldDocument.js');
    const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
    new WorldSerializer().save(createWorldDocument({ metadata:{name:'Veg'}, grass:{enabled:true, density:8, visibleDistance:130, keepDistance:165}, trees:{enabled:true, density:0.035, visibleDistance:160}, bushes:{enabled:true, density:1.0}, objects:[] }));
    return { objects: 0 };
  })()`,
  largecity: `(async () => {
    const { generateCityLayout } = await import('/src/generators/CityLayout.js');
    const { cityLayoutToWorldObjects } = await import('/src/generators/cityEmitter.js');
    const { createCityConfig } = await import('/src/generators/GeneratorConfig.js');
    const { createWorldDocument } = await import('/src/world/WorldDocument.js');
    const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
    const objects = cityLayoutToWorldObjects(generateCityLayout(createCityConfig({ seed:'stress', style:'grid', blocks:8, density:1 })), 'gen-city');
    new WorldSerializer().save(createWorldDocument({ metadata:{name:'Large City'}, grass:{density:4}, objects }));
    return { objects: objects.length };
  })()`,
  animation: `(async () => {
    const { exportAnimatedFixtureGLB } = await import('/src/animation/fixtures/animatedFixture.js');
    const { AssetLibrary } = await import('/src/assets/AssetLibrary.js');
    const { AssetImporter } = await import('/src/assets/AssetImporter.js');
    const { createWorldDocument } = await import('/src/world/WorldDocument.js');
    const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
    const glb = await exportAnimatedFixtureGLB();
    const file = new File([new Blob([glb])], 'a.glb', { type:'model/gltf-binary' });
    const lib = await new AssetLibrary().init();
    const asset = await new AssetImporter(lib).importGLTF(file);
    const objects = [];
    for (let i=0;i<24;i++){ objects.push({ id:'rig-'+i, name:'Rig', type:'gltf', assetRef:asset.id, primitive:null, asset:null, transform:{ position:{x:(i%6)*4-10, y:0, z:Math.floor(i/6)*4-6}, rotation:{x:0,y:0,z:0}, scale:{x:1,y:1,z:1} }, collider:{type:'none'}, exclusion:{grass:true,trees:true} }); }
    new WorldSerializer().save(createWorldDocument({ metadata:{name:'Anim'}, grass:{density:3}, objects }));
    return { objects: objects.length };
  })()`,
};

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "budget-profile") },
  async () => {
    // Author a scene in an editor page, then read __BUDGET__ in a runtime page.
    const measure = async (authorJs) => {
      const author = await openPage(CDP_PORT, `${BASE}/`);
      try {
        await waitForReady(author.cdp, "editor", 45000);
        await evalValue(author.cdp, authorJs);
      } finally {
        await author.close();
      }
      const rt = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
      try {
        await waitForReady(rt.cdp, "runtime", 75000);
        await sleep(SETTLE_MS);
        const budget = await evalValue(rt.cdp, `window.__BUDGET__ ? window.__BUDGET__() : null`);
        if (!budget) throw new Error("__BUDGET__ hook missing in runtime");
        return { budget, consoleErrors: rt.consoleErrors.slice() };
      } finally {
        await rt.close();
      }
    };

    // --- PART 1: editor shows the HUD while authoring -----------------------
    const editor = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(editor.cdp, "editor", 45000);
      const hud = await evalValue(editor.cdp, `(() => {
        const el = document.getElementById('budget-hud');
        return { present: !!el, display: el ? getComputedStyle(el).display : null, hasHook: typeof window.__BUDGET__ === 'function' };
      })()`);
      assert.equal(hud.present, true, "budget HUD overlay present while authoring");
      assert.notEqual(hud.display, "none", "budget HUD visible by default while authoring");
      assert.equal(hud.hasHook, true, "__BUDGET__ hook available in DEV");
      if (editor.consoleErrors.length) throw new Error(`editor console errors:\n${editor.consoleErrors.join("\n")}`);
    } finally {
      await editor.close();
    }

    // --- PART 2: per-scene budget status ------------------------------------
    const connected = await measure(SCENES.connected);
    assert.equal(connected.budget.evaluated.drawCalls.status, "green", "connected world: draw calls green");
    assert.equal(connected.budget.evaluated.triangles.status, "green", "connected world: triangles green");
    if (connected.consoleErrors.length) throw new Error(`connected console errors:\n${connected.consoleErrors.join("\n")}`);

    const veg = await measure(SCENES.vegetation);
    assert.notEqual(veg.budget.evaluated.triangles.status, "green", "vegetation-heavy: triangle pressure surfaced (not green)");
    assert.ok(veg.budget.metrics.triangles > PERFORMANCE_BUDGETS.triangles.green, `vegetation triangles above the green budget (${veg.budget.metrics.triangles})`);
    assert.equal(veg.budget.evaluated.drawCalls.status, "green", "vegetation-heavy: draw calls still green");

    const city = await measure(SCENES.largecity);
    assert.equal(city.budget.evaluated.drawCalls.status, "green", "large city: flat draw calls green (instancing)");
    assert.equal(city.budget.evaluated.instancedBatches.status, "green", "large city: few instanced batches green");
    assert.ok(city.budget.metrics.generatedObjects >= 200, `large city: generated objects counted (${city.budget.metrics.generatedObjects})`);

    const anim = await measure(SCENES.animation);
    assert.ok(anim.budget.rigs >= 1, `animation: rig/update pressure reported separately (${anim.budget.rigs} rigs)`);
    assert.equal(anim.budget.evaluated.drawCalls.status, "green", "animation: draw calls green (rig cost is separate)");

    console.log(
      `  editor HUD visible; connected=${connected.budget.evaluated.overall}; ` +
        `veg tris=${Math.round(veg.budget.metrics.triangles / 1000)}k→${veg.budget.evaluated.triangles.status}; ` +
        `city ${city.budget.metrics.generatedObjects} objs→${city.budget.metrics.drawCalls} draws (${city.budget.evaluated.drawCalls.status}), batches ${city.budget.metrics.instancedBatches}; ` +
        `anim rigs=${anim.budget.rigs}`
    );
  }
);

if (run.skipped) console.log("browser budget proof skipped (no browser)");
else console.log("browser budget proof passed");
