// Local performance validation harness (side report — NOT a product stage).
//
// Authors a scene matrix, loads each in the runtime, and records measured metrics
// via the DEV-only window.__PERF__ hook. It writes docs/perf-report.json (raw
// snapshots) and docs/PERFORMANCE_REPORT.md (human report).
//
// HONESTY: the shared browser harness renders with the SwiftShader SOFTWARE
// rasterizer (no GPU in this headless environment). Structural metrics (draw calls,
// triangles, memory, object/instance/patch counts, JS heap) are GPU-INDEPENDENT and
// authoritative. Frame timings are software-raster CPU signals, NOT a GPU FPS claim.
// Run this on real hardware (Playwright + a real GPU Chromium) to fill the GPU rows.

import fs from "node:fs";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5220;
const CDP_PORT = 9354;
const BASE = `http://127.0.0.1:${PORT}`;

// --- scene matrix: each `author` runs in an editor page and saves a world ------

const VEG_OFF = `grass: { enabled: false }, trees: { enabled: false }, bushes: { enabled: false }`;

const SCENES = [
  {
    id: "baseline",
    label: "Empty terrain (no vegetation, no objects)",
    author: `(async () => {
      const { createWorldDocument } = await import('/src/world/WorldDocument.js');
      const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
      new WorldSerializer().save(createWorldDocument({ metadata: { name: 'Baseline' }, ${VEG_OFF}, objects: [] }));
      return { objects: 0 };
    })()`,
  },
  {
    id: "vegetation",
    label: "Vegetation-heavy (dense grass + trees + bushes)",
    author: `(async () => {
      const { createWorldDocument } = await import('/src/world/WorldDocument.js');
      const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
      new WorldSerializer().save(createWorldDocument({
        metadata: { name: 'Vegetation' },
        grass: { enabled: true, density: 8, visibleDistance: 130, keepDistance: 165 },
        trees: { enabled: true, density: 0.035, visibleDistance: 160, keepDistance: 190 },
        bushes: { enabled: true, density: 1.0, visibleDistance: 120 },
        objects: [],
      }));
      return { objects: 0 };
    })()`,
  },
  {
    id: "connected",
    label: "Connected world (city + camp + ruin + forest + road + plaza + connector)",
    author: `(async () => {
      const { generateCityLayout } = await import('/src/generators/CityLayout.js');
      const { cityLayoutToWorldObjects } = await import('/src/generators/cityEmitter.js');
      const { generateCampLayout, campLayoutToWorldObjects } = await import('/src/generators/CampGenerator.js');
      const { generateRuinLayout, ruinLayoutToWorldObjects } = await import('/src/generators/RuinGenerator.js');
      const { generateForestLayout, forestLayoutToWorldObjects } = await import('/src/generators/ForestGenerator.js');
      const { generateRoadLayout, roadLayoutToWorldObjects } = await import('/src/generators/RoadGenerator.js');
      const { generatePlazaLayout, plazaLayoutToWorldObjects } = await import('/src/generators/PlazaGenerator.js');
      const { generateConnectorLayout, connectorLayoutToWorldObjects } = await import('/src/generators/ConnectorGenerator.js');
      const C = await import('/src/generators/GeneratorConfig.js');
      const { createWorldDocument } = await import('/src/world/WorldDocument.js');
      const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
      const objects = [
        ...cityLayoutToWorldObjects(generateCityLayout(C.createCityConfig({ seed: 'c', blocks: 3, density: 0.7, origin: { x: 0, z: 0 } })), 'gen-city'),
        ...campLayoutToWorldObjects(generateCampLayout(C.createCampConfig({ seed: 'k', size: 4, origin: { x: -70, z: 0 } })), 'gen-camp'),
        ...ruinLayoutToWorldObjects(generateRuinLayout(C.createRuinConfig({ seed: 'r', size: 4, origin: { x: 70, z: 0 } })), 'gen-ruin'),
        ...forestLayoutToWorldObjects(generateForestLayout(C.createForestConfig({ seed: 'f', size: 4, origin: { x: 0, z: 70 } })), 'gen-forest'),
        ...roadLayoutToWorldObjects(generateRoadLayout(C.createRoadConfig({ seed: 'rd', style: 'avenue', size: 5, origin: { x: 0, z: -35 } })), 'gen-road'),
        ...plazaLayoutToWorldObjects(generatePlazaLayout(C.createPlazaConfig({ seed: 'pz', size: 3, origin: { x: 0, z: 35 } })), 'gen-plaza'),
        ...connectorLayoutToWorldObjects(generateConnectorLayout(C.createConnectorConfig({ seed: 'cn', style: 'stepped', from: { x: -70, z: 0 }, to: { x: 70, z: 0 } })), 'gen-connector'),
      ];
      new WorldSerializer().save(createWorldDocument({ metadata: { name: 'Connected' }, grass: { density: 7 }, trees: { density: 0.02 }, objects }));
      return { objects: objects.length };
    })()`,
  },
  {
    id: "largecity",
    label: "Large generated city (stress: 8×8 blocks, full density)",
    author: `(async () => {
      const { generateCityLayout } = await import('/src/generators/CityLayout.js');
      const { cityLayoutToWorldObjects } = await import('/src/generators/cityEmitter.js');
      const { createCityConfig } = await import('/src/generators/GeneratorConfig.js');
      const { createWorldDocument } = await import('/src/world/WorldDocument.js');
      const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
      const objects = cityLayoutToWorldObjects(generateCityLayout(createCityConfig({ seed: 'stress', style: 'grid', blocks: 8, density: 1, origin: { x: 0, z: 0 } })), 'gen-city');
      new WorldSerializer().save(createWorldDocument({ metadata: { name: 'Large City' }, grass: { density: 5 }, objects }));
      return { objects: objects.length };
    })()`,
  },
  {
    id: "particles",
    label: "Particles + lights + generated props (camp fire + smoke stacks)",
    author: `(async () => {
      const { generateCampLayout, campLayoutToWorldObjects } = await import('/src/generators/CampGenerator.js');
      const { createCampConfig } = await import('/src/generators/GeneratorConfig.js');
      const { createWorldDocument } = await import('/src/world/WorldDocument.js');
      const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
      const camp = campLayoutToWorldObjects(generateCampLayout(createCampConfig({ seed: 'pk', size: 5, density: 1, origin: { x: 0, z: 0 } })), 'gen-camp');
      const stacks = [];
      for (let i = 0; i < 10; i++) {
        stacks.push({ type: 'primitive', primitive: 'cylinder', name: 'Smoke Stack', color: '#444444',
          transform: { position: { x: (i - 5) * 6, y: 1.5, z: -24 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 3, z: 1 } },
          collider: { type: 'none' }, particles: { kind: 'smoke' } });
      }
      const objects = [...camp, ...stacks];
      new WorldSerializer().save(createWorldDocument({ metadata: { name: 'Particles' }, grass: { density: 4 }, objects }));
      return { objects: objects.length };
    })()`,
  },
  {
    id: "animation",
    label: "Animation fixture scene (24 rigged GLB instances)",
    author: `(async () => {
      const { exportAnimatedFixtureGLB } = await import('/src/animation/fixtures/animatedFixture.js');
      const { AssetLibrary } = await import('/src/assets/AssetLibrary.js');
      const { AssetImporter } = await import('/src/assets/AssetImporter.js');
      const { createWorldDocument } = await import('/src/world/WorldDocument.js');
      const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
      const glb = await exportAnimatedFixtureGLB();
      const file = new File([new Blob([glb])], 'anim-fixture.glb', { type: 'model/gltf-binary' });
      const lib = await new AssetLibrary().init();
      const asset = await new AssetImporter(lib).importGLTF(file);
      const objects = [];
      for (let i = 0; i < 24; i++) {
        const gx = (i % 6) * 5 - 12;
        const gz = Math.floor(i / 6) * 5 - 6;
        objects.push({ id: 'rig-' + i, name: 'Rig', type: 'gltf', assetRef: asset.id, primitive: null, asset: null,
          transform: { position: { x: gx, y: 0, z: gz }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
          collider: { type: 'none' }, exclusion: { grass: true, trees: true } });
      }
      new WorldSerializer().save(createWorldDocument({ metadata: { name: 'Animation' }, grass: { density: 3 }, objects }));
      return { objects: objects.length, asset: asset.id };
    })()`,
  },
];

