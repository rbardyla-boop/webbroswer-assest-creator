// Stage 18C browser proof: a generated settlement is readable at runtime.
//
// PART 1 (editor): the DEV-only __LAYOUT_DEBUG__ hook is available while authoring.
//
// PART 2 (runtime): authors a connected village (camp + plaza + city, linked by a
// connector) with the player spawned at the camp entrance, loads it, and reads
// __LAYOUT_DEBUG__ to confirm the settlement reads as a place, not scatter:
//   - at least one landmark exists, and the nearest one is close to the spawn
//     (a readability proxy — you arrive facing a focal point),
//   - paths + buildings + interactive markers (spawn/sign/trigger) are present,
//   - instancing is active (static primitives batched into few draws),
//   - no console errors.
//
// No FPS/GPU claim (SwiftShader). Shared harness; skips cleanly with no Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5220;
const CDP_PORT = 9354;
const BASE = `http://127.0.0.1:${PORT}`;
const SETTLE_MS = 2000; // let object streaming + instancing settle

const VILLAGE = `(async () => {
  const C = await import('/src/generators/GeneratorConfig.js');
  const { generateGeneratorObjects } = await import('/src/generators/GeneratorRegistry.js');
  const { generateCampLayout } = await import('/src/generators/CampGenerator.js');
  const { createWorldDocument } = await import('/src/world/WorldDocument.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  const instances = [
    { id: 'gen-camp',  type: 'camp',      config: C.createCampConfig({ seed: 'pv-camp', size: 4, origin: { x: -160, z: 0 } }) },
    { id: 'gen-plaza', type: 'plaza',     config: C.createPlazaConfig({ seed: 'pv-plaza', size: 4, origin: { x: -40, z: 0 } }) },
    { id: 'gen-city',  type: 'city',      config: C.createCityConfig({ seed: 'pv-city', style: 'town', blocks: 4, density: 0.7, origin: { x: 120, z: 0 } }) },
    { id: 'gen-conn',  type: 'connector', config: C.createConnectorConfig({ seed: 'pv-conn', style: 'straight', from: { x: -142, z: 0 }, to: { x: -56, z: 0 }, fromId: 'gen-camp', toId: 'gen-plaza' }) },
  ];
  const objects = instances.flatMap((i) => generateGeneratorObjects(i.type, i.config, i.id).objects);
  // Spawn at the camp's entrance, facing the fire pit.
  const camp = generateCampLayout(instances[0].config);
  const spawn = { x: camp.spawn.x, y: 2, z: camp.spawn.z };
  new WorldSerializer().save(createWorldDocument({ metadata: { name: 'Proof Village' }, grass: { density: 4 }, generators: { instances }, objects, player: { spawn } }));
  return { objects: objects.length };
})()`;

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "settlement-profile") },
  async () => {
    // --- PART 1: editor exposes the hook while authoring ---------------------
    const editor = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(editor.cdp, "editor", 45000);
      const hasHook = await evalValue(editor.cdp, `typeof window.__LAYOUT_DEBUG__ === 'function'`);
      assert.equal(hasHook, true, "__LAYOUT_DEBUG__ hook available in DEV editor");
      await evalValue(editor.cdp, VILLAGE);
      if (editor.consoleErrors.length) throw new Error(`editor console errors:\n${editor.consoleErrors.join("\n")}`);
    } finally {
      await editor.close();
    }

    // --- PART 2: runtime layout snapshot -------------------------------------
    const rt = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    let layout;
    try {
      await waitForReady(rt.cdp, "runtime", 75000);
      await sleep(SETTLE_MS);
      layout = await evalValue(rt.cdp, `window.__LAYOUT_DEBUG__ ? window.__LAYOUT_DEBUG__() : null`);
      if (!layout) throw new Error("__LAYOUT_DEBUG__ hook missing in runtime");
      if (rt.consoleErrors.length) throw new Error(`runtime console errors:\n${rt.consoleErrors.join("\n")}`);
    } finally {
      await rt.close();
    }

    // A landmark exists and the nearest is close to the spawn (readability proxy).
    assert.ok(layout.landmarks.length >= 1, `at least one landmark (${layout.landmarks.length})`);
    const nearest = layout.landmarks.reduce((best, lm) => {
      const d = dist(lm.position, layout.spawn);
      return d < best.d ? { d, lm } : best;
    }, { d: Infinity, lm: null });
    assert.ok(nearest.d <= 60, `nearest landmark within sight of spawn (${nearest.d.toFixed(0)}u)`);

    // Structure: paths, buildings, and interactive markers are all present.
    assert.ok(layout.counts.path > 0, `paths present (${layout.counts.path})`);
    assert.ok(layout.counts.building > 0, `buildings present (${layout.counts.building})`);
    assert.ok(layout.markers.spawn >= 1, `spawn marker present (${layout.markers.spawn})`);
    assert.ok(layout.markers.sign >= 1, `sign marker present (${layout.markers.sign})`);
    assert.ok(layout.markers.trigger >= 1, `trigger marker present (${layout.markers.trigger})`);

    // Instancing is active in the runtime view (static primitives batched).
    assert.ok(layout.instancedBatches >= 1, `instancing active (${layout.instancedBatches} batches)`);

    console.log(
      `  editor hook ok; runtime: ${layout.landmarks.length} landmarks (nearest ${nearest.d.toFixed(0)}u), ` +
        `path=${layout.counts.path} building=${layout.counts.building} ` +
        `markers spawn/sign/trigger=${layout.markers.spawn}/${layout.markers.sign}/${layout.markers.trigger}, ` +
        `batches=${layout.instancedBatches}`
    );
  }
);

if (run.skipped) console.log("browser settlement-layout proof skipped (no browser)");
else console.log("browser settlement-layout proof passed");
