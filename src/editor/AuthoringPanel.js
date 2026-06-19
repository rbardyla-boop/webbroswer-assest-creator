// Editor "Authoring" panel (Procedural Authoring-1). A thin DOM surface over the
// document's `authoring` block: it lists the splines/masks/modifiers and turns button
// clicks into callbacks the WorldEditor implements (which record undoable commands and
// drive the in-scene tools). Mirrors ProceduralPanel's callback-injection + DOM-helper
// style. The panel owns no THREE and no command logic — it only reflects + requests.

export class AuthoringPanel {
  constructor({ getDocument, onNewSpline, onFinishSpline, onCancelSpline, onUndoPoint, onNewMask, onCreateModifier, onDelete, onToggle, onRegenerate } = {}) {
    this.getDocument = typeof getDocument === "function" ? getDocument : () => null;
    this.cb = { onNewSpline, onFinishSpline, onCancelSpline, onUndoPoint, onNewMask, onCreateModifier, onDelete, onToggle, onRegenerate };
    this._splineMode = false;
    this._splinePoints = 0;
    this._buildDOM();
    this.refresh();
  }

  /** Reflect the live spline-edit tool state (active + collected point count). */
  setSplineMode(active, count = 0) {
    this._splineMode = active;
    this._splinePoints = count;
    this._syncModeUI();
  }

  /** Re-render the lists + modifier source selects from the document. */
  refresh() {
    const a = this.getDocument()?.authoring ?? { splines: [], masks: [], modifiers: [] };
    this._fillSelect(this.splineSelect, a.splines, "(pick a spline)");
    this._fillSelect(this.maskSelect, a.masks, "(no mask)", true);
    this._renderList(this.splineList, a.splines, "splines", { toggle: false, regen: false });
    this._renderList(this.maskList, a.masks, "masks", { toggle: false, regen: false });
    this._renderList(this.modifierList, a.modifiers, "modifiers", { toggle: true, regen: true });
    this._syncModeUI();
  }

  setStatus(text) {
    this.statusEl.textContent = text;
  }

  _syncModeUI() {
    this.newSplineBtn.style.display = this._splineMode ? "none" : "";
    this.splineEditRow.style.display = this._splineMode ? "" : "none";
    this.finishBtn.textContent = `Finish (${this._splinePoints} pts)`;
    this.finishBtn.disabled = this._splinePoints < 3;
    this.finishBtn.style.opacity = this._splinePoints < 3 ? "0.5" : "1";
  }

  // --- DOM ---------------------------------------------------------------------

