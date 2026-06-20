// test:webgpu-feasibility — pure-Node regression for WebGPU Feasibility Gate-0.
//
// WebGPU Feasibility Gate-0 is a FEASIBILITY-ONLY research gate (NOT a renderer migration). It ships:
//   - a capability probe (probeWebGPU) that honestly reports whether WebGPU is available,
//   - a deterministic structural plan for a minimal grass-like instanced field (the lab spike),
//   - a structural comparison against the WebGL Visual Benchmark-1 baseline.
// WebGL stays the production path, untouched. The live "WebGPURenderer actually initializes under a
// real browser" proof is test:webgpu-feasibility-proof. This gate proves the PURE logic + ISOLATION:
// the feasibility modules never import the production renderer/main/world, and the pure modules carry
// no THREE and no nondeterministic sources.

import assert from "node:assert/strict";
import fs from "node:fs";

import { probeWebGPU, summarizeLimits } from "../src/feasibility/webgpu/WebGPUCapability.js";
import { webgpuLabComposition, DEFAULT_LAB_FIELD, TRIANGLES_PER_BLADE } from "../src/feasibility/webgpu/WebGPULabComposition.js";
import { compareToWebGLBaseline, WEBGL_VISUAL_BENCHMARK_BASELINE } from "../src/feasibility/webgpu/WebGLBaselineComparison.js";

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

// --- 1. probeWebGPU honestly reports availability against mock navigators -----
{
  const noNav = await probeWebGPU(null);
  assert.equal(noNav.apiPresent, false, "null navigator → API not present");
  assert.equal(noNav.available, false, "null navigator → unavailable");
  assert.ok(noNav.reason.length > 0, "a human reason is always given");

  const noGpu = await probeWebGPU({});
  assert.equal(noGpu.apiPresent, false, "navigator without .gpu → API not present");
  assert.equal(noGpu.available, false, "navigator without .gpu → unavailable");
  assert.match(noGpu.reason, /navigator\.gpu/, "reason names the missing API surface");

  const noAdapter = await probeWebGPU({ gpu: { requestAdapter: async () => null } });
  assert.equal(noAdapter.apiPresent, true, "gpu present → API present");
  assert.equal(noAdapter.available, false, "no adapter granted → unavailable");
  assert.match(noAdapter.reason, /no adapter/i, "reason explains the missing adapter");

  const threw = await probeWebGPU({ gpu: { requestAdapter: async () => { throw new Error("denied"); } } });
  assert.equal(threw.apiPresent, true, "API present even when requestAdapter throws");
  assert.equal(threw.available, false, "throw → unavailable (never crashes the probe)");
  assert.match(threw.reason, /threw/, "reason surfaces the thrown error");

  const granted = await probeWebGPU({
    gpu: { requestAdapter: async () => ({ isFallbackAdapter: true, limits: { maxBufferSize: 268435456, maxTextureDimension2D: 8192, bogus: 1 } }) },
  });
  assert.equal(granted.apiPresent, true, "adapter granted → API present");
  assert.equal(granted.available, true, "adapter granted → available");
  assert.equal(granted.isFallbackAdapter, true, "fallback-adapter flag surfaced");
  assert.match(granted.reason, /FALLBACK/, "reason notes the software fallback adapter");
  assert.equal(granted.limits.maxBufferSize, 268435456, "whitelisted limit recorded");
  assert.equal("bogus" in granted.limits, false, "non-whitelisted limit dropped");
  ok("probe: honest apiPresent/available verdict + reason across all navigator shapes");
}

// --- 2. summarizeLimits whitelists finite numeric limits ----------------------
{
  assert.deepEqual(summarizeLimits(null), {}, "null limits → empty");
  assert.deepEqual(summarizeLimits({ maxBufferSize: "big" }), {}, "non-numeric limit dropped");
  assert.deepEqual(summarizeLimits({ maxBufferSize: Infinity }), {}, "non-finite limit dropped");
  assert.deepEqual(summarizeLimits({ maxBufferSize: 1024, junk: 5 }), { maxBufferSize: 1024 }, "only whitelisted finite limits kept");
  ok("limits: only whitelisted finite numeric limits are reported");
}

