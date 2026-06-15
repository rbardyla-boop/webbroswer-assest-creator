// Performance budgets (Stage 20A). Pure classification of live engine metrics into
// green / yellow / red so authoring surfaces budget pressure immediately. No THREE,
// no DOM — Node-testable.
//
// IMPORTANT: these thresholds are CONSERVATIVE DEFAULTS, not universal truths. They
// are structural (draw calls, triangles, heap, object/batch/patch counts) and so are
// GPU-INDEPENDENT — they are the budget drivers identified by the measured
// performance report (docs/PERFORMANCE_REPORT.md), NOT an FPS claim. A green status
// is "well within a conservative structural budget", not "runs at 60 fps on your
// GPU" — that still requires a hardware FPS measurement. Tune per target device.
//
// A metric is green when value ≤ green, yellow when ≤ yellow, otherwise red. The
// `red` number is the design ceiling (the point you should treat as clearly over).

export const PERFORMANCE_BUDGETS = Object.freeze({
  drawCalls: Object.freeze({ green: 120, yellow: 180, red: 240 }),
  triangles: Object.freeze({ green: 500_000, yellow: 900_000, red: 1_400_000 }),
  heapMB: Object.freeze({ green: 80, yellow: 140, red: 220 }),
  generatedObjects: Object.freeze({ green: 300, yellow: 600, red: 1000 }),
  instancedBatches: Object.freeze({ green: 40, yellow: 80, red: 120 }),
  visibleVegetationPatches: Object.freeze({ green: 120, yellow: 220, red: 320 }),
});

// Human labels for each budget key (used by the HUD).
export const BUDGET_LABELS = Object.freeze({
  drawCalls: "draw calls",
  triangles: "triangles",
  heapMB: "JS heap MB",
  generatedObjects: "gen objects",
  instancedBatches: "inst batches",
  visibleVegetationPatches: "veg patches",
});

const SEVERITY = Object.freeze({ unknown: -1, green: 0, yellow: 1, red: 2 });

// Classify a single value against its {green, yellow, red} levels. A null / NaN /
// missing value (e.g. heap when performance.memory is unavailable) is "unknown".
export function classify(value, levels) {
  if (!levels || value == null || !Number.isFinite(value)) return "unknown";
  if (value <= levels.green) return "green";
  if (value <= levels.yellow) return "yellow";
  return "red";
}

// Evaluate a metrics object against the budgets. Returns per-key { value, status }
// plus an `overall` worst-status across known metrics ("unknown" never worsens it).
export function evaluateBudget(metrics, budgets = PERFORMANCE_BUDGETS) {
  const result = {};
  let worst = "green";
  for (const key of Object.keys(budgets)) {
    const value = metrics?.[key] ?? null;
    const status = classify(value, budgets[key]);
    result[key] = { value, status };
    if (SEVERITY[status] > SEVERITY[worst]) worst = status;
  }
  result.overall = worst;
  return result;
}

// Compare two statuses by severity (for sorting / worst-of).
export function severityOf(status) {
  return SEVERITY[status] ?? -1;
}
