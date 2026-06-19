// Hierarchy / outliner for the World Builder (Editor UX-1).
//
// A sectioned list of what's in the world so an author can see and select it
// without hunting in the viewport. DOM-only (no THREE): the editor feeds it
// plain row data and gets selection intent back via callbacks.
//
//   Objects   — hand-placed world objects (click to select; Shift/Ctrl to add)
//   Generated — procedural-generator objects, grouped (click to select)
//   Weapons   — placed generated weapons, named by their derived identity (read-only)
//   Objective — the relic + cache zone from the document (read-only)
//
// Selection is two-way: clicking a row drives the editor's SelectionGroup, and the
// editor calls render() with the live selectedIds so the rows reflect viewport picks.

const ACCENT = "#7fdca0";
const TEXT = "#d7e6dc";
const DIM = "#8fa899";
// Keep the DOM bounded for large procedural batches; the remainder is surfaced
// honestly as a "+N more" line rather than silently dropped.
const MAX_ROWS_PER_SECTION = 200;

export class HierarchyPanel {
  constructor({ onSelect = null, onToggleSelect = null } = {}) {
    this.onSelect = onSelect;
    this.onToggleSelect = onToggleSelect;

    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      maxHeight: "230px",
      overflowY: "auto",
    });
    this._empty = document.createElement("div");
    this._empty.textContent = "Empty world — place an object to begin.";
    Object.assign(this._empty.style, { color: DIM, fontSize: "10px" });
    this.root.appendChild(this._empty);
  }

  /**
   * @param {object} data
   * @param {Array<{id:string,name:string,generated:boolean}>} data.objects
   * @param {Array<{id:string,name:string}>} [data.weapons]
   * @param {Array<{id:string,name:string}>} [data.objectives]
   * @param {Array<{id:string,name:string}>} [data.authoring]
   * @param {Set<string>} [data.selectedIds]
   */
  render({ objects = [], weapons = [], objectives = [], authoring = [], selectedIds = new Set() } = {}) {
    this.root.replaceChildren();
    const placed = objects.filter((o) => !o.generated);
    const generated = objects.filter((o) => o.generated);

    const total = objects.length + weapons.length + objectives.length + authoring.length;
    if (total === 0) {
      this.root.appendChild(this._empty);
      return;
    }

    if (placed.length) this.root.appendChild(this._section(`Objects (${placed.length})`, placed, selectedIds, true));
    if (generated.length) this.root.appendChild(this._section(`Generated (${generated.length})`, generated, selectedIds, true));
    if (weapons.length) this.root.appendChild(this._section(`Weapons (${weapons.length})`, weapons, selectedIds, false));
    if (objectives.length) this.root.appendChild(this._section(`Objective (${objectives.length})`, objectives, selectedIds, false));
    if (authoring.length) this.root.appendChild(this._section(`Authoring (${authoring.length})`, authoring, selectedIds, false));
  }

  _section(title, rows, selectedIds, selectable) {
    const wrap = document.createElement("div");
    Object.assign(wrap.style, { display: "flex", flexDirection: "column", gap: "3px" });
    const heading = document.createElement("div");
    heading.textContent = title;
    Object.assign(heading.style, { color: ACCENT, fontSize: "9px", letterSpacing: "0.08em", marginTop: "2px" });
    wrap.appendChild(heading);

    const shown = rows.slice(0, MAX_ROWS_PER_SECTION);
    for (const row of shown) wrap.appendChild(this._row(row, selectedIds, selectable));
    if (rows.length > shown.length) {
      const more = document.createElement("div");
      more.textContent = `+${rows.length - shown.length} more…`;
      Object.assign(more.style, { color: DIM, fontSize: "10px", padding: "2px 6px" });
      wrap.appendChild(more);
    }
    return wrap;
  }

  _row(row, selectedIds, selectable) {
    const el = document.createElement("div");
    const isSelected = selectedIds.has(row.id);
    el.textContent = row.name || row.id;
    el.title = row.id;
    Object.assign(el.style, {
      padding: "3px 6px",
      borderRadius: "5px",
      fontSize: "11px",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      color: isSelected ? "#06120d" : selectable ? TEXT : DIM,
      background: isSelected ? ACCENT : "transparent",
      border: "1px solid " + (isSelected ? ACCENT : "transparent"),
      cursor: selectable ? "pointer" : "default",
    });
    if (selectable) {
      el.addEventListener("click", (event) => {
        const additive = event.shiftKey || event.ctrlKey || event.metaKey;
        if (additive) this.onToggleSelect?.(row.id);
        else this.onSelect?.(row.id);
      });
    }
    return el;
  }
}
