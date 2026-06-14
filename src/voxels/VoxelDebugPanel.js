import * as THREE from "three";
import { voxelizeObjects } from "./Voxelizer.js";
import { raycastVoxels } from "./VoxelRaycast.js";
import { VoxelDebugMesh } from "./VoxelDebugMesh.js";
import { VOXEL_LIMITS, clampInt } from "./VoxelTypes.js";

// Editor-only Voxel Debug Lab panel: voxelize the current selection, show the
// occupancy as one instanced cube mesh, and cast a debug ray (from the camera or
// programmatically) through the grid. It owns its transient debug mesh and adds
// it directly to the scene (NOT via the WorldObjectManager), so nothing here is
// serialized or exported. Lives only in editor builds — absent at runtime.

export class VoxelDebugPanel {
  constructor({ scene, camera, getSelection } = {}) {
    this.scene = scene;
    this.camera = camera;
    this.getSelection = typeof getSelection === "function" ? getSelection : () => [];

    this.grid = null;
    this.debugMesh = null;
    this.stats = null;
    this.lastHit = null;

    this._buildDOM();
  }

  // --- public lab API (also driven by the browser proof via __WORLD_EDITOR__) --

  voxelize() {
    const objects = (this.getSelection() ?? []).filter(Boolean);
    if (objects.length === 0) {
      this._setInfo("Select one or more objects, then voxelize.");
      return null;
    }
    const resolution = clampInt(this.resInput.value, VOXEL_LIMITS.MIN_RESOLUTION, VOXEL_LIMITS.MAX_RESOLUTION, VOXEL_LIMITS.DEFAULT_RESOLUTION);
    const { grid, stats } = voxelizeObjects(objects, { resolution });
    this._clearMesh();
    this.grid = grid;
    this.stats = stats;
    this.lastHit = null;

    if (grid && stats.occupied > 0) {
      this.debugMesh = new VoxelDebugMesh(grid);
      this.scene.add(this.debugMesh.object3D);
      stats.debugInstances = this.debugMesh.instanceCount;
      stats.debugTruncated = this.debugMesh.truncated;
      stats.drawCalls = this.debugMesh.drawCalls;
    } else {
      stats.debugInstances = 0;
      stats.drawCalls = 0;
    }
    this._renderStats();
    return stats;
  }

  clear() {
    this._clearMesh();
    this.grid = null;
    this.stats = null;
    this.lastHit = null;
    this._renderStats();
    this._setHit(null);
  }

  // Cast a ray through the grid. origin/direction default to the editor camera.
  raycast(origin, direction, opts) {
    if (!this.grid) return null;
    let o = origin;
    let d = direction;
    if (!o || !d) {
      const p = this.camera.getWorldPosition(new THREE.Vector3());
      const f = this.camera.getWorldDirection(new THREE.Vector3());
      o = o ?? { x: p.x, y: p.y, z: p.z };
      d = d ?? { x: f.x, y: f.y, z: f.z };
    }
    const hit = raycastVoxels(this.grid, o, d, opts ?? {});
    this.lastHit = hit;
    this._setHit(hit);
    return hit;
  }

  getStats() {
    return this.stats;
  }

  getLastHit() {
    return this.lastHit;
  }

  getDebugDrawCalls() {
    return this.debugMesh?.drawCalls ?? 0;
  }

  // World center of the first occupied cell (deterministic order), for tooling.
  getOccupiedSample() {
    if (!this.grid || this.grid.occupiedCount === 0) return null;
    let found = null;
    this.grid.forEachOccupied((x, y, z) => {
      if (!found) found = { x, y, z };
    });
    if (!found) return null;
    const c = this.grid.cellCenter(found.x, found.y, found.z, new THREE.Vector3());
    return { cell: found, center: { x: c.x, y: c.y, z: c.z } };
  }

  dispose() {
    this._clearMesh();
    this.root?.remove();
  }

  // --- internals --------------------------------------------------------------

  _clearMesh() {
    if (this.debugMesh) {
      this.scene.remove(this.debugMesh.object3D);
      this.debugMesh.dispose();
      this.debugMesh = null;
    }
  }

  _buildDOM() {
    this.root = document.createElement("div");
    Object.assign(this.root.style, { display: "flex", flexDirection: "column", gap: "7px" });

    this.info = document.createElement("div");
    Object.assign(this.info.style, { color: "#8fa899", fontSize: "10px", minHeight: "12px" });
    this._setInfo("Select objects, then voxelize for an occupancy + ray-traversal preview.");
    this.root.appendChild(this.info);

    this.resInput = this._number(VOXEL_LIMITS.DEFAULT_RESOLUTION, 1);
    this.resInput.min = VOXEL_LIMITS.MIN_RESOLUTION;
    this.resInput.max = VOXEL_LIMITS.MAX_RESOLUTION;
    this.root.appendChild(this._labeled(`Resolution (≤${VOXEL_LIMITS.MAX_RESOLUTION})`, this.resInput));

    const buttons = document.createElement("div");
    Object.assign(buttons.style, { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" });
    buttons.appendChild(this._button("Voxelize", () => this.voxelize()));
    buttons.appendChild(this._button("Clear", () => this.clear()));
    buttons.appendChild(this._button("Cast ray (cam)", () => this.raycast()));
    this.root.appendChild(buttons);

    this.statsEl = document.createElement("div");
    Object.assign(this.statsEl.style, { color: "#8fa899", fontSize: "10px", whiteSpace: "pre-line", minHeight: "12px" });
    this.root.appendChild(this.statsEl);

    this.hitEl = document.createElement("div");
    Object.assign(this.hitEl.style, { color: "#8fa899", fontSize: "10px", whiteSpace: "pre-line", minHeight: "12px" });
    this.root.appendChild(this.hitEl);
  }

  _renderStats() {
    const s = this.stats;
    if (!s) {
      this.statsEl.textContent = "";
      return;
    }
    const d = s.dims;
    this.statsEl.textContent =
      `grid ${d.x}×${d.y}×${d.z}  cell ${s.cellSize.toFixed(3)}\n` +
      `occupied ${s.occupied} / ${s.cellCount}  draws ${s.drawCalls ?? 0}\n` +
      `tris ${s.triangles}  tests ${s.tests}` +
      (s.truncated ? "  ⚠ truncated" : "");
  }

  _setHit(hit) {
    if (!hit) {
      this.hitEl.textContent = "";
      return;
    }
    if (!hit.hit) {
      this.hitEl.textContent = `ray: no hit (${hit.reason})`;
      return;
    }
    const v = hit.voxel;
    this.hitEl.textContent =
      `ray hit voxel ${v.x},${v.y},${v.z}  face ${hit.face}\n` +
      `id ${hit.id}  dist ${hit.distance.toFixed(2)}  steps ${hit.steps}`;
  }

  _setInfo(text) {
    this.info.textContent = text;
  }

  // --- DOM helpers ------------------------------------------------------------

  _number(value, step) {
    const input = document.createElement("input");
    input.type = "number";
    input.step = step;
    input.value = value;
    this._inputStyle(input);
    return input;
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
    Object.assign(wrap.style, { display: "grid", gridTemplateColumns: "110px 1fr", gap: "8px", alignItems: "center" });
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
