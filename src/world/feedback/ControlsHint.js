// Arrival controls hint (Slice-0A — human UX hardening). The Frozen Cache slice teaches F/H/R/G
// contextually, but NOTHING teaches movement/look/camera — and the editor's controls hint is hidden
// in play mode. A fresh player can stall at "how do I even move?" before any contextual prompt is
// relevant. This surfaces move/look/camera on arrival and fades on the player's first movement (or
// after a few seconds), so the very first thing a player learns is how to go. Pure UI feedback.

export class ControlsHint {
  constructor(parent = document.body) {
    this.element = document.createElement("div");
    this.element.className = "controls-hint";
    this.element.innerHTML =
      '<span><b>Move</b> <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span>' +
      '<span><b>Look</b> move the mouse</span>' +
      '<span><b>Camera</b> <kbd>V</kbd></span>';
    parent.appendChild(this.element);
    this._dismissed = false;
  }

  /** Show the hint (no-op once dismissed, so it never reappears mid-run). */
  show() {
    if (!this._dismissed) this.element.classList.add("visible");
  }

  /** Permanently dismiss the hint (first movement learned it, or the arrival window elapsed). */
  dismiss() {
    this._dismissed = true;
    this.element.classList.remove("visible");
  }

  get visible() {
    return this.element.classList.contains("visible");
  }

  get dismissed() {
    return this._dismissed;
  }

  dispose() {
    this.element.remove();
  }
}