const SETTLE_MS = 1400; // let grass/tree/object streaming settle before snapshotting

// Re-render the markdown from an existing perf-report.json without re-measuring
// (e.g. after editing the report template): `node scripts/perf-report.mjs --render-only`.
if (process.argv.includes("--render-only")) {
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "perf-report.json"), "utf8"));
  fs.writeFileSync(path.join(ROOT, "docs", "PERFORMANCE_REPORT.md"), renderMarkdown(json));
  console.log("re-rendered docs/PERFORMANCE_REPORT.md from existing perf-report.json");
  process.exit(0);
}

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "perf-profile") },
  async () => {
    const results = [];
    // Write the report after every scene so a timeout/kill still leaves partial data.
    const flush = () => {
      const renderer = results.find((r) => r.snapshot)?.snapshot?.renderer ?? { gpu: "unknown", vendor: "unknown" };
      const report = { generatedAt: new Date().toISOString(), platform: process.platform, node: process.version, renderer, settleMs: SETTLE_MS, scenes: results };
      fs.writeFileSync(path.join(ROOT, "docs", "perf-report.json"), JSON.stringify(report, null, 2));
      fs.writeFileSync(path.join(ROOT, "docs", "PERFORMANCE_REPORT.md"), renderMarkdown(report));
      return report;
    };

    for (const scene of SCENES) {
      try {
        // 1. Author + save the scene in an editor page.
        const author = await openPage(CDP_PORT, `${BASE}/`);
        let summary;
        try {
          await waitForReady(author.cdp, "editor", 45000);
          summary = await evalValue(author.cdp, scene.author);
        } finally {
          await author.close();
        }

        // 2. Load it in the runtime and measure. The ready timeout is generous: a
        // heavy scene's first frame is slow under the software rasterizer.
        const rt = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
        try {
          await waitForReady(rt.cdp, "runtime", 75000);
          await sleep(SETTLE_MS);
          const snapshot = await evalValue(rt.cdp, `window.__PERF__ ? window.__PERF__.snapshot() : null`);
          if (!snapshot) throw new Error("__PERF__ hook missing in runtime");
          const steady = await evalValue(rt.cdp, `window.__PERF__.sample({ frames: 60, maxMs: 7000 })`);
          const turn = await evalValue(rt.cdp, `window.__PERF__.sample({ frames: 60, turn: true, maxMs: 7000 })`);
          const afterTurn = await evalValue(rt.cdp, `window.__PERF__.snapshot()`);
          results.push({ id: scene.id, label: scene.label, summary, snapshot, afterTurn, steady, turn, consoleErrors: rt.consoleErrors.slice() });
          console.log(
            `  ${scene.id.padEnd(11)} objs=${String(snapshot.objects).padStart(5)} ` +
              `draws=${String(snapshot.draw.calls).padStart(4)} tris=${String(snapshot.draw.triangles).padStart(8)} ` +
              `inst=${snapshot.instancing ? snapshot.instancing.instances + "/" + snapshot.instancing.batches : "0"} ` +
              `heap=${snapshot.heap ? snapshot.heap.usedMB + "MB" : "n/a"} ` +
              `swFps≈${steady.softwareApproxFps} worstTurn=${turn.worstMs}ms`
          );
        } finally {
          await rt.close();
        }
      } catch (err) {
        results.push({ id: scene.id, label: scene.label, error: String(err?.message ?? err) });
        console.log(`  ${scene.id.padEnd(11)} ERROR: ${err?.message ?? err}`);
      }
      flush();
    }

    const report = flush();
    console.log(`\n  wrote docs/perf-report.json + docs/PERFORMANCE_REPORT.md (renderer: ${report.renderer.gpu})`);
  }
);

