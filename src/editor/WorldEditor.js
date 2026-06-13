import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { getHeight } from "../terrain/terrainSampling.js";
import { AssetLibrary } from "./AssetLibrary.js";
import { ColliderInspector } from "./ColliderInspector.js";
import { SceneSerializer } from "./SceneSerializer.js";
import { ReliefAssetTool } from "./ReliefAssetTool.js";
import { getCollider } from "../physics/ColliderProxy.js";
import { WorldObjectManager } from "../world/WorldObjectManager.js";

export class WorldEditor {
  constructor({ scene, camera, renderer, terrain, input, colliderSystem, getGrassStats, onWorldChanged, onOpen, onClose }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.terrain = terrain;
    this.input = input;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.colliderSystem = colliderSystem;
    this.getGrassStats = getGrassStats;
    this.isOpen = false;

    this.assets = new AssetLibrary();
    this.manager = new WorldObjectManager(scene, { colliderSystem, onChange: onWorldChanged });
    this.serializer = new SceneSerializer(this.manager);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.selectedAsset = this.assets.list()[0];
    this.selectedObject = null;
    this._transformStartBox = null;
    this._transformUpdates = 0;
    this.stats = {
      lastActionMs: 0,
      transformUpdates: 0,
      saveSerializeMs: 0,
      saveWriteMs: 0,
    };

    this.transform = new TransformControls(camera, renderer.domElement);
    this.transform.setMode("translate");
    this.transform.setSize(0.85);
    this.transform.addEventListener("objectChange", () => {
      this._transformUpdates++;
      this.stats.transformUpdates++;
      this._refreshSelectionLabel();
    });
    this.transform.addEventListener("mouseDown", () => {
      this._transformStartBox = this.selectedObject ? this.manager.getWorldBox(this.selectedObject) : null;
      this._transformUpdates = 0;
    });
    this.transform.addEventListener("mouseUp", () => {
      const t0 = performance.now();
      if (this.selectedObject) this.manager.commitObjectChange(this.selectedObject, this._transformStartBox);
      this.stats.lastActionMs = performance.now() - t0;
      this._transformStartBox = null;
      this._refreshPerf();
    });
    scene.add(this.transform.getHelper());

    this.reliefTool = new ReliefAssetTool({
      onCreateAsset: (asset) => {
        const stored = this.assets.add(asset);
        this.selectedAsset = stored;
        this._renderAssetList();
      },
    });

    this._buildDOM();
    this._bind();
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.root.style.display = "flex";
    this.input?.setEnabled?.(false);
    if (document.pointerLockElement) document.exitPointerLock();
    this.onOpen?.();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.style.display = "none";
    this.transform.detach();
    this.input?.setEnabled?.(true);
    this.onClose?.();
  }

  update() {
    if (!this.isOpen) return;
    this.transform.enabled = true;
    this._refreshPerf();
  }

