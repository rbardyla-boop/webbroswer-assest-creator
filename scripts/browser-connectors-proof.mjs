// Stage 18B browser proof: connective generators (road / plaza / connector).
//
// PART 1 (editor): place a camp and a ruin at DISTINCT origins (the new origin
// inputs), generate a plaza (with sign/spawn/trigger anchors) and a road, then drive
// the connector — whose From/To dropdowns list the generator instances — to link the
// camp and ruin. The connector path spans between the two clusters; everything
// coexists; lock detaches just the connector.
//
// PART 2 (runtime): author a connected world (camp + ruin + connector) and load it in
// real (SwiftShader) WebGL; it renders with zero console errors.
//
// Shared SwiftShader harness; skips cleanly when no Chromium is present.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5218;
const CDP_PORT = 9352;
const BASE = `http://127.0.0.1:${PORT}`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "connectors-profile") },
  async () => {
    // --- PART 1: editor — place clusters apart, then link them ---------------
    const editor = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(editor.cdp, "editor");

      const setup = await evalValue(editor.cdp, `(async () => {
        const ed = window.__WORLD_EDITOR__;
        if (!ed?.proceduralPanel) throw new Error("procedural panel missing");
        ed.open(); await ed._loadSample();
        const p = ed.proceduralPanel;
        const place = async (type, style, ox, oz) => {
          p.setType(type); p.seedInput.value = type + '-1'; p.styleSelect.value = style;
          p.blocksInput.value = '4'; p.densityInput.value = '0.8';
          p.originXInput.value = String(ox); p.originZInput.value = String(oz);
          await p.generate();
        };
        await place('camp', 'camp', -20, 0);
        await place('ruin', 'temple', 40, 0);
        await place('plaza', 'square', 0, -30);
        await place('road', 'avenue', 0, 30);
        const plazaRoles = ed.manager.objectsByGeneratorId('gen-plaza').map(o => o.userData.interaction?.role).filter(Boolean);

        // Connector: its From/To slots list the placed cluster instances.
        p.setType('connector');
        const anchorOpts = [...p.buildingPrefabSelect.options].map(o => o.value);
        const hasAnchors = anchorOpts.includes('gen-camp') && anchorOpts.includes('gen-ruin');
        p.seedInput.value = 'cn'; p.styleSelect.value = 'straight'; p.blocksInput.value = '5';
        p.buildingPrefabSelect.value = 'gen-camp'; p.propPrefabSelect.value = 'gen-ruin';
        await p.generate();
        const conn = ed.manager.objectsByGeneratorId('gen-connector');
        const xs = conn.filter(o => o.name === 'Path').map(o => o.position.x);
        return {
          camp: ed.manager.objectsByGeneratorId('gen-camp').length,
          ruin: ed.manager.objectsByGeneratorId('gen-ruin').length,
          road: ed.manager.objectsByGeneratorId('gen-road').length,
          plazaRoles, hasAnchors,
          connCount: conn.length,
          pathCount: xs.length,
          midX: xs.length ? xs[0] : null,
        };
      })()`);
      assert.ok(setup.camp > 0 && setup.ruin > 0 && setup.road > 0, "camp/ruin/road all generated");
      for (const role of ["spawn", "sign", "trigger"]) {
        assert.ok(setup.plazaRoles.includes(role), `plaza includes a ${role} anchor`);
      }
      assert.equal(setup.hasAnchors, true, "connector From/To dropdowns list the cluster instances");
      assert.ok(setup.connCount > 0 && setup.pathCount >= 1, "connector emitted a path");
      assert.ok(setup.midX > -20 && setup.midX < 40, "connector path runs between the two clusters");

      const locked = await evalValue(editor.cdp, `(() => {
        const ed = window.__WORLD_EDITOR__; const p = ed.proceduralPanel;
        p.setType('connector');
        const before = ed.manager.objectsByGeneratorId('gen-connector').length;
        const total = ed.manager.objects.size;
        p.lock();
        return { before, after: ed.manager.objectsByGeneratorId('gen-connector').length, total, totalAfter: ed.manager.objects.size };
      })()`);
      assert.ok(locked.before > 0, "connector objects owned before lock");
      assert.equal(locked.after, 0, "lock detaches the connector objects");
      assert.equal(locked.totalAfter, locked.total, "locked objects remain in the world");

      if (editor.consoleErrors.length) throw new Error(`editor console errors:\n${editor.consoleErrors.join("\n")}`);
      console.log(`  editor: camp(${setup.camp})+ruin(${setup.ruin})+plaza[${setup.plazaRoles.join("/")}]+road(${setup.road}); connector ${setup.connCount} objs linking clusters (midX ${setup.midX})`);
    } finally {
      await editor.close();
    }

    // --- PART 2: runtime renders a connected world --------------------------
    const authored = await (async () => {
      const page = await openPage(CDP_PORT, `${BASE}/`);
      try {
        await waitForReady(page.cdp, "editor");
        return await evalValue(page.cdp, `(async () => {
          const { generateCampLayout, campLayoutToWorldObjects } = await import('/src/generators/CampGenerator.js');
          const { generateRuinLayout, ruinLayoutToWorldObjects } = await import('/src/generators/RuinGenerator.js');
          const { generateConnectorLayout, connectorLayoutToWorldObjects } = await import('/src/generators/ConnectorGenerator.js');
          const { createCampConfig, createRuinConfig, createConnectorConfig } = await import('/src/generators/GeneratorConfig.js');
          const { createWorldDocument } = await import('/src/world/WorldDocument.js');
          const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
          const campCfg = createCampConfig({ seed: 'rtc', size: 3, origin: { x: -20, z: 0 } });
          const ruinCfg = createRuinConfig({ seed: 'rtr', size: 3, origin: { x: 40, z: 0 } });
          const connCfg = createConnectorConfig({ seed: 'rtn', style: 'stepped', from: { x: -20, z: 0 }, to: { x: 40, z: 0 }, fromId: 'gen-camp', toId: 'gen-ruin' });
          const objects = [
            ...campLayoutToWorldObjects(generateCampLayout(campCfg), 'gen-camp'),
            ...ruinLayoutToWorldObjects(generateRuinLayout(ruinCfg), 'gen-ruin'),
            ...connectorLayoutToWorldObjects(generateConnectorLayout(connCfg), 'gen-connector'),
          ];
          new WorldSerializer().save(createWorldDocument({
            metadata: { name: 'Connected RT' },
            generators: { instances: [
              { id: 'gen-camp', type: 'camp', config: campCfg },
              { id: 'gen-ruin', type: 'ruin', config: ruinCfg },
              { id: 'gen-connector', type: 'connector', config: connCfg },
            ] },
            objects,
          }));
          return { count: objects.length, paths: objects.filter(o => o.name === 'Path').length };
        })()`);
      } finally {
        await page.close();
      }
    })();
    assert.ok(authored.paths > 0, "authored a connected world with a connector path");

    const rt = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(rt.cdp, "runtime");
      const world = await evalValue(rt.cdp, `window.__WORLD_DEBUG__()`);
      assert.ok(world.objects >= authored.count, `runtime loaded the connected world (${world.objects} >= ${authored.count})`);
      if (rt.consoleErrors.length) throw new Error(`runtime console errors:\n${rt.consoleErrors.join("\n")}`);
      console.log(`  runtime: ${world.objects} objects (${authored.paths} connector path segments) rendered, no console errors`);
    } finally {
      await rt.close();
    }
  }
);

if (run.skipped) console.log("browser connectors proof skipped (no browser)");
else console.log("browser connectors proof passed");
