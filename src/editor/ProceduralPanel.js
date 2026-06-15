// Editor "Procedural" panel (Stage 17C / 18). A SYSTEM panel (like Grass/Bushes/
// Terrain) — it applies directly, it is not a spatial-edit action. It drives a
// generator instance through the host's WorldObjectManager: Generate / Regenerate
// emit normal WorldDocument objects tagged with the instance id; Clear removes
// them; Lock detaches them from the generator so they become permanent objects.
//
// Stage 18: the panel is data-driven off the GeneratorRegistry. A Type dropdown
// picks city / camp / ruin / forest; the style options, the generic "amount" dial,
// and the prefab source slots all reconfigure from the registry entry. Each type
// has its own instance id (`gen-<type>`), so a city and a camp can coexist in one
// world and be regenerated/cleared independently.
//
// The generator itself holds NO scene authority — everything flows through
// addWorldObjects/removeWorldObjects, so generated content uses the same lighting,
// material, collision, interaction, and visibility systems as any placed object.

import { GENERATORS, GENERATOR_LIST, getGenerator, generateGeneratorObjects } from "../generators/GeneratorRegistry.js";
import { createGeneratorInstance } from "../generators/GeneratorConfig.js";
import { validatePlacement } from "../generators/PlacementValidator.js";

export class ProceduralPanel {
  constructor({ getManager, getDocument, getPrefab, listPrefabs, onChanged } = {}) {
    this.getManager = typeof getManager === "function" ? getManager : () => null;
    this.getDocument = typeof getDocument === "function" ? getDocument : () => null;
    this.getPrefab = typeof getPrefab === "function" ? getPrefab : () => null;
    this.listPrefabs = typeof listPrefabs === "function" ? listPrefabs : () => [];
    this.onChanged = onChanged;
    this.activeType = "city";
    this.instanceId = "gen-city";
    this._buildDOM();
    this._applyType();
  }

  // --- workflow ---------------------------------------------------------------

  async generate() {
    const manager = this.getManager();
    if (!manager) return;
    // Replace whatever this instance currently owns.
    manager.removeWorldObjects(manager.objectsByGeneratorId(this.instanceId));

    const config = this._readConfig();
    const g = getGenerator(this.activeType);
    // Resolve prefab backings; a missing prefab safely falls back to a primitive.
    const resolved = {
      buildingPrefab: config.buildingPrefab ? this.getPrefab(config.buildingPrefab) : null,
      propPrefab: config.propPrefab ? this.getPrefab(config.propPrefab) : null,
    };
    const { layout, objects } = generateGeneratorObjects(this.activeType, config, this.instanceId, resolved);
    await manager.addWorldObjects(objects);

    this._recordInstance(config);
    const missing = [];
    if (config.buildingPrefab && !resolved.buildingPrefab) missing.push("building");
    if (config.propPrefab && !resolved.propPrefab) missing.push("prop");
    const fallbackNote = missing.length ? ` · ${missing.join("+")} prefab missing → primitive` : "";
    this._setStatus(`Generated ${objects.length} ${g.label} objects${this._countsNote(layout)}${fallbackNote}.`);
    this.onChanged?.();
  }

