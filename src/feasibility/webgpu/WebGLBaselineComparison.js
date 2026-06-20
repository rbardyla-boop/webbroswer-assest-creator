// WebGPU Feasibility Gate-0 — structural comparison against the WebGL baseline (PURE: no THREE,
// no platform RNG, no wall-clock).
//
// The honest framing: the lab field is a small controlled micro-scene, NOT a like-for-like copy
// of the full Visual Benchmark-1 world. So this is an ARCHITECTURAL/structural comparison — how
// each renderer expresses an instanced field — not a scene-equal benchmark and DEFINITELY not a
// GPU-FPS comparison (SwiftShader is a CPU rasterizer; see docs/WEBGPU_FEASIBILITY.md).

// Visual Benchmark-1's MEASURED WebGL structural numbers (full scene, GLB resolved).
// Source of truth: docs/VISUAL_BENCHMARK.md baseline table + memory stage-visual-benchmark-1.
// Recorded as constants so the comparison stays pure and Node-testable.
export const WEBGL_VISUAL_BENCHMARK_BASELINE = Object.freeze({
  drawCalls: 116,
  triangles: 512_962,
  objects: 11,
  instancedBatches: 2,
  vegetationPatches: 62,
  runtimeAssets: 2,
  rasterizer: "SwiftShader (CPU software) — structural signal, not GPU FPS",
  source: "docs/VISUAL_BENCHMARK.md",
});

/**
 * Compare the lab field's structural plan to the recorded WebGL baseline.
 * @param {{instances:number, triangles:number, drawBatches:number}} plan - webgpuLabComposition()
 * @returns {{spike:object, webglBaseline:object, structural:object, notes:string[]}}
 */
export function compareToWebGLBaseline(plan) {
  const spike = {
    instances: plan.instances,
    triangles: plan.triangles,
    drawBatches: plan.drawBatches,
  };
  return {
    spike,
    webglBaseline: WEBGL_VISUAL_BENCHMARK_BASELINE,
    structural: {
      // The lab field is a fraction of the full world's triangle load by design — it exists to
      // prove WebGPURenderer initializes and batches an instanced field, not to outscore the world.
      spikeTrianglesVsBaseline: ratio(plan.triangles, WEBGL_VISUAL_BENCHMARK_BASELINE.triangles),
      spikeDrawBatches: plan.drawBatches,
      baselineInstancedBatches: WEBGL_VISUAL_BENCHMARK_BASELINE.instancedBatches,
      // Both renderers collapse an instanced field into a single draw batch — instance batching is
      // NOT where WebGPU differs from WebGL. WebGPU's architectural levers are render bundles and
      // compute, neither of which is exercised by this minimal field.
      bothBatchInstancesIntoOneDraw: plan.drawBatches === 1,
    },
    notes: [
      "Lab field is a controlled micro-scene, not a copy of the full Visual Benchmark-1 world.",
      "Comparison is structural/architectural, not GPU-FPS (SwiftShader is a CPU rasterizer).",
      "WebGL already batches an InstancedMesh into one draw — instance batching is not a WebGPU-only win.",
      "WebGPU's real levers (render bundles, compute culling/placement) are NOT exercised by this field.",
    ],
  };
}

function ratio(a, b) {
  if (typeof b !== "number" || b === 0) return null;
  return Math.round((a / b) * 10000) / 10000;
}
