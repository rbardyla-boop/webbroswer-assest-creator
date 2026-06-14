// Global lighting editor: sun (color/intensity/azimuth/elevation/shadow),
// hemisphere fill (sky/ground/intensity), and distance fog (color/near/far/on).
// Presentation + intent only — the host sanitizes, applies live, and persists the
// result into the world document.

export class LightingPanel {
  constructor({ onChange } = {}) {
    this.onChange = onChange;

    this.root = document.createElement("div");
    Object.assign(this.root.style, { display: "flex", flexDirection: "column", gap: "7px" });

    // Sun
    this.sunColor = this._color("#fff1d8");
    this.sunIntensity = this._number(2.6, 0.1);
    this.sunAzimuth = this._number(34, 1);
    this.sunElevation = this._number(51, 1);
    this.sunShadow = this._checkbox("Sun shadows", true);

    // Hemisphere
    this.skyColor = this._color("#bfe0ff");
    this.groundColor = this._color("#4a5236");
    this.hemiIntensity = this._number(0.85, 0.05);

    // Fog
    this.fogColor = this._color("#9fc4d8");
    this.fogNear = this._number(70, 1);
    this.fogFar = this._number(225, 1);
    this.fogEnabled = this._checkbox("Fog", true);

    this.root.appendChild(this._heading("Sun"));
    this.root.appendChild(this._labeled("Color", this.sunColor));
    this.root.appendChild(this._labeled("Intensity", this.sunIntensity));
    this.root.appendChild(this._labeled("Azimuth°", this.sunAzimuth));
    this.root.appendChild(this._labeled("Elevation°", this.sunElevation));
    this.root.appendChild(this.sunShadow.label);

    this.root.appendChild(this._heading("Hemisphere"));
    this.root.appendChild(this._labeled("Sky", this.skyColor));
    this.root.appendChild(this._labeled("Ground", this.groundColor));
    this.root.appendChild(this._labeled("Intensity", this.hemiIntensity));

    this.root.appendChild(this._heading("Fog"));
    this.root.appendChild(this._labeled("Color", this.fogColor));
    this.root.appendChild(this._labeled("Near", this.fogNear));
    this.root.appendChild(this._labeled("Far", this.fogFar));
    this.root.appendChild(this.fogEnabled.label);

    for (const control of [
      this.sunColor, this.sunIntensity, this.sunAzimuth, this.sunElevation, this.sunShadow.input,
      this.skyColor, this.groundColor, this.hemiIntensity,
      this.fogColor, this.fogNear, this.fogFar, this.fogEnabled.input,
    ]) {
      control.addEventListener("input", () => this._emit());
      control.addEventListener("change", () => this._emit());
    }
  }

  setLighting(lighting) {
    if (!lighting) return;
    this.sunColor.value = lighting.sun.color;
    this.sunIntensity.value = lighting.sun.intensity;
    this.sunAzimuth.value = lighting.sun.azimuth;
    this.sunElevation.value = lighting.sun.elevation;
    this.sunShadow.input.checked = lighting.sun.castShadow;
    this.skyColor.value = lighting.hemisphere.skyColor;
    this.groundColor.value = lighting.hemisphere.groundColor;
    this.hemiIntensity.value = lighting.hemisphere.intensity;
    this.fogColor.value = lighting.fog.color;
    this.fogNear.value = lighting.fog.near;
    this.fogFar.value = lighting.fog.far;
    this.fogEnabled.input.checked = lighting.fog.enabled;
  }

  getLighting() {
    return {
      sun: {
        color: this.sunColor.value,
        intensity: num(this.sunIntensity.value, 2.6),
        azimuth: num(this.sunAzimuth.value, 34),
        elevation: num(this.sunElevation.value, 51),
        castShadow: this.sunShadow.input.checked,
      },
      hemisphere: {
        skyColor: this.skyColor.value,
        groundColor: this.groundColor.value,
        intensity: num(this.hemiIntensity.value, 0.85),
      },
      fog: {
        color: this.fogColor.value,
        near: num(this.fogNear.value, 70),
        far: num(this.fogFar.value, 225),
        enabled: this.fogEnabled.input.checked,
      },
    };
  }

  _emit() {
    this.onChange?.(this.getLighting());
  }

  // --- DOM helpers ------------------------------------------------------------

  _heading(text) {
    const el = document.createElement("div");
    el.textContent = text;
    Object.assign(el.style, { color: "#8fa899", fontSize: "11px", marginTop: "4px" });
    return el;
  }

  _color(value) {
    const input = document.createElement("input");
    input.type = "color";
    input.value = value;
    Object.assign(input.style, { width: "100%", height: "26px", padding: "0", background: "transparent", border: "1px solid rgba(120,200,140,0.25)", borderRadius: "6px", cursor: "pointer" });
    return input;
  }

  _number(value, step) {
    const input = document.createElement("input");
    input.type = "number";
    input.step = step;
    input.value = value;
    Object.assign(input.style, {
      width: "100%", font: "inherit", fontSize: "11px", padding: "6px 8px",
      color: "#d7e6dc", background: "rgba(127,220,160,0.08)", border: "1px solid rgba(120,200,140,0.25)", borderRadius: "7px",
    });
    return input;
  }

  _checkbox(label, checked) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    const wrap = document.createElement("label");
    Object.assign(wrap.style, { display: "flex", alignItems: "center", gap: "6px", color: "#8fa899", fontSize: "11px" });
    wrap.appendChild(input);
    wrap.appendChild(document.createTextNode(label));
    return { input, label: wrap };
  }

  _labeled(label, control) {
    const wrap = document.createElement("label");
    Object.assign(wrap.style, { display: "grid", gridTemplateColumns: "74px 1fr", gap: "8px", alignItems: "center" });
    const span = document.createElement("span");
    span.textContent = label;
    Object.assign(span.style, { color: "#8fa899", fontSize: "11px" });
    wrap.appendChild(span);
    wrap.appendChild(control);
    return wrap;
  }
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
