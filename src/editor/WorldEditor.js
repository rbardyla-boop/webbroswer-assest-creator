import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { getHeight } from "../terrain/terrainSampling.js";
import { ColliderInspector } from "./ColliderInspector.js";
import { ReliefAssetTool } from "./ReliefAssetTool.js";
import { getCollider } from "../physics/ColliderProxy.js";
import { WorldSerializer } from "../world/WorldSerializer.js";
import { exportWorldDocument, importWorldDocumentFile } from "../world/WorldExport.js";
import { downloadWorldPack, downloadPlayableBuildZip } from "../export/PlayableBuildExport.js";
import { summarizeExport } from "../export/BuildReport.js";
import { ModRegistry } from "../mods/ModRegistry.js";
import { ModPanel } from "./ModPanel.js";
import { importModFile } from "../mods/ModImporter.js";
import { downloadModPackage, downloadModPackageZip } from "../mods/ModExporter.js";
import { AnimationPanel } from "./AnimationPanel.js";
import { AnimationPreview } from "../animation/AnimationPreview.js";
import { InteractionPanel } from "./InteractionPanel.js";
import { sanitizeInteraction } from "../interaction/InteractionValidation.js";
import { LightingPanel } from "./LightingPanel.js";
import { sanitizeLighting } from "../lighting/LightingValidation.js";
import { applyLighting } from "../lighting/LightingRig.js";
import { ParticlePanel } from "./ParticlePanel.js";
import { sanitizeParticles } from "../particles/ParticleValidation.js";
import { ParticleRuntime } from "../particles/ParticleRuntime.js";
import { VoxelDebugPanel } from "../voxels/VoxelDebugPanel.js";
import { ProceduralPanel } from "./ProceduralPanel.js";
import { summarizeAssetAnimation } from "../animation/AnimationMetadata.js";
import { AssetImporter } from "../assets/AssetImporter.js";
import { AssetLibrary } from "../assets/AssetLibrary.js";
import { PrefabLibrary } from "../prefabs/PrefabLibrary.js";
import { PrefabInstancer } from "../prefabs/PrefabInstancer.js";
import { PrefabPanel } from "./PrefabPanel.js";
import { SelectionGroup } from "./SelectionGroup.js";
import { CommandStack } from "./CommandStack.js";
import { AddObjectsCommand, RemoveObjectsCommand, TransformObjectsCommand } from "./commands/WorldObjectCommands.js";
import { getSampleWorld, VERTICAL_SLICE_ID } from "../world/samples/index.js";