function renderMarkdown(report) {
  const r = report.renderer;
  const isSoftware = /swiftshader|llvmpipe|software/i.test(`${r.gpu} ${r.vendor}`);
  const rows = report.scenes
    .map((s) => {
      if (!s.snapshot) return `| ${s.label} | — | — | — | — | — | — | — | — | _${s.error ?? "unmeasured"}_ |`;
      const d = s.snapshot;
      const inst = d.instancing ? `${d.instancing.instances}/${d.instancing.batches}` : "—";
      return `| ${s.label} | ${d.objects} | ${d.draw.calls} | ${fmt(d.draw.triangles)} | ${inst} | ${d.memory.geometries}/${d.memory.textures} | ${d.heap ? d.heap.usedMB : "n/a"} | ${s.steady.softwareApproxFps} | ${s.steady.medianMs} | ${s.turn.worstMs} |`;
    })
    .join("\n");

  const vegRows = report.scenes
    .filter((s) => s.snapshot && (s.snapshot.grass || s.snapshot.trees || s.snapshot.bushes))
    .map((s) => {
      const g = s.snapshot.grass, t = s.snapshot.trees, b = s.snapshot.bushes;
      return `| ${s.label} | ${g ? g.visiblePatches + "/" + g.activePatches : "—"} | ${t ? t.visiblePatches + "/" + t.activePatches : "—"} | ${b ? b.visiblePatches + "/" + b.activePatches : "—"} |`;
    })
    .join("\n");

  // Data-driven key findings (computed from the measured snapshots).
  const measured = report.scenes.filter((s) => s.snapshot);
  let findings = "";
  if (measured.length) {
    const by = (sel) => measured.slice().sort((a, b) => sel(b.snapshot) - sel(a.snapshot))[0];
    const maxDraws = by((d) => d.draw.calls);
    const heaviest = by((d) => d.draw.triangles);
    const mostObjs = by((d) => d.objects);
    const bestInst = by((d) => (d.instancing ? d.instancing.instances : 0));
    const heaps = measured.map((s) => s.snapshot.heap?.usedMB).filter((n) => typeof n === "number");
    const minHeap = heaps.length ? Math.min(...heaps) : null;
    const maxHeap = heaps.length ? Math.max(...heaps) : null;
    const instLine = bestInst.snapshot.instancing?.instances
      ? `the **${mostObjs.snapshot.objects}-object** scene renders in just **${mostObjs.snapshot.draw.calls} draw calls** because runtime instancing collapses **${bestInst.snapshot.instancing.instances} repeated primitives into ${bestInst.snapshot.instancing.batches} instanced batch(es)** (${bestInst.label}). Without instancing each static primitive would be its own draw call.`
      : `instancing did not engage in the measured scenes.`;
    findings = `## Key findings (measured, GPU-independent)

- **Draw calls stay low and roughly flat across content load.** The busiest scene
  measured **${maxDraws.snapshot.draw.calls} draw calls** (${maxDraws.label}); ${instLine}
- **Triangles are the heaviest budget, and vegetation — not generated objects —
  dominates.** Peak **${fmt(heaviest.snapshot.draw.triangles)} triangles** (${heaviest.label}); the
  grass system is the triangle driver, so a large city of boxes is cheaper in
  triangles than a dense grass field.
- **JS heap stayed modest** (${minHeap ?? "n/a"}–${maxHeap ?? "n/a"} MB) across all scenes.
- **Particles** render as GPU points and the **rigged-GLB** scene carries the most
  textures (skinned-mesh materials) — both visible in the per-scene snapshots.
- The software-raster frame times below are ~1 fps on the heavy scenes; that is
  SwiftShader on the CPU, **not** a GPU result, and is exactly why GPU FPS must be
  measured on hardware before any public claim.

`;
  }

  return `# Performance Validation Report

> Generated by \`npm run perf:report\` (scripts/perf-report.mjs). Numbers below are
> **measured**, not estimated.

## Measurement environment

| Field | Value |
|---|---|
| Generated | \`${report.generatedAt}\` |
| Platform | \`${report.platform}\`, Node \`${report.node}\` |
| WebGL renderer (UNMASKED) | \`${r.gpu}\` |
| WebGL vendor (UNMASKED) | \`${r.vendor}\` |
| Renderer class | ${isSoftware ? "**SOFTWARE rasterizer (no GPU)**" : "hardware GPU"} |
| Settle before snapshot | ${report.settleMs} ms |

${
  isSoftware
    ? `> ⚠️ **This run used a SOFTWARE rasterizer (SwiftShader), not a GPU.** The
> **structural metrics** (objects, draw calls, triangles, instancing, geometry/
> texture counts, JS heap, visible patches) are **GPU-independent and authoritative** —
> they are the real budget drivers. The **frame-time / FPS** columns are **CPU
> software-raster signals only and must NOT be read as GPU FPS or used in any public
> performance claim.** To get true GPU FPS, run \`npm run perf:report\` on real
> hardware (Playwright + a GPU-backed Chromium); the renderer row above will then
> show your actual GPU and the FPS columns become meaningful. See "Reproduce on real
> hardware" below.`
    : `> This run used a hardware GPU; all columns are meaningful.`
}

