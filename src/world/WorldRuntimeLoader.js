import * as THREE from "three";
import { Terrain } from "../terrain/Terrain.js";
import { TERRAIN, setTerrainProfile, getActiveTerrainProfile } from "../terrain/terrainSampling.js";
import { createTerrainProfile } from "../terrain/profiles/index.js";
import { createGrassConfig } from "../grass/GrassConfig.js";
import { GrassSystem } from "../grass/GrassSystem.js";
import { createTreeConfig } from "../trees/TreeConfig.js";
import { createBushConfig } from "../bushes/BushConfig.js";
import { TreeSystem } from "../trees/TreeSystem.js";
import { BushSystem } from "../bushes/BushSystem.js";
import { ColliderSystem } from "../physics/ColliderSystem.js";
import { WorldObjectManager } from "./WorldObjectManager.js";
import { validateWorldDocument } from "./WorldValidation.js";
import { applyLighting } from "../lighting/LightingRig.js";
import { GlacialWater } from "./water/GlacialWater.js";
import { ValleyAtmosphere } from "./atmosphere/ValleyAtmosphere.js";

export class WorldRuntimeLoader {
  constructor({ scene, lights, fog, colliderSystem = null, assetLibrary = null, animationRuntime = null } = {}) {
    this.scene = scene;
    this.lights = lights;
    this.fog = fog;
    this.colliderSystem = colliderSystem ?? new ColliderSystem();
    this.assetLibrary = assetLibrary;
    this.animationRuntime = animationRuntime;
    this.terrain = null;
    this.water = null;
    this.atmosphere = null;
    this.grass = null;
    this.trees = null;
    this.bushes = null;
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
    // Apply lighting BEFORE grass is built so fog/sky are correct when the grass
    // material captures the scene fog.
    applyLighting({ lights: this.lights, scene: this.scene }, document.lighting);

    // Capture the lighting-defined base fog before grass is built (Visual-1). The
    // atmosphere does not change scene.fog here — it only eases from this base each
    // runtime frame — so grass still captures a coherent fog at construction.
    this.atmosphere = new ValleyAtmosphere(document.atmosphere);
    this.atmosphere.applyBase(this.scene);

    this.terrain = new Terrain(document.terrain);
    this.scene.add(this.terrain.mesh);

    // Glacial water (Visual-1) — a derived surface mesh. Only built when the active
    // profile actually has a water table (rolling → none) and the block is enabled,
    // so we never feed -Infinity water levels into geometry.
    const profile = getActiveTerrainProfile();
    if (profile.hasWater && document.water?.enabled !== false) {
      this.water = new GlacialWater(document.water, {
        size: document.terrain.size,
        segments: document.terrain.segments,
      });
      this.scene.add(this.water.mesh);
    }

    this.manager = new WorldObjectManager(this.scene, {
      colliderSystem: this.colliderSystem,
      assetLibrary: this.assetLibrary,
      animationRuntime: this.animationRuntime,
      onChange: () => {
        this.grass?.rebuildActivePatches();
        this.trees?.rebuildActivePatches();
        this.bushes?.rebuildActivePatches();
      },
    });
    await this.manager.loadWorldObjects(document.objects);

    // Use the live scene fog (applyLighting may have replaced/removed it) so the
    // grass material captures the world's actual fog, not a stale reference.
    // The active profile's snowline caps tree/bush placement so vegetation stops
    // below the snow (rolling → Infinity, so no effect). Grass self-limits via
    // canPlaceGrass, which already consults the profile snowline + slope.
    const snowline = profile.visual?.snowlineY ?? Infinity;
    this.grass = new GrassSystem(this.scene, this.lights, this.scene.fog, grassConfigFromDocument(document.grass), this.colliderSystem);
    this.trees = new TreeSystem(this.scene, treeConfigFromDocument(document.trees, snowline), this.colliderSystem);
    this.bushes = new BushSystem(this.scene, bushConfigFromDocument(document.bushes, snowline), this.colliderSystem);

    // Grass captured the base fog at construction; hand it to the atmosphere so the
    // eased fog can be pushed back into the grass shader as the camera moves (runtime).
    this.atmosphere.attachFogConsumer(this.grass);

    return {
      document,
      warnings: this.warnings,
      terrain: this.terrain,
      water: this.water,
      atmosphere: this.atmosphere,
      grass: this.grass,
      trees: this.trees,
      bushes: this.bushes,
      objectManager: this.manager,
      colliderSystem: this.colliderSystem,
    };
  }

