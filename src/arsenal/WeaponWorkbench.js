// Weapon workbench — the live browser tool: a left-side control panel (vanilla DOM,
// mirroring ProceduralPanel's helpers + theme) over a turntable preview. Owns a
// WeaponGenerator; any change rebuilds the weapon (disposing the previous one first).
// Rendering/turntable advance is driven by arsenalMain's loop via update(dt, elapsed).

import { WeaponGenerator } from "./WeaponGenerator.js";
import { createWeaponConfig, rollConfig, PARAM_RANGES, WEAPON_TYPES } from "./WeaponConfig.js";
import { WEAPON_PRESETS } from "./WeaponPresets.js";
import { hashSeed } from "./WeaponSeed.js";
import { weaponAssetId } from "./WeaponRecipe.js";
import { weaponIdentity } from "./WeaponIdentity.js";

// Cross-entry handoff: /arsenal.html writes world-asset JSON to this localStorage key;
// the world app drains it on load. Keeps the two entries decoupled (no shared imports).
const HANDOFF_KEY = "arsenal-export-queue";
const HANDOFF_MAX = 64;

const PARAM_KEYS = Object.keys(PARAM_RANGES);

export class WeaponWorkbench {
  constructor() {
    this.generator = new WeaponGenerator();
    this.group = this.generator.group;
    this.config = rollConfig("arsenal-1", "sidearm");
    this.turntable = true;
    this.exploded = 0;
    this.wireframe = false;
    this.glow = true;
    this._spin = 0;
    this._rollN = 0;
    this._sliders = {};
    this._lastRecipe = null;
    this._buildDOM();
    this._rebuild();
  }

  // Loop hook: advance the energy shader + turntable.
  update(dt, elapsed) {
    this.generator.update(elapsed);
    if (this.turntable) {
      this._spin += dt * 0.6;
      this.group.rotation.y = this._spin;
    }
  }

  snapshot() {
    const id = this._lastRecipe ? weaponIdentity(this._lastRecipe) : null;
    return {
      type: this.config.type,
      recipe: this._lastRecipe ? { type: this._lastRecipe.type, family: this._lastRecipe.family, rarity: this._lastRecipe.rarity, counts: this._lastRecipe.counts } : null,
      name: id?.name ?? null,
      tier: id?.tier ?? null,
      meshCount: this.generator.stats.parts,
      triangles: this.generator.stats.triangles,
      vertices: this.generator.stats.vertices,
    };
  }

  // --- core actions ----------------------------------------------------------------

  _rebuild() {
    this.config = createWeaponConfig(this.config);
    const recipe = this.generator.build(this.config);
    this.generator.setExploded(this.exploded);
    this.generator.setWireframe(this.wireframe);
    this.generator.setGlow(this.glow);
    this._lastRecipe = recipe;
    this._syncStatus(recipe);
  }

  // Re-roll all params from the current seed+type, refresh the sliders, rebuild.
  _reroll(seed = this.config.seed, type = this.config.type) {
    this.config = rollConfig(seed, type);
    this.seedInput.value = this.config.seed;
    this.typeSelect.value = this.config.type;
    for (const key of PARAM_KEYS) this._setSlider(key, this.config[key]);
    this._rebuild();
  }

  _randomize() {
    this._rollN++;
    const seed = "wpn-" + (hashSeed(`roll:${this.config.seed}:${this._rollN}`) % 1_000_000).toString(36);
    this._reroll(seed, this.config.type);
  }

  _copyRecipe() {
    this._copyText(JSON.stringify(this._lastRecipe, null, 2), "recipe copied");
  }

  // The world-asset handoff descriptor: kind + deterministic id + recipe + identity
  // transform (the world grounds it on terrain at placement time).
  _worldAsset() {
    return {
      kind: "generated.weapon",
      id: weaponAssetId(this._lastRecipe),
      recipe: this._lastRecipe,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    };
  }

  _sendToWorld() {
    try {
      const store = globalThis.localStorage;
      if (!store) return this._flash("storage unavailable");
      const queue = JSON.parse(store.getItem(HANDOFF_KEY) ?? "[]");
      queue.push(this._worldAsset());
      store.setItem(HANDOFF_KEY, JSON.stringify(queue.slice(-HANDOFF_MAX)));
      this._flash(`sent to world (${Math.min(queue.length, HANDOFF_MAX)})`);
    } catch {
      this._flash("send failed");
    }
  }

