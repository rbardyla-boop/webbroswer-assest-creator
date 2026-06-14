// Per-object particle emitter editor. Author a kind (spark/dust/smoke) + its
// parameters on the selected object. Presentation + intent only — the host
// sanitizes, stores onto object.userData.particles, and reloads the live preview.

const KINDS = [
  ["none", "None"],
  ["spark", "Sparks"],
  ["dust", "Dust"],
  ["smoke", "Smoke"],
];

export class ParticlePanel {
  constructor({ onChange } = {}) {
    this.onChange = onChange;
    this.object = null;

    this.root = document.createElement("div");
    Object.assign(this.root.style, { display: "flex", flexDirection: "column", gap: "7px" });

    this.info = document.createElement("div");
    Object.assign(this.info.style, { color: "#8fa899", fontSize: "10px", minHeight: "12px" });
    this.root.appendChild(this.info);

    this.kind = this._select(KINDS);
    this.root.appendChild(this._labeled("Kind", this.kind));

    this.rate = this._number(16, 1);
    this.max = this._number(180, 10);
    this.lifetime = this._number(2.4, 0.1);
    this.size = this._number(0.6, 0.05);
    this.sizeEnd = this._number(0.8, 0.05);
    this.color = this._color("#cbb892");
    this.colorEnd = this._color("#3b3f47");
    this.speed = this._number(1.2, 0.1);
    this.spread = this._number(0.5, 0.05);
    this.gravity = this._number(0, 0.1);
    this.emitRadius = this._number(0.3, 0.05);
    this.opacity = this._number(0.6, 0.05);

    this.fields = [
      this._labeled("Rate/s", this.rate),
      this._labeled("Max", this.max),
      this._labeled("Lifetime", this.lifetime),
      this._labeled("Size", this.size),
      this._labeled("Size end", this.sizeEnd),
      this._labeled("Color", this.color),
      this._labeled("Color end", this.colorEnd),
      this._labeled("Speed", this.speed),
      this._labeled("Spread", this.spread),
      this._labeled("Gravity", this.gravity),
      this._labeled("Emit radius", this.emitRadius),
      this._labeled("Opacity", this.opacity),
    ];
    for (const row of this.fields) this.root.appendChild(row);

    for (const control of [
      this.kind, this.rate, this.max, this.lifetime, this.size, this.sizeEnd,
      this.color, this.colorEnd, this.speed, this.spread, this.gravity, this.emitRadius, this.opacity,
    ]) {
      control.addEventListener("change", () => this._emit());
    }
    this.kind.addEventListener("change", () => this._showFields(this.kind.value !== "none"));

    this.setObject(null);
  }

  setObject(object) {
    if (object === this.object) return;
    this.object = object;
    if (!object) {
      this.info.textContent = "No object selected.";
      this.kind.disabled = true;
      this._showFields(false);
      return;
    }
    this.kind.disabled = false;
    const p = object.userData?.particles ?? null;
    this.kind.value = p?.kind ?? "none";
    if (p) {
      this.rate.value = p.rate;
      this.max.value = p.max;
      this.lifetime.value = p.lifetime;
      this.size.value = p.size;
      this.sizeEnd.value = p.sizeEnd;
      this.color.value = p.color;
      this.colorEnd.value = p.colorEnd;
      this.speed.value = p.speed;
      this.spread.value = p.spread;
      this.gravity.value = p.gravity;
      this.emitRadius.value = p.emitRadius;
      this.opacity.value = p.opacity;
    }
    this.info.textContent = p ? `Emitter: ${p.kind}` : "Tag this object with a particle emitter.";
    this._showFields(!!p);
  }

  // Raw shape from current controls; host sanitizes. Role "none" → null.
  getParticles() {
    if (this.kind.value === "none") return null;
    return {
      kind: this.kind.value,
      rate: num(this.rate.value, 16),
      max: num(this.max.value, 180),
      lifetime: num(this.lifetime.value, 2.4),
      size: num(this.size.value, 0.6),
      sizeEnd: num(this.sizeEnd.value, 0.8),
      color: this.color.value,
      colorEnd: this.colorEnd.value,
      speed: num(this.speed.value, 1.2),
      spread: num(this.spread.value, 0.5),
      gravity: num(this.gravity.value, 0),
      emitRadius: num(this.emitRadius.value, 0.3),
      opacity: num(this.opacity.value, 0.6),
    };
  }

  _emit() {
    if (!this.object) return;
    this.onChange?.(this.getParticles());
  }

  _showFields(on) {
    for (const row of this.fields) row.style.display = on ? "grid" : "none";
  }

  // --- DOM helpers ------------------------------------------------------------

  _select(options) {
    const select = document.createElement("select");
    this._inputStyle(select);
    for (const [value, label] of options) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    }
    return select;
  }

  _color(value) {
    const input = document.createElement("input");
    input.type = "color";
    input.value = value;
    Object.assign(input.style, { width: "100%", height: "24px", padding: "0", background: "transparent", border: "1px solid rgba(120,200,140,0.25)", borderRadius: "6px", cursor: "pointer" });
    return input;
  }

  _number(value, step) {
    const input = document.createElement("input");
    input.type = "number";
    input.step = step;
    input.value = value;
    this._inputStyle(input);
    return input;
  }

  _labeled(label, control) {
    const wrap = document.createElement("label");
    Object.assign(wrap.style, { display: "none", gridTemplateColumns: "78px 1fr", gap: "8px", alignItems: "center" });
    const span = document.createElement("span");
    span.textContent = label;
    Object.assign(span.style, { color: "#8fa899", fontSize: "11px" });
    wrap.appendChild(span);
    wrap.appendChild(control);
    return wrap;
  }

  _inputStyle(el) {
    Object.assign(el.style, {
      width: "100%", font: "inherit", fontSize: "11px", padding: "6px 8px",
      color: "#d7e6dc", background: "rgba(127,220,160,0.08)", border: "1px solid rgba(120,200,140,0.25)", borderRadius: "7px",
    });
  }
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
