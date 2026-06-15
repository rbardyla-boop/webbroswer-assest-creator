// Performance budget HUD (Stage 20A). A compact authoring overlay that turns the
// __PERF__-style metrics into live green / yellow / red status so budget pressure is
// impossible to ignore while building a world.
//
// Discipline:
// - Metric collection is THROTTLED (default 4 Hz), never per-frame, and reads only
//   already-computed counters (renderer.info, system .stats) into a REUSED scratch
//   object — no per-frame allocation in the 60 Hz loop.
// - It still collects while hidden (so the __BUDGET__ test hook works in runtime
//   where the HUD is toggled off), but only touches the DOM when visible.
// - DEV-only: main.js constructs it behind import.meta.env.DEV, so a production build
//   never ships it.

import { PERFORMANCE_BUDGETS, BUDGET_LABELS, classify, evaluateBudget } from "../perf/PerformanceBudget.js";

const COLORS = Object.freeze({ green: "#7fdca0", yellow: "#e6c463", red: "#e0795a", unknown: "#8fa899" });

export class BudgetHUD {
  /**
   * @param {object} opts
   * @param {(scratch: object) => void} opts.collect fills the scratch metrics in place
   * @param {boolean} [opts.visible]
   * @param {object}  [opts.budgets]
   * @param {number}  [opts.interval] seconds between samples (throttle)
   */
  constructor({ collect, visible = true, budgets = PERFORMANCE_BUDGETS, interval = 0.25 } = {}) {
    this.collect = typeof collect === "function" ? collect : () => {};
    this.budgets = budgets;
    this.interval = interval;
    this.visible = visible;
    this._acc = interval; // sample on the first update
    // Reused metrics scratch — mutated in place every sample, never reallocated.
    this._scratch = { drawCalls: 0, triangles: 0, heapMB: null, generatedObjects: 0, instancedBatches: 0, visibleVegetationPatches: 0, rigs: 0 };
    this._buildDOM();
  }

  _buildDOM() {
    this.el = document.createElement("div");
    this.el.id = "budget-hud";
    Object.assign(this.el.style, {
      position: "fixed", top: "12px", right: "12px", zIndex: "40",
      font: "11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
      color: "#d7e6dc", background: "rgba(8,16,12,0.78)", border: "1px solid rgba(120,200,140,0.25)",
      borderRadius: "9px", padding: "9px 11px", minWidth: "168px", pointerEvents: "none",
      display: this.visible ? "block" : "none", whiteSpace: "pre",
    });

    this.titleEl = document.createElement("div");
    Object.assign(this.titleEl.style, { letterSpacing: ".12em", marginBottom: "5px", color: "#7fdca0" });
    this.el.appendChild(this.titleEl);

    // One row per budgeted metric, in a stable order.
    this.rows = Object.keys(this.budgets).map((key) => this._row(key, BUDGET_LABELS[key] ?? key, this.budgets[key]));
    // Rig / animation update pressure — shown separately from draw calls (it is
    // per-frame CPU work, not a draw-call cost), so it has no color budget.
    this.rigRow = this._row("rigs", "rigs (anim)", null);

    const note = document.createElement("div");
    Object.assign(note.style, { marginTop: "6px", color: "#5c6f64", fontSize: "10px" });
    note.textContent = "thresholds = conservative defaults";
    this.el.appendChild(note);

    document.body.appendChild(this.el);
  }

  _row(key, label, budget) {
    const line = document.createElement("div");
    Object.assign(line.style, { display: "flex", justifyContent: "space-between", gap: "12px" });
    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    Object.assign(labelEl.style, { color: "#8fa899" });
    const valueEl = document.createElement("span");
    valueEl.textContent = "—";
    Object.assign(valueEl.style, { fontWeight: "600", fontVariantNumeric: "tabular-nums" });
    line.appendChild(labelEl);
    line.appendChild(valueEl);
    // Insert budget rows above the footnote (which is appended last on first build).
    this.el.appendChild(line);
    return { key, budget, valueEl, value: 0, status: "unknown", format: formatterFor(key) };
  }

  update(dt) {
    this._acc += dt;
    if (this._acc < this.interval) return;
    // Subtract the interval (don't reset to 0) so the sample cadence doesn't drift
    // slow by discarding the per-tick overshoot. dt is clamped upstream (≤ 50 ms), so
    // _acc can't spiral into repeated catch-up fires.
    this._acc -= this.interval;

    this.collect(this._scratch); // cheap, into the reused object — no allocation
    let worst = "green";
    for (const row of this.rows) {
      row.value = this._scratch[row.key];
      row.status = classify(row.value, row.budget);
      if (severity(row.status) > severity(worst)) worst = row.status;
    }
    this.rigRow.value = this._scratch.rigs;
    this._overall = worst;

    if (this.visible) this._render();
  }

  _render() {
    this.titleEl.textContent = `BUDGET · ${this._overall.toUpperCase()}`;
    this.titleEl.style.color = COLORS[this._overall] ?? COLORS.unknown;
    for (const row of this.rows) {
      row.valueEl.textContent = row.format(row.value);
      row.valueEl.style.color = COLORS[row.status] ?? COLORS.unknown;
    }
    this.rigRow.valueEl.textContent = String(this.rigRow.value ?? 0);
    this.rigRow.valueEl.style.color = COLORS.unknown;
  }

  toggle() {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? "block" : "none";
    if (this.visible) this._render();
  }

  // Snapshot for the __BUDGET__ test/debug hook (allocates — called rarely).
  snapshot() {
    return {
      metrics: { ...this._scratch },
      evaluated: evaluateBudget(this._scratch, this.budgets),
      rigs: this._scratch.rigs,
    };
  }
}

function severity(status) {
  return status === "red" ? 2 : status === "yellow" ? 1 : status === "green" ? 0 : -1;
}

function formatterFor(key) {
  if (key === "triangles") return (n) => (Number.isFinite(n) ? `${Math.round(n / 1000)}k` : "—");
  if (key === "heapMB") return (n) => (Number.isFinite(n) ? n.toFixed(0) : "n/a");
  return (n) => (Number.isFinite(n) ? String(n) : "—");
}