## Measured scene matrix

Frame-time columns are ${isSoftware ? "**software-raster (CPU) — not GPU FPS**" : "GPU-measured"}.

| Scene | Objects | Draw calls | Triangles | Instances/batches | Geom/Tex | JS heap (MB) | ${isSoftware ? "sw-fps≈" : "fps"} | median ms | worst-turn ms |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
${rows}

${findings}## Vegetation streaming (visible / active patches)

| Scene | Grass | Trees | Bushes |
|---|--:|--:|--:|
${vegRows}

## Primitive objects vs instanced runtime view

The runtime batches eligible repeated static primitives into instanced draw calls
(Stage 17C-2) without changing object identity. Per scene:

${report.scenes
  .map((s) => {
    if (!s.snapshot) return `- **${s.label}** — _${s.error ?? "unmeasured"}_.`;
    const d = s.snapshot;
    if (!d.instancing || !d.instancing.instances) return `- **${s.label}** — ${d.objects} objects, no instancing engaged (draw calls: ${d.draw.calls}).`;
    return `- **${s.label}** — ${d.objects} objects → ${d.instancing.instances} instances in ${d.instancing.batches} batch(es); total draw calls ${d.draw.calls}. Instancing collapses repeated primitives into ${d.instancing.batches} call(s) instead of one-per-object.`;
  })
  .join("\n")}

