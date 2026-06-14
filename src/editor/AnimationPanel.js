// Per-object animation inspector for animated GLB assets. Lets the author pick a
// clip + autoplay/loop/speed for the selected object and preview it in-editor.
// Presentation + intent only — the host owns the AnimationPreview mixer and
// writes the override onto the object.

import { clampPlaybackSpeed } from "../animation/AnimationTypes.js";

export class AnimationPanel {
  constructor({ onChange, onPlay, onStop } = {}) {
    this.onChange = onChange;
    this.onPlay = onPlay;
    this.onStop = onStop;
    this.object = null;

    this.root = document.createElement("div");
    Object.assign(this.root.style, { display: "flex", flexDirection: "column", gap: "7px" });

    this.info = document.createElement("div");
    Object.assign(this.info.style, { color: "#8fa899", fontSize: "10px", minHeight: "12px" });
    this.root.appendChild(this.info);

    this.clipSelect = this._select();
    this.root.appendChild(this._labeled("Clip", this.clipSelect));

    this.speedInput = this._number(1, 0.1);
    this.root.appendChild(this._labeled("Speed", this.speedInput));

    const toggles = document.createElement("div");
    Object.assign(toggles.style, { display: "flex", gap: "12px", flexWrap: "wrap" });
    this.autoplay = this._checkbox("Autoplay");
    this.loop = this._checkbox("Loop");
    toggles.appendChild(this.autoplay.label);
    toggles.appendChild(this.loop.label);
    this.root.appendChild(toggles);

    const buttons = document.createElement("div");
    Object.assign(buttons.style, { display: "flex", gap: "6px", flexWrap: "wrap" });
    this.playButton = this._button("▶ Preview", () => this.onPlay?.());
    this.stopButton = this._button("■ Stop", () => this.onStop?.());
    buttons.appendChild(this.playButton);
    buttons.appendChild(this.stopButton);
    this.root.appendChild(buttons);

    this.clipSelect.addEventListener("change", () => this._emit());
    this.speedInput.addEventListener("change", () => this._emit());
    this.autoplay.input.addEventListener("change", () => this._emit());
    this.loop.input.addEventListener("change", () => this._emit());

    this.setObject(null);
  }

  // Show controls for an object whose asset advertises animation clips.
  setObject(object) {
    // Skip the (DOM-churning) rebuild when re-inspecting the same object, e.g.
    // the per-tick refresh during a transform drag.
    if (object === this.object) return;
    this.object = object;
    const assetAnimation = object?.userData?.assetAnimation ?? null;
    const clips = assetAnimation?.clips ?? [];
    const enabled = clips.length > 0;

    this._setEnabled(enabled);
    if (!enabled) {
      this.info.textContent = object?.userData?.asset?.type === "gltf" ? "GLB has no animation clips." : "Selected object is not an animated asset.";
      this.clipSelect.replaceChildren();
      return;
    }

    this.info.textContent = `${clips.length} clip${clips.length === 1 ? "" : "s"}` + (assetAnimation.hasSkeleton ? " · rigged" : "");
    const override = object.userData.animation ?? {};
    this.clipSelect.replaceChildren();
    const def = document.createElement("option");
    def.value = "";
    def.textContent = `(default: ${assetAnimation.defaultClip ?? clips[0]?.name ?? "—"})`;
    this.clipSelect.appendChild(def);
    for (const clip of clips) {
      const option = document.createElement("option");
      option.value = clip.name;
      option.textContent = `${clip.name} (${clip.duration.toFixed(2)}s)`;
      this.clipSelect.appendChild(option);
    }
    this.clipSelect.value = override.clip ?? "";
    this.speedInput.value = Number.isFinite(override.playbackSpeed) ? override.playbackSpeed : 1;
    this.autoplay.input.checked = override.autoplay !== false;
    this.loop.input.checked = override.loop !== false;
  }

  // Build the override object from the current control values.
  getOverride() {
    return {
      clip: this.clipSelect.value || null,
      autoplay: this.autoplay.input.checked,
      loop: this.loop.input.checked,
      playbackSpeed: clampPlaybackSpeed(parseFloat(this.speedInput.value)),
      startOffset: 0,
    };
  }

  _emit() {
    if (!this.object) return;
    this.onChange?.(this.getOverride());
  }

  _setEnabled(enabled) {
    for (const el of [this.clipSelect, this.speedInput, this.autoplay.input, this.loop.input, this.playButton, this.stopButton]) {
      el.disabled = !enabled;
      el.style.opacity = enabled ? "1" : "0.5";
    }
  }

  _select() {
    const select = document.createElement("select");
    Object.assign(select.style, {
      width: "100%",
      font: "inherit",
      fontSize: "11px",
      padding: "6px 8px",
      color: "#d7e6dc",
      background: "rgba(127,220,160,0.08)",
      border: "1px solid rgba(120,200,140,0.25)",
      borderRadius: "7px",
    });
    return select;
  }

  _number(value, step) {
    const input = document.createElement("input");
    input.type = "number";
    input.step = step;
    input.value = value;
    Object.assign(input.style, {
      width: "100%",
      font: "inherit",
      fontSize: "11px",
      padding: "6px 8px",
      color: "#d7e6dc",
      background: "rgba(127,220,160,0.08)",
      border: "1px solid rgba(120,200,140,0.25)",
      borderRadius: "7px",
    });
    return input;
  }

  _checkbox(label) {
    const input = document.createElement("input");
    input.type = "checkbox";
    const wrap = document.createElement("label");
    Object.assign(wrap.style, { display: "flex", alignItems: "center", gap: "6px", color: "#8fa899", fontSize: "11px" });
    wrap.appendChild(input);
    wrap.appendChild(document.createTextNode(label));
    return { input, label: wrap };
  }

  _labeled(label, control) {
    const wrap = document.createElement("label");
    Object.assign(wrap.style, { display: "grid", gridTemplateColumns: "54px 1fr", gap: "8px", alignItems: "center" });
    const span = document.createElement("span");
    span.textContent = label;
    span.style.color = "#8fa899";
    span.style.fontSize = "11px";
    wrap.appendChild(span);
    wrap.appendChild(control);
    return wrap;
  }

  _button(label, onClick) {
    const button = document.createElement("button");
    button.textContent = label;
    Object.assign(button.style, {
      cursor: "pointer",
      font: "inherit",
      fontSize: "11px",
      padding: "6px 10px",
      color: "#d7e6dc",
      background: "rgba(127,220,160,0.08)",
      border: "1px solid rgba(120,200,140,0.25)",
      borderRadius: "7px",
    });
    button.addEventListener("click", onClick);
    return button;
  }
}