  // Pick a fresh seed and regenerate (authoring-only randomness; generation from
  // the chosen seed stays fully deterministic).
  async regenerate() {
    const base = this.seedInput.value.replace(/-\d+$/, "") || this.activeType;
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

  // Validate the generated objects' placement (Stage 17C-2): overlaps + invalid
  // positions, via the Stage-16 bounds/voxel tools.
  validate() {
    const manager = this.getManager();
    if (!manager) return null;
    const owned = manager.objectsByGeneratorId(this.instanceId);
    const target = owned.length ? owned : [...manager.objects.values()];
    const result = validatePlacement(target);
    this._setStatus(
      `Validated ${result.checked} objects · ${result.solids} solid · ${result.overlaps.length} overlaps · ${result.invalid.length} invalid.`
    );
    return result;
  }

  // Switch the active generator type and reconfigure the panel for it (also
  // restoring that type's stored instance fields if the loaded world has one).
  setType(type) {
    this.typeSelect.value = Object.hasOwn(GENERATORS, type) ? type : "city";
    this._applyType();
    this._restoreInstanceFields();
  }

  // Restore panel inputs from a loaded world's stored generator instances. Picks
  // the first stored instance's type; the user can switch types to reach others.
  setFromDocument(document) {
    // Refresh prefab options first (user prefabs may have loaded with the world).
    this._populatePrefabOptions();
    const instances = document?.generators?.instances ?? [];
    const inst = instances[0];
    const type = inst && Object.hasOwn(GENERATORS, inst.type) ? inst.type : "city";
    this.setType(type);
  }

  // --- internals --------------------------------------------------------------

  // Reconfigure the style options, amount dial, and prefab source slots for the
  // currently selected type. Does not touch the document.
  _applyType() {
    const g = getGenerator(this.typeSelect.value);
    this.activeType = g.type;
    this.instanceId = `gen-${g.type}`;

    this._setSelectValues(this.styleSelect, g.styles);

    this.amountLabel.textContent = g.amount.label;
    this.blocksInput.min = g.amount.min;
    this.blocksInput.max = g.amount.max;
    this.blocksInput.step = g.amount.step;
    this._amountField = g.amount.field;
    this._amountDefault = g.amount.default;

    for (let i = 0; i < this.slots.length; i++) {
      const src = g.sources[i] ?? null;
      const slot = this.slots[i];
      if (src) {
        slot.key = src.key;
        slot.label.textContent = src.label;
        slot.row.style.display = "";
      } else {
        slot.key = null;
        slot.row.style.display = "none";
      }
    }
  }

  // Restore seed/style/amount/density/prefab fields for the active type's instance,
  // or reset to defaults when the world has no instance of this type.
  _restoreInstanceFields() {
    const document = this.getDocument();
    // Prefer the canonical `gen-<type>` instance; fall back to the first instance of
    // this type so an externally-authored generator (different id) still restores.
    const instances = document?.generators?.instances ?? [];
    const inst = instances.find((i) => i.id === this.instanceId) ?? instances.find((i) => i.type === this.activeType);
    const g = getGenerator(this.activeType);
    if (inst?.config) {
      if (inst.config.seed) this.seedInput.value = inst.config.seed;
      if (g.styles.includes(inst.config.style)) this.styleSelect.value = inst.config.style;
      const amt = inst.config[this._amountField];
      if (Number.isFinite(amt)) this.blocksInput.value = amt;
      if (Number.isFinite(inst.config.density)) this.densityInput.value = inst.config.density;
      for (const slot of this.slots) {
        if (!slot.key) continue;
        const value = inst.config[slot.key] ?? "";
        slot.select.value = [...slot.select.options].some((o) => o.value === value) ? value : "";
      }
    } else {
      this.blocksInput.value = this._amountDefault;
      for (const slot of this.slots) if (slot.key) slot.select.value = "";
    }
    const manager = this.getManager();
    const owned = manager ? manager.objectsByGeneratorId(this.instanceId).length : 0;
    this._setStatus(owned ? `${owned} live ${this.activeType} objects.` : `Set seed/options, then Generate ${g.label}.`);
  }

  _readConfig() {
    const g = getGenerator(this.activeType);
    const overrides = {
      seed: this.seedInput.value,
      style: this.styleSelect.value,
      density: parseFloat(this.densityInput.value),
      origin: { x: 0, z: 0 },
      [this._amountField]: parseInt(this.blocksInput.value, 10),
    };
    for (const slot of this.slots) {
      if (slot.key) overrides[slot.key] = slot.select.value || null;
    }
    return g.createConfig(overrides);
  }

  _countsNote(layout) {
    const counts = layout?.counts;
    if (!counts) return "";
    return " · " + Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ");
  }

  _recordInstance(config) {
    const document = this.getDocument();
    if (!document) return;
    document.generators = document.generators ?? { instances: [] };
    const others = (document.generators.instances ?? []).filter((i) => i.id !== this.instanceId);
    document.generators.instances = [createGeneratorInstance({ id: this.instanceId, type: this.activeType, config }), ...others];
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

    this.typeSelect = document.createElement("select");
    this._inputStyle(this.typeSelect);
    for (const g of GENERATOR_LIST) {
      const option = document.createElement("option");
      option.value = g.type;
      option.textContent = g.label;
      this.typeSelect.appendChild(option);
    }
    this.typeSelect.addEventListener("change", () => {
      this._applyType();
      this._restoreInstanceFields();
    });

    this.seedInput = this._text("city-1");
    this.styleSelect = this._select([]);
    this.blocksInput = this._number(4, 1, 1, 8);
    this.densityInput = this._number(0.6, 0.05, 0, 1);

    // Two generic prefab source slots; labels + visibility come from the registry.
    this.buildingPrefabSelect = this._select([]);
    this.propPrefabSelect = this._select([]);
    this._populatePrefabOptions();

    const typeRow = this._labeled("Type", this.typeSelect);
    const styleRow = this._labeled("Style", this.styleSelect);
    const amountRow = this._labeled("Blocks", this.blocksInput);
    const densityRow = this._labeled("Density", this.densityInput);
    const buildingRow = this._labeled("Buildings", this.buildingPrefabSelect);
    const propRow = this._labeled("Props", this.propPrefabSelect);
    this.amountLabel = amountRow.labelSpan;

    this.slots = [
      { select: this.buildingPrefabSelect, row: buildingRow.wrap, label: buildingRow.labelSpan, key: "buildingPrefab" },
      { select: this.propPrefabSelect, row: propRow.wrap, label: propRow.labelSpan, key: "propPrefab" },
    ];

    this.root.appendChild(typeRow.wrap);
    this.root.appendChild(styleRow.wrap);
    this.root.appendChild(amountRow.wrap);
    this.root.appendChild(densityRow.wrap);
    this.root.appendChild(buildingRow.wrap);
    this.root.appendChild(propRow.wrap);

    const buttons = document.createElement("div");
    Object.assign(buttons.style, { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" });
    buttons.appendChild(this._button("Generate", () => this.generate()));
    buttons.appendChild(this._button("Regenerate", () => this.regenerate()));
    buttons.appendChild(this._button("Lock", () => this.lock()));
    buttons.appendChild(this._button("Clear", () => this.clear()));
    buttons.appendChild(this._button("Validate", () => this.validate()));
    this.root.appendChild(buttons);

    this.statusEl = document.createElement("div");
    Object.assign(this.statusEl.style, { color: "#8fa899", fontSize: "10px", whiteSpace: "pre-line", minHeight: "12px" });
    this.root.appendChild(this.statusEl);
  }

  _setStatus(text) {
    this.statusEl.textContent = text;
  }

  // Fill the prefab source dropdowns with "Primitive" + the available prefabs,
  // preserving the current selection.
  _populatePrefabOptions() {
    const prefabs = this.listPrefabs() ?? [];
    const opts = [{ value: "", label: "Primitive" }, ...prefabs.map((p) => ({ value: p.id, label: p.name ?? p.id }))];
    for (const select of [this.buildingPrefabSelect, this.propPrefabSelect]) {
      const prev = select.value;
      select.replaceChildren();
      for (const { value, label } of opts) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
      }
      if (opts.some((o) => o.value === prev)) select.value = prev;
    }
  }

  // Replace a <select>'s options, keeping the prior value if still valid.
  _setSelectValues(select, values) {
    const prev = select.value;
    select.replaceChildren();
    for (const value of values) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    }
    select.value = values.includes(prev) ? prev : values[0];
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
    const labelSpan = document.createElement("span");
    labelSpan.textContent = label;
    Object.assign(labelSpan.style, { color: "#8fa899", fontSize: "11px" });
    wrap.appendChild(labelSpan);
    wrap.appendChild(control);
    return { wrap, labelSpan };
  }

  _inputStyle(el) {
    Object.assign(el.style, {
      width: "100%", font: "inherit", fontSize: "11px", padding: "6px 8px",
      color: "#d7e6dc", background: "rgba(127,220,160,0.08)", border: "1px solid rgba(120,200,140,0.25)", borderRadius: "7px",
    });
  }
}
