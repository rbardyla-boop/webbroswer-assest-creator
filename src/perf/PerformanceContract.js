// Performance contract evaluation (Performance Contract-1).
//
// Turns a captured performance snapshot into a pass/fail verdict. REUSES the Stage 20A
// classifier (PerformanceBudget.js) — it does NOT redefine those thresholds. It layers
// CONTRACT_BUDGETS (the same six metrics plus a few contract-only ones) and exposes a
// hard gate `assertWithinBudget` used by both the Node regression and the browser proof.
//
// PURE: no THREE, no DOM — Node-testable. Structural metrics are GPU-independent (a
// "within budget" result is not a GPU-FPS claim; see PerformanceBudget.js).

import { PERFORMANCE_BUDGETS, classify, severityOf } from "./PerformanceBudget.js";

// The contract's budget set: the calibrated Stage 20A budgets, plus contract-only
// metrics (total objects, placed runtime assets, GPU geometry/texture-count proxy).
// Adding keys here does NOT touch PERFORMANCE_BUDGETS / BudgetHUD / test:budget.
export const CONTRACT_BUDGETS = Object.freeze({
  ...PERFORMANCE_BUDGETS,
  objects: Object.freeze({ green: 600, yellow: 1200, red: 2500 }),
  runtimeAssets: Object.freeze({ green: 20, yellow: 60, red: 150 }),
  memGeometries: Object.freeze({ green: 1500, yellow: 3000, red: 6000 }),
  memTextures: Object.freeze({ green: 60, yellow: 120, red: 250 }),
});

// Flatten a captured { perf: __PERF__.snapshot(), budget: __BUDGET__() } pair into the
// contract's flat metric set. Prefers the already-computed __BUDGET__ metrics, falling
// back to the __PERF__ snapshot. Missing values stay null (classified "unknown").
export function extractMetrics({ perf = null, budget = null } = {}) {
  const m = budget?.metrics ?? {};
  return {
    drawCalls: pick(m.drawCalls, perf?.draw?.calls),
    triangles: pick(m.triangles, perf?.draw?.triangles),
    heapMB: pick(m.heapMB, perf?.heap?.usedMB),
    generatedObjects: pick(m.generatedObjects, 0),
    instancedBatches: pick(m.instancedBatches, perf?.instancing?.batches),
    visibleVegetationPatches: pick(m.visibleVegetationPatches, vegPatches(perf)),
    objects: pick(perf?.objects, 0),
    runtimeAssets: pick(perf?.arsenal?.count, 0),
    memGeometries: pick(perf?.memory?.geometries, null),
    memTextures: pick(perf?.memory?.textures, null),
    rigs: pick(budget?.rigs, 0),
    // Reported for stability checks (not gated by a fixed ceiling):
    wildlifeAnimals: pick(perf?.wildlife?.activeAnimals, 0),
    ambientMotes: pick(perf?.ambient?.activeMotes, 0),
  };
}

// Per-metric status (green/yellow/red/unknown) + worst-of overall, against CONTRACT_BUDGETS.
export function evaluateContract(metrics, budgets = CONTRACT_BUDGETS) {
  const perMetric = {};
  let worst = "green";
  for (const key of Object.keys(budgets)) {
    const value = metrics?.[key] ?? null;
    const status = classify(value, budgets[key]);
    perMetric[key] = { value, status, budget: budgets[key] };
    if (severityOf(status) > severityOf(worst)) worst = status;
  }
  return { perMetric, overall: worst };
}

/**
 * Hard gate. Throws (with a precise breach list) when a live metric exceeds either:
 *   (a) a per-scene ceiling — the measured baseline + tolerance (catches a regression
 *       that is still under the global red line), or
 *   (b) the global RED design ceiling in CONTRACT_BUDGETS (clearly over, any scene).
 * Yellow is a warning, never a failure — vegetation legitimately runs yellow on
 * triangles, and the gate must not false-fail on intended pressure.
 * @returns {true} on pass
 */
export function assertWithinBudget(sceneId, metrics, ceilings = {}, budgets = CONTRACT_BUDGETS) {
  const breaches = collectBreaches(sceneId, metrics, ceilings, budgets);
  if (breaches.length) throw new Error(`Performance budget breach:\n  ${breaches.join("\n  ")}`);
  return true;
}

// The breach list without throwing (for reporting / tests).
export function collectBreaches(sceneId, metrics, ceilings = {}, budgets = CONTRACT_BUDGETS) {
  const breaches = [];
  for (const [key, ceil] of Object.entries(ceilings)) {
    const value = metrics?.[key];
    if (Number.isFinite(value) && Number.isFinite(ceil) && value > ceil) {
      breaches.push(`${sceneId}.${key}=${value} > scene ceiling ${ceil}`);
    }
  }
  for (const key of Object.keys(budgets)) {
    const value = metrics?.[key];
    if (Number.isFinite(value) && classify(value, budgets[key]) === "red") {
      breaches.push(`${sceneId}.${key}=${value} exceeds RED design ceiling ${budgets[key].red}`);
    }
  }
  return breaches;
}

function vegPatches(perf) {
  if (!perf) return null;
  const g = perf.grass?.visiblePatches ?? 0;
  const t = perf.trees?.visiblePatches ?? 0;
  const b = perf.bushes?.visiblePatches ?? 0;
  return g + t + b;
}

function pick(value, fallback) {
  if (Number.isFinite(value)) return value;
  if (Number.isFinite(fallback)) return fallback;
  return value ?? fallback ?? null;
}
