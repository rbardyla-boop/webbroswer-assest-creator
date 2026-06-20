// Editor "Encounters" panel (Encounter Editor-0). A list panel (like Procedural / Authoring) driven off
// document.encounters.items: arm placement (then a terrain click drops a combat-beat descriptor), set the
// new beat's radius + completion-persistence, and review/delete placed beats. The panel writes NO scene
// state — the host owns placement (writes the descriptor + draws the preview ring) and removal. Authoring
// a beat never spawns an enemy; the enemy is projected only in play (by EncounterRuntime).

import { DEFAULT_RADIUS, RADIUS_MIN, RADIUS_MAX } from "../world/encounters/EncounterTypes.js";

export class EncounterPanel {
  constructor({ getDocument, onArm, onRemove } = {}) {
    this.getDocument = typeof getDocument === "function" ? getDocument : () => null;
    this.onArm = onArm;
    this.onRemove = onRemove;
    this._armed = false;
    this._buildDOM();
    this.refresh();
  }

  /** The radius (m) a freshly-placed beat should use. */
  radius() {
    const n = Number(this.radiusInput.value);
    return Number.isFinite(n) ? Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, n)) : DEFAULT_RADIUS;
  }

  /** Whether a freshly-placed beat persists its completion across reload (default true). */
  persistCompletion() {
    return this.persistInput.checked;
  }

  /** Reflect the host's armed state on the Place button. */
  setArmed(on) {
    this._armed = !!on;
    this.armButton.textContent = this._armed ? "Placing… (click terrain · Esc to cancel)" : "Place encounter";
    this.armButton.style.borderColor = this._armed ? "#7fdca0" : "rgba(120,200,140,0.25)";
    this.armButton.style.color = this._armed ? "#7fdca0" : "#d7e6dc";
  }

  // Rebuild the placed-beat list from the live document.
  refresh() {
    const items = this.getDocument()?.encounters?.items ?? [];
    this.list.replaceChildren();
    if (!items.length) {
      this.status.textContent = "No encounters. Arm placement, then click terrain to drop a combat beat.";
      return;
    }
    this.status.textContent = `${items.length} encounter${items.length === 1 ? "" : "s"}.`;
    for (const enc of items) {
      const row = document.createElement("div");
      Object.assign(row.style, { display: "grid", gridTemplateColumns: "1fr auto", gap: "6px", alignItems: "center" });

      const label = document.createElement("div");
      Object.assign(label.style, { color: "#d7e6dc", fontSize: "10px", lineHeight: "1.35" });
      const p = enc.position ?? { x: 0, y: 0, z: 0 };
      const badge = enc.completed ? " · cleared" : "";
      const replay = enc.persistCompletion === false ? " · replayable" : "";
      label.textContent = `${enc.id} — (${fmt(p.x)}, ${fmt(p.z)}) · r${fmt(enc.radius)} · ${enc.enemyType}${badge}${replay}`;

      const del = this._button("✕", () => this.onRemove?.(enc.id));
      Object.assign(del.style, { padding: "4px 9px" });
      row.append(label, del);
      this.list.appendChild(row);
    }
  }

  _buildDOM() {
    this.root = document.createElement("div");
    Object.assign(this.root.style, { display: "grid", gap: "8px" });

    this.armButton = this._button("Place encounter", () => this.onArm?.(!this._armed));
    this.root.appendChild(this.armButton);

    this.radiusInput = this._number(DEFAULT_RADIUS, 0.5, RADIUS_MIN, RADIUS_MAX);
    this.root.appendChild(this._labeled("Radius (m)", this.radiusInput));

    const persist = this._checkbox("Persist completion on reload", true);
    this.persistInput = persist.input;
    this.root.appendChild(persist.label);

    this.list = document.createElement("div");
    Object.assign(this.list.style, { display: "grid", gap: "5px" });
    this.root.appendChild(this.list);

    this.status = document.createElement("div");
    Object.assign(this.status.style, { color: "#8fa899", fontSize: "10px", minHeight: "12px" });
    this.root.appendChild(this.status);
  }

  // --- DOM helpers ------------------------------------------------------------

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

  _checkbox(label, checked) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!checked;
    const wrap = document.createElement("label");
    Object.assign(wrap.style, { display: "flex", alignItems: "center", gap: "8px", color: "#8fa899", fontSize: "11px" });
    wrap.appendChild(input);
    wrap.appendChild(document.createTextNode(label));
    return { input, label: wrap };
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
    Object.assign(wrap.style, { display: "grid", gridTemplateColumns: "84px 1fr", gap: "8px", alignItems: "center" });
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

function fmt(n) {
  return Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : "?";
}
