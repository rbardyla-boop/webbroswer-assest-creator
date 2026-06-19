// Debounced autosave for the World Builder (Editor UX-1).
//
// The editor used to save only on an explicit "Save World" click, so unsaved
// authoring could be lost. This drives a small status machine off a debounced
// timer:  idle → dirty → saving → saved | error.  The actual persistence is the
// injected `save` fn (the editor passes its existing serialize+localStorage
// path), and the timer is injected too, so the whole state machine is unit-testable
// in Node with a fake clock (no DOM, no real timers, no THREE).

/** Default debounce window (ms) between the last edit and an autosave. */
export const AUTOSAVE_DEBOUNCE_MS = 1500;

/** @typedef {"idle"|"dirty"|"saving"|"saved"|"error"} AutosaveStatus */

export class EditorAutosave {
  /**
   * @param {object} opts
   * @param {() => void} opts.save        persist the world now (may throw)
   * @param {number} [opts.debounceMs]
   * @param {(status: AutosaveStatus, error: Error|null) => void} [opts.onStatus]
   * @param {(fn: Function, ms: number) => any} [opts.setTimer]
   * @param {(handle: any) => void} [opts.clearTimer]
   */
  constructor({
    save,
    debounceMs = AUTOSAVE_DEBOUNCE_MS,
    onStatus = null,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (handle) => clearTimeout(handle),
  } = {}) {
    this._save = save;
    this._debounceMs = Math.max(0, debounceMs | 0);
    this._onStatus = onStatus;
    this._setTimer = setTimer;
    this._clearTimer = clearTimer;
    this._timer = null;
    this._status = "idle";
    this._lastError = null;
    this._saveCount = 0;
  }

  /** @returns {AutosaveStatus} */
  status() {
    return this._status;
  }

  get lastError() {
    return this._lastError;
  }

  /** Number of successful saves — for tests/diagnostics. */
  get saveCount() {
    return this._saveCount;
  }

  /** An edit happened: go dirty and (re)arm the debounce so a burst coalesces to one save. */
  markDirty() {
    this._setStatus("dirty");
    this._cancelTimer();
    this._timer = this._setTimer(() => {
      this._timer = null;
      this._run();
    }, this._debounceMs);
  }

  /** Save immediately (e.g. before entering Play) and cancel any pending debounce. */
  flush() {
    this._cancelTimer();
    this._run();
  }

  /** Drop pending work and return to idle — used when a fresh world is loaded. */
  reset() {
    this._cancelTimer();
    this._lastError = null;
    this._setStatus("idle");
  }

  _run() {
    this._setStatus("saving");
    try {
      this._save?.();
      this._saveCount++;
      this._lastError = null;
      this._setStatus("saved");
    } catch (error) {
      this._lastError = error instanceof Error ? error : new Error(String(error));
      this._setStatus("error");
    }
  }

  _cancelTimer() {
    if (this._timer != null) {
      this._clearTimer(this._timer);
      this._timer = null;
    }
  }

  _setStatus(status) {
    if (status === this._status && status !== "saving" && status !== "saved") return;
    this._status = status;
    this._onStatus?.(status, this._lastError);
  }
}
