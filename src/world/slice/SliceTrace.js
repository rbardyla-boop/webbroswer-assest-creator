// Slice friction trace (Slice-0A instrumentation). Records the player's journey through the Frozen
// Cache slice — beat changes, the contextual prompt shown, actions taken (F/H/R/G), dwell/stuck
// signals, and completion — so a human tester can SEE where friction occurred during their own walk
// instead of relying only on memory. Events are timestamped by the slice's accumulated `elapsed`
// (deterministic, no wall-clock — keeps proofs reproducible and avoids any time/random call). It
// renders a toggleable on-screen "session log" panel and exposes the events via a debug hook for
// copy/paste. Pure telemetry: it never affects gameplay or completion.

const MAX_EVENTS = 80;
const PANEL_ROWS = 12;

export class SliceTrace {
  constructor(parent = document.body) {
    this.events = [];
    this.panelOpen = false;
    this.element = document.createElement("div");
    this.element.className = "slice-trace";
    parent.appendChild(this.element);
    this._lastKey = ""; // de-dupe consecutive identical events (the prompt re-evaluates every frame)
  }

  /**
   * Append one event (deduped against the immediately-preceding identical one).
   * @param {string} type  e.g. "beat" | "prompt" | "action" | "stuck" | "complete"
   * @param {string} detail short payload (the beat name, prompt key, action key, …)
   * @param {number} t      the slice's elapsed seconds (the deterministic clock)
   */
  record(type, detail = "", t = 0) {
    const key = `${type}|${detail}`;
    if (key === this._lastKey) return;
    this._lastKey = key;
    this.events.push({ t: Math.round(t * 10) / 10, type, detail: String(detail) });
    if (this.events.length > MAX_EVENTS) this.events.shift();
    if (this.panelOpen) this._render();
  }

  /** Clear the log for a fresh walk (called on each slice load). */
  reset() {
    this.events = [];
    this._lastKey = "";
    if (this.panelOpen) this._render();
  }

  togglePanel() {
    this.panelOpen = !this.panelOpen;
    this.element.classList.toggle("visible", this.panelOpen);
    this._render();
  }

  /** A defensive copy of the recorded events (for the __SLICE_TRACE__ debug hook + tests). */
  entries() {
    return this.events.map((e) => ({ ...e }));
  }

  /** Compact summary: counts per type + the friction signals a tester cares about. */
  summary() {
    const byType = {};
    for (const e of this.events) byType[e.type] = (byType[e.type] ?? 0) + 1;
    return {
      total: this.events.length,
      byType,
      stuckCount: byType.stuck ?? 0,
      completed: this.events.some((e) => e.type === "complete"),
      panelOpen: this.panelOpen,
    };
  }

  _render() {
    const rows = this.events
      .slice(-PANEL_ROWS)
      .map((e) => `<div class="slice-trace-row"><span>${e.t}s</span> ${e.type}${e.detail ? " · " + e.detail : ""}</div>`)
      .join("");
    this.element.innerHTML = `<div class="slice-trace-title">SESSION LOG — press L to toggle</div>${rows}`;
  }

  dispose() {
    this.element.remove();
  }
}
