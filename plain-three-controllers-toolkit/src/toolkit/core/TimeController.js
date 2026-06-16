export class TimeController {
  constructor({ timeScale = 1, minScale = 0.02, maxDelta = 0.05 } = {}) {
    this.timeScale = timeScale;
    this.targetTimeScale = timeScale;
    this.minScale = minScale;
    this.maxDelta = maxDelta;
    this.elapsed = 0;
    this.unscaledElapsed = 0;
    this._bullet = null;
  }

  setTimeScale(scale, { smooth = false } = {}) {
    const s = Math.max(this.minScale, scale);
    if (smooth) this.targetTimeScale = s;
    else {
      this.timeScale = s;
      this.targetTimeScale = s;
    }
  }

  bulletTime(duration = 0.75, scale = 0.18, restoreScale = 1) {
    this._bullet = { remaining: duration, restoreScale };
    this.setTimeScale(scale, { smooth: false });
  }

  update(realDt) {
    const clamped = Math.min(realDt, this.maxDelta);
    this.unscaledElapsed += clamped;
    if (this._bullet) {
      this._bullet.remaining -= clamped;
      if (this._bullet.remaining <= 0) {
        const restore = this._bullet.restoreScale;
        this._bullet = null;
        this.setTimeScale(restore, { smooth: true });
      }
    }
    this.timeScale += (this.targetTimeScale - this.timeScale) * (1 - Math.exp(-8 * clamped));
    const dt = clamped * this.timeScale;
    this.elapsed += dt;
    return { dt, unscaledDt: clamped, timeScale: this.timeScale, elapsed: this.elapsed };
  }
}
