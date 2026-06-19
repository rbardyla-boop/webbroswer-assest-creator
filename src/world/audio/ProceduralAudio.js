import { CUE_NOTES } from "./AudioCues.js";

export class ProceduralAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.wind = null;
    this._unlock = () => this.unlock();
    globalThis.addEventListener?.("pointerdown", this._unlock, { once: true });
    globalThis.addEventListener?.("keydown", this._unlock, { once: true });
  }

  unlock() {
    const AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AudioContext) return false;
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.16;
      this.master.connect(this.context.destination);
      this._startWind();
    }
    this.context.resume?.();
    return true;
  }

  cue(name) {
    if (!this.context || !this.master) return false;
    const notes = CUE_NOTES[name];
    if (!notes) return false;
    const now = this.context.currentTime;
    notes.forEach((frequency, i) => this._tone(frequency, now + i * 0.07, name === "complete" ? 0.7 : 0.18));
    return true;
  }

  setEscalation(active) {
    if (!this.context || !this.wind) return;
    this.wind.gain.setTargetAtTime(active ? 0.075 : 0.035, this.context.currentTime, 0.8);
  }

  _tone(frequency, start, duration) {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.22, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  _startWind() {
    const length = this.context.sampleRate * 2;
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let value = 0;
    for (let i = 0; i < length; i++) {
      value = value * 0.985 + (Math.random() * 2 - 1) * 0.015;
      data[i] = value;
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    this.wind = this.context.createGain();
    source.buffer = buffer;
    source.loop = true;
    filter.type = "bandpass";
    filter.frequency.value = 420;
    filter.Q.value = 0.55;
    this.wind.gain.value = 0.035;
    source.connect(filter).connect(this.wind).connect(this.master);
    source.start();
    this.windSource = source;
  }

  dispose() {
    globalThis.removeEventListener?.("pointerdown", this._unlock);
    globalThis.removeEventListener?.("keydown", this._unlock);
    this.windSource?.stop?.();
    this.context?.close?.();
    this.context = null;
  }
}