  updateDocumentFromRuntime({ player = null, cameraController = null } = {}) {
    if (!this.document) return null;
    this.document.terrain = terrainDocumentFromRuntime(this.terrain, this.document.terrain);
    this.document.grass = grassDocumentFromRuntime(this.grass?.cfg, this.document.grass);
    this.document.trees = treeDocumentFromRuntime(this.trees?.cfg, this.document.trees);
    this.document.bushes = bushDocumentFromRuntime(this.bushes?.cfg, this.document.bushes);
    this.document.objects = this.manager?.serializeWorldObjects() ?? [];
    // lighting has no separate runtime state to read back — it lives on
    // this.document and the editor mutates it in place on every edit, so it is
    // already current here and is intentionally not rebuilt.
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
    this.atmosphere?.dispose();
    if (this.water) {
      this.scene.remove(this.water.mesh);
      this.water.dispose();
    }
    this.grass?.dispose();
    this.trees?.dispose();
    this.bushes?.dispose();
    if (this.manager) {
      this.manager.onChange = null;
      this.manager.clear();
      this.manager.root?.removeFromParent();
    }
    if (this.terrain) {
      this.scene.remove(this.terrain.mesh);
      this.terrain.dispose();
    }
    this.water = null;
    this.atmosphere = null;
    this.grass = null;
    this.trees = null;
    this.bushes = null;
    this.manager = null;
    this.terrain = null;
  }
}

export function applyTerrainSettings(settings = {}) {
  // Keep the legacy TERRAIN defaults in sync (editor terrain sliders read/write
  // these and serialize-back reads them to capture in-editor terrain edits).
  TERRAIN.heightAmplitude = settings.heightAmplitude ?? TERRAIN.heightAmplitude;
  TERRAIN.featureScale = settings.featureScale ?? TERRAIN.featureScale;
  TERRAIN.detailScale = settings.detailScale ?? TERRAIN.detailScale;
  TERRAIN.detailAmount = settings.detailAmount ?? TERRAIN.detailAmount;

  // Swap the active terrain profile — the whole-world ground-truth switch. The
  // document carries `profile`; an editor "Apply Terrain" (sliders only) keeps the
  // current profile id and merges its params so the seed/identity isn't reset.
  const base = getActiveTerrainProfile().params ?? {};
  const profile = settings.profile ?? getActiveTerrainProfile().id;
  setTerrainProfile(createTerrainProfile({ ...base, ...settings, profile }));
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
    clumpStrength: grass.clumpStrength,
    clumpScale: grass.clumpScale,
    distanceTint: grass.distanceTint,
    fresnelIntensity: grass.fresnelIntensity,
  });
}

function treeConfigFromDocument(trees = {}, snowlineMaxHeight = Infinity) {
  return createTreeConfig({
    enabled: trees.enabled,
    density: trees.density,
    patchSize: trees.patchSize,
    visibleDistance: trees.visibleDistance,
    keepDistance: trees.keepDistance,
    seed: trees.seed,
    respectExclusions: trees.respectExclusions,
    snowlineMaxHeight, // runtime-only snow ceiling (not serialized)
  });
}

function bushConfigFromDocument(bushes = {}, snowlineMaxHeight = Infinity) {
  return createBushConfig({
    enabled: bushes.enabled,
    density: bushes.density,
    patchSize: bushes.patchSize,
    visibleDistance: bushes.visibleDistance,
    keepDistance: bushes.keepDistance,
    seed: bushes.seed,
    respectExclusions: bushes.respectExclusions,
    slopeLimit: bushes.slopeLimit,
    clumpStrength: bushes.clumpStrength,
    clumpScale: bushes.clumpScale,
    minHeight: bushes.minHeight,
    maxHeight: bushes.maxHeight,
    snowlineMaxHeight, // runtime-only snow ceiling (not serialized)
  });
}

function terrainDocumentFromRuntime(terrain = null, fallback = {}) {
  return {
    ...fallback,
    heightAmplitude: TERRAIN.heightAmplitude,
    featureScale: TERRAIN.featureScale,
    detailScale: TERRAIN.detailScale,
    detailAmount: TERRAIN.detailAmount,
    // Material v2 lives on the live Terrain instance (the editor mutates its
    // uniforms); read it back so worldpack/mod exports preserve it.
    material: terrain?.getMaterialSettings ? terrain.getMaterialSettings() : { ...(fallback.material ?? {}) },
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
    clumpStrength: cfg.clumpStrength ?? fallback.clumpStrength,
    clumpScale: cfg.clumpScale ?? fallback.clumpScale,
    distanceTint: cfg.distanceTint ?? fallback.distanceTint,
    fresnelIntensity: cfg.fresnelIntensity ?? fallback.fresnelIntensity,
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

function bushDocumentFromRuntime(cfg = {}, fallback = {}) {
  return {
    ...fallback,
    enabled: cfg.enabled ?? fallback.enabled,
    density: cfg.density ?? fallback.density,
    patchSize: cfg.patchSize ?? fallback.patchSize,
    visibleDistance: cfg.visibleDistance ?? fallback.visibleDistance,
    keepDistance: cfg.keepDistance ?? fallback.keepDistance,
    seed: cfg.seed ?? fallback.seed,
    respectExclusions: cfg.respectExclusions ?? fallback.respectExclusions,
    slopeLimit: cfg.slopeLimit ?? fallback.slopeLimit,
    clumpStrength: cfg.clumpStrength ?? fallback.clumpStrength,
    clumpScale: cfg.clumpScale ?? fallback.clumpScale,
    minHeight: cfg.minHeight ?? fallback.minHeight,
    maxHeight: cfg.maxHeight ?? fallback.maxHeight,
  };
}
