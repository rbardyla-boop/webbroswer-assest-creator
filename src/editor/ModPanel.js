// Mods panel for the World Builder. Imports/export mod packages, lists installed
// mods, and loads a mod world. All storage/validation is done by the host via
// callbacks; this module is presentation + intent only. Mod data is DATA ONLY —
// nothing here executes imported content.

export class ModPanel {
  constructor({
    registry,
    onImport,
    onExportJson,
    onExportZip,
    onLoadWorld,
    onShowDetails,
    onDelete,
    onToggleEnabled,
  } = {}) {
    this.registry = registry;
    this.onImport = onImport;
    this.onExportJson = onExportJson;
    this.onExportZip = onExportZip;
    this.onLoadWorld = onLoadWorld;
    this.onShowDetails = onShowDetails;
    this.onDelete = onDelete;
    this.onToggleEnabled = onToggleEnabled;

    this.root = document.createElement("div");
    Object.assign(this.root.style, { display: "flex", flexDirection: "column", gap: "8px" });

    const actions = document.createElement("div");
    Object.assign(actions.style, { display: "flex", gap: "6px", flexWrap: "wrap" });
    actions.appendChild(this._button("Import Mod Package", () => this.onImport?.()));
    actions.appendChild(this._button("Export World as Mod", () => this.onExportJson?.()));
    actions.appendChild(this._button("Export Mod (.zip)", () => this.onExportZip?.()));
    this.root.appendChild(actions);

    this.status = document.createElement("div");
    Object.assign(this.status.style, { color: "#8fa899", fontSize: "10px", minHeight: "12px", whiteSpace: "pre-line" });
    this.root.appendChild(this.status);

    this.listEl = document.createElement("div");
    Object.assign(this.listEl.style, { display: "flex", flexDirection: "column", gap: "6px" });
    this.root.appendChild(this.listEl);

    this.refresh();
  }

  setStatus(text) {
    this.status.textContent = text ?? "";
  }

  refresh() {
    this.listEl.replaceChildren();
    const mods = this.registry?.list() ?? [];
    if (!mods.length) {
      const empty = document.createElement("div");
      empty.textContent = "No mods installed. Import a .modpack.json/.zip to begin.";
      Object.assign(empty.style, { color: "#6f8478", fontSize: "11px", padding: "2px 0" });
      this.listEl.appendChild(empty);
      return;
    }
    for (const mod of mods) this.listEl.appendChild(this._row(mod));
  }

  _row(mod) {
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      flexDirection: "column",
      gap: "5px",
      padding: "8px",
      borderRadius: "8px",
      border: `1px solid ${mod.enabled ? "rgba(120,200,140,0.28)" : "rgba(160,160,160,0.2)"}`,
      background: mod.enabled ? "rgba(127,220,160,0.05)" : "rgba(140,140,140,0.05)",
      opacity: mod.enabled ? "1" : "0.62",
    });

    const title = document.createElement("div");
    title.textContent = `${mod.name}${mod.author ? `  ·  ${mod.author}` : ""}`;
    Object.assign(title.style, { color: "#d7e6dc", fontSize: "11px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
    row.appendChild(title);

    const meta = document.createElement("div");
    const c = mod.counts ?? {};
    meta.textContent = `v${mod.version} · ${c.worlds ?? 0} world · ${c.assets ?? 0} asset · ${c.prefabs ?? 0} prefab · ${c.kits ?? 0} kit` +
      (mod.warnings?.length ? ` · ${mod.warnings.length}⚠` : "");
    Object.assign(meta.style, { color: "#8fa899", fontSize: "10px" });
    row.appendChild(meta);

    const actions = document.createElement("div");
    Object.assign(actions.style, { display: "flex", gap: "5px", flexWrap: "wrap" });
    if ((mod.worlds ?? c.worlds) && (mod.counts?.worlds ?? 0) > 0) {
      actions.appendChild(this._miniButton("Load World", () => this.onLoadWorld?.(mod.id)));
    }
    actions.appendChild(this._miniButton("Details", () => this.onShowDetails?.(mod.id)));
    actions.appendChild(this._miniButton(mod.enabled ? "Disable" : "Enable", () => this.onToggleEnabled?.(mod.id, !mod.enabled)));
    actions.appendChild(this._miniButton("Uninstall", () => this.onDelete?.(mod.id)));
    row.appendChild(actions);

    return row;
  }

  _button(label, onClick) {
    const button = document.createElement("button");
    button.textContent = label;
    Object.assign(button.style, {
      cursor: "pointer",
      font: "inherit",
      fontSize: "11px",
      padding: "7px 10px",
      color: "#d7e6dc",
      background: "rgba(127,220,160,0.08)",
      border: "1px solid rgba(120,200,140,0.25)",
      borderRadius: "7px",
    });
    button.addEventListener("click", onClick);
    return button;
  }

  _miniButton(label, onClick) {
    const button = this._button(label, onClick);
    button.style.padding = "4px 8px";
    button.style.fontSize = "10px";
    return button;
  }
}