export class WorldEditor {
  constructor({
    scene,
    camera,
    renderer,
    terrain,
    input,
    colliderSystem,
    objectManager,
    assetLibrary,
    worldLoader,
    worldSerializer,
    lights,
    player,
    cameraController,
    treeSystem,
    grassSystem,
    bushSystem,
    getGrassStats,
    getTreeStats,
    prefabLibrary,
    modRegistry,
    onLoadWorld,
    onWorldChanged,
    onOpen,
    onClose,
  }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.terrain = terrain;
    this.input = input;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.colliderSystem = colliderSystem;
    this.worldLoader = worldLoader;
    this.worldSerializer = worldSerializer ?? new WorldSerializer();
    this.lights = lights ?? null;
    this.player = player;
    this.cameraController = cameraController;
    this.onLoadWorld = onLoadWorld;
    this.treeSystem = treeSystem;
    this.grassSystem = grassSystem ?? null;
    this.bushSystem = bushSystem ?? null;
    this.assetLibrary = assetLibrary ?? new AssetLibrary();
    this.assetImporter = new AssetImporter(this.assetLibrary);
    this.getGrassStats = getGrassStats;
    this.getTreeStats = getTreeStats;
    this.isOpen = false;

    this.prefabLibrary = prefabLibrary ?? new PrefabLibrary();
    this.prefabInstancer = new PrefabInstancer(objectManager);
    this.armedPrefab = null;
    this.lastExportReport = null;
    this.modRegistry = modRegistry ?? new ModRegistry();
    this.animationPreview = new AnimationPreview();
    // Editor-side particle preview: runs all emitters live while the editor is
    // open so VFX are authored with feedback (it is ambient, not gameplay).
    this.particlePreview = new ParticleRuntime({ scene: this.scene });

    this.manager = objectManager;
    this.selection = new SelectionGroup({ scene: this.scene, manager: objectManager });
    // Bounded in-memory undo/redo for spatial authoring (place / prefab / dup /
    // delete / transform). Cleared whenever the world is reloaded so history
    // never references objects from a torn-down world.
    this.history = new CommandStack({ limit: 100, onChange: () => this._refreshHistoryControls() });
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.selectedAsset = this.assetLibrary.list()[0];
    this._transformStartBox = null;
    this._dragBefore = null;
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
      // Group drag: move every selected object this tick (visual only, cheap).
      if (this.selection.isMulti) this.selection.applyDrag();
      this._refreshSelectionLabel();
    });
    this.transform.addEventListener("mouseDown", () => {
      // Snapshot the pre-drag transforms so the finished move can be recorded as
      // a single undoable command (one per drag, not per gizmo tick).
      this._dragBefore = this._snapshotTransforms(this.selection.objects);
      if (this.selection.isMulti) this.selection.beginDrag();
      else this._transformStartBox = this.selection.primary ? this.manager.getWorldBox(this.selection.primary) : null;
      this._transformUpdates = 0;
    });
    this.transform.addEventListener("mouseUp", () => {
      const t0 = performance.now();
      // Commit once on drag end: rebuild grass/trees for all touched boxes.
      if (this.selection.isMulti) {
        const { boxes } = this.selection.endDrag();
        this.manager._changed({ boxes });
        this.transform.attach(this.selection.pivot); // follow recentered pivot
      } else if (this.selection.primary) {
        this.manager.commitObjectChange(this.selection.primary, this._transformStartBox);
      }
      // Record the drag for undo only if it actually moved something (a bare
      // click on the gizmo must not push an empty command).
      const after = this._snapshotTransforms(this.selection.objects);
      if (this._transformsChanged(this._dragBefore, after)) {
        this.history.push(new TransformObjectsCommand(this.manager, this._dragBefore, after));
      }
      this._dragBefore = null;
      this.stats.lastActionMs = performance.now() - t0;
      this._transformStartBox = null;
      this._refreshPerf();
    });
    scene.add(this.transform.getHelper());

    this.reliefTool = new ReliefAssetTool({
      onCreateAsset: async (asset) => {
        const stored = await this.assetImporter.importRelief(asset);
        this.selectedAsset = stored;
        this._renderAssetList();
      },
    });

    this._buildDOM();
    this._bind();
  }

  // Primary selected object — preserves the Stage 1–5 single-selection API.
  get selectedObject() {
    return this.selection.primary;
  }

  setWorldContext({ terrain, objectManager, treeSystem, grassSystem, bushSystem, getGrassStats, getTreeStats }) {
    this.terrain = terrain ?? this.terrain;
    this.manager = objectManager ?? this.manager;
    this.grassSystem = grassSystem ?? this.grassSystem;
    if (objectManager) {
      this.prefabInstancer.setManager(objectManager);
      this.selection.setManager(objectManager);
    }
    this.selection.clear();
    // A reloaded world is a fresh object graph (applyLoadedWorld builds a NEW
    // WorldObjectManager, never clear()-ing the old one in place). Discard
    // history here so no parked command references a torn-down object. Every
    // world-reload path (_load/_loadSample/_importWorld/_loadModWorld) routes
    // through onLoadWorld → setWorldContext, so this is the single choke point.
    this.history.clear();
    // A reloaded world is a fresh object graph — drop any voxel-lab preview so it
    // never references torn-down meshes.
    this.voxelPanel?.clear();
    this._armPrefabPlacement(null);
    this.prefabPanel?.refresh();
    // A reloaded world brings its own lighting — refresh the editor panel from it.
    this.lightingPanel?.setLighting(this.worldLoader?.document?.lighting);
    // Restore the procedural panel from the reloaded world's generator instances.
    this.proceduralPanel?.setFromDocument(this.worldLoader?.document);
    // Rebuild the particle preview for the new world's emitters (if open).
    if (this.isOpen) this.particlePreview?.load(this.manager);
    this.treeSystem = treeSystem ?? this.treeSystem;
    this.getGrassStats = getGrassStats ?? this.getGrassStats;
    this.getTreeStats = getTreeStats ?? this.getTreeStats;
    if (this.treeSystem && this.treeEnabled) {
      this.treeEnabled.input.checked = this.treeSystem.cfg.enabled;
      this.treeRespect.input.checked = this.treeSystem.cfg.respectExclusions;
      this.treeDensity.value = this.treeSystem.cfg.density;
      this.treeVisible.value = this.treeSystem.cfg.visibleDistance;
      this.treeSeed.value = this.treeSystem.cfg.seed;
    }
    if (this.grassSystem && this.grassDensity) {
      const g = this.grassSystem.cfg;
      this.grassDensity.value = g.density;
      this.grassClump.value = g.clumpStrength ?? 0;
      this.grassClumpScale.value = g.clumpScale ?? 0.05;
      this.grassDistanceTint.value = g.distanceTint ?? 0.22;
      this.grassFresnel.value = g.fresnelIntensity ?? 0.35;
    }
    this.bushSystem = bushSystem ?? this.bushSystem;
    if (this.bushSystem && this.bushDensity) {
      const b = this.bushSystem.cfg;
      this.bushEnabled.input.checked = b.enabled;
      this.bushDensity.value = b.density;
      this.bushClump.value = b.clumpStrength ?? 0.45;
      this.bushVisible.value = b.visibleDistance;
      this.bushSeed.value = b.seed;
    }
    // A reloaded world brings a fresh Terrain instance with its own material v2.
    if (this.terrain?.getMaterialSettings && this.terrainMacro) {
      const m = this.terrain.getMaterialSettings();
      this.terrainMacro.value = m.macroIntensity;
      this.terrainMacroScale.value = m.macroScale;
      this.terrainSlopeRock.value = m.slopeRock;
      this.terrainHeightTint.value = m.heightTint;
      this.terrainDetail.value = m.detailIntensity;
    }
    this._select(null);
    this._refreshPerf();
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.root.style.display = "flex";
    this.input?.setEnabled?.(false);
    if (document.pointerLockElement) document.exitPointerLock();
    this.particlePreview.load(this.manager); // preview the world's emitters
    this.onOpen?.();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.style.display = "none";
    this.animationPreview.stop();
    this.particlePreview.clear(); // stop + remove preview particles
    this._clearSelection();
    this.input?.setEnabled?.(true);
    this.onClose?.();
  }

  update(dt = 0) {
    if (!this.isOpen) return;
    this.transform.enabled = true;
    // Advance the editor-only animation + particle previews.
    this.animationPreview.update(dt);
    this.particlePreview.update(dt);
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
    importRow.appendChild(this._button("Import Image", () => this.imageFileInput.click()));
    importRow.appendChild(this._button("Create Relief", () => this.reliefTool.open()));
    root.appendChild(importRow);

    this.fileInput = document.createElement("input");
    this.fileInput.type = "file";
    this.fileInput.accept = ".glb,.gltf,model/gltf-binary,model/gltf+json";
    this.fileInput.style.display = "none";
    root.appendChild(this.fileInput);

    this.imageFileInput = document.createElement("input");
    this.imageFileInput.type = "file";
    this.imageFileInput.accept = "image/*";
    this.imageFileInput.style.display = "none";
    root.appendChild(this.imageFileInput);

    this.worldFileInput = document.createElement("input");
    this.worldFileInput.type = "file";
    this.worldFileInput.accept = ".world.json,application/json";
    this.worldFileInput.style.display = "none";
    root.appendChild(this.worldFileInput);

    this.modFileInput = document.createElement("input");
    this.modFileInput.type = "file";
    this.modFileInput.accept = ".modpack.json,.modpack.zip,.json,.zip,application/json,application/zip";
    this.modFileInput.style.display = "none";
    root.appendChild(this.modFileInput);

    const modes = document.createElement("div");
    Object.assign(modes.style, { display: "flex", gap: "8px", flexWrap: "wrap" });
    modes.appendChild(this._button("Move", () => this.transform.setMode("translate")));
    modes.appendChild(this._button("Rotate", () => this.transform.setMode("rotate")));
    modes.appendChild(this._button("Scale", () => this.transform.setMode("scale")));
    root.appendChild(this._section("Transform", modes));

    const actions = document.createElement("div");
    Object.assign(actions.style, { display: "flex", gap: "8px", flexWrap: "wrap" });
    actions.appendChild(this._button("Duplicate", () => this._duplicateSelected()));
    actions.appendChild(this._button("Delete", () => this._deleteSelected()));
    actions.appendChild(this._button("Save World", () => this._save()));
    actions.appendChild(this._button("Load World", () => this._load()));
    actions.appendChild(this._button("Export World JSON", () => this._exportWorld()));
    actions.appendChild(this._button("Import World JSON", () => this.worldFileInput.click()));
    actions.appendChild(this._button("Load Sample World", () => this._loadSample()));
    actions.appendChild(this._button("Close", () => this.close()));
    root.appendChild(actions);

    const history = document.createElement("div");
    Object.assign(history.style, { display: "flex", flexDirection: "column", gap: "7px" });
    const historyButtons = document.createElement("div");
    Object.assign(historyButtons.style, { display: "flex", gap: "8px", flexWrap: "wrap" });
    this.undoButton = this._button("Undo", () => this._undo());
    this.redoButton = this._button("Redo", () => this._redo());
    historyButtons.appendChild(this.undoButton);
    historyButtons.appendChild(this.redoButton);
    this.historyLabel = document.createElement("div");
    Object.assign(this.historyLabel.style, { color: "#8fa899", fontSize: "10px" });
    history.appendChild(historyButtons);
    history.appendChild(this.historyLabel);
    root.appendChild(this._section("History (Ctrl+Z / Ctrl+Shift+Z)", history));

    const assetActions = document.createElement("div");
    Object.assign(assetActions.style, { display: "flex", gap: "8px", flexWrap: "wrap" });
    assetActions.appendChild(this._button("Rename Asset", () => this._renameSelectedAsset()));
    assetActions.appendChild(this._button("Delete Asset", () => this._deleteSelectedAsset()));
    assetActions.appendChild(this._button("Refresh Library", () => this._refreshAssetLibrary()));
    root.appendChild(this._section("Asset Library", assetActions));

    this.prefabPanel = new PrefabPanel({
      library: this.prefabLibrary,
      onCreatePrefab: () => this._createPrefabFromSelection(),
      onArmPlacement: (prefab) => this._armPrefabPlacement(prefab),
      onRenamePrefab: (id) => this._renamePrefab(id),
      onDeletePrefab: (id) => this._deletePrefab(id),
    });
    root.appendChild(this._section("Prefabs", this.prefabPanel.root));

    const buildActions = document.createElement("div");
    Object.assign(buildActions.style, { display: "flex", gap: "8px", flexWrap: "wrap" });
    buildActions.appendChild(this._button("Export Playable Build", () => this._exportPlayableBuild()));
    buildActions.appendChild(this._button("Export WorldPack", () => this._exportWorldPack()));
    buildActions.appendChild(this._button("Show Last Export Report", () => this._showLastExportReport()));
    root.appendChild(this._section("Playable Build", buildActions));

    this.modPanel = new ModPanel({
      registry: this.modRegistry,
      onImport: () => this.modFileInput.click(),
      onExportJson: () => this._exportWorldAsMod(false),
      onExportZip: () => this._exportWorldAsMod(true),
      onLoadWorld: (id) => this._loadModWorld(id),
      onShowDetails: (id) => this._showModDetails(id),
      onDelete: (id) => this._deleteMod(id),
      onToggleEnabled: (id, enabled) => this._toggleMod(id, enabled),
    });
    root.appendChild(this._section("Mods", this.modPanel.root));

    this.colliderInspector = new ColliderInspector({
      onChange: (collider) => {
        if (!this.selection.count) return;
        // Apply the collider/exclusion change to every selected object.
        for (const object of this.selection.objects) {
          object.userData.collider = { ...object.userData.collider, ...collider };
        }
        this.manager._changed();
        this._refreshSelectionLabel();
      },
      onToggleDebug: () => this.colliderSystem?.toggleDebug(),
    });
    root.appendChild(this._section("Collider", this.colliderInspector.root));

    this.animationPanel = new AnimationPanel({
      onChange: (override) => {
        const object = this.selection.primary;
        if (object) object.userData.animation = override;
      },
      onPlay: () => this._previewAnimation(),
      onStop: () => this.animationPreview.stop(),
    });
    root.appendChild(this._section("Animation", this.animationPanel.root));

    this.interactionPanel = new InteractionPanel({
      onChange: (raw) => {
        const object = this.selection.primary;
        if (!object) return;
        // Data-only: sanitize before storing so nothing executable is ever kept.
        object.userData.interaction = sanitizeInteraction(raw);
        this._refreshInteractionHelper();
      },
    });
    root.appendChild(this._section("Interaction", this.interactionPanel.root));

    this.lightingPanel = new LightingPanel({
      onChange: (raw) => {
        const lighting = sanitizeLighting(raw);
        if (this.worldLoader?.document) this.worldLoader.document.lighting = lighting;
        applyLighting({ lights: this.lights, scene: this.scene }, lighting);
        // Grass is manually fogged + shaded, so push the live values into its
        // shader too (otherwise edits show everywhere but the grass).
        this.grassSystem?.syncLighting?.(lighting, this.lights?.sunDirection);
      },
    });
    this.lightingPanel.setLighting(this.worldLoader?.document?.lighting);
    root.appendChild(this._section("Lighting", this.lightingPanel.root));

    this.particlePanel = new ParticlePanel({
      onChange: (raw) => {
        const object = this.selection.primary;
        if (!object) return;
        object.userData.particles = sanitizeParticles(raw);
        // Rebuild the preview so the edit shows immediately.
        this.particlePreview.load(this.manager);
      },
    });
    root.appendChild(this._section("Particles", this.particlePanel.root));

    root.appendChild(this._section("Grass", this._buildGrassControls()));
    root.appendChild(this._section("Bushes", this._buildBushControls()));
    root.appendChild(this._section("Trees", this._buildTreeControls()));
    root.appendChild(this._section("Terrain material", this._buildTerrainControls()));

    // Editor/debug-only Voxel Lab: voxelize the selection, visualize occupancy,
    // ray-traverse it. Owns a transient debug mesh (never serialized/exported).
    this.voxelPanel = new VoxelDebugPanel({
      scene: this.scene,
      camera: this.camera,
      getSelection: () => this.selection.objects,
    });
    this.voxelLab = this.voxelPanel; // stable name for the __WORLD_EDITOR__ proof
    root.appendChild(this._section("Voxel Lab (debug)", this.voxelPanel.root));

    // Procedural Build System (Stage 17C): a generator emits normal WorldDocument
    // objects through the manager. System panel — applies directly, not undo-tracked.
    this.proceduralPanel = new ProceduralPanel({
      getManager: () => this.manager,
      getDocument: () => this.worldLoader?.document,
      getPrefab: (id) => this.prefabLibrary?.get(id) ?? null,
      listPrefabs: () => this.prefabLibrary?.list() ?? [],
      onChanged: () => this._refreshPerf(),
    });
    root.appendChild(this._section("Procedural (city)", this.proceduralPanel.root));

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
    this._refreshHistoryControls();
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

  _buildTreeControls() {
    const wrap = document.createElement("div");
    Object.assign(wrap.style, { display: "grid", gap: "8px" });

    this.treeEnabled = this._checkbox("Enable", this.treeSystem?.cfg.enabled ?? true);
    this.treeRespect = this._checkbox("Respect roads", this.treeSystem?.cfg.respectExclusions ?? true);
    this.treeDensity = this._numberInput(this.treeSystem?.cfg.density ?? 0.018, 0.001);
    this.treeVisible = this._numberInput(this.treeSystem?.cfg.visibleDistance ?? 190, 5);
    this.treeSeed = this._numberInput(this.treeSystem?.cfg.seed ?? 1337, 1);

    wrap.appendChild(this.treeEnabled.label);
    wrap.appendChild(this._labeledControl("Density", this.treeDensity));
    wrap.appendChild(this._labeledControl("Visible", this.treeVisible));
    wrap.appendChild(this._labeledControl("Seed", this.treeSeed));
    wrap.appendChild(this.treeRespect.label);
    wrap.appendChild(this._button("Apply Trees", () => this._applyTreeSettings()));
    return wrap;
  }

  _buildGrassControls() {
    const wrap = document.createElement("div");
    Object.assign(wrap.style, { display: "grid", gap: "8px" });
    const cfg = this.grassSystem?.cfg ?? {};

    this.grassDensity = this._numberInput(cfg.density ?? 7, 0.5);
    this.grassClump = this._numberInput(cfg.clumpStrength ?? 0, 0.05);
    this.grassClumpScale = this._numberInput(cfg.clumpScale ?? 0.05, 0.005);
    this.grassDistanceTint = this._numberInput(cfg.distanceTint ?? 0.22, 0.02);
    this.grassFresnel = this._numberInput(cfg.fresnelIntensity ?? 0.35, 0.02);

    wrap.appendChild(this._labeledControl("Density", this.grassDensity));
    wrap.appendChild(this._labeledControl("Clump", this.grassClump));
    wrap.appendChild(this._labeledControl("Clump scale", this.grassClumpScale));
    wrap.appendChild(this._labeledControl("Dist tint", this.grassDistanceTint));
    wrap.appendChild(this._labeledControl("Fresnel", this.grassFresnel));
    wrap.appendChild(this._button("Apply Grass", () => this._applyGrassSettings()));
    return wrap;
  }

  _applyGrassSettings() {
    if (!this.grassSystem) return;
    const t0 = performance.now();
    this.grassSystem.updateSettings({
      density: Math.max(0, parseFloat(this.grassDensity.value) || 0),
      clumpStrength: Math.min(1, Math.max(0, parseFloat(this.grassClump.value) || 0)),
      clumpScale: Math.max(0.001, parseFloat(this.grassClumpScale.value) || 0.05),
      distanceTint: Math.min(1, Math.max(0, parseFloat(this.grassDistanceTint.value) || 0)),
      fresnelIntensity: Math.min(1, Math.max(0, parseFloat(this.grassFresnel.value) || 0)),
    });
    this.stats.lastActionMs = performance.now() - t0;
    this._refreshPerf();
  }

  _buildBushControls() {
    const wrap = document.createElement("div");
    Object.assign(wrap.style, { display: "grid", gap: "8px" });
    const cfg = this.bushSystem?.cfg ?? {};

    this.bushEnabled = this._checkbox("Enable", cfg.enabled ?? true);
    this.bushDensity = this._numberInput(cfg.density ?? 0.05, 0.005);
    this.bushClump = this._numberInput(cfg.clumpStrength ?? 0.45, 0.05);
    this.bushVisible = this._numberInput(cfg.visibleDistance ?? 130, 5);
    this.bushSeed = this._numberInput(cfg.seed ?? 911, 1);

    wrap.appendChild(this.bushEnabled.label);
    wrap.appendChild(this._labeledControl("Density", this.bushDensity));
    wrap.appendChild(this._labeledControl("Clump", this.bushClump));
    wrap.appendChild(this._labeledControl("Visible", this.bushVisible));
    wrap.appendChild(this._labeledControl("Seed", this.bushSeed));
    wrap.appendChild(this._button("Apply Bushes", () => this._applyBushSettings()));
    return wrap;
  }

  _applyBushSettings() {
    if (!this.bushSystem) return;
    const t0 = performance.now();
    const visible = Math.max(24, parseFloat(this.bushVisible.value) || 130);
    this.bushSystem.updateSettings({
      enabled: this.bushEnabled.input.checked,
      density: Math.max(0, parseFloat(this.bushDensity.value) || 0),
      clumpStrength: Math.min(1, Math.max(0, parseFloat(this.bushClump.value) || 0)),
      visibleDistance: visible,
      keepDistance: visible + 35,
      seed: Math.floor(parseFloat(this.bushSeed.value) || 1),
    });
    this.stats.lastActionMs = performance.now() - t0;
    this._refreshPerf();
  }

  _buildTerrainControls() {
    const wrap = document.createElement("div");
    Object.assign(wrap.style, { display: "grid", gap: "8px" });
    const s = this.terrain?.getMaterialSettings?.() ?? {};

    this.terrainMacro = this._numberInput(s.macroIntensity ?? 0.35, 0.02);
    this.terrainMacroScale = this._numberInput(s.macroScale ?? 0.015, 0.002);
    this.terrainSlopeRock = this._numberInput(s.slopeRock ?? 0.5, 0.02);
    this.terrainHeightTint = this._numberInput(s.heightTint ?? 0.3, 0.02);
    this.terrainDetail = this._numberInput(s.detailIntensity ?? 0.25, 0.02);

    wrap.appendChild(this._labeledControl("Macro", this.terrainMacro));
    wrap.appendChild(this._labeledControl("Macro scale", this.terrainMacroScale));
    wrap.appendChild(this._labeledControl("Slope rock", this.terrainSlopeRock));
    wrap.appendChild(this._labeledControl("Height tint", this.terrainHeightTint));
    wrap.appendChild(this._labeledControl("Detail", this.terrainDetail));
    wrap.appendChild(this._button("Apply Terrain", () => this._applyTerrainSettings()));
    return wrap;
  }

  _applyTerrainSettings() {
    if (!this.terrain?.syncMaterial) return;
    const t0 = performance.now();
    const c01 = (input, fallback) => Math.min(1, Math.max(0, parseFloat(input.value) || fallback));
    this.terrain.syncMaterial({
      macroIntensity: c01(this.terrainMacro, 0.35),
      macroScale: Math.min(0.2, Math.max(0.0001, parseFloat(this.terrainMacroScale.value) || 0.015)),
      slopeRock: c01(this.terrainSlopeRock, 0.5),
      heightTint: c01(this.terrainHeightTint, 0.3),
      detailIntensity: c01(this.terrainDetail, 0.25),
    });
    this.stats.lastActionMs = performance.now() - t0;
    this._refreshPerf();
  }

  _checkbox(label, checked) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    const wrap = document.createElement("label");
    Object.assign(wrap.style, { display: "flex", alignItems: "center", gap: "8px", color: "#8fa899" });
    wrap.appendChild(input);
    wrap.appendChild(document.createTextNode(label));
    return { input, label: wrap };
  }

  _numberInput(value, step) {
    const input = document.createElement("input");
    input.type = "number";
    input.step = step;
    input.value = value;
    Object.assign(input.style, {
      width: "100%",
      font: "inherit",
      fontSize: "11px",
      padding: "6px 8px",
      color: "#d7e6dc",
      background: "rgba(127,220,160,0.08)",
      border: "1px solid rgba(120,200,140,0.25)",
      borderRadius: "7px",
    });
    return input;
  }

  _labeledControl(label, control) {
    const wrap = document.createElement("label");
    Object.assign(wrap.style, { display: "grid", gridTemplateColumns: "74px 1fr", gap: "8px", alignItems: "center" });
    const span = document.createElement("span");
    span.textContent = label;
    span.style.color = "#8fa899";
    wrap.appendChild(span);
    wrap.appendChild(control);
    return wrap;
  }

  _applyTreeSettings() {
    if (!this.treeSystem) return;
    const t0 = performance.now();
    this.treeSystem.updateSettings({
      enabled: this.treeEnabled.input.checked,
      respectExclusions: this.treeRespect.input.checked,
      density: Math.max(0, parseFloat(this.treeDensity.value) || 0),
      visibleDistance: Math.max(24, parseFloat(this.treeVisible.value) || 190),
      keepDistance: Math.max(48, (parseFloat(this.treeVisible.value) || 190) + 40),
      seed: Math.floor(parseFloat(this.treeSeed.value) || 1),
    });
    this.stats.lastActionMs = performance.now() - t0;
    this._refreshPerf();
  }

  _renderAssetList() {
    this.assetList.replaceChildren();
    for (const asset of this.assetLibrary.list()) {
      const button = this._button("", () => {
        this.selectedAsset = asset;
        this._renderAssetList();
      });
      button.style.display = "grid";
      button.style.gridTemplateColumns = asset.thumbnailRef ? "34px 1fr" : "1fr";
      button.style.gap = "7px";
      button.style.alignItems = "center";
      if (asset.thumbnailRef) {
        const img = document.createElement("img");
        img.src = asset.thumbnailRef;
        Object.assign(img.style, { width: "30px", height: "30px", objectFit: "cover", borderRadius: "5px" });
        button.appendChild(img);
      }
      const label = document.createElement("span");
      const animationNote = asset.type === "gltf" && asset.animation?.clips?.length
        ? `\n♦ ${summarizeAssetAnimation(asset.animation)}`
        : "";
      label.textContent = `${asset.name}\n${asset.type}${animationNote}`;
      label.style.whiteSpace = "pre-line";
      label.style.textAlign = "left";
      button.appendChild(label);
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
      // Undo/redo: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y. Skip while typing in a
      // field so native text undo still works.
      const typing = /^(input|textarea|select)$/i.test(event.target?.tagName ?? "") || event.target?.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && !typing) {
        if (event.code === "KeyZ" && !event.shiftKey) {
          event.preventDefault();
          this._undo();
          return;
        }
        if ((event.code === "KeyZ" && event.shiftKey) || event.code === "KeyY") {
          event.preventDefault();
          this._redo();
          return;
        }
      }
      // Don't let editor shortcuts (delete / transform-mode) hijack text editing
      // in the panel's number inputs (tree density/visible/seed).
      if (typing) return;
      if (event.code === "Delete" || event.code === "Backspace") this._deleteSelected();
      if (event.code === "Escape") {
        // Escape disarms prefab placement first, then closes the editor.
        if (this.armedPrefab) this._armPrefabPlacement(null);
        else this.close();
      }
      if (event.code === "KeyQ") this.transform.setMode("translate");
      if (event.code === "KeyE") this.transform.setMode("rotate");
      if (event.code === "KeyR") this.transform.setMode("scale");
    });

    this.fileInput.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (file) await this._importGLTF(file);
      event.target.value = "";
    });

    this.imageFileInput.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (file) await this._importImage(file);
      event.target.value = "";
    });

    this.worldFileInput.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (file) await this._importWorld(file);
      event.target.value = "";
    });

    this.modFileInput.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (file) await this._handleModFile(file);
      event.target.value = "";
    });
  }

  async _handleCanvasClick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    // When a prefab is armed, terrain clicks place it (repeatedly) and object
    // selection is suppressed so multiple placements stay fast.
    if (this.armedPrefab) {
      const armedHits = this.raycaster.intersectObject(this.terrain.mesh, false);
      if (armedHits.length) {
        const hit = armedHits[0].point;
        hit.y = getHeight(hit.x, hit.z);
        await this._placeArmedPrefab(hit);
      }
      return;
    }

    // Shift/Ctrl/Cmd-click toggles an object in the multi-selection.
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;

    const objectHits = this.raycaster.intersectObjects([...this.manager.objects.values()], true);
    if (objectHits.length) {
      const root = this._findEditorRoot(objectHits[0].object);
      if (additive) this._toggleInSelection(root);
      else this._select(root);
      return;
    }

    const terrainHits = this.raycaster.intersectObject(this.terrain.mesh, false);
    // Modifier-click or no-asset terrain click clears the selection rather than
    // placing — gives an explicit "deselect" gesture while multi-selecting.
    if (!terrainHits.length || additive || !this.selectedAsset) {
      this._clearSelection();
      return;
    }
    const point = terrainHits[0].point;
    point.y = getHeight(point.x, point.z);
    const placed = await this.manager.addFromAsset(this.selectedAsset, point);
    this.history.push(new AddObjectsCommand(this.manager, [placed]));
    this._select(placed);
  }

  _findEditorRoot(object) {
    let current = object;
    while (current && !current.userData.editorObject) current = current.parent;
    return current;
  }

  // Replace the selection with a single object (or clear when null).
  _select(object) {
    this.selection.set(object ? [object] : []);
    this._applySelection();
  }

  _toggleInSelection(object) {
    if (!object) return;
    this.selection.toggle(object);
    this._applySelection();
  }

  _clearSelection() {
    this.selection.clear();
    this._applySelection();
  }

  // Point the transform gizmo at the right target: the object (single), the
  // group pivot (multi), or nothing (empty), then refresh dependent UI.
  _applySelection() {
    const count = this.selection.count;
    if (count === 0) {
      this.transform.detach();
    } else if (count === 1) {
      this.transform.attach(this.selection.primary);
    } else {
      this.selection.recenterPivot();
      this.transform.attach(this.selection.pivot);
    }
    this._refreshSelectionLabel();
  }

  _deleteSelected() {
    if (!this.selection.count) return;
    const objects = [...this.selection.objects];
    for (const object of objects) this.animationPreview.stopFor(object);
    this._clearSelection();
    // execute() detaches the objects now; the command parks them so undo can
    // restore the exact same instances.
    this.history.execute(new RemoveObjectsCommand(this.manager, objects));
  }

  _undo() {
    if (this.history.undo()) this._syncSelectionAfterHistory();
  }

  _redo() {
    if (this.history.redo()) this._syncSelectionAfterHistory();
  }

  // After undo/redo the world changed under the selection: drop any selected
  // objects that are no longer present, then rebuild gizmo + highlight + labels.
  _syncSelectionAfterHistory() {
    const valid = this.selection.objects.filter((object) => this.manager.objects.has(object.userData.objectId));
    this.selection.set(valid); // rebuilds BoxHelpers at current positions
    this._applySelection();
    this._refreshPerf();
  }

  // Show a wireframe volume for the primary selected object when it is a trigger
  // or pickup, so radii are authored with feedback (editor-only; never in runtime).
  // Reused (reposition-only) while the role/shape/radius are unchanged, so a drag
  // doesn't rebuild geometry every tick.
  _refreshInteractionHelper() {
    const object = this.selection.count === 1 ? this.selection.primary : null;
    const it = object?.userData?.interaction;
    const wants = !!it && (it.role === "trigger" || it.role === "pickup");
    const key = wants ? `${object.userData.objectId}:${it.role}:${it.shape ?? "sphere"}:${it.radius}` : null;

    if (wants && this._interactionHelper && this._interactionHelperKey === key) {
      this._interactionHelper.position.copy(object.getWorldPosition(this._interactionHelper.position));
      return;
    }
    if (this._interactionHelper) {
      this.scene.remove(this._interactionHelper);
      this._interactionHelper.geometry.dispose();
      this._interactionHelper.material.dispose();
      this._interactionHelper = null;
      this._interactionHelperKey = null;
    }
    if (!wants) return;

    const radius = Math.max(0.1, Number(it.radius) || 4);
    const geometry = it.shape === "box"
      ? new THREE.BoxGeometry(radius * 2, radius * 2, radius * 2)
      : new THREE.SphereGeometry(radius, 18, 12);
    const helper = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: 0xffc36e, wireframe: true, transparent: true, opacity: 0.45, depthTest: false })
    );
    helper.position.copy(object.getWorldPosition(new THREE.Vector3()));
    helper.renderOrder = 999;
    this._interactionHelper = helper;
    this._interactionHelperKey = key;
    this.scene.add(helper);
  }

  _refreshHistoryControls() {
    if (this.undoButton) {
      this.undoButton.disabled = !this.history.canUndo;
      this.undoButton.style.opacity = this.history.canUndo ? "1" : "0.4";
    }
    if (this.redoButton) {
      this.redoButton.disabled = !this.history.canRedo;
      this.redoButton.style.opacity = this.history.canRedo ? "1" : "0.4";
    }
    if (this.historyLabel) {
      this.historyLabel.textContent = `history: ${this.history.depth} undo · ${this.history.redoDepth} redo`;
    }
  }

  _snapshotTransforms(objects) {
    return objects.map((object) => ({
      id: object.userData.objectId,
      position: object.position.toArray(),
      rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
      scale: object.scale.toArray(),
    }));
  }

  _transformsChanged(before, after) {
    if (!before || !after || before.length !== after.length) return false;
    const eps = 1e-6;
    for (let i = 0; i < before.length; i++) {
      if (before[i].id !== after[i].id) return true;
      for (const key of ["position", "rotation", "scale"]) {
        for (let j = 0; j < 3; j++) {
          if (Math.abs(before[i][key][j] - after[i][key][j]) > eps) return true;
        }
      }
    }
    return false;
  }

  // Preview the selected object's chosen clip with a single editor mixer.
  _previewAnimation() {
    const object = this.selection.primary;
    const clips = object?.userData?.animationClips;
    if (!object || !clips?.length) {
      this.animationPanel.info.textContent = "No animation clips to preview.";
      return;
    }
    const override = this.animationPanel.getOverride();
    object.userData.animation = override;
    const clipName = override.clip || object.userData.assetAnimation?.defaultClip || clips[0]?.name;
    this.animationPreview.play(object, clips, {
      clip: clipName,
      loop: override.loop,
      speed: override.playbackSpeed,
      offset: override.startOffset,
    });
  }

  async _duplicateSelected() {
    if (!this.selection.count) return;
    // Duplicate every selected object by the same offset → relative layout kept.
    const sources = [...this.selection.objects];
    const copies = [];
    for (const source of sources) {
      const copy = await this.manager.duplicate(source);
      if (copy) copies.push(copy);
    }
    if (copies.length) this.history.push(new AddObjectsCommand(this.manager, copies));
    this.selection.set(copies);
    this._applySelection();
  }

  // --- prefabs ----------------------------------------------------------------

  async _createPrefabFromSelection() {
    const selected = [...this.selection.objects];
    if (!selected.length) {
      this.prefabPanel.setStatus("Select one or more objects first, then save them as a prefab.");
      return;
    }
    // One object → single prefab; multiple → grouped prefab. The serializer
    // captures child local transforms relative to the group root either way.
    const descriptors = selected.map((object) => this.manager.serializeWorldObject(object));
    const suggested = selected.length > 1 ? `Group (${selected.length})` : selected[0].name || "Prefab";
    const name = prompt("Prefab name", suggested);
    if (name === null) return;
    try {
      const prefab = await this.prefabLibrary.createFromObjects(descriptors, {
        name: name || suggested,
      });
      this.prefabPanel.refresh();
      this.prefabPanel.setStatus(`Saved ${prefab.kind} prefab "${prefab.name}" (${prefab.objects.length} object).`);
    } catch (error) {
      console.warn("Could not create prefab", error);
      this.prefabPanel.setStatus("Could not create prefab from selection.");
    }
  }

  _armPrefabPlacement(prefab) {
    this.armedPrefab = prefab ?? null;
    if (this.armedPrefab) this._select(null);
    this.prefabPanel.setArmed(this.armedPrefab);
    if (!this.armedPrefab) this.prefabPanel.setStatus("Placement finished.");
  }

  async _placeArmedPrefab(point) {
    const prefab = this.armedPrefab;
    if (!prefab) return;
    const placed = await this.prefabInstancer.instantiate(prefab, {
      position: { x: point.x, y: point.y, z: point.z },
    });
    if (placed.length) {
      this.history.push(new AddObjectsCommand(this.manager, placed));
      this._select(placed[0]);
    }
    this.prefabPanel.setStatus(`Placed "${prefab.name}" (${placed.length} object). Click again to place more.`);
  }

  async _renamePrefab(id) {
    const prefab = this.prefabLibrary.get(id);
    if (!prefab) return;
    const name = prompt("Prefab name", prefab.name);
    if (!name) return;
    await this.prefabLibrary.rename(id, name);
    this.prefabPanel.refresh();
  }

  async _deletePrefab(id) {
    const prefab = this.prefabLibrary.get(id);
    if (!prefab) return;
    if (!confirm(`Delete prefab "${prefab.name}"? Objects already placed in the world are kept.`)) return;
    if (this.armedPrefab?.id === id) this._armPrefabPlacement(null);
    await this.prefabLibrary.delete(id);
    this.prefabPanel.refresh();
    this.prefabPanel.setStatus(`Deleted prefab "${prefab.name}". Placed objects were kept.`);
  }

  _save() {
    const t0 = performance.now();
    const document = this.worldLoader.updateDocumentFromRuntime({
      player: this.player,
      cameraController: this.cameraController,
    });
    document.prefabs = this.prefabLibrary.createManifest();
    const t1 = performance.now();
    const result = this.worldSerializer.save(document);
    const t2 = performance.now();
    this.stats.saveSerializeMs = t1 - t0;
    this.stats.saveWriteMs = t2 - t1;
    this.stats.lastActionMs = t2 - t0;
    this.selectionLabel.textContent = `Saved ${result.document.objects.length} object(s) to localStorage.`;
    this._refreshPerf();
  }

  async _load() {
    const result = this.worldSerializer.load();
    this._select(null);
    if (result) {
      await this._mergePrefabManifest(result.document);
      await this.onLoadWorld?.(result.document);
    }
    this.selectionLabel.textContent = result
      ? `Loaded ${result.document.objects.length} object(s) from localStorage.`
      : "No saved world found.";
  }

  // Bring any prefabs embedded in a loaded/imported world into the library
  // (additive — existing prefabs are kept). Unknown prefabRefs never crash.
  async _mergePrefabManifest(document) {
    try {
      await this.prefabLibrary.importManifest(document?.prefabs);
      this.prefabPanel?.refresh();
    } catch (error) {
      console.warn("Could not merge prefab manifest from world", error);
    }
  }

  async _loadSample() {
    const doc = getSampleWorld(VERTICAL_SLICE_ID);
    if (!doc) {
      this.selectionLabel.textContent = "Sample world unavailable.";
      return;
    }
    this._clearSelection();
    await this._mergePrefabManifest(doc);
    await this.onLoadWorld?.(doc);
    this.selectionLabel.textContent = `Loaded sample world (${doc.objects.length} objects).`;
  }

  _exportWorld() {
    const document = this.worldLoader.updateDocumentFromRuntime({
      player: this.player,
      cameraController: this.cameraController,
    });
    document.prefabs = this.prefabLibrary.createManifest();
    const exported = exportWorldDocument(document);
    this.selectionLabel.textContent = `Exported ${exported.objects.length} object(s) to .world.json.`;
  }

  async _importWorld(file) {
    try {
      const result = await importWorldDocumentFile(file);
      await this._mergePrefabManifest(result.document);
      await this.onLoadWorld?.(result.document);
      this.selectionLabel.textContent = `Imported ${result.document.objects.length} object(s) from ${file.name}.`;
    } catch (error) {
      console.error("Failed to import world", error);
      this.selectionLabel.textContent = `Could not import ${file.name}.`;
    }
  }

  // --- playable build export --------------------------------------------------

  // Current world document for export: same path as Save/Export World, including
  // the user prefab manifest. Built-in kits regenerate locally so they are not
  // embedded (see PrefabLibrary.createManifest).
  _documentForExport() {
    const worldDoc = this.worldLoader.updateDocumentFromRuntime({
      player: this.player,
      cameraController: this.cameraController,
    });
    worldDoc.prefabs = this.prefabLibrary.createManifest();
    return worldDoc;
  }

  async _exportWorldPack() {
    try {
      const worldpack = await downloadWorldPack(this._documentForExport(), this.assetLibrary, {
        exportedAt: new Date().toISOString(),
      });
      this.lastExportReport = worldpack;
      this._setExportStatus(worldpack, "worldpack");
    } catch (error) {
      console.error("WorldPack export failed", error);
      this.selectionLabel.textContent = "WorldPack export failed.";
    }
  }

  async _exportPlayableBuild() {
    try {
      const worldpack = await downloadPlayableBuildZip(this._documentForExport(), this.assetLibrary, {
        exportedAt: new Date().toISOString(),
      });
      this.lastExportReport = worldpack;
      this._setExportStatus(worldpack, "playable build .zip");
    } catch (error) {
      console.error("Playable build export failed", error);
      this.selectionLabel.textContent = "Playable build export failed.";
    }
  }

  _setExportStatus(worldpack, label) {
    const m = worldpack.manifest;
    const verdict = worldpack.report.ok ? "PASS" : "FAIL";
    const missing = m.missingAssetCount ? `, ${m.missingAssetCount} missing` : "";
    this.selectionLabel.textContent =
      `Exported ${label}: ${m.objectCount} object(s), ${m.assetCount} asset(s)${missing}, validation ${verdict}.`;
    console.log(summarizeExport(m, worldpack.report));
  }

  _showLastExportReport() {
    if (!this.lastExportReport) {
      this.selectionLabel.textContent = "No export yet — use Export WorldPack or Export Playable Build first.";
      return;
    }
    const { manifest, report } = this.lastExportReport;
    const summary = summarizeExport(manifest, report);
    console.log("Last export report", report);
    if (typeof alert === "function") alert(summary);
    this.selectionLabel.textContent = summary.split("\n")[0] + " — full report in console.";
  }

  // --- mods -------------------------------------------------------------------

  async _handleModFile(file) {
    try {
      const { modpack, validation, fileName } = await importModFile(file);
      if (!validation.ok || !modpack) {
        this.modPanel.setStatus(`Rejected ${fileName}:\n${validation.errors.join("\n")}`);
        return;
      }
      const { entry, warnings } = await this.modRegistry.install(modpack, {
        assetLibrary: this.assetLibrary,
        prefabLibrary: this.prefabLibrary,
      });
      this.modPanel.refresh();
      this.prefabPanel?.refresh();
      this._renderAssetList();
      const warnLine = warnings.length ? ` (${warnings.length} warning${warnings.length === 1 ? "" : "s"})` : "";
      this.modPanel.setStatus(`Installed "${entry.name}"${warnLine}. ${entry.counts.worlds} world(s) available.`);
    } catch (error) {
      console.error("Mod import failed", error);
      this.modPanel.setStatus(`Mod import failed: ${error.message}`);
    }
  }

  async _exportWorldAsMod(asZip) {
    const name = prompt("Mod name", this._documentForExport().metadata?.name || "My World Mod");
    if (name === null) return;
    const author = prompt("Author (optional)", "") ?? "";
    const meta = { name: name || "My World Mod", author, exportedAt: new Date().toISOString() };
    try {
      const download = asZip ? downloadModPackageZip : downloadModPackage;
      const modpack = await download(this._documentForExport(), this.assetLibrary, this.prefabLibrary, meta);
      const verdict = modpack.report?.ok ? "valid" : "INVALID";
      this.modPanel.setStatus(`Exported mod "${modpack.name}" (${asZip ? ".zip" : ".json"}) — ${verdict}, ${modpack.warnings.length} warning(s).`);
    } catch (error) {
      console.error("Mod export failed", error);
      this.modPanel.setStatus(`Mod export failed: ${error.message}`);
    }
  }

  async _loadModWorld(id) {
    const world = this.modRegistry.getModWorld(id);
    if (!world?.document) {
      this.modPanel.setStatus("That mod has no loadable world.");
      return;
    }
    this._clearSelection();
    await this._mergePrefabManifest(world.document);
    await this.onLoadWorld?.(world.document);
    this.modPanel.setStatus(`Loaded mod world "${world.name}" (${world.document.objects?.length ?? 0} objects).`);
  }

  _showModDetails(id) {
    const entry = this.modRegistry.get(id);
    if (!entry) return;
    const c = entry.counts ?? {};
    const lines = [
      `${entry.name}  (v${entry.version})`,
      `Author: ${entry.author || "(unknown)"}`,
      entry.description ? `\n${entry.description}\n` : "",
      `Worlds ${c.worlds} · Assets ${c.assets} · Prefabs ${c.prefabs} · Kits ${c.kits}`,
      `Contributed: ${entry.contributed.assetIds.length} asset(s), ${entry.contributed.prefabIds.length} prefab(s)`,
      `Installed ${entry.installedAt}`,
      ...(entry.warnings?.length ? ["", "Warnings:", ...entry.warnings.map((w) => `• ${w}`)] : []),
    ];
    const text = lines.filter((l) => l !== "").join("\n");
    console.log("Mod details", entry);
    if (typeof alert === "function") alert(text);
    this.modPanel.setStatus(`${entry.name}: ${c.worlds} world(s), ${entry.warnings?.length ?? 0} warning(s) — details in console.`);
  }

  async _deleteMod(id) {
    const entry = this.modRegistry.get(id);
    if (!entry) return;
    const refs = this.modRegistry.referencesInWorld(id, { objects: this.manager.serializeWorldObjects() });
    const inUse = refs.assetIds.length + refs.prefabIds.length;
    const warn = inUse
      ? `\n\nWARNING: the current world references ${inUse} item(s) from this mod; they will show as placeholders if you remove the mod's assets.`
      : "";
    if (!confirm(`Uninstall mod "${entry.name}"? Imported assets/prefabs are kept in your libraries.${warn}`)) return;
    await this.modRegistry.uninstall(id);
    this.modPanel.refresh();
    this.modPanel.setStatus(`Uninstalled "${entry.name}". Its assets/prefabs were kept locally.`);
  }

  async _toggleMod(id, enabled) {
    await this.modRegistry.setEnabled(id, enabled);
    this.modPanel.refresh();
  }

  _refreshSelectionLabel() {
    if (!this.selectionLabel) return;
    const count = this.selection.count;
    const primary = count ? this.selection.primary : null;
    // Release the preview whenever it no longer targets the inspected object
    // (object→object switch, not just full deselect).
    if (this.animationPreview.root && this.animationPreview.root !== primary) this.animationPreview.stop();
    if (count === 0) {
      this.selectionLabel.textContent = "No object selected.";
      this.colliderInspector?.setObject(null);
      this.animationPanel?.setObject(null);
      this.interactionPanel?.setObject(null);
      this.particlePanel?.setObject(null);
      this._refreshInteractionHelper();
      return;
    }
    this.colliderInspector?.setObject(primary);
    this.animationPanel?.setObject(primary);
    this.interactionPanel?.setObject(primary);
    this.particlePanel?.setObject(primary);
    this._refreshInteractionHelper();
    if (count > 1) {
      this.selectionLabel.textContent = `${count} objects selected — group transform active.`;
    } else {
      const p = primary.position;
      this.selectionLabel.textContent = `Selected ${primary.name}: ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`;
    }
    this._refreshPerf();
  }

  _refreshPerf() {
    if (!this.perfLabel) return;
    const grass = this.getGrassStats?.() ?? {};
    const trees = this.getTreeStats?.() ?? {};
    const colliders = [...this.manager.objects.values()].filter((object) => getCollider(object).type !== "none").length;
    const exclusions = [...this.manager.objects.values()].filter((object) => getCollider(object).excludeGrass).length;
    this.perfLabel.textContent =
      `editor action ${this.stats.lastActionMs.toFixed(2)} ms\n` +
      `objects ${this.manager.objects.size} · colliders ${colliders} · exclusions ${exclusions}\n` +
      `grass rebuilt ${grass.rebuiltThisFrame ?? 0} · queued ${grass.rebuildQueueLength ?? 0}\n` +
      `trees ${trees.visibleTrees ?? 0} · rebuilt ${trees.rebuiltThisFrame ?? 0} · queued ${trees.rebuildQueueLength ?? 0}\n` +
      `transform updates ${this.stats.transformUpdates}\n` +
      `save serialize ${this.stats.saveSerializeMs.toFixed(2)} ms\n` +
      `localStorage ${this.stats.saveWriteMs.toFixed(2)} ms`;
  }

  async _importGLTF(file) {
    try {
      this.selectedAsset = await this.assetImporter.importGLTF(file);
      this._renderAssetList();
    } catch (error) {
      console.error("Failed to import GLTF", error);
      this.selectionLabel.textContent = `Could not import ${file.name}.`;
    }
  }

  async _importImage(file) {
    try {
      this.selectedAsset = await this.assetImporter.importImage(file);
      this._renderAssetList();
    } catch (error) {
      console.error("Failed to import image", error);
      this.selectionLabel.textContent = `Could not import ${file.name}.`;
    }
  }

  async _renameSelectedAsset() {
    if (!this.selectedAsset) return;
    const name = prompt("Asset name", this.selectedAsset.name);
    if (!name) return;
    this.selectedAsset = await this.assetLibrary.rename(this.selectedAsset.id, name);
    this._renderAssetList();
  }

  async _deleteSelectedAsset() {
    if (!this.selectedAsset) return;
    if (this.selectedAsset.type === "primitive") {
      this.selectionLabel.textContent = "Built-in primitive assets cannot be deleted.";
      return;
    }
    const used = [...this.manager.objects.values()].filter((object) => object.userData.assetRef === this.selectedAsset.id).length;
    const message = used
      ? `Delete "${this.selectedAsset.name}"? It is used by ${used} placed object(s). Missing placeholders will appear.`
      : `Delete "${this.selectedAsset.name}"?`;
    if (!confirm(message)) return;
    await this.assetLibrary.delete(this.selectedAsset.id);
    this.selectedAsset = this.assetLibrary.list()[0] ?? null;
    this._renderAssetList();
  }

  async _refreshAssetLibrary() {
    await this.assetLibrary.init();
    if (!this.selectedAsset || !this.assetLibrary.get(this.selectedAsset.id)) {
      this.selectedAsset = this.assetLibrary.list()[0] ?? null;
    }
    this._renderAssetList();
  }
}
