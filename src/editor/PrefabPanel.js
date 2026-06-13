// Prefab Library panel for the World Builder. Lists saved prefabs, creates a
// prefab from the current selection, arms a prefab for placement, and supports
// rename / delete. All heavy lifting (serialize, persist, instance) is done by
// the host via callbacks; this module is presentation + intent only.
//
// The list is re-rendered explicitly (on refresh), never per frame, and prefab
// thumbnails are fetched lazily when a row is drawn.

export class PrefabPanel {
  constructor({
    library,
    onCreatePrefab,
    onArmPlacement,
    onRenamePrefab,
    onDeletePrefab,
  } = {}) {
    this.library = library;
    this.onCreatePrefab = onCreatePrefab;
    this.onArmPlacement = onArmPlacement;
    this.onRenamePrefab = onRenamePrefab;
    this.onDeletePrefab = onDeletePrefab;
    this.armedId = null;

    this.root = document.createElement("div");
    Object.assign(this.root.style, { display: "flex", flexDirection: "column", gap: "8px" });

    this.createButton = this._button("＋ Save Selection as Prefab", () => this.onCreatePrefab?.());
    this.root.appendChild(this.createButton);

    this.status = document.createElement("div");
    Object.assign(this.status.style, { color: "#8fa899", fontSize: "10px", minHeight: "12px" });
    this.root.appendChild(this.status);

    this.listEl = document.createElement("div");
    Object.assign(this.listEl.style, { display: "flex", flexDirection: "column", gap: "6px" });
    this.root.appendChild(this.listEl);

    this.refresh();
  }

  setStatus(text) {
    this.status.textContent = text ?? "";
  }

  setArmed(prefab) {
    this.armedId = prefab?.id ?? null;
    this.refresh();
    if (this.armedId) {
      this.setStatus(`Placing "${prefab.name}" — click terrain (repeat to place again). Esc/Stop to finish.`);
    }
  }

  refresh() {
    this.listEl.replaceChildren();
    const prefabs = this.library?.list() ?? [];
    if (!prefabs.length) {
      const empty = document.createElement("div");
      empty.textContent = "No prefabs yet. Select an object and save it as a prefab.";
      Object.assign(empty.style, { color: "#6f8478", fontSize: "11px", padding: "2px 0" });
      this.listEl.appendChild(empty);
      return;
    }
    for (const prefab of prefabs) this.listEl.appendChild(this._row(prefab));
  }

  _row(prefab) {
    const armed = prefab.id === this.armedId;
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "grid",
      gridTemplateColumns: "34px 1fr",
      gap: "8px",
      alignItems: "center",
      padding: "7px",
      borderRadius: "8px",
      border: `1px solid ${armed ? "#7fdca0" : "rgba(120,200,140,0.22)"}`,
      background: armed ? "rgba(127,220,160,0.12)" : "rgba(127,220,160,0.05)",
    });

    const thumb = document.createElement("div");
    Object.assign(thumb.style, {
      width: "34px",
      height: "34px",
      borderRadius: "6px",
      background: "rgba(127,220,160,0.12)",
      display: "grid",
      placeItems: "center",
      fontSize: "9px",
      color: "#7fdca0",
      overflow: "hidden",
    });
    thumb.textContent = prefab.kind?.slice(0, 4) ?? "obj";
    this._loadThumb(prefab, thumb);
    row.appendChild(thumb);

    const main = document.createElement("div");
    Object.assign(main.style, { display: "flex", flexDirection: "column", gap: "4px", minWidth: "0" });

    const title = document.createElement("div");
    title.textContent = prefab.name;
    Object.assign(title.style, { color: "#d7e6dc", fontSize: "11px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
    main.appendChild(title);

    const meta = document.createElement("div");
    const count = prefab.metadata?.objectCount ?? prefab.objects?.length ?? 0;
    meta.textContent = `${prefab.kind} · ${count} obj`;
    Object.assign(meta.style, { color: "#8fa899", fontSize: "10px" });
    main.appendChild(meta);

    const actions = document.createElement("div");
    Object.assign(actions.style, { display: "flex", gap: "5px", flexWrap: "wrap" });
    actions.appendChild(this._miniButton(armed ? "Stop" : "Place", () => {
      this.onArmPlacement?.(armed ? null : prefab);
    }, armed));
    actions.appendChild(this._miniButton("Rename", () => this.onRenamePrefab?.(prefab.id)));
    actions.appendChild(this._miniButton("Del", () => this.onDeletePrefab?.(prefab.id)));
    main.appendChild(actions);

    row.appendChild(main);
    return row;
  }

  async _loadThumb(prefab, el) {
    if (!prefab.metadata?.thumbnailRef || !this.library?.getThumbnail) return;
    try {
      const dataUrl = await this.library.getThumbnail(prefab.id);
      if (!dataUrl) return;
      const img = document.createElement("img");
      img.src = dataUrl;
      Object.assign(img.style, { width: "34px", height: "34px", objectFit: "cover" });
      el.replaceChildren(img);
    } catch {
      // keep the text placeholder
    }
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

  _miniButton(label, onClick, active = false) {
    const button = this._button(label, onClick);
    button.style.padding = "4px 8px";
    button.style.fontSize = "10px";
    if (active) {
      button.style.borderColor = "#7fdca0";
      button.style.color = "#7fdca0";
    }
    return button;
  }
}
