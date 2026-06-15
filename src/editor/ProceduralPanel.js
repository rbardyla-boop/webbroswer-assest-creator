// Editor "Procedural" panel (Stage 17C). A SYSTEM panel (like Grass/Bushes/Terrain)
// — it applies directly, it is not a spatial-edit action. It drives a generator
// instance through the host's WorldObjectManager: Generate / Regenerate emit normal
// WorldDocument objects tagged with the instance id; Clear removes them; Lock
// detaches them from the generator so they become permanent hand-editable objects.
//
// The generator itself holds NO scene authority — everything here flows through
// addWorldObjects/removeWorldObjects, so generated content uses the same lighting,
// material, collision, and visibility systems as any placed object.

import { createCityConfig, createGeneratorInstance, CITY_STYLES, GENERATOR_LIMITS } from "../generators/GeneratorConfig.js";
import { generateCityLayout } from "../generators/CityLayout.js";
import { cityLayoutToWorldObjects } from "../generators/cityEmitter.js";

const INSTANCE_ID = "gen-city";

export class ProceduralPanel {
  constructor({ getManager, getDocument, onChanged } = {}) {
    this.getManager = typeof getManager === "function" ? getManager : () => null;
    this.getDocument = typeof getDocument === "function" ? getDocument : () => null;
    this.onChanged = onChanged;
    this.instanceId = INSTANCE_ID;
    this._buildDOM();
  }

  // --- workflow ---------------------------------------------------------------

  async generate() {
    const manager = this.getManager();
    if (!manager) return;
    // Replace whatever this instance currently owns.
    manager.removeWorldObjects(manager.objectsByGeneratorId(this.instanceId));

    const config = this._readConfig();
    const layout = generateCityLayout(config);
    const descriptors = cityLayoutToWorldObjects(layout, this.instanceId);
    await manager.addWorldObjects(descriptors);

    this._recordInstance(config);
    this._setStatus(`Generated ${descriptors.length} objects · ${layout.counts.buildings} buildings, ${layout.counts.roads} streets, ${layout.counts.props} trees.`);
    this.onChanged?.();
  }

  // Pick a fresh seed and regenerate (authoring-only randomness; generation from
  // the chosen seed stays fully deterministic).
  async regenerate() {
    const base = this.seedInput.value.replace(/-\d+$/, "") || "city";
    this.seedInput.value = `${base}-${1000 + Math.floor((this._tick = (this._tick ?? 0) + 1) * 1733) % 9000}`;
    await this.generate();
  }

  clear() {
    const manager = this.getManager();
    if (!manager) return;
    const removed = manager.removeWorldObjects(manager.objectsByGeneratorId(this.instanceId));
    this._forgetInstance();
    this._setStatus(removed ? `Cleared ${removed} generated objects.` : "Nothing to clear.");
    this.onChanged?.();
  }

  // Detach the generated objects from the generator: they stay in the world as
  // permanent, normal, hand-editable objects; the instance is removed.
  lock() {
    const manager = this.getManager();
    if (!manager) return;
    const owned = manager.objectsByGeneratorId(this.instanceId);
    for (const object of owned) object.userData.generatorId = null;
    this._forgetInstance();
    this._setStatus(owned.length ? `Locked ${owned.length} objects — now permanent.` : "No generated objects to lock.");
    this.onChanged?.();
  }

  // Restore panel inputs from a loaded world's stored generator instance.
  setFromDocument(document) {
    const instances = document?.generators?.instances ?? [];
    const inst = instances.find((i) => i.id === this.instanceId) ?? instances.find((i) => i.type === "city");
    if (inst?.config) {
      this.instanceId = inst.id ?? INSTANCE_ID;
      this.seedInput.value = inst.config.seed;
      this.styleSelect.value = inst.config.style;
      this.blocksInput.value = inst.config.blocks;
      this.densityInput.value = inst.config.density;
    }
    const manager = this.getManager();
    const owned = manager ? manager.objectsByGeneratorId(this.instanceId).length : 0;
    this._setStatus(owned ? `${owned} live generated objects.` : "Set seed/style, then Generate.");
  }

