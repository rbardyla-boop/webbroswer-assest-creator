// Per-object interaction inspector. Lets the author tag the selected object with
// a data-only interaction role (trigger / door / sign / pickup / spawn) and its
// fields. Presentation + intent only — the host sanitizes and writes the result
// onto object.userData.interaction. Event lists are typed as comma/space-
// separated names (plain strings, equality-matched at runtime — never code).

const ROLES = [
  ["none", "None"],
  ["trigger", "Trigger volume"],
  ["door", "Door / mover"],
  ["sign", "Sign"],
  ["pickup", "Pickup"],
  ["spawn", "Spawn point"],
];

export class InteractionPanel {
  constructor({ onChange } = {}) {
    this.onChange = onChange;
    this.object = null;

    this.root = document.createElement("div");
    Object.assign(this.root.style, { display: "flex", flexDirection: "column", gap: "7px" });

    this.info = document.createElement("div");
    Object.assign(this.info.style, { color: "#8fa899", fontSize: "10px", minHeight: "12px" });
    this.root.appendChild(this.info);

    this.roleSelect = this._select(ROLES);
    this.root.appendChild(this._labeled("Role", this.roleSelect));

    // Shared
    this.channel = this._text("default");
    this.rowChannel = this._labeled("Channel", this.channel);

    // Trigger / pickup
    this.shape = this._select([["sphere", "Sphere"], ["box", "Box"]]);
    this.rowShape = this._labeled("Shape", this.shape);
    this.radius = this._number(4, 0.5);
    this.rowRadius = this._labeled("Radius", this.radius);

    // Trigger
    this.emitOnEnter = this._text("");
    this.rowEnter = this._labeled("Emit enter", this.emitOnEnter);
    this.emitOnExit = this._text("");
    this.rowExit = this._labeled("Emit exit", this.emitOnExit);
    this.teleportTo = this._text("");
    this.rowTeleport = this._labeled("Teleport to", this.teleportTo);
    this.once = this._checkbox("Fire once");

    // Door
    this.listenOpen = this._text("");
    this.rowListenOpen = this._labeled("Open on", this.listenOpen);
    this.listenClose = this._text("");
    this.rowListenClose = this._labeled("Close on", this.listenClose);
    this.moveX = this._number(0, 0.1);
    this.moveY = this._number(0, 0.1);
    this.moveZ = this._number(0, 0.1);
    this.rowMove = this._labeled("Move xyz", this._triple(this.moveX, this.moveY, this.moveZ));
    this.rotX = this._number(0, 0.1);
    this.rotY = this._number(0, 0.1);
    this.rotZ = this._number(0, 0.1);
    this.rowRotate = this._labeled("Rotate xyz", this._triple(this.rotX, this.rotY, this.rotZ));
    this.duration = this._number(0.6, 0.1);
    this.rowDuration = this._labeled("Duration", this.duration);
    this.startOpen = this._checkbox("Start open");

    // Sign
    this.text = this._textarea("");
    this.rowText = this._labeled("Text", this.text);
    this.showRadius = this._number(5, 0.5);
    this.rowShowRadius = this._labeled("Show radius", this.showRadius);

    // Pickup
    this.emitOnCollect = this._text("");
    this.rowCollect = this._labeled("Emit collect", this.emitOnCollect);
    this.respawn = this._checkbox("Respawn");

    // Spawn
    this.spawnName = this._text("spawn");
    this.rowSpawnName = this._labeled("Name", this.spawnName);

    const toggles = document.createElement("div");
    Object.assign(toggles.style, { display: "flex", gap: "12px", flexWrap: "wrap" });
    toggles.appendChild(this.once.label);
    toggles.appendChild(this.startOpen.label);
    toggles.appendChild(this.respawn.label);

    for (const row of [
      this.rowChannel, this.rowShape, this.rowRadius,
      this.rowEnter, this.rowExit, this.rowTeleport,
      this.rowListenOpen, this.rowListenClose, this.rowMove, this.rowRotate, this.rowDuration,
      this.rowText, this.rowShowRadius,
      this.rowCollect, this.rowSpawnName,
    ]) {
      this.root.appendChild(row);
    }
    this.root.appendChild(toggles);

    const controls = [
      this.roleSelect, this.channel, this.shape, this.radius, this.emitOnEnter, this.emitOnExit,
      this.teleportTo, this.once.input, this.listenOpen, this.listenClose,
      this.moveX, this.moveY, this.moveZ, this.rotX, this.rotY, this.rotZ, this.duration, this.startOpen.input,
      this.text, this.showRadius, this.emitOnCollect, this.respawn.input, this.spawnName,
    ];
    for (const control of controls) {
      control.addEventListener("change", () => this._emit());
    }
    this.roleSelect.addEventListener("change", () => this._showFor(this.roleSelect.value));

    this.setObject(null);
  }