  _buildDOM() {
    const root = document.createElement("div");
    Object.assign(root.style, {
      position: "fixed",
      left: "0",
      top: "0",
      bottom: "0",
      zIndex: "35",
      width: "318px",
      display: "none",
      flexDirection: "column",
      gap: "12px",
      padding: "16px",
      overflowY: "auto",
      color: "#d7e6dc",
      background: "rgba(8, 13, 11, 0.9)",
      borderRight: "1px solid rgba(120,200,140,0.24)",
      backdropFilter: "blur(8px)",
      font: '12px/1.45 "SF Mono", ui-monospace, Menlo, Consolas, monospace',
    });
    root.innerHTML = `
      <div style="font-size:13px;letter-spacing:.14em;color:#7fdca0">WORLD BUILDER</div>
      <div style="color:#8fa899;font-size:11px">Choose an asset, click terrain to place it, then select objects to transform.</div>
    `;

    this.assetList = document.createElement("div");
    Object.assign(this.assetList.style, { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" });
    root.appendChild(this._section("Assets", this.assetList));

    const importRow = document.createElement("div");
    Object.assign(importRow.style, { display: "flex", gap: "8px", flexWrap: "wrap" });
    importRow.appendChild(this._button("Import GLB", () => this.fileInput.click()));
    importRow.appendChild(this._button("Create Relief", () => this.reliefTool.open()));
    root.appendChild(importRow);

    this.fileInput = document.createElement("input");
    this.fileInput.type = "file";
    this.fileInput.accept = ".glb,.gltf,model/gltf-binary,model/gltf+json";
    this.fileInput.style.display = "none";
    root.appendChild(this.fileInput);

    const modes = document.createElement("div");
    Object.assign(modes.style, { display: "flex", gap: "8px", flexWrap: "wrap" });
    modes.appendChild(this._button("Move", () => this.transform.setMode("translate")));
    modes.appendChild(this._button("Rotate", () => this.transform.setMode("rotate")));
    modes.appendChild(this._button("Scale", () => this.transform.setMode("scale")));
    root.appendChild(this._section("Transform", modes));

    const actions = document.createElement("div");
    Object.assign(actions.style, { display: "flex", gap: "8px", flexWrap: "wrap" });
    actions.appendChild(this._button("Duplicate", () => this._select(this.manager.duplicate(this.selectedObject))));
    actions.appendChild(this._button("Delete", () => this._deleteSelected()));
    actions.appendChild(this._button("Save", () => this._save()));
    actions.appendChild(this._button("Load", () => this._load()));
    actions.appendChild(this._button("Close", () => this.close()));
    root.appendChild(actions);

    this.colliderInspector = new ColliderInspector({
      onChange: (collider) => {
        if (!this.selectedObject) return;
        this.selectedObject.userData.collider = { ...this.selectedObject.userData.collider, ...collider };
        this.manager._changed();
        this._refreshSelectionLabel();
      },
      onToggleDebug: () => this.colliderSystem?.toggleDebug(),
    });
    root.appendChild(this._section("Collider", this.colliderInspector.root));

    this.selectionLabel = document.createElement("div");
    Object.assign(this.selectionLabel.style, { marginTop: "auto", color: "#8fa899", fontSize: "11px" });
    root.appendChild(this.selectionLabel);

    this.perfLabel = document.createElement("div");
    Object.assign(this.perfLabel.style, { color: "#8fa899", fontSize: "10px", whiteSpace: "pre-line" });
    root.appendChild(this.perfLabel);

    document.body.appendChild(root);
    this.root = root;
    this._renderAssetList();
    this._refreshSelectionLabel();
  }

  _section(label, child) {
    const wrap = document.createElement("div");
    Object.assign(wrap.style, { display: "flex", flexDirection: "column", gap: "7px" });
    const heading = document.createElement("div");
    heading.textContent = label;
    heading.style.color = "#8fa899";
    heading.style.fontSize = "11px";
    wrap.appendChild(heading);
    wrap.appendChild(child);
    return wrap;
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

  _renderAssetList() {
    this.assetList.replaceChildren();
    for (const asset of this.assets.list()) {
      const button = this._button(asset.name, () => {
        this.selectedAsset = asset;
        this._renderAssetList();
      });
      if (asset.id === this.selectedAsset?.id) {
        button.style.borderColor = "#7fdca0";
        button.style.color = "#7fdca0";
      }
      this.assetList.appendChild(button);
    }
  }

  _bind() {
    this.renderer.domElement.addEventListener("pointerdown", (event) => {
      if (!this.isOpen || this.reliefTool.isOpen || this.transform.dragging) return;
      if (event.button !== 0) return;
      this._handleCanvasClick(event);
    });

    window.addEventListener("keydown", (event) => {
      if (!this.isOpen || this.reliefTool.isOpen) return;
      if (event.code === "Delete" || event.code === "Backspace") this._deleteSelected();
      if (event.code === "Escape") this.close();
      if (event.code === "KeyQ") this.transform.setMode("translate");
      if (event.code === "KeyE") this.transform.setMode("rotate");
      if (event.code === "KeyR") this.transform.setMode("scale");
    });

    this.fileInput.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file) this._importGLTF(file);
      event.target.value = "";
    });

  }