  // --- internals --------------------------------------------------------------

  _readConfig() {
    return createCityConfig({
      seed: this.seedInput.value,
      style: this.styleSelect.value,
      blocks: parseInt(this.blocksInput.value, 10),
      density: parseFloat(this.densityInput.value),
      origin: { x: 0, z: 0 },
    });
  }

  _recordInstance(config) {
    const document = this.getDocument();
    if (!document) return;
    document.generators = document.generators ?? { instances: [] };
    const others = (document.generators.instances ?? []).filter((i) => i.id !== this.instanceId);
    document.generators.instances = [createGeneratorInstance({ id: this.instanceId, type: "city", config }), ...others];
  }

  _forgetInstance() {
    const document = this.getDocument();
    if (document?.generators) {
      document.generators.instances = (document.generators.instances ?? []).filter((i) => i.id !== this.instanceId);
    }
  }

  _buildDOM() {
    this.root = document.createElement("div");
    Object.assign(this.root.style, { display: "grid", gap: "8px" });

    this.seedInput = this._text("city-1");
    this.styleSelect = this._select(CITY_STYLES);
    this.blocksInput = this._number(4, 1, GENERATOR_LIMITS.MIN_BLOCKS, GENERATOR_LIMITS.MAX_BLOCKS);
    this.densityInput = this._number(0.6, 0.05, 0, 1);

    this.root.appendChild(this._labeled("Seed", this.seedInput));
    this.root.appendChild(this._labeled("Style", this.styleSelect));
    this.root.appendChild(this._labeled("Blocks", this.blocksInput));
    this.root.appendChild(this._labeled("Density", this.densityInput));

    const buttons = document.createElement("div");
    Object.assign(buttons.style, { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" });
    buttons.appendChild(this._button("Generate", () => this.generate()));
    buttons.appendChild(this._button("Regenerate", () => this.regenerate()));
    buttons.appendChild(this._button("Lock", () => this.lock()));
    buttons.appendChild(this._button("Clear", () => this.clear()));
    this.root.appendChild(buttons);

    this.statusEl = document.createElement("div");
    Object.assign(this.statusEl.style, { color: "#8fa899", fontSize: "10px", whiteSpace: "pre-line", minHeight: "12px" });
    this.root.appendChild(this.statusEl);
    this._setStatus("Set seed/style, then Generate.");
  }

  _setStatus(text) {
    this.statusEl.textContent = text;
  }

  // --- DOM helpers ------------------------------------------------------------

  _text(value) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    this._inputStyle(input);
    return input;
  }

  _number(value, step, min, max) {
    const input = document.createElement("input");
    input.type = "number";
    input.step = step;
    input.value = value;
    if (min !== undefined) input.min = min;
    if (max !== undefined) input.max = max;
    this._inputStyle(input);
    return input;
  }

  _select(options) {
    const select = document.createElement("select");
    this._inputStyle(select);
    for (const value of options) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    }
    return select;
  }

  _button(label, onClick) {
    const button = document.createElement("button");
    button.textContent = label;
    Object.assign(button.style, {
      cursor: "pointer", font: "inherit", fontSize: "11px", padding: "7px 8px",
      color: "#d7e6dc", background: "rgba(127,220,160,0.08)", border: "1px solid rgba(120,200,140,0.25)", borderRadius: "7px",
    });
    button.addEventListener("click", onClick);
    return button;
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

  _inputStyle(el) {
    Object.assign(el.style, {
      width: "100%", font: "inherit", fontSize: "11px", padding: "6px 8px",
      color: "#d7e6dc", background: "rgba(127,220,160,0.08)", border: "1px solid rgba(120,200,140,0.25)", borderRadius: "7px",
    });
  }
}