  _copyWorldAsset() {
    this._copyText(JSON.stringify(this._worldAsset(), null, 2), "world JSON copied");
  }

  _copyText(text, okMsg) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => this._flash(okMsg), () => this._flash("copy blocked"));
    } else {
      this._flash("clipboard unavailable");
    }
  }

  // --- DOM -------------------------------------------------------------------------

  _buildDOM() {
    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      position: "fixed", left: "0", top: "0", bottom: "0", width: "320px", zIndex: "35",
      display: "flex", flexDirection: "column", gap: "10px", padding: "16px",
      color: "#d7e6dc", background: "rgba(8, 13, 11, 0.92)",
      borderRight: "1px solid rgba(120,200,140,0.24)", backdropFilter: "blur(8px)",
      font: '12px "SF Mono", ui-monospace, Menlo, Consolas, monospace', overflowY: "auto",
    });

    const title = document.createElement("div");
    title.textContent = "ARSENAL LAB";
    Object.assign(title.style, { letterSpacing: ".16em", color: "#7fdca0", marginBottom: "2px" });
    this.root.appendChild(title);

    this.seedInput = this._text(this.config.seed, () => this._reroll(this.seedInput.value, this.typeSelect.value));
    this.root.appendChild(this._labeled("Seed", this.seedInput).wrap);

    this.typeSelect = this._select(WEAPON_TYPES, this.config.type, () => this._reroll(this.seedInput.value, this.typeSelect.value));
    this.root.appendChild(this._labeled("Type", this.typeSelect).wrap);

    this.presetSelect = this._select(["— preset —", ...WEAPON_PRESETS.map((p) => p.name)], "— preset —", () => {
      const p = WEAPON_PRESETS.find((x) => x.name === this.presetSelect.value);
      if (p) this._reroll(p.seed, p.type);
      this.presetSelect.value = "— preset —";
    });
    this.root.appendChild(this._labeled("Preset", this.presetSelect).wrap);

    // Sliders, one per tunable param.
    for (const key of PARAM_KEYS) this.root.appendChild(this._slider(key));

    // Action buttons.
    const actions = document.createElement("div");
    Object.assign(actions.style, { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginTop: "4px" });
    actions.appendChild(this._button("⟳ Randomize", () => this._randomize()));
    actions.appendChild(this._button("Copy recipe", () => this._copyRecipe()));
    this.root.appendChild(actions);

    // World handoff: queue the current weapon for the world app, or copy its world-asset
    // JSON for manual import. Decoupled — just a recipe + transform, no shared code.
    const handoff = document.createElement("div");
    Object.assign(handoff.style, { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" });
    handoff.appendChild(this._button("→ Send to World", () => this._sendToWorld()));
    handoff.appendChild(this._button("Copy world JSON", () => this._copyWorldAsset()));
    this.root.appendChild(handoff);

    // Toggles.
    const toggles = document.createElement("div");
    Object.assign(toggles.style, { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" });
    toggles.appendChild(this._toggle("Turntable", this.turntable, (v) => { this.turntable = v; if (!v) { this._spin = this.group.rotation.y; } }));
    toggles.appendChild(this._toggle("Wireframe", this.wireframe, (v) => { this.wireframe = v; this.generator.setWireframe(v); }));
    toggles.appendChild(this._toggle("Glow", this.glow, (v) => { this.glow = v; this.generator.setGlow(v); }));
    toggles.appendChild(this._toggle("Exploded", false, (v) => { this.exploded = v ? 1.1 : 0; this.generator.setExploded(this.exploded); }));
    this.root.appendChild(toggles);

    this.statusEl = document.createElement("div");
    Object.assign(this.statusEl.style, { color: "#8fa899", fontSize: "10px", lineHeight: "1.6", marginTop: "auto", paddingTop: "8px", borderTop: "1px solid rgba(120,200,140,0.16)" });
    this.root.appendChild(this.statusEl);

    document.body.appendChild(this.root);
  }

  _syncStatus(recipe) {
    if (!recipe) return;
    const s = this.generator.stats;
    const id = weaponIdentity(recipe);
    this.statusEl.textContent =
      `${id.name}\n` +
      `${recipe.type} · ${recipe.family} · ${recipe.rarity} · tier ${id.tier} · #${id.hash.toString(36)}\n` +
      `parts ${s.parts} (energy ${s.energy}) · ${s.triangles} tris · ${s.vertices} verts`;
  }

  _flash(msg) {
    const prev = this.statusEl.textContent;
    this.statusEl.textContent = msg;
    window.setTimeout(() => { if (this._lastRecipe) this._syncStatus(this._lastRecipe); else this.statusEl.textContent = prev; }, 1100);
  }

  _setSlider(key, value) {
    const s = this._sliders[key];
    if (!s) return;
    s.input.value = value;
    s.valueEl.textContent = PARAM_RANGES[key].int ? String(Math.round(value)) : Number(value).toFixed(2);
  }

  _slider(key) {
    const r = PARAM_RANGES[key];
    const wrap = document.createElement("label");
    Object.assign(wrap.style, { display: "grid", gridTemplateColumns: "84px 1fr 34px", gap: "8px", alignItems: "center" });
    const label = document.createElement("span");
    label.textContent = r.label;
    Object.assign(label.style, { color: "#8fa899", fontSize: "11px" });
    const input = document.createElement("input");
    input.type = "range";
    input.min = r.min;
    input.max = r.max;
    input.step = r.step;
    input.value = this.config[key];
    input.style.width = "100%";
    const valueEl = document.createElement("span");
    Object.assign(valueEl.style, { color: "#d7e6dc", fontSize: "10px", textAlign: "right" });
    valueEl.textContent = r.int ? String(this.config[key]) : Number(this.config[key]).toFixed(2);
    input.addEventListener("input", () => {
      const v = r.int ? Math.round(Number(input.value)) : Number(input.value);
      this.config[key] = v;
      valueEl.textContent = r.int ? String(v) : v.toFixed(2);
      this._rebuild();
    });
    this._sliders[key] = { input, valueEl };
    wrap.appendChild(label);
    wrap.appendChild(input);
    wrap.appendChild(valueEl);
    return wrap;
  }

  _text(value, onChange) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    this._inputStyle(input);
    input.addEventListener("change", onChange);
    return input;
  }

  _select(options, value, onChange) {
    const select = document.createElement("select");
    this._inputStyle(select);
    for (const opt of options) {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      select.appendChild(o);
    }
    select.value = value;
    select.addEventListener("change", onChange);
    return select;
  }

  _button(label, onClick) {
    const b = document.createElement("button");
    b.textContent = label;
    Object.assign(b.style, {
      cursor: "pointer", font: "inherit", fontSize: "11px", padding: "8px",
      color: "#d7e6dc", background: "rgba(127,220,160,0.08)",
      border: "1px solid rgba(120,200,140,0.25)", borderRadius: "7px",
    });
    b.addEventListener("click", onClick);
    return b;
  }

  _toggle(label, initial, onChange) {
    const b = document.createElement("button");
    let on = !!initial;
    const paint = () => {
      b.textContent = `${on ? "●" : "○"} ${label}`;
      b.style.color = on ? "#7fdca0" : "#8fa899";
      b.style.background = on ? "rgba(127,220,160,0.14)" : "rgba(127,220,160,0.04)";
    };
    Object.assign(b.style, { cursor: "pointer", font: "inherit", fontSize: "11px", padding: "7px 8px", border: "1px solid rgba(120,200,140,0.25)", borderRadius: "7px" });
    b.addEventListener("click", () => { on = !on; paint(); onChange(on); });
    paint();
    return b;
  }

  _labeled(label, control) {
    const wrap = document.createElement("label");
    Object.assign(wrap.style, { display: "grid", gridTemplateColumns: "84px 1fr", gap: "8px", alignItems: "center" });
    const span = document.createElement("span");
    span.textContent = label;
    Object.assign(span.style, { color: "#8fa899", fontSize: "11px" });
    wrap.appendChild(span);
    wrap.appendChild(control);
    return { wrap };
  }

  _inputStyle(el) {
    Object.assign(el.style, {
      width: "100%", font: "inherit", fontSize: "11px", padding: "6px 8px",
      color: "#d7e6dc", background: "rgba(127,220,160,0.08)",
      border: "1px solid rgba(120,200,140,0.25)", borderRadius: "7px",
    });
  }

  dispose() {
    this.generator.dispose();
    this.root?.remove();
  }
}
