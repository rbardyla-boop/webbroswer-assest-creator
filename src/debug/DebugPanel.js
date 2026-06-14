// On-screen debug HUD. Pure DOM (no canvas), updated once per frame with a
// snapshot of system stats. Toggle visibility with the configured key.

export class DebugPanel {
  constructor({ visible = true } = {}) {
    this.visible = visible;
    this.fps = 60;
    this._acc = 0;
    this._frames = 0;
    this._lastReport = 0;

    this.el = document.createElement("div");
    this.el.id = "debug-panel";
    Object.assign(this.el.style, {
      position: "fixed",
      left: "16px",
      top: "14px",
      zIndex: "20",
      minWidth: "210px",
      padding: "11px 13px",
      background: "rgba(14, 18, 16, 0.82)",
      border: "1px solid rgba(120, 200, 140, 0.22)",
      borderRadius: "10px",
      backdropFilter: "blur(8px)",
      font: '11px/1.6 "SF Mono", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
      color: "#d7e6dc",
      pointerEvents: "none",
      whiteSpace: "pre",
    });
    document.body.appendChild(this.el);
    this._applyVisibility();
  }

  toggle() {
    this.visible = !this.visible;
    this._applyVisibility();
  }

  _applyVisibility() {
    this.el.style.display = this.visible ? "block" : "none";
  }

  // dt in seconds. data carries everything the HUD displays.
  update(dt, data) {
    // Smooth FPS, reported a few times a second so it reads steadily.
    this._acc += dt;
    this._frames += 1;
    this._lastReport += dt;
    if (this._lastReport >= 0.25) {
      this.fps = this._frames / this._acc;
      this._acc = 0;
      this._frames = 0;
      this._lastReport = 0;
    }
    if (!this.visible) return;

    const s = data.grass;
    const trees = data.trees;
    const p = data.player;
    const lod = s.lod;
    const lodTotal = Math.max(1, lod[0] + lod[1] + lod[2]);
    const pct = (n) => Math.round((n / lodTotal) * 100);
    const k = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));

    const fpsColor =
      this.fps >= 55 ? "#7fdca0" : this.fps >= 30 ? "#e6c463" : "#e0795a";

    this.el.innerHTML =
      `<span style="color:#7fdca0;letter-spacing:.12em">GRASS WORLD · DEBUG</span>\n` +
      `<span style="color:#8fa899">fps        </span><b style="color:${fpsColor}">${this.fps.toFixed(0)}</b>\n` +
      `<span style="color:#8fa899">camera     </span>${data.cameraMode}\n` +
      `<span style="color:#8fa899">draw calls </span>${data.drawCalls}\n` +
      depthLine(data.depth) +
      visibilityLines(data.visibility) +
      `<span style="color:#8fa899">patches    </span>${s.visiblePatches} vis / ${s.activePatches} active\n` +
      `<span style="color:#8fa899">blades~    </span>${k(s.visibleBlades)}\n` +
      `<span style="color:#8fa899">LOD 0/1/2  </span>${lod[0]}/${lod[1]}/${lod[2]}  (${pct(lod[0])}/${pct(lod[1])}/${pct(lod[2])}%)\n` +
      `<span style="color:#8fa899">build queue</span>${s.queueLength} (+${s.builtThisFrame}/f)\n` +
      treeLines(trees, k) +
      bushLines(data.bushes, k) +
      `<span style="color:#8fa899">player xyz </span>${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}\n` +
      `<span style="color:#8fa899">grounded   </span>${data.grounded ? "yes" : "airborne"}`;
  }

  dispose() {
    this.el.remove();
  }
}

function visibilityLines(v) {
  if (!v || !v.total) return "";
  const off = v.enabled === false ? " (off)" : "";
  return (
    `<span style="color:#7fdca0;letter-spacing:.12em">VISIBILITY${off}</span>\n` +
    `<span style="color:#8fa899">vis/warm   </span>${v.visible}/${v.warm}\n` +
    `<span style="color:#8fa899">sleep/unld </span>${v.sleeping}/${v.unloaded}  of ${v.total}\n`
  );
}

function depthLine(depth) {
  if (!depth) return "";
  // reverse-z (green) when active; normal-z amber when reverse-Z was requested
  // but unsupported, grey when never requested.
  const color = depth.active ? "#7fdca0" : depth.requested ? "#e6c463" : "#8fa899";
  const note = depth.active ? "" : depth.requested ? " (no EXT_clip_control)" : " (off)";
  return `<span style="color:#8fa899">depth      </span><b style="color:${color}">${depth.mode}</b>${note}\n`;
}

function bushLines(bushes, k) {
  if (!bushes) return "";
  return (
    `<span style="color:#7fdca0;letter-spacing:.12em">BUSHES</span>\n` +
    `<span style="color:#8fa899">patches    </span>${bushes.visiblePatches} vis / ${bushes.activePatches} active\n` +
    `<span style="color:#8fa899">bushes~    </span>${k(bushes.visibleBushes)}\n` +
    `<span style="color:#8fa899">LOD 0/1/2  </span>${bushes.lod[0]}/${bushes.lod[1]}/${bushes.lod[2]}\n` +
    `<span style="color:#8fa899">bush draws </span>${bushes.drawCalls}\n`
  );
}

function treeLines(trees, k) {
  if (!trees) return "";
  return (
    `<span style="color:#7fdca0;letter-spacing:.12em">TREES</span>\n` +
    `<span style="color:#8fa899">patches    </span>${trees.visiblePatches} vis / ${trees.activePatches} active\n` +
    `<span style="color:#8fa899">trees~     </span>${k(trees.visibleTrees)}\n` +
    `<span style="color:#8fa899">LOD 0/1/2  </span>${trees.lod[0]}/${trees.lod[1]}/${trees.lod[2]}\n` +
    `<span style="color:#8fa899">tree queue </span>${trees.queueLength} (+${trees.builtThisFrame}/f) rebuild ${trees.rebuildQueueLength} (+${trees.rebuiltThisFrame}/f)\n` +
    `<span style="color:#8fa899">tree free  </span>${trees.disposedThisFrame}/f · rebuild ${trees.lastRebuildMs.toFixed(2)}ms\n` +
    `<span style="color:#8fa899">tree draws </span>${trees.drawCalls}\n`
  );
}