  setObject(object) {
    if (object === this.object) return;
    this.object = object;
    if (!object) {
      this.info.textContent = "No object selected.";
      this._setEnabled(false);
      return;
    }
    this._setEnabled(true);
    const it = object.userData?.interaction ?? null;
    const role = it?.role ?? "none";
    this.roleSelect.value = role;
    this.channel.value = it?.channel ?? "default";
    this.shape.value = it?.shape ?? "sphere";
    this.radius.value = it?.radius ?? 4;
    this.emitOnEnter.value = listToStr(it?.emitOnEnter);
    this.emitOnExit.value = listToStr(it?.emitOnExit);
    this.teleportTo.value = it?.teleportTo ?? "";
    this.once.input.checked = it?.once ?? false;
    this.listenOpen.value = listToStr(it?.listenOpen);
    this.listenClose.value = listToStr(it?.listenClose);
    this.moveX.value = it?.move?.x ?? 0;
    this.moveY.value = it?.move?.y ?? 0;
    this.moveZ.value = it?.move?.z ?? 0;
    this.rotX.value = it?.rotate?.x ?? 0;
    this.rotY.value = it?.rotate?.y ?? 0;
    this.rotZ.value = it?.rotate?.z ?? 0;
    this.duration.value = it?.duration ?? 0.6;
    this.startOpen.input.checked = it?.startOpen ?? false;
    this.text.value = it?.text ?? "";
    this.showRadius.value = it?.showRadius ?? 5;
    this.emitOnCollect.value = listToStr(it?.emitOnCollect);
    this.respawn.input.checked = it?.respawn ?? false;
    this.spawnName.value = it?.name ?? "spawn";
    this.info.textContent = role === "none" ? "Tag this object with an interaction." : `Role: ${role}`;
    this._showFor(role);
  }

  // Build the raw (unsanitized) interaction shape from current controls. The host
  // sanitizes this before storing. Role "none" → null.
  getInteraction() {
    const role = this.roleSelect.value;
    if (role === "none") return null;
    if (role === "trigger") {
      return {
        role, channel: this.channel.value, shape: this.shape.value, radius: num(this.radius.value, 4),
        emitOnEnter: parseList(this.emitOnEnter.value), emitOnExit: parseList(this.emitOnExit.value),
        teleportTo: this.teleportTo.value.trim() || undefined, once: this.once.input.checked,
      };
    }
    if (role === "door") {
      return {
        role, channel: this.channel.value,
        listenOpen: parseList(this.listenOpen.value), listenClose: parseList(this.listenClose.value),
        move: { x: num(this.moveX.value, 0), y: num(this.moveY.value, 0), z: num(this.moveZ.value, 0) },
        rotate: { x: num(this.rotX.value, 0), y: num(this.rotY.value, 0), z: num(this.rotZ.value, 0) },
        duration: num(this.duration.value, 0.6), startOpen: this.startOpen.input.checked,
      };
    }
    if (role === "sign") {
      return { role, text: this.text.value, showRadius: num(this.showRadius.value, 5) };
    }
    if (role === "pickup") {
      return { role, channel: this.channel.value, radius: num(this.radius.value, 4), emitOnCollect: parseList(this.emitOnCollect.value), respawn: this.respawn.input.checked };
    }
    if (role === "spawn") {
      return { role, name: this.spawnName.value.trim() || "spawn" };
    }
    return null;
  }

