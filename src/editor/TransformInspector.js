// Numeric transform inspector for the World Builder (Editor UX-1).
//
// Shows the primary selection's position / rotation (degrees) / scale and lets the
// author edit them by typing — a precise complement to the drag gizmo. DOM-only
// (no THREE): it reports an edited transform (rotation already converted to radians)
// via onChange, and the editor records it as a normal TransformObjectsCommand so
// undo + autosave work for free. Disabled when nothing, or more than one object, is
// selected (single-primary editing keeps the MVP simple and unambiguous).

const DIM = "#8fa899";
const TEXT = "#d7e6dc";
const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

export class TransformInspector {
  /**
   * @param {object} opts
   * @param {(t:{position:{x,y,z},rotation:{x,y,z},scale:{x,y,z}}) => void} opts.onChange
   *        rotation is in RADIANS (ready to apply to object.rotation)
   */
  constructor({ onChange = null } = {}) {
    this.onChange = onChange;
    this._object = null;

    this.root = document.createElement("div");
    Object.assign(this.root.style, { display: "flex", flexDirection: "column", gap: "6px" });

    this._hint = document.createElement("div");
    this._hint.textContent = "No object selected.";
    Object.assign(this._hint.style, { color: DIM, fontSize: "10px" });
    this.root.appendChild(this._hint);

    this._fields = {};
    this._rows = [
      this._buildRow("Pos", ["px", "py", "pz"], 0.5),
      this._buildRow("Rot°", ["rx", "ry", "rz"], 5),
      this._buildRow("Scl", ["sx", "sy", "sz"], 0.1),
    ];
    for (const row of this._rows) this.root.appendChild(row);
    this._setEnabled(false);
  }

  /** Bind to the primary selection (or null/multi → disabled). */
  setObject(object) {
    this._object = object ?? null;
    if (!this._object) {
      this._hint.textContent = "No object selected.";
      this._setEnabled(false);
      return;
    }
    this._hint.textContent = `Editing ${this._object.name || this._object.userData?.objectId || "object"}`;
    this._setEnabled(true);
    this.refresh();
  }

  /** Re-read the bound object's transform into the fields (after a gizmo drag/undo). */
  refresh() {
    const o = this._object;
    if (!o) return;
    this._fields.px.value = round(o.position.x);
    this._fields.py.value = round(o.position.y);
    this._fields.pz.value = round(o.position.z);
    this._fields.rx.value = round(o.rotation.x * RAD_TO_DEG);
    this._fields.ry.value = round(o.rotation.y * RAD_TO_DEG);
    this._fields.rz.value = round(o.rotation.z * RAD_TO_DEG);
    this._fields.sx.value = round(o.scale.x);
    this._fields.sy.value = round(o.scale.y);
    this._fields.sz.value = round(o.scale.z);
  }

  _commit() {
    if (!this._object) return;
    const f = this._fields;
    const transform = {
      position: { x: num(f.px.value, this._object.position.x), y: num(f.py.value, this._object.position.y), z: num(f.pz.value, this._object.position.z) },
      rotation: {
        x: num(f.rx.value, this._object.rotation.x * RAD_TO_DEG) * DEG_TO_RAD,
        y: num(f.ry.value, this._object.rotation.y * RAD_TO_DEG) * DEG_TO_RAD,
        z: num(f.rz.value, this._object.rotation.z * RAD_TO_DEG) * DEG_TO_RAD,
      },
      scale: { x: num(f.sx.value, this._object.scale.x), y: num(f.sy.value, this._object.scale.y), z: num(f.sz.value, this._object.scale.z) },
    };
    this.onChange?.(transform);
  }

  _buildRow(label, keys, step) {
    const wrap = document.createElement("div");
    Object.assign(wrap.style, { display: "grid", gridTemplateColumns: "34px 1fr 1fr 1fr", gap: "5px", alignItems: "center" });
    const span = document.createElement("span");
    span.textContent = label;
    Object.assign(span.style, { color: DIM, fontSize: "10px" });
    wrap.appendChild(span);
    for (const key of keys) {
      const input = document.createElement("input");
      input.type = "number";
      input.step = step;
      Object.assign(input.style, {
        width: "100%",
        font: "inherit",
        fontSize: "11px",
        padding: "4px 5px",
        color: TEXT,
        background: "rgba(127,220,160,0.08)",
        border: "1px solid rgba(120,200,140,0.25)",
        borderRadius: "5px",
      });
      // Commit on Enter or blur (change), not per keystroke, so undo gets one command.
      input.addEventListener("change", () => this._commit());
      input.addEventListener("keydown", (event) => {
        if (event.code === "Enter") input.blur();
      });
      this._fields[key] = input;
      wrap.appendChild(input);
    }
    return wrap;
  }

  _setEnabled(enabled) {
    for (const input of Object.values(this._fields)) {
      input.disabled = !enabled;
      input.style.opacity = enabled ? "1" : "0.4";
    }
  }
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function num(value, fallback) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}
