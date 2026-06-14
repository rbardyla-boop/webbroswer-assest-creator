import * as THREE from "three";
import { Terrain } from "../terrain/Terrain.js";
import { TERRAIN } from "../terrain/terrainSampling.js";
import { createGrassConfig } from "../grass/GrassConfig.js";
import { GrassSystem } from "../grass/GrassSystem.js";
import { createTreeConfig } from "../trees/TreeConfig.js";
import { TreeSystem } from "../trees/TreeSystem.js";
import { ColliderSystem } from "../physics/ColliderSystem.js";
import { WorldObjectManager } from "./WorldObjectManager.js";
import { validateWorldDocument } from "./WorldValidation.js";

export class WorldRuntimeLoader {
  constructor({ scene, lights, fog, colliderSystem = null, assetLibrary = null, animationRuntime = null } = {}) {
    this.scene = scene;
    this.lights = lights;
    this.fog = fog;
    this.colliderSystem = colliderSystem ?? new ColliderSystem();
    this.assetLibrary = assetLibrary;
    this.animationRuntime = animationRuntime;
    this.terrain = null;
    this.grass = null;
    this.trees = null;
    this.manager = null;
    this.document = null;
    this.warnings = [];
  }

  async load(inputDocument) {
    const result = validateWorldDocument(inputDocument);
    const document = result.document;
    this.warnings = result.warnings;
    this.document = document;

    this.dispose();
    applyTerrainSettings(document.terrain);

    this.terrain = new Terrain(document.terrain);
    this.scene.add(this.terrain.mesh);

    this.manager = new WorldObjectManager(this.scene, {
      colliderSystem: this.colliderSystem,
      assetLibrary: this.assetLibrary,
      animationRuntime: this.animationRuntime,
      onChange: () => {
        this.grass?.rebuildActivePatches();
        this.trees?.rebuildActivePatches();
      },
    });
    await this.manager.loadWorldObjects(document.objects);

    this.grass = new GrassSystem(this.scene, this.lights, this.fog, grassConfigFromDocument(document.grass), this.colliderSystem);
    this.trees = new TreeSystem(this.scene, treeConfigFromDocument(document.trees), this.colliderSystem);

    return {
      document,
      warnings: this.warnings,
      terrain: this.terrain,
      grass: this.grass,
      trees: this.trees,
      objectManager: this.manager,
      colliderSystem: this.colliderSystem,
    };
  }

  updateDocumentFromRuntime({ player = null, cameraController = null } = {}) {
    if (!this.document) return null;
    this.document.terrain = terrainDocumentFromRuntime(this.document.terrain);
    this.document.grass = grassDocumentFromRuntime(this.grass?.cfg, this.document.grass);
    this.document.trees = treeDocumentFromRuntime(this.trees?.cfg, this.document.trees);
    this.document.objects = this.manager?.serializeWorldObjects() ?? [];
    if (this.assetLibrary) this.document.assets = this.assetLibrary.createManifest();
    if (player) {
      this.document.player.spawn = { x: player.position.x, y: player.position.y, z: player.position.z };
    }
    if (cameraController) this.document.player.cameraMode = cameraController.mode;
    this.document.metadata.updatedAt = new Date().toISOString();
    return this.document;
  }

  dispose() {
    this.animationRuntime?.clear();
    this.grass?.dispose();
    this.trees?.dispose();
    if (this.manager) {
      this.manager.onChange = null;
      this.manager.clear();
      this.manager.root?.removeFromParent();
    }
    if (this.terrain) {
      this.scene.remove(this.terrain.mesh);
      this.terrain.dispose();
    }
    this.grass = null;
    this.trees = null;
    this.manager = null;
    this.terrain = null;
  }
}

export function applyTerrainSettings(settings = {}) {
  TERRAIN.heightAmplitude = settings.heightAmplitude ?? TERRAIN.heightAmplitude;
  TERRAIN.featureScale = settings.featureScale ?? TERRAIN.featureScale;
  TERRAIN.detailScale = settings.detailScale ?? TERRAIN.detailScale;
  TERRAIN.detailAmount = settings.detailAmount ?? TERRAIN.detailAmount;
}

function grassConfigFromDocument(grass = {}) {
  const wind = { ...(grass.wind ?? {}) };
  if (wind.direction && !(wind.direction instanceof THREE.Vector2)) {
    wind.direction = new THREE.Vector2(wind.direction.x ?? 1, wind.direction.y ?? 0.45).normalize();
  }
  return createGrassConfig({
    density: grass.enabled === false ? 0 : grass.density,
    patchSize: grass.patchSize,
    visibleDistance: grass.visibleDistance,
    keepDistance: grass.keepDistance,
    lodDistances: grass.lodDistances,
    wind,
  });
}

function treeConfigFromDocument(trees = {}) {
  return createTreeConfig({
    enabled: trees.enabled,
    density: trees.density,
    patchSize: trees.patchSize,
    visibleDistance: trees.visibleDistance,
    keepDistance: trees.keepDistance,
    seed: trees.seed,
    respectExclusions: trees.respectExclusions,
  });
}

function terrainDocumentFromRuntime(fallback = {}) {
  return {
    ...fallback,
    heightAmplitude: TERRAIN.heightAmplitude,
    featureScale: TERRAIN.featureScale,
    detailScale: TERRAIN.detailScale,
    detailAmount: TERRAIN.detailAmount,
  };
}

function grassDocumentFromRuntime(cfg = {}, fallback = {}) {
  return {
    ...fallback,
    enabled: cfg.density > 0,
    density: cfg.density ?? fallback.density,
    patchSize: cfg.patchSize ?? fallback.patchSize,
    visibleDistance: cfg.visibleDistance ?? fallback.visibleDistance,
    keepDistance: cfg.keepDistance ?? fallback.keepDistance,
    lodDistances: [...(cfg.lodDistances ?? fallback.lodDistances ?? [])],
    wind: {
      ...(fallback.wind ?? {}),
      ...(cfg.wind ?? {}),
      direction: {
        x: cfg.wind?.direction?.x ?? fallback.wind?.direction?.x ?? 1,
        y: cfg.wind?.direction?.y ?? fallback.wind?.direction?.y ?? 0.45,
      },
    },
  };
}

function treeDocumentFromRuntime(cfg = {}, fallback = {}) {
  return {
    ...fallback,
    enabled: cfg.enabled ?? fallback.enabled,
    density: cfg.density ?? fallback.density,
    patchSize: cfg.patchSize ?? fallback.patchSize,
    visibleDistance: cfg.visibleDistance ?? fallback.visibleDistance,
    keepDistance: cfg.keepDistance ?? fallback.keepDistance,
    seed: cfg.seed ?? fallback.seed,
    respectExclusions: cfg.respectExclusions ?? fallback.respectExclusions,
  };
}