  _emit() {
    if (!this.object) return;
    this.onChange?.(this.getInteraction());
  }

  // Show only the rows relevant to the chosen role.
  _showFor(role) {
    const show = (row, on) => { row.style.display = on ? "grid" : "none"; };
    show(this.rowChannel, role === "trigger" || role === "door" || role === "pickup");
    show(this.rowShape, role === "trigger");
    show(this.rowRadius, role === "trigger" || role === "pickup");
    show(this.rowEnter, role === "trigger");
    show(this.rowExit, role === "trigger");
    show(this.rowTeleport, role === "trigger");
    show(this.rowListenOpen, role === "door");
    show(this.rowListenClose, role === "door");
    show(this.rowMove, role === "door");
    show(this.rowRotate, role === "door");
    show(this.rowDuration, role === "door");
    show(this.rowText, role === "sign");
    show(this.rowShowRadius, role === "sign");
    show(this.rowCollect, role === "pickup");
    show(this.rowSpawnName, role === "spawn");
    this.once.label.style.display = role === "trigger" ? "flex" : "none";
    this.startOpen.label.style.display = role === "door" ? "flex" : "none";
    this.respawn.label.style.display = role === "pickup" ? "flex" : "none";
  }

  _setEnabled(enabled) {
    this.roleSelect.disabled = !enabled;
    this.roleSelect.style.opacity = enabled ? "1" : "0.5";
    if (!enabled) this._showFor("none");
  }

  // --- DOM helpers ------------------------------------------------------------

  _select(options) {
    const select = document.createElement("select");
    this._inputStyle(select);
    for (const [value, label] of options) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    }
    return select;
  }

  _text(value) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    this._inputStyle(input);
    return input;
  }

  _textarea(value) {
    const area = document.createElement("textarea");
    area.value = value;
    area.rows = 2;
    this._inputStyle(area);
    return area;
  }

  _number(value, step) {
    const input = document.createElement("input");
    input.type = "number";
    input.step = step;
    input.value = value;
    this._inputStyle(input);
    return input;
  }

  _checkbox(label) {
    const input = document.createElement("input");
    input.type = "checkbox";
    const wrap = document.createElement("label");
    Object.assign(wrap.style, { display: "none", alignItems: "center", gap: "6px", color: "#8fa899", fontSize: "11px" });
    wrap.appendChild(input);
    wrap.appendChild(document.createTextNode(label));
    return { input, label: wrap };
  }

  _triple(a, b, c) {
    const wrap = document.createElement("div");
    Object.assign(wrap.style, { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4px" });
    wrap.append(a, b, c);
    return wrap;
  }

  _labeled(label, control) {
    const wrap = document.createElement("label");
    Object.assign(wrap.style, { display: "none", gridTemplateColumns: "70px 1fr", gap: "8px", alignItems: "center" });
    const span = document.createElement("span");
    span.textContent = label;
    span.style.color = "#8fa899";
    span.style.fontSize = "11px";
    wrap.appendChild(span);
    wrap.appendChild(control);
    return wrap;
  }

  _inputStyle(el) {
    Object.assign(el.style, {
      width: "100%",
      font: "inherit",
      fontSize: "11px",
      padding: "6px 8px",
      color: "#d7e6dc",
      background: "rgba(127,220,160,0.08)",
      border: "1px solid rgba(120,200,140,0.25)",
      borderRadius: "7px",
    });
  }
}

function parseList(value) {
  if (typeof value !== "string") return [];
  return value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

function listToStr(list) {
  return Array.isArray(list) ? list.join(", ") : "";
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