  _handleCanvasClick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const objectHits = this.raycaster.intersectObjects([...this.manager.objects.values()], true);
    if (objectHits.length) {
      this._select(this._findEditorRoot(objectHits[0].object));
      return;
    }

    const terrainHits = this.raycaster.intersectObject(this.terrain.mesh, false);
    if (!terrainHits.length || !this.selectedAsset) {
      this._select(null);
      return;
    }
    const point = terrainHits[0].point;
    point.y = getHeight(point.x, point.z);
    this._select(this.manager.addFromAsset(this.selectedAsset, point));
  }

  _findEditorRoot(object) {
    let current = object;
    while (current && !current.userData.editorObject) current = current.parent;
    return current;
  }

  _select(object) {
    this.selectedObject = object;
    if (object) this.transform.attach(object);
    else this.transform.detach();
    this._refreshSelectionLabel();
  }

  _deleteSelected() {
    const object = this.selectedObject;
    this._select(null);
    this.manager.remove(object);
  }

  _save() {
    const t0 = performance.now();
    const document = this.manager.serialize();
    const t1 = performance.now();
    localStorage.setItem("grass-world-builder-save", JSON.stringify(document));
    const t2 = performance.now();
    this.stats.saveSerializeMs = t1 - t0;
    this.stats.saveWriteMs = t2 - t1;
    this.stats.lastActionMs = t2 - t0;
    this.selectionLabel.textContent = `Saved ${document.objects.length} object(s) to localStorage.`;
    this._refreshPerf();
  }

  _load() {
    const document = this.serializer.load();
    this._select(null);
    this.selectionLabel.textContent = document
      ? `Loaded ${document.objects.length} object(s) from localStorage.`
      : "No saved world found.";
  }

  _refreshSelectionLabel() {
    if (!this.selectionLabel) return;
    if (!this.selectedObject) {
      this.selectionLabel.textContent = "No object selected.";
      this.colliderInspector?.setObject(null);
      return;
    }
    this.colliderInspector?.setObject(this.selectedObject);
    const p = this.selectedObject.position;
    this.selectionLabel.textContent = `Selected ${this.selectedObject.name}: ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`;
    this._refreshPerf();
  }

  _refreshPerf() {
    if (!this.perfLabel) return;
    const grass = this.getGrassStats?.() ?? {};
    const colliders = [...this.manager.objects.values()].filter((object) => getCollider(object).type !== "none").length;
    const exclusions = [...this.manager.objects.values()].filter((object) => getCollider(object).excludeGrass).length;
    this.perfLabel.textContent =
      `editor action ${this.stats.lastActionMs.toFixed(2)} ms\n` +
      `objects ${this.manager.objects.size} · colliders ${colliders} · exclusions ${exclusions}\n` +
      `grass rebuilt ${grass.rebuiltThisFrame ?? 0} · queued ${grass.rebuildQueueLength ?? 0}\n` +
      `transform updates ${this.stats.transformUpdates}\n` +
      `save serialize ${this.stats.saveSerializeMs.toFixed(2)} ms\n` +
      `localStorage ${this.stats.saveWriteMs.toFixed(2)} ms`;
  }

  _importGLTF(file) {
    const url = URL.createObjectURL(file);
    new GLTFLoader().load(
      url,
      (gltf) => {
        const asset = this.assets.add({ type: "gltf", name: file.name.replace(/\.(glb|gltf)$/i, ""), scene: gltf.scene });
        this.selectedAsset = asset;
        this._renderAssetList();
        URL.revokeObjectURL(url);
      },
      undefined,
      (error) => {
        console.error("Failed to import GLTF", error);
        URL.revokeObjectURL(url);
      }
    );
  }
}
