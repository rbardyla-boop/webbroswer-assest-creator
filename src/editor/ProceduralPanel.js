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
import { validatePlacement } from "../generators/PlacementValidator.js";

const INSTANCE_ID = "gen-city";

export class ProceduralPanel {
  constructor({ getManager, getDocument, getPrefab, listPrefabs, onChanged } = {}) {
    this.getManager = typeof getManager === "function" ? getManager : () => null;
    this.getDocument = typeof getDocument === "function" ? getDocument : () => null;
    this.getPrefab = typeof getPrefab === "function" ? getPrefab : () => null;
    this.listPrefabs = typeof listPrefabs === "function" ? listPrefabs : () => [];
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
    // Resolve prefab backings; a missing prefab safely falls back to a primitive.
    const buildingPrefab = config.buildingPrefab ? this.getPrefab(config.buildingPrefab) : null;
    const propPrefab = config.propPrefab ? this.getPrefab(config.propPrefab) : null;
    const descriptors = cityLayoutToWorldObjects(layout, this.instanceId, { buildingPrefab, propPrefab });
    await manager.addWorldObjects(descriptors);

    this._recordInstance(config);
    const missing = [];
    if (config.buildingPrefab && !buildingPrefab) missing.push("building");
    if (config.propPrefab && !propPrefab) missing.push("prop");
    const fallbackNote = missing.length ? ` · ${missing.join("+")} prefab missing → primitive` : "";
    this._setStatus(`Generated ${descriptors.length} objects · ${layout.counts.buildings} buildings, ${layout.counts.roads} streets, ${layout.counts.props} trees${fallbackNote}.`);
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

  // Validate the generated objects' placement (Stage 17C-2): overlaps + invalid
  // positions, via the Stage-16 bounds/voxel tools.
  validate() {
    const manager = this.getManager();
    if (!manager) return null;
    const owned = manager.objectsByGeneratorId(this.instanceId);
    const target = owned.length ? owned : [...manager.objects.values()];
    const result = validatePlacement(target);
    const buildingOverlaps = result.overlaps.filter((o) => o.aName === "Building" && o.bName === "Building").length;
    this._setStatus(
      `Validated ${result.checked} objects · ${result.solids} solid · ${result.overlaps.length} overlaps (${buildingOverlaps} building↔building) · ${result.invalid.length} invalid.`
    );
    return result;
  }

  // Restore panel inputs from a loaded world's stored generator instance.
  setFromDocument(document) {
    // Refresh prefab options first (user prefabs may have loaded with the world).
    this._populatePrefabOptions();
    const instances = document?.generators?.instances ?? [];
    const inst = instances.find((i) => i.id === this.instanceId) ?? instances.find((i) => i.type === "city");
    if (inst?.config) {
      this.instanceId = inst.id ?? INSTANCE_ID;
      this.seedInput.value = inst.config.seed;
      this.styleSelect.value = inst.config.style;
      this.blocksInput.value = inst.config.blocks;
      this.densityInput.value = inst.config.density;
      this.buildingPrefabSelect.value = inst.config.buildingPrefab ?? "";
      this.propPrefabSelect.value = inst.config.propPrefab ?? "";
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
      buildingPrefab: this.buildingPrefabSelect.value || null,
      propPrefab: this.propPrefabSelect.value || null,
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

    // Per-category source: "Primitive" (default) or a prefab to expand (Stage 19).
    this.buildingPrefabSelect = this._select([]);
    this.propPrefabSelect = this._select([]);
    this._populatePrefabOptions();

    this.root.appendChild(this._labeled("Seed", this.seedInput));
    this.root.appendChild(this._labeled("Style", this.styleSelect));
    this.root.appendChild(this._labeled("Blocks", this.blocksInput));
    this.root.appendChild(this._labeled("Density", this.densityInput));
    this.root.appendChild(this._labeled("Buildings", this.buildingPrefabSelect));
    this.root.appendChild(this._labeled("Props", this.propPrefabSelect));

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
    this._setStatus("Set seed/style, then Generate.");
  }

  _setStatus(text) {
    this.statusEl.textContent = text;
  }

  // Fill the Building/Props dropdowns with "Primitive" + the available prefabs,
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
      // Keep the prior selection if it still exists.
      if (opts.some((o) => o.value === prev)) select.value = prev;
    }
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
