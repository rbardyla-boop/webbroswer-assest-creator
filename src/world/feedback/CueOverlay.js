// Audio/Feedback-1 — the visual mirror for the slice's milestone audio cues (accessibility). A small
// corner toast that briefly shows the cue label (shrine discovered / reward found / sentinel down /
// path clear / cache sealed) so the key audio moments are also legible without sound. Pure UI feedback;
// it owns no game state. Modeled on ControlsHint. Per-hit is NOT mirrored here (the enemy's emissive
// flash already covers it), so combat never floods the toast.

const SHOW_MS = 1700; // how long a milestone label stays before fading

export class CueOverlay {
  constructor(parent = document.body) {
    this.element = document.createElement("div");
    this.element.className = "cue-overlay";
    this.element.setAttribute("role", "status");
    this.element.setAttribute("aria-live", "polite");
    parent.appendChild(this.element);
    this._timer = null;
    this._lastLabel = null;
  }

  /** Flash a milestone label, then fade. XSS-safe (textContent); labels are internal constants. */
  show(label) {
    if (!label) return;
    this._lastLabel = label;
    this.element.textContent = label;
    this.element.classList.add("visible");
    if (this._timer != null) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this.element.classList.remove("visible");
      this._timer = null;
    }, SHOW_MS);
  }

  get visible() {
    return this.element.classList.contains("visible");
  }

  get lastLabel() {
    return this._lastLabel;
  }

  dispose() {
    if (this._timer != null) clearTimeout(this._timer);
    this._timer = null;
    this.element.remove();
  }
}