// --- 3. lab composition is deterministic + structurally exact -----------------
{
  const a = webgpuLabComposition();
  const b = webgpuLabComposition();
  assert.deepEqual(a, b, "default composition is deterministic");
  assert.equal(a.rows, DEFAULT_LAB_FIELD.rows, "default rows");
  assert.equal(a.cols, DEFAULT_LAB_FIELD.cols, "default cols");
  assert.equal(a.instances, a.rows * a.cols, "instances = rows*cols");
  assert.equal(a.trianglesPerInstance, TRIANGLES_PER_BLADE, "2 triangles per blade");
  assert.equal(a.triangles, a.instances * TRIANGLES_PER_BLADE, "triangles = instances * 2");
  assert.equal(a.drawBatches, 1, "ONE instanced draw batch (the WebGL-equal batching)");

  // Clamps: out-of-range / non-finite inputs are bounded, never NaN.
  const clamped = webgpuLabComposition({ rows: 99999, cols: -3, spacing: NaN });
  assert.ok(clamped.rows <= 256 && clamped.cols >= 1, "rows/cols clamped to [1,256]");
  assert.ok(Number.isFinite(clamped.spacing), "spacing falls back to a finite default");
  ok("composition: deterministic, structurally exact, input-clamped");
}

// --- 4. structural comparison vs the recorded WebGL baseline ------------------
{
  assert.equal(WEBGL_VISUAL_BENCHMARK_BASELINE.triangles, 512_962, "baseline triangles match the recorded VB-1 measurement");
  assert.equal(WEBGL_VISUAL_BENCHMARK_BASELINE.drawCalls, 116, "baseline draw calls match the recorded VB-1 measurement");
  const cmp = compareToWebGLBaseline(webgpuLabComposition());
  assert.equal(cmp.webglBaseline.source, "docs/VISUAL_BENCHMARK.md", "comparison cites the baseline source");
  assert.equal(cmp.structural.bothBatchInstancesIntoOneDraw, true, "the lab field is one draw batch");
  assert.ok(typeof cmp.structural.spikeTrianglesVsBaseline === "number", "triangle ratio is computed");
  assert.ok(cmp.notes.some((n) => /not GPU-FPS/i.test(n)), "comparison records the SwiftShader-is-CPU caveat");
  assert.ok(cmp.notes.some((n) => /already batches/i.test(n)), "comparison records that WebGL already batches instances");
  ok("comparison: structural, honest, cites the recorded WebGL baseline");
}

// --- 5. ISOLATION — the feasibility modules never touch the production renderer
{
  const dir = new URL("../src/feasibility/webgpu/", import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
  assert.ok(files.length >= 5, `all feasibility modules present (${files.length})`);
  for (const f of files) {
    const src = fs.readFileSync(new URL(f, dir), "utf8");
    assert.equal(/core\/renderer\.js/.test(src), false, `${f} does NOT import the production renderer`);
    assert.equal(/\.\.\/\.\.\/main\.js|from ["']\.\.\/\.\.\/\.\.\/main/.test(src), false, `${f} does NOT import main.js`);
    assert.equal(/\.\.\/\.\.\/world\//.test(src), false, `${f} does NOT import the production world`);
  }
  ok(`isolation: ${files.length} feasibility modules import no production renderer/main/world`);
}

// --- 6. the PURE modules carry no THREE and no nondeterministic sources -------
{
  const pure = ["WebGPUCapability.js", "WebGPULabComposition.js", "WebGLBaselineComparison.js"];
  const dir = new URL("../src/feasibility/webgpu/", import.meta.url);
  for (const f of pure) {
    const src = fs.readFileSync(new URL(f, dir), "utf8");
    assert.equal(/from ["']three/.test(src), false, `${f} is THREE-free (pure, Node-importable)`);
    assert.equal(/Math\.random|Date\.now|new Date\(|performance\.now/.test(src), false, `${f} has no RNG / wall-clock`);
  }
  // The spike (scene) + entry MAY import three/webgpu — confirm the spike is actually wired to it.
  const scene = fs.readFileSync(new URL("WebGPULabScene.js", dir), "utf8");
  assert.match(scene, /three\/webgpu/, "the lab scene imports node materials from three/webgpu");
  ok("purity: pure modules are THREE-free + deterministic; the spike is wired to three/webgpu");
}

console.log(`\nwebgpu-feasibility regression: ${passed} checks passed`);