  _buildDOM() {
    this.root = document.createElement("div");
    Object.assign(this.root.style, { display: "grid", gap: "8px" });

    const intro = document.createElement("div");
    intro.textContent = "Place a path, gate it with an area, then add a beacon trail. Trails persist + show in play.";
    Object.assign(intro.style, { color: "#8fa899", fontSize: "10px" });
    this.root.appendChild(intro);

    // Spline creation + in-progress edit controls.
    this.newSplineBtn = this._button("New Spline (click terrain)", () => this.cb.onNewSpline?.());
    this.splineEditRow = document.createElement("div");
    Object.assign(this.splineEditRow.style, { display: "none", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" });
    this.finishBtn = this._button("Finish", () => this.cb.onFinishSpline?.());
    this.splineEditRow.appendChild(this.finishBtn);
    this.splineEditRow.appendChild(this._button("Undo pt", () => this.cb.onUndoPoint?.()));
    this.splineEditRow.appendChild(this._button("Cancel", () => this.cb.onCancelSpline?.()));
    this.root.appendChild(this.newSplineBtn);
    this.root.appendChild(this.splineEditRow);
    this.splineList = this._listContainer();
    this.root.appendChild(this.splineList);

    // Mask creation.
    this.newMaskBtn = this._button("New Mask (click terrain)", () => this.cb.onNewMask?.());
    this.root.appendChild(this.newMaskBtn);
    this.maskList = this._listContainer();
    this.root.appendChild(this.maskList);

    // Modifier creation: bind a spline (+ optional mask).
    this.splineSelect = this._select();
    this.maskSelect = this._select();
    this.root.appendChild(this._labeled("Path", this.splineSelect));
    this.root.appendChild(this._labeled("Area", this.maskSelect));
    this.root.appendChild(
      this._button("Create Beacon Trail", () => {
        const splineId = this.splineSelect.value || null;
        const maskId = this.maskSelect.value || null;
        this.cb.onCreateModifier?.({ splineId, maskId });
      })
    );
    this.modifierList = this._listContainer();
    this.root.appendChild(this.modifierList);

    this.statusEl = document.createElement("div");
    Object.assign(this.statusEl.style, { color: "#8fa899", fontSize: "10px", whiteSpace: "pre-line", minHeight: "12px" });
    this.root.appendChild(this.statusEl);
  }

  _renderList(container, items, kind, { toggle, regen }) {
    container.replaceChildren();
    for (const item of items) {
      const row = document.createElement("div");
      Object.assign(row.style, { display: "flex", alignItems: "center", gap: "6px", fontSize: "10px", color: "#8fa899" });

      if (toggle) {
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = item.enabled !== false;
        cb.title = "Enabled";
        cb.addEventListener("change", () => this.cb.onToggle?.(kind, item.id, cb.checked));
        row.appendChild(cb);
      }

      const label = document.createElement("span");
      label.textContent = item.name || item.id;
      Object.assign(label.style, { flex: "1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
      row.appendChild(label);

      if (regen) row.appendChild(this._iconBtn("⟳", "Regenerate", () => this.cb.onRegenerate?.(item.id)));
      row.appendChild(this._iconBtn("×", "Delete", () => this.cb.onDelete?.(kind, item.id)));
      container.appendChild(row);
    }
  }

  _fillSelect(select, items, emptyLabel, allowNone = false) {
    const prev = select.value;
    select.replaceChildren();
    if (allowNone) this._option(select, "", emptyLabel);
    else this._option(select, "", emptyLabel);
    for (const item of items) this._option(select, item.id, item.name || item.id);
    if ([...select.options].some((o) => o.value === prev)) select.value = prev;
  }

  _option(select, value, label) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    select.appendChild(o);
  }

  _listContainer() {
    const el = document.createElement("div");
    Object.assign(el.style, { display: "grid", gap: "3px" });
    return el;
  }

  _select() {
    const select = document.createElement("select");
    this._inputStyle(select);
    return select;
  }

  _labeled(label, control) {
    const wrap = document.createElement("label");
    Object.assign(wrap.style, { display: "grid", gridTemplateColumns: "54px 1fr", gap: "8px", alignItems: "center" });
    const span = document.createElement("span");
    span.textContent = label;
    Object.assign(span.style, { color: "#8fa899", fontSize: "11px" });
    wrap.appendChild(span);
    wrap.appendChild(control);
    return wrap;
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

  _iconBtn(glyph, title, onClick) {
    const b = document.createElement("button");
    b.textContent = glyph;
    b.title = title;
    Object.assign(b.style, {
      cursor: "pointer", font: "inherit", fontSize: "11px", lineHeight: "1", padding: "2px 7px",
      color: "#d7e6dc", background: "rgba(127,220,160,0.08)", border: "1px solid rgba(120,200,140,0.25)", borderRadius: "6px",
    });
    b.addEventListener("click", onClick);
    return b;
  }

  _inputStyle(el) {
    Object.assign(el.style, {
      width: "100%", font: "inherit", fontSize: "11px", padding: "6px 8px",
      color: "#d7e6dc", background: "rgba(127,220,160,0.08)", border: "1px solid rgba(120,200,140,0.25)", borderRadius: "7px",
    });
  }
}
