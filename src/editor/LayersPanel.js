// Layers panel for the World Builder (Editor UX-1).
//
// One row per editor layer with a visibility (eye) toggle and — where the layer's
// content is selectable — a lock toggle. DOM-only: it renders the LayerModel's
// snapshot and reports toggle intent back via callbacks; the model + editor own
// the actual scene changes. Layer state is editor-session-only and never persisted.

const ACCENT = "#7fdca0";
const TEXT = "#d7e6dc";
const DIM = "#8fa899";

export class LayersPanel {
  constructor({ onToggleVisible = null, onToggleLock = null } = {}) {
    this.onToggleVisible = onToggleVisible;
    this.onToggleLock = onToggleLock;
    this.root = document.createElement("div");
    Object.assign(this.root.style, { display: "flex", flexDirection: "column", gap: "4px" });
  }

  /** @param {Array<{id,label,visible,locked,lockable}>} layers */
  render(layers = []) {
    this.root.replaceChildren();
    for (const layer of layers) this.root.appendChild(this._row(layer));
  }

  _row(layer) {
    const wrap = document.createElement("div");
    Object.assign(wrap.style, { display: "grid", gridTemplateColumns: "1fr auto auto", gap: "6px", alignItems: "center" });

    const label = document.createElement("span");
    label.textContent = layer.label;
    Object.assign(label.style, { color: layer.visible ? TEXT : DIM, fontSize: "11px" });
    wrap.appendChild(label);

    const eye = this._toggle(layer.visible ? "👁" : "—", layer.visible, () => this.onToggleVisible?.(layer.id));
    eye.title = layer.visible ? "Hide layer" : "Show layer";
    wrap.appendChild(eye);

    if (layer.lockable) {
      const lock = this._toggle(layer.locked ? "🔒" : "🔓", layer.locked, () => this.onToggleLock?.(layer.id));
      lock.title = layer.locked ? "Locked — click to allow selection" : "Unlocked — click to lock from selection";
      wrap.appendChild(lock);
    } else {
      const spacer = document.createElement("span");
      spacer.style.width = "26px";
      wrap.appendChild(spacer);
    }
    return wrap;
  }

  _toggle(text, active, onClick) {
    const button = document.createElement("button");
    button.textContent = text;
    Object.assign(button.style, {
      cursor: "pointer",
      font: "inherit",
      fontSize: "11px",
      width: "26px",
      padding: "3px 0",
      textAlign: "center",
      color: active ? ACCENT : DIM,
      background: "rgba(127,220,160,0.08)",
      border: "1px solid " + (active ? "rgba(127,220,160,0.45)" : "rgba(120,200,140,0.2)"),
      borderRadius: "5px",
    });
    button.addEventListener("click", onClick);
    return button;
  }
}
