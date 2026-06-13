import { COLLIDER_TYPES } from "../physics/ColliderProxy.js";

const LABELS = {
  [COLLIDER_TYPES.none]: "none",
  [COLLIDER_TYPES.box]: "box",
  [COLLIDER_TYPES.cylinder]: "cylinder",
  [COLLIDER_TYPES.plane]: "plane / walkable",
  [COLLIDER_TYPES.ramp]: "ramp",
  [COLLIDER_TYPES.trigger]: "trigger",
};

export class ColliderInspector {
  constructor({ onChange, onToggleDebug }) {
    this.onChange = onChange;
    this.onToggleDebug = onToggleDebug;
    this.object = null;

    this.root = document.createElement("div");
    Object.assign(this.root.style, { display: "grid", gridTemplateColumns: "1fr auto", gap: "8px" });

    this.select = document.createElement("select");
    Object.assign(this.select.style, {
      font: "inherit",
      fontSize: "11px",
      padding: "7px 8px",
      color: "#d7e6dc",
      background: "rgba(127,220,160,0.08)",
      border: "1px solid rgba(120,200,140,0.25)",
      borderRadius: "7px",
    });
    for (const type of Object.values(COLLIDER_TYPES)) {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = LABELS[type] ?? type;
      this.select.appendChild(option);
    }

    const wire = document.createElement("button");
    wire.textContent = "Wire";
    Object.assign(wire.style, {
      cursor: "pointer",
      font: "inherit",
      fontSize: "11px",
      padding: "7px 10px",
      color: "#d7e6dc",
      background: "rgba(127,220,160,0.08)",
      border: "1px solid rgba(120,200,140,0.25)",
      borderRadius: "7px",
    });

    this.root.appendChild(this.select);
    this.root.appendChild(wire);

    this.select.addEventListener("change", () => {
      if (!this.object) return;
      const type = this.select.value;
      this.onChange?.({
        type,
        excludeGrass: type !== COLLIDER_TYPES.none && type !== COLLIDER_TYPES.trigger,
      });
    });
    wire.addEventListener("click", () => this.onToggleDebug?.());
    this.setObject(null);
  }

  setObject(object) {
    this.object = object;
    this.select.disabled = !object;
    this.select.value = object?.userData?.collider?.type ?? COLLIDER_TYPES.none;
  }
}