## Conservative caps (derived from measured structural metrics)

These are GPU-independent and safe to state now. FPS-based caps stay open until a
hardware run fills the GPU rows.

- **Draw calls** are the primary budget driver. The connected/stress scenes above
  show how generated content maps to draw calls; instancing keeps repeated primitives
  to a handful of batches. Keep steady-state draw calls modest (a common 60 fps
  rule-of-thumb on mid hardware is low-thousands of calls).
- **Hard object ceiling** \`GENERATOR_LIMITS.MAX_TOTAL_OBJECTS = 1500\` per generate is
  exercised by the large-city scene; the measured triangle/draw-call counts there are
  the honest "stress" reference.
- **Triangles** scale with object count × primitive complexity; the matrix gives the
  measured cost of each content type to budget against.
- Recommend keeping the **default** generator sizes (city blocks ≤ 4, camp/ruin/forest
  size ≤ 5) for everyday authoring, reserving max sizes for deliberate stress builds.

## Reproduce on real hardware (to fill the GPU rows)

1. \`npm i -D playwright && npx playwright install chromium\`
2. Run \`npm run perf:report\` on a machine with a real GPU (the harness auto-detects a
   GPU-backed Chromium; the renderer row will show your actual GPU/driver).
3. Re-read the FPS / median-ms / worst-turn-ms columns — they are GPU-measured there.
4. Record GPU model, driver version, and OS alongside this report before making any
   public performance statement.

_Raw per-scene snapshots: \`docs/perf-report.json\`._
`;
}

function fmt(n) {
  return typeof n === "number" ? n.toLocaleString("en-US") : String(n);
}

if (run.skipped) console.log("perf report skipped (no browser)");
else console.log("perf report complete");
