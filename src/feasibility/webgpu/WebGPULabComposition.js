// WebGPU Feasibility Gate-0 — the lab field's structural plan (PURE: no THREE, no platform RNG,
// no wall-clock). A deterministic description of a small grass-like instanced field: enough to
// init a WebGPURenderer, render something, and compare its STRUCTURE (instances / triangles /
// draw batches) against the WebGL Visual Benchmark-1 baseline.
//
// "Minimal field + capability readout" (the approved spike scope): a single InstancedMesh of
// thin 2-triangle blades — one draw batch, controlled vertex count. NOT the production grass,
// NOT a TSL port of the real wind shader (that cost is assessed analytically in the report).

// A blade is a 2-triangle quad (4 verts, 2 tris). One small, fixed footprint.
export const TRIANGLES_PER_BLADE = 2;
export const VERTICES_PER_BLADE = 4;

// Default field: a square lattice of blades. Kept small — this is a feasibility micro-scene,
// not a stress test. 64×64 = 4096 blades = 8192 triangles in ONE instanced draw batch.
export const DEFAULT_LAB_FIELD = Object.freeze({ rows: 64, cols: 64, spacing: 0.25 });

/**
 * Deterministic structural plan for the lab field.
 * @param {{rows?:number, cols?:number, spacing?:number}} [opts]
 * @returns {{rows:number, cols:number, spacing:number, instances:number,
 *   trianglesPerInstance:number, triangles:number, vertices:number, drawBatches:number,
 *   bounds:{x:number, z:number}}}
 */
export function webgpuLabComposition(opts = {}) {
  const rows = clampInt(opts.rows, DEFAULT_LAB_FIELD.rows, 1, 256);
  const cols = clampInt(opts.cols, DEFAULT_LAB_FIELD.cols, 1, 256);
  const spacing = clampNum(opts.spacing, DEFAULT_LAB_FIELD.spacing, 0.02, 4);
  const instances = rows * cols;
  return {
    rows,
    cols,
    spacing,
    instances,
    trianglesPerInstance: TRIANGLES_PER_BLADE,
    triangles: instances * TRIANGLES_PER_BLADE,
    vertices: instances * VERTICES_PER_BLADE,
    // A single InstancedMesh → ONE draw batch, exactly the batching WebGL already does.
    drawBatches: 1,
    bounds: { x: (cols - 1) * spacing, z: (rows - 1) * spacing },
  };
}

function clampInt(value, fallback, lo, hi) {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(lo, Math.min(hi, n));
}

function clampNum(value, fallback, lo, hi) {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(lo, Math.min(hi, n));
}
