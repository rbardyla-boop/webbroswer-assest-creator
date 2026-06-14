import assert from "node:assert/strict";
import * as THREE from "three";

import { createWorldDocument } from "../src/world/WorldDocument.js";
import { validateWorldDocument } from "../src/world/WorldValidation.js";
import { WorldObjectManager } from "../src/world/WorldObjectManager.js";
import { createAssetId, defaultColliderTypeForAsset } from "../src/assets/AssetTypes.js";
import { normalizeAssetMetadata } from "../src/assets/AssetValidation.js";
import { AssetLibrary } from "../src/assets/AssetLibrary.js";
import { PrefabLibrary } from "../src/prefabs/PrefabLibrary.js";
import { PrefabInstancer } from "../src/prefabs/PrefabInstancer.js";
import { worldObjectsFromPrefab } from "../src/prefabs/PrefabSerializer.js";
import { validatePrefabDocument } from "../src/prefabs/PrefabValidation.js";
import { createBuiltinPrefabs, isBuiltinPrefab } from "../src/prefabs/BuiltinKits.js";
import { buildVerticalSliceV1 } from "../src/world/samples/verticalSliceV1.js";
import { getSampleWorld, VERTICAL_SLICE_ID } from "../src/world/samples/index.js";
import {
  buildWorldPack,
  buildPlayableBuildPackage,
  createAssetLibraryFromWorldPack,
} from "../src/export/PlayableBuildExport.js";
import { collectUsedAssetRefs, collectBuildAssets } from "../src/export/BuildAssetCollector.js";
import { validateBuild } from "../src/export/BuildValidation.js";
import { createZip, crc32, readZip } from "../src/export/BuildZip.js";
import { buildWorldMod, buildModFiles } from "../src/mods/ModExporter.js";
import { assembleModPackage } from "../src/mods/ModPackage.js";
import { validateModPackage } from "../src/mods/ModValidation.js";
import { parseModPackage } from "../src/mods/ModImporter.js";
import { ModRegistry } from "../src/mods/ModRegistry.js";
import { createModPackage } from "../src/mods/ModManifest.js";
import { extractAnimationMetadata } from "../src/animation/AnimationMetadata.js";
import { sanitizeAssetAnimation, sanitizePlacedAnimation, resolveClipName } from "../src/animation/AnimationValidation.js";
import { AnimationRuntime } from "../src/animation/AnimationRuntime.js";
import { buildAnimatedFixtureScene, FIXTURE_CLIP_NAMES } from "../src/animation/fixtures/animatedFixture.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { CommandStack } from "../src/editor/CommandStack.js";
import { AddObjectsCommand, RemoveObjectsCommand, TransformObjectsCommand } from "../src/editor/commands/WorldObjectCommands.js";
import { sanitizeInteraction } from "../src/interaction/InteractionValidation.js";
import { InteractionRuntime } from "../src/interaction/InteractionRuntime.js";
import { EventBus } from "../src/interaction/EventBus.js";
import { sphereContains, boxContains, volumeContains } from "../src/interaction/triggerVolume.js";
import { sanitizeLighting } from "../src/lighting/LightingValidation.js";
import { computeSunOffset, defaultLighting } from "../src/lighting/LightingTypes.js";
import { applyLighting } from "../src/lighting/LightingRig.js";
import { GrassMaterial } from "../src/grass/GrassMaterial.js";
import { createGrassConfig } from "../src/grass/GrassConfig.js";
import { generatePatchInstances } from "../src/grass/GrassPlacement.js";
import { generateBushPatchData } from "../src/bushes/BushPlacement.js";
import { BushSystem } from "../src/bushes/BushSystem.js";
import { createBushConfig } from "../src/bushes/BushConfig.js";
import { sanitizeParticles } from "../src/particles/ParticleValidation.js";
import { ParticleRuntime } from "../src/particles/ParticleRuntime.js";
import { Terrain, sanitizeTerrainMaterial, DEFAULT_TERRAIN_MATERIAL } from "../src/terrain/Terrain.js";
import { summarizeReverseDepth, getReverseDepthStatus } from "../src/core/renderer.js";

class MemoryPrefabStore {
  constructor() {
    this.data = [];
    this.thumbs = new Map();
  }

  async loadAll() {
    return this.data.map((entry) => structuredClone(entry));
  }

  async saveAll(prefabs) {
    this.data = (prefabs ?? []).map((entry) => structuredClone(entry));
  }

  async putThumbnail(ref, url) {
    this.thumbs.set(ref, url);
  }

  async getThumbnail(ref) {
    return this.thumbs.get(ref) ?? null;
  }

  async deleteThumbnail(ref) {
    this.thumbs.delete(ref);
  }
}

class MemoryAssetStore {
  constructor() {
    this.metadata = new Map();
    this.blobs = new Map();
  }

  async listMetadata() {
    return [...this.metadata.values()];
  }

  async putAsset(metadata, blob = null) {
    this.metadata.set(metadata.id, structuredClone(metadata));
    if (blob) this.blobs.set(metadata.id, blob);
  }

  async updateMetadata(metadata) {
    this.metadata.set(metadata.id, structuredClone(metadata));
  }

  async getBlob(id) {
    return this.blobs.get(id) ?? null;
  }

  async deleteAsset(id) {
    this.metadata.delete(id);
    this.blobs.delete(id);
  }
}

class MemoryModStore {
  constructor() {
    this.entries = [];
  }

  async load() {
    return this.entries.map((entry) => structuredClone(entry));
  }

  async save(entries) {
    this.entries = (entries ?? []).map((entry) => structuredClone(entry));
  }
}

const reliefGeometry = new THREE.BufferGeometry().copy(new THREE.BoxGeometry(1, 0.3, 1));
const reliefGeometryData = reliefGeometry.toJSON();

const source = createWorldDocument({
  metadata: {
    name: "Regression World",
  },
  grass: {
    density: 3.5,
    patchSize: 18,
    visibleDistance: 90,
    keepDistance: 130,
    lodDistances: [25, 60],
    seed: 42,
  },
  trees: {
    enabled: true,
    density: 0.031,
    patchSize: 44,
    visibleDistance: 175,
    keepDistance: 225,
    seed: 77,
    respectExclusions: false,
  },
  player: {
    spawn: { x: 12, y: 4.25, z: -8 },
    cameraMode: "first",
  },
  objects: [
    {
      id: "obj-primitive",
      name: "Persisted Cube",
      type: "primitive",
      assetRef: "primitive-cube",
      primitive: "cube",
      asset: { type: "primitive", kind: "cube", name: "Cube" },
      transform: {
        position: { x: 1, y: 2.5, z: 3 },
        rotation: { x: 0.1, y: 0.2, z: 0.3 },
        scale: { x: 1.2, y: 1.3, z: 1.4 },
      },
      collider: {
        type: "box",
        dimensions: { width: 2, height: 3, depth: 4 },
        enabled: true,
      },
      exclusion: {
        grass: true,
        trees: false,
        radius: 5,
        bounds: null,
      },
    },
    {
      id: "obj-relief",
      name: "Persisted Relief",
      type: "relief",
      primitive: "cube",
      asset: { type: "relief", name: "Relief", geometryData: reliefGeometryData },
      transform: {
        position: { x: -5, y: 6.75, z: 7 },
        rotation: { x: 0, y: 0.5, z: 0 },
        scale: { x: 2, y: 1, z: 2 },
      },
      collider: {
        type: "ramp",
        dimensions: { width: 4, height: 1, depth: 3 },
        enabled: true,
      },
      exclusion: {
        grass: true,
        trees: true,
        radius: 0,
        bounds: null,
      },
    },
  ],
});

const validated = validateWorldDocument(source);
assert.equal(validated.warnings.length, 0);
assert.equal(validated.document.objects.length, 2);
assert.equal(validated.document.grass.density, 3.5);
assert.equal(validated.document.trees.seed, 77);
assert.equal(validated.document.player.spawn.y, 4.25);

const scene = new THREE.Scene();
const manager = new WorldObjectManager(scene);
await manager.loadWorldObjects(validated.document.objects);
const roundTripObjects = manager.serializeWorldObjects();

assert.equal(roundTripObjects.length, 2);
assert.equal(roundTripObjects[0].assetRef, "primitive-cube");
assert.equal(roundTripObjects[0].asset, null);
assert.equal(roundTripObjects[0].primitive, "cube");
assert.equal(roundTripObjects[0].collider.type, "box");
assert.deepEqual(roundTripObjects[0].collider.dimensions, { width: 2, height: 3, depth: 4 });
assert.equal(roundTripObjects[0].exclusion.grass, true);
assert.equal(roundTripObjects[0].exclusion.trees, false);
assert.equal(roundTripObjects[0].transform.position.y, 2.5);
assert.equal(roundTripObjects[1].type, "relief");
assert.equal(roundTripObjects[1].collider.type, "ramp");
assert.deepEqual(roundTripObjects[1].collider.dimensions, { width: 4, height: 1, depth: 3 });
assert.equal(roundTripObjects[1].exclusion.trees, true);
assert.equal(roundTripObjects[1].transform.position.y, 6.75);

const exportedJson = JSON.stringify({ ...validated.document, objects: roundTripObjects });
const imported = validateWorldDocument(JSON.parse(exportedJson));
assert.equal(imported.document.objects.length, 2);
assert.equal(imported.document.grass.visibleDistance, 90);
assert.equal(imported.document.trees.respectExclusions, false);
assert.equal(imported.document.player.cameraMode, "first");
assert.equal(imported.document.player.spawn.x, 12);

const legacy = validateWorldDocument({
  version: 1,
  objects: [
    {
      id: "obj-legacy",
      asset: { type: "primitive", kind: "sphere", name: "Sphere" },
      position: [8, 9, 10],
      rotation: [0, 0.25, 0],
      scale: [1, 2, 1],
      collider: { type: "cylinder", excludeGrass: true },
    },
  ],
});
assert.equal(legacy.document.version, 2);
assert.equal(legacy.document.objects.length, 1);
assert.equal(legacy.document.objects[0].primitive, "sphere");
assert.equal(legacy.document.objects[0].transform.position.y, 9);
assert.match(legacy.warnings.join("\n"), /legacy world save/i);

const invalid = validateWorldDocument({
  version: 999,
  objects: [
    {
      id: "bad-collider",
      type: "primitive",
      primitive: "cube",
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      collider: { type: "banana" },
    },
    {
      id: "bad-transform",
      type: "primitive",
      primitive: "cube",
      transform: {
        position: { x: "nope", y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    },
  ],
});
assert.equal(invalid.document.version, 2);
assert.equal(invalid.document.objects.length, 1);
assert.equal(invalid.document.objects[0].collider.type, "none");
assert.match(invalid.warnings.join("\n"), /Unsupported world version 999/);
assert.match(invalid.warnings.join("\n"), /invalid collider type/);
assert.match(invalid.warnings.join("\n"), /Skipped object bad-transform/);

const assetId = createAssetId("gltf", "Test Asset.glb");
assert.match(assetId, /^gltf-test-asset-/);
assert.equal(defaultColliderTypeForAsset({ type: "image" }), "plane");
const metadata = normalizeAssetMetadata({
  id: assetId,
  type: "gltf",
  name: "Stable Asset",
  sourceName: "stable.glb",
  sizeBytes: 123,
});
assert.equal(metadata.id, assetId);
assert.equal(metadata.name, "Stable Asset");
assert.equal(metadata.defaultColliderType, "box");
assert.deepEqual(metadata.defaultExclusion, { grass: true, trees: true });

const memoryStore = new MemoryAssetStore();
const assetLibrary = await new AssetLibrary({ store: memoryStore }).init();
const reliefBlob = new Blob([JSON.stringify(reliefGeometryData)], { type: "application/json" });
const reliefAsset = await assetLibrary.storeAsset({
  id: "asset-relief-stable",
  type: "relief",
  name: "Stable Relief",
  sourceName: "Stable Relief",
  mimeType: "application/vnd.grass-world.relief+json",
  sizeBytes: reliefBlob.size,
}, reliefBlob);
const duplicate = await assetLibrary.storeAsset({
  id: "asset-relief-stable",
  type: "relief",
  name: "Stable Relief Copy",
  sourceName: "Stable Relief Copy",
  mimeType: "application/vnd.grass-world.relief+json",
  sizeBytes: reliefBlob.size,
}, reliefBlob);
assert.equal(reliefAsset.id, "asset-relief-stable");
assert.notEqual(duplicate.id, reliefAsset.id);

const renamed = await assetLibrary.rename(reliefAsset.id, "Renamed Relief");
assert.equal(renamed.name, "Renamed Relief");
await assetLibrary.init();
assert.equal(assetLibrary.get(reliefAsset.id).name, "Renamed Relief");

const resolvedRelief = await assetLibrary.resolve(reliefAsset.id);
assert.equal(resolvedRelief.id, reliefAsset.id);
assert.ok(resolvedRelief.geometry);

const assetScene = new THREE.Scene();
const assetManager = new WorldObjectManager(assetScene, { assetLibrary });
await assetManager.loadWorldObjects([
  {
    id: "obj-relief-a",
    name: "Relief A",
    type: "relief",
    assetRef: reliefAsset.id,
    transform: {
      position: { x: 0, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    collider: { type: "box", enabled: true },
    exclusion: { grass: true, trees: true },
  },
  {
    id: "obj-relief-b",
    name: "Relief B",
    type: "relief",
    assetRef: reliefAsset.id,
    transform: {
      position: { x: 2, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    collider: { type: "box", enabled: true },
    exclusion: { grass: true, trees: true },
  },
  {
    id: "obj-missing",
    name: "Missing",
    type: "image",
    assetRef: "missing-image-asset",
    transform: {
      position: { x: 4, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    collider: { type: "plane", enabled: true },
    exclusion: { grass: true, trees: true },
  },
]);
const assetRoundTrip = assetManager.serializeWorldObjects();
assert.equal(assetRoundTrip.length, 3);
assert.equal(assetRoundTrip[0].assetRef, reliefAsset.id);
assert.equal(assetRoundTrip[1].assetRef, reliefAsset.id);
assert.equal(assetRoundTrip[2].assetRef, "missing-image-asset");
assert.equal(assetRoundTrip[2].asset, null);
const manifest = assetLibrary.createManifest();
assert.equal(manifest.localIndexedDB, true);
assert.ok(manifest.items.some((item) => item.id === reliefAsset.id));

// --- Stage 5: prefab / template objects -------------------------------------

// Build a prefab from a placed (asset-backed) object's serialized descriptor.
const reliefDescriptor = assetRoundTrip[0];
assert.equal(reliefDescriptor.assetRef, reliefAsset.id);
assert.equal(reliefDescriptor.collider.type, "box");
assert.equal(reliefDescriptor.exclusion.grass, true);

const prefabStore = new MemoryPrefabStore();
const prefabLibrary = await new PrefabLibrary({ store: prefabStore }).init();
const prefab = await prefabLibrary.createFromObjects([reliefDescriptor], { name: "Stable Prefab" });

// prefab shape + asset/collider/exclusion captured, no blob duplication.
assert.match(prefab.id, /^prefab-stable-prefab-/);
assert.equal(prefab.version, 1);
assert.equal(prefab.objects.length, 1);
assert.equal(prefab.metadata.objectCount, 1);
assert.equal(prefab.objects[0].assetRef, reliefAsset.id);
assert.equal(prefab.objects[0].asset, null); // asset-backed → no inline blob
assert.equal(prefab.objects[0].collider.type, "box");
assert.equal(prefab.objects[0].exclusion.grass, true);
assert.equal(prefab.objects[0].exclusion.trees, true);

// Prefab ID stability across persistence reloads.
const reloadedPrefabs = await new PrefabLibrary({ store: prefabStore }).init();
assert.ok(reloadedPrefabs.get(prefab.id));
assert.equal(reloadedPrefabs.get(prefab.id).id, prefab.id);
assert.equal(reloadedPrefabs.get(prefab.id).objects[0].assetRef, reliefAsset.id);

// Pure expansion: placement transform + prefabRef + preserved metadata.
const expanded = worldObjectsFromPrefab(prefab, { position: { x: 10, y: 0, z: -4 }, yaw: 0 });
assert.equal(expanded.length, 1);
assert.equal(expanded[0].prefabRef, prefab.id);
assert.equal(expanded[0].assetRef, reliefAsset.id);
assert.equal(expanded[0].collider.type, "box");
assert.equal(expanded[0].exclusion.trees, true);
assert.ok(Math.abs(expanded[0].transform.position.x - 10) < 1e-6);
assert.ok(Math.abs(expanded[0].transform.position.z + 4) < 1e-6);

// Placing a prefab creates real placed objects that preserve prefabRef.
const prefabScene = new THREE.Scene();
const prefabManager = new WorldObjectManager(prefabScene, { assetLibrary });
const instancer = new PrefabInstancer(prefabManager);
const placedA = await instancer.instantiate(prefab, { position: { x: 5, y: 0, z: 5 } });
assert.equal(placedA.length, 1);
const placedB = await instancer.instantiate(prefab, { position: { x: 8, y: 0, z: 8 } });
assert.equal(placedB.length, 1);
assert.equal(prefabManager.objects.size, 2); // placed multiple times

const placedSerialized = prefabManager.serializeWorldObjects();
assert.equal(placedSerialized.length, 2);
assert.equal(placedSerialized[0].prefabRef, prefab.id);
assert.equal(placedSerialized[0].assetRef, reliefAsset.id);
assert.equal(placedSerialized[0].collider.type, "box");
assert.equal(placedSerialized[1].prefabRef, prefab.id);

// Deleting the prefab must not remove already-placed world objects.
assert.equal(await prefabLibrary.delete(prefab.id), true);
assert.equal(prefabLibrary.get(prefab.id), null);
assert.equal(prefabManager.objects.size, 2);

// World document round-trip: prefabRef on objects + prefab manifest preserved,
// and an unknown prefabRef must not crash validation or load.
const prefabWorldDoc = createWorldDocument({
  objects: [
    {
      id: "obj-from-prefab",
      name: "From Prefab",
      type: "primitive",
      assetRef: "primitive-cube",
      primitive: "cube",
      prefabRef: "prefab-known-123",
      transform: {
        position: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      collider: { type: "box", enabled: true },
      exclusion: { grass: true, trees: true },
    },
    {
      id: "obj-unknown-prefab",
      name: "Unknown Prefab Ref",
      type: "primitive",
      assetRef: "primitive-sphere",
      primitive: "sphere",
      prefabRef: "prefab-does-not-exist",
      transform: {
        position: { x: 2, y: 2, z: 2 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      exclusion: { grass: false, trees: false },
    },
  ],
  prefabs: { version: 1, items: [prefab] },
});
const prefabValidated = validateWorldDocument(prefabWorldDoc);
assert.equal(prefabValidated.warnings.length, 0);
assert.equal(prefabValidated.document.objects[0].prefabRef, "prefab-known-123");
assert.equal(prefabValidated.document.objects[1].prefabRef, "prefab-does-not-exist");
assert.equal(prefabValidated.document.prefabs.items.length, 1);
assert.equal(prefabValidated.document.prefabs.items[0].id, prefab.id);

// Loading a world with a placed-but-orphaned prefabRef does not crash and the
// prefabRef survives the manager round-trip.
const missingScene = new THREE.Scene();
const missingManager = new WorldObjectManager(missingScene, { assetLibrary });
await missingManager.loadWorldObjects(prefabValidated.document.objects);
const missingRoundTrip = missingManager.serializeWorldObjects();
assert.equal(missingRoundTrip.length, 2);
assert.equal(missingRoundTrip[0].prefabRef, "prefab-known-123");
assert.equal(missingRoundTrip[1].prefabRef, "prefab-does-not-exist");

// Export → import keeps prefabRef and the prefab manifest.
const exportedPrefabJson = JSON.stringify({ ...prefabValidated.document, objects: missingRoundTrip });
const importedPrefab = validateWorldDocument(JSON.parse(exportedPrefabJson));
assert.equal(importedPrefab.document.objects[0].prefabRef, "prefab-known-123");
assert.equal(importedPrefab.document.prefabs.items.length, 1);

// --- Stage 6A: grouped prefab round-trip ------------------------------------

function worldObjectDescriptor(id, assetRef, primitive, x) {
  return {
    id,
    name: primitive,
    type: "primitive",
    assetRef,
    primitive,
    asset: null,
    transform: {
      position: { x, y: 1, z: 10 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    collider: { type: "box", dimensions: {}, enabled: true },
    exclusion: { grass: true, trees: true, radius: 0, bounds: null },
    runtime: { visible: true, static: true, castShadow: true, receiveShadow: true },
  };
}

const groupLibrary = await new PrefabLibrary({ store: new MemoryPrefabStore() }).init();
const groupA = worldObjectDescriptor("g-a", "primitive-cube", "cube", 10);
const groupB = worldObjectDescriptor("g-b", "primitive-sphere", "sphere", 13); // 3 units apart
const groupPrefab = await groupLibrary.createFromObjects([groupA, groupB], { name: "Two Block Group" });

assert.equal(groupPrefab.kind, "group");
assert.equal(groupPrefab.objects.length, 2);
assert.equal(groupPrefab.metadata.objectCount, 2);
// Relative offset preserved as local transforms about the group origin.
const localDx = groupPrefab.objects[1].localTransform.position.x - groupPrefab.objects[0].localTransform.position.x;
assert.ok(Math.abs(localDx - 3) < 1e-6);

// Expansion preserves relative layout and tags both children with prefabRef.
const groupExpanded = worldObjectsFromPrefab(groupPrefab, { position: { x: 50, y: 0, z: 50 } });
assert.equal(groupExpanded.length, 2);
assert.equal(groupExpanded[0].prefabRef, groupPrefab.id);
assert.equal(groupExpanded[1].prefabRef, groupPrefab.id);
const worldDx = groupExpanded[1].transform.position.x - groupExpanded[0].transform.position.x;
assert.ok(Math.abs(worldDx - 3) < 1e-6);
assert.equal(groupExpanded[0].assetRef, "primitive-cube");
assert.equal(groupExpanded[1].assetRef, "primitive-sphere");

// Instancing the grouped prefab creates two real placed objects.
const groupScene = new THREE.Scene();
const groupManager = new WorldObjectManager(groupScene, { assetLibrary });
const groupInstancer = new PrefabInstancer(groupManager);
const groupPlaced = await groupInstancer.instantiate(groupPrefab, { position: { x: -30, y: 0, z: -30 } });
assert.equal(groupPlaced.length, 2);
assert.equal(groupManager.objects.size, 2);
const groupRoundTrip = groupManager.serializeWorldObjects();
assert.equal(groupRoundTrip.every((o) => o.prefabRef === groupPrefab.id), true);
assert.equal(groupRoundTrip[0].collider.type, "box");
assert.equal(groupRoundTrip[0].exclusion.grass, true);
const placedDx = Math.abs(groupRoundTrip[1].transform.position.x - groupRoundTrip[0].transform.position.x);
assert.ok(Math.abs(placedDx - 3) < 1e-6); // relative layout reconstructed

// --- Stage 6B: built-in structural kit library ------------------------------

const kitStore = new MemoryPrefabStore();
const kitLibrary = await new PrefabLibrary({ store: kitStore }).init();

// Built-ins are registered, marked, and NOT persisted to the user store.
const kitList = kitLibrary.list();
assert.ok(kitList.length >= 10);
assert.ok(kitLibrary.isBuiltin("builtin-straight-road"));
assert.equal(isBuiltinPrefab(kitLibrary.get("builtin-wall")), true);
assert.equal(kitStore.data.length, 0); // built-ins never written to storage
assert.ok(createBuiltinPrefabs().some((p) => p.id === "builtin-hut")); // stable ids

// Road defaults: walkable plane collider + grass/tree exclusion.
const road = kitLibrary.get("builtin-straight-road");
assert.equal(road.objects[0].collider.type, "plane");
assert.equal(road.objects[0].exclusion.grass, true);
assert.equal(road.objects[0].exclusion.trees, true);

// Ramp defaults: ramp collider + exclusion.
const ramp = kitLibrary.get("builtin-ramp");
assert.equal(ramp.objects[0].collider.type, "ramp");
assert.equal(ramp.objects[0].exclusion.grass, true);

// Wall defaults: box collider (blocks the player).
assert.equal(kitLibrary.get("builtin-wall").objects[0].collider.type, "box");

// Built-ins cannot be deleted or renamed.
assert.equal(await kitLibrary.delete("builtin-wall"), false);
assert.equal((await kitLibrary.rename("builtin-wall", "Hacked")).name, "Wall Segment");

// World export manifest excludes built-ins (they regenerate locally).
assert.equal(kitLibrary.createManifest().items.length, 0);

// Placing a built-in creates real placed objects carrying prefabRef.
const kitScene = new THREE.Scene();
const kitManager = new WorldObjectManager(kitScene, { assetLibrary });
const kitInstancer = new PrefabInstancer(kitManager);
const placedRoad = await kitInstancer.instantiate(road, { position: { x: 5, y: 0, z: 5 } });
assert.equal(placedRoad.length, 1);
const roadSerialized = kitManager.serializeWorldObjects();
assert.equal(roadSerialized[0].prefabRef, "builtin-straight-road");
assert.equal(roadSerialized[0].collider.type, "plane");
assert.equal(roadSerialized[0].exclusion.grass, true);
assert.equal(roadSerialized[0].exclusion.trees, true);

// Multi-part kit (hut) places every part and tags each with prefabRef.
const hut = kitLibrary.get("builtin-hut");
const placedHut = await kitInstancer.instantiate(hut, { position: { x: 30, y: 0, z: 30 } });
assert.equal(placedHut.length, hut.objects.length);
const hutSerialized = kitManager.serializeWorldObjects().filter((o) => o.prefabRef === "builtin-hut");
assert.equal(hutSerialized.length, hut.objects.length);
assert.ok(hutSerialized.every((o) => o.collider.type === "box"));

// A world referencing a built-in prefabRef survives validation + reload.
const kitWorld = validateWorldDocument(
  createWorldDocument({ objects: kitManager.serializeWorldObjects() })
);
assert.equal(kitWorld.warnings.length, 0);
assert.ok(kitWorld.document.objects.every((o) => typeof o.prefabRef === "string"));

// --- Stage 7: vertical slice sample world -----------------------------------

const sliceDoc = buildVerticalSliceV1();
const sliceValidated = validateWorldDocument(sliceDoc);
assert.equal(sliceValidated.warnings.length, 0); // sample loads clean
assert.ok(sliceValidated.document.objects.length >= 10);
assert.ok(
  Number.isFinite(sliceDoc.player.spawn.x) &&
    Number.isFinite(sliceDoc.player.spawn.y) &&
    Number.isFinite(sliceDoc.player.spawn.z)
);

// Every required structural element is present (by prefabRef).
const sliceRefs = new Set(sliceDoc.objects.map((o) => o.prefabRef));
for (const id of [
  "builtin-straight-road",
  "builtin-ramp",
  "builtin-wall",
  "builtin-platform",
  "builtin-signboard",
  "builtin-hut",
  "builtin-tree-cluster",
]) {
  assert.ok(sliceRefs.has(id), `vertical slice is missing ${id}`);
}

// Road is walkable + suppresses grass/trees; wall is a solid box.
const sliceRoad = sliceDoc.objects.find((o) => o.prefabRef === "builtin-straight-road");
assert.equal(sliceRoad.collider.type, "plane");
assert.equal(sliceRoad.exclusion.grass, true);
assert.equal(sliceRoad.exclusion.trees, true);
assert.equal(sliceDoc.objects.find((o) => o.prefabRef === "builtin-wall").collider.type, "box");

// Registry lookups (used by editor action + runtime ?world=).
assert.ok(getSampleWorld(VERTICAL_SLICE_ID));
assert.equal(getSampleWorld("does-not-exist"), null);

// Load the slice as normal world objects (no missing assets — primitives only),
// then round-trip: prefabRef / collider / exclusion preserved.
const sliceScene = new THREE.Scene();
const sliceManager = new WorldObjectManager(sliceScene, { assetLibrary });
await sliceManager.loadWorldObjects(sliceValidated.document.objects);
assert.equal(sliceManager.objects.size, sliceValidated.document.objects.length);
const sliceRound = sliceManager.serializeWorldObjects();
assert.equal(sliceRound.length, sliceValidated.document.objects.length);
assert.ok(sliceRound.some((o) => o.prefabRef === "builtin-ramp"));
const roundRoad = sliceRound.find((o) => o.prefabRef === "builtin-straight-road");
assert.equal(roundRoad.collider.type, "plane");
assert.equal(roundRoad.exclusion.grass, true);

// Export → import preserves the whole slice with no warnings.
const sliceJson = JSON.stringify({ ...sliceValidated.document, objects: sliceRound });
const sliceImported = validateWorldDocument(JSON.parse(sliceJson));
assert.equal(sliceImported.warnings.length, 0);
assert.equal(sliceImported.document.objects.length, sliceRound.length);
assert.ok(sliceImported.document.objects.every((o) => typeof o.prefabRef === "string"));

// Garbage prefab input is skipped, never thrown.
assert.equal(validatePrefabDocument(null).prefab, null);
assert.equal(validatePrefabDocument({ name: "Empty", objects: [] }).prefab, null);

// GLTF-backed prefab children keep their advisory type through validation
// (PREFAB_OBJECT_TYPES includes "gltf"), and are classified as asset prefabs.
const gltfPrefab = validatePrefabDocument({
  name: "Gltf Prefab",
  objects: [
    {
      localId: "c0",
      name: "Model",
      type: "gltf",
      assetRef: "gltf-abc",
      localTransform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      collider: { type: "box", enabled: true },
      exclusion: { grass: true, trees: true },
    },
  ],
});
assert.ok(gltfPrefab.prefab);
assert.equal(gltfPrefab.prefab.objects[0].type, "gltf");
assert.equal(gltfPrefab.prefab.kind, "asset");

// --- Stage 8: playable build export -----------------------------------------

// A world that mixes a primitive, an asset-backed relief (blob present), and an
// object whose assetRef has no blob (missing). Spawn placed clear of geometry.
const exportDoc = createWorldDocument({
  metadata: { name: "Export World" },
  player: { spawn: { x: -20, y: 0, z: -20 }, cameraMode: "third" },
  objects: [
    {
      id: "obj-prim-export",
      name: "Cube",
      type: "primitive",
      assetRef: "primitive-cube",
      primitive: "cube",
      transform: { position: { x: 0, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      collider: { type: "box", enabled: true },
      exclusion: { grass: true, trees: true },
    },
    {
      id: "obj-relief-export",
      name: "Relief",
      type: "relief",
      assetRef: reliefAsset.id,
      transform: { position: { x: 6, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      collider: { type: "box", enabled: true },
      exclusion: { grass: true, trees: true },
    },
    {
      id: "obj-missing-export",
      name: "Ghost",
      type: "image",
      assetRef: "ghost-asset-xyz",
      transform: { position: { x: 12, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      collider: { type: "plane", enabled: true },
      exclusion: { grass: false, trees: false },
    },
  ],
});
const exportSanitized = validateWorldDocument(exportDoc).document;

// Only non-primitive refs are collected (primitives regenerate at runtime).
const usedRefs = collectUsedAssetRefs(exportSanitized).sort();
assert.deepEqual(usedRefs, [reliefAsset.id, "ghost-asset-xyz"].sort());

// Collection embeds the relief blob, reports the missing one, excludes unused.
const collected = await collectBuildAssets(exportSanitized, assetLibrary);
assert.equal(collected.embedded.length, 1);
assert.equal(collected.embedded[0].id, reliefAsset.id);
assert.ok(collected.embedded[0].dataBase64.length > 0);
assert.equal(collected.missing.length, 1);
assert.equal(collected.missing[0].id, "ghost-asset-xyz");
assert.ok(collected.unusedCount >= 1); // the duplicate relief is never referenced

// Validation: runtime-safe (no errors), missing asset surfaced as a warning.
const buildValidation = validateBuild(exportSanitized, collected);
assert.equal(buildValidation.ok, true);
assert.ok(buildValidation.warnings.some((w) => /ghost-asset-xyz/.test(w)));
assert.ok(buildValidation.report.criteria.some((c) => c.id === "assets-resolve" && c.status === "WARN"));
assert.ok(buildValidation.report.criteria.some((c) => c.id === "player-spawn-clear" && c.status === "PASS"));

// Worldpack shape + manifest counts + deterministic timestamp passthrough.
const worldpack = await buildWorldPack(exportDoc, assetLibrary, { exportedAt: "2026-06-14T00:00:00.000Z" });
assert.equal(worldpack.format, "world-builder-worldpack");
assert.equal(worldpack.version, 1);
assert.equal(worldpack.world.version, 2);
assert.equal(worldpack.manifest.objectCount, 3);
assert.equal(worldpack.manifest.assetCount, 1);
assert.equal(worldpack.manifest.missingAssetCount, 1);
assert.equal(worldpack.manifest.prefabCount, 0);
assert.equal(worldpack.manifest.exportedAt, "2026-06-14T00:00:00.000Z");
assert.ok(worldpack.manifest.requiredCapabilities.includes("webgl2"));
assert.equal(worldpack.assets.length, 1);

// Runtime loader compatibility: rebuild an AssetLibrary purely from the pack and
// reconstruct the world. The relief resolves to real geometry; the missing
// asset degrades to a placeholder (allowed by validation), never crashing.
const consumed = await createAssetLibraryFromWorldPack(worldpack);
assert.equal(consumed.document.version, 2);
const consumedRelief = await consumed.assetLibrary.resolve(reliefAsset.id);
assert.ok(consumedRelief && consumedRelief.geometry);
const consumeManager = new WorldObjectManager(new THREE.Scene(), { assetLibrary: consumed.assetLibrary });
await consumeManager.loadWorldObjects(consumed.document.objects);
assert.equal(consumeManager.objects.size, 3);
const consumedObjects = [...consumeManager.objects.values()];
assert.equal(consumedObjects.find((o) => o.userData.assetRef === reliefAsset.id).userData.asset.type, "relief");
assert.equal(consumedObjects.find((o) => o.userData.assetRef === "ghost-asset-xyz").userData.asset.type, "missing");

// Playable build package: conceptual folder structure + embedded asset file.
const pkgFiles = buildPlayableBuildPackage(worldpack);
const pkgPaths = pkgFiles.map((f) => f.path);
for (const required of [
  "index.html",
  "world.worldpack.json",
  "world/world.json",
  "world/manifest.json",
  "docs/README.txt",
  "docs/validation-report.json",
]) {
  assert.ok(pkgPaths.includes(required), `playable build package missing ${required}`);
}
assert.ok(pkgPaths.some((p) => p.startsWith("assets/"))); // the embedded relief blob

// Store-only zip writer: valid signatures, correct entry count, CRC32 vector.
const zipBytes = createZip(pkgFiles);
assert.ok(zipBytes instanceof Uint8Array && zipBytes.length > 0);
assert.equal(new DataView(zipBytes.buffer).getUint32(0, true), 0x04034b50); // local file header
const eocdView = new DataView(zipBytes.buffer, zipBytes.length - 22);
assert.equal(eocdView.getUint32(0, true), 0x06054b50); // end of central directory
assert.equal(eocdView.getUint16(10, true), pkgFiles.length); // total entries
assert.equal(crc32(new TextEncoder().encode("hello")), 0x3610a686); // known CRC-32 vector

// Vertical slice exports as a clean playable build: primitives only, no missing
// assets, validation passes, world stays WorldDocument v2.
const sliceWorldpack = await buildWorldPack(sliceDoc, assetLibrary, { exportedAt: "2026-06-14T00:00:00.000Z" });
assert.equal(sliceWorldpack.manifest.assetCount, 0);
assert.equal(sliceWorldpack.manifest.missingAssetCount, 0);
assert.equal(sliceWorldpack.report.ok, true);
assert.equal(sliceWorldpack.manifest.objectCount, sliceDoc.objects.length);
assert.equal(sliceWorldpack.world.version, 2);
assert.ok(buildPlayableBuildPackage(sliceWorldpack).every((f) => f.path && (f.text !== undefined || f.bytes)));

// Hardening: an untrusted worldpack (malicious worldName / asset id) must not
// produce a launcher that breaks out of its inline <script>, nor zip paths that
// traverse out of the package on extraction.
const hostilePackage = buildPlayableBuildPackage({
  manifest: {
    format: "world-builder-worldpack",
    worldName: "</script><script>alert(1)</script>",
    objectCount: 0,
    assetCount: 1,
    missingAssetCount: 0,
    prefabCount: 0,
    exportedAt: "2026-06-14T00:00:00.000Z",
    requiredCapabilities: ["webgl2"],
    assetReferences: [],
  },
  world: { version: 2 },
  assets: [{ id: "../../evil", type: "image", name: "e", mimeType: "image/png", sizeBytes: 3, dataBase64: "AQID" }],
  report: { ok: true, errors: [], warnings: [], criteria: [] },
});
const hostileLauncher = hostilePackage.find((f) => f.path === "index.html").text;
assert.ok(!/<\/script><script>alert/i.test(hostileLauncher), "launcher must neutralize </script> from worldName");
const hostileAsset = hostilePackage.find((f) => f.path.startsWith("assets/"));
assert.ok(!hostileAsset.path.includes(".."), "zip asset paths must not contain path traversal");

// --- Stage 9: mod packages (data-only) --------------------------------------

const modPrefabLib = await new PrefabLibrary({ store: new MemoryPrefabStore() }).init();

// Export the vertical slice as a mod package: one self-contained worldpack +
// built-in kit references (metadata only), no external assets.
const sliceMod = await buildWorldMod(sliceDoc, assetLibrary, modPrefabLib, {
  name: "Slice Mod",
  author: "tester",
  exportedAt: "2026-06-14T00:00:00.000Z",
});
assert.equal(sliceMod.format, "grass-world-mod-v1");
assert.equal(sliceMod.version, 1);
assert.ok(sliceMod.id.startsWith("mod-"));
assert.equal(sliceMod.signature, null); // no signing in v1
assert.equal(sliceMod.contents.worldpacks.length, 1);
assert.equal(sliceMod.contents.worldpacks[0].world.version, 2);
assert.ok(sliceMod.contents.kits.length >= 1); // built-in kits referenced
assert.equal(sliceMod.contents.assets.length, 0); // slice is primitives-only
assert.equal(validateModPackage(sliceMod).ok, true);

// Reject invalid format.
assert.equal(validateModPackage({ format: "not-a-mod", version: 1, id: "x", name: "x" }).ok, false);

// Reject executable/prohibited fields (nested and top-level).
const scriptInWorld = createModPackage({ name: "Hostile" });
scriptInWorld.contents.worlds.push({ version: 2, objects: [], script: "alert(1)" });
const scriptResult = validateModPackage(scriptInWorld);
assert.equal(scriptResult.ok, false);
assert.ok(scriptResult.errors.some((e) => /prohibited|executable/i.test(e)));
assert.equal(validateModPackage({ ...createModPackage({ name: "H2" }), code: "evil()" }).ok, false);

// Reject path traversal in an asset id.
const traversalMod = createModPackage({ name: "Traversal" });
traversalMod.contents.assets.push({ id: "../../etc/passwd", type: "image", mimeType: "image/png", dataBase64: "AQID" });
const traversalResult = validateModPackage(traversalMod);
assert.equal(traversalResult.ok, false);
assert.ok(traversalResult.errors.some((e) => /traversal|path/i.test(e)));

// Import a valid mod from JSON and from a zip (both round-trip to the same id).
const fromJson = parseModPackage(JSON.stringify(sliceMod));
assert.ok(fromJson.modpack);
assert.equal(fromJson.validation.ok, true);
assert.equal(fromJson.modpack.id, sliceMod.id);

const modFiles = buildModFiles(sliceMod);
assert.ok(modFiles.some((f) => f.path === "mod.modpack.json"));
assert.ok(modFiles.every((f) => !f.path.includes(".."))); // safe zip paths
const modZipBytes = createZip(modFiles);
assert.ok(readZip(modZipBytes).some((e) => e.path === "mod.modpack.json"));
const fromZip = parseModPackage(modZipBytes);
assert.ok(fromZip.modpack);
assert.equal(fromZip.modpack.id, sliceMod.id);

// Install into a registry → registry round-trip → runtime loader consumes the
// imported mod world (vertical slice rebuilds with all objects).
const modRegistry = await new ModRegistry({ store: new MemoryModStore() }).init();
const installPrefabLib = await new PrefabLibrary({ store: new MemoryPrefabStore() }).init();
const installed = await modRegistry.install(sliceMod, { assetLibrary, prefabLibrary: installPrefabLib });
assert.equal(installed.entry.id, sliceMod.id);
assert.equal(installed.entry.counts.worlds, 1);
assert.equal(installed.entry.enabled, true);

const reloadedRegistry = await new ModRegistry({ store: modRegistry.store }).init();
assert.ok(reloadedRegistry.get(sliceMod.id));
assert.equal(reloadedRegistry.list().length, 1);

const modWorld = reloadedRegistry.getModWorld(sliceMod.id);
assert.ok(modWorld.document);
const modScene = new THREE.Scene();
const modManager = new WorldObjectManager(modScene, { assetLibrary });
await modManager.loadWorldObjects(validateWorldDocument(modWorld.document).document.objects);
assert.equal(modManager.objects.size, sliceDoc.objects.length);

// enable/disable + uninstall (keeps contributed content; reports it).
assert.equal((await reloadedRegistry.setEnabled(sliceMod.id, false)).enabled, false);
const uninstalled = await reloadedRegistry.uninstall(sliceMod.id);
assert.equal(uninstalled.id, sliceMod.id);
assert.equal(reloadedRegistry.get(sliceMod.id), null);

// Duplicate-id conflict: install must NOT overwrite an existing local asset.
const dupMod = assembleModPackage({
  name: "Dup Asset Mod",
  assets: [{ id: reliefAsset.id, type: "relief", name: "Should Not Win", mimeType: "application/json", sizeBytes: 4, dataBase64: "AQID" }],
});
assert.equal(validateModPackage(dupMod).ok, true);
const beforeName = assetLibrary.get(reliefAsset.id).name;
const dupRegistry = await new ModRegistry({ store: new MemoryModStore() }).init();
const dupInstall = await dupRegistry.install(dupMod, { assetLibrary, prefabLibrary: installPrefabLib });
assert.ok(dupInstall.warnings.some((w) => w.includes(reliefAsset.id) && /already exists/.test(w)));
assert.equal(assetLibrary.get(reliefAsset.id).name, beforeName); // untouched

// Missing imported asset → placeholder at load, never a crash or hard reject.
const missingMod = assembleModPackage({
  name: "Missing Asset Mod",
  worlds: [
    createWorldDocument({
      objects: [
        {
          id: "obj-ghost-mod",
          name: "Ghost",
          type: "image",
          assetRef: "ghost-mod-asset",
          transform: { position: { x: 0, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
          collider: { type: "plane", enabled: true },
          exclusion: { grass: false, trees: false },
        },
      ],
    }),
  ],
});
assert.equal(validateModPackage(missingMod).ok, true);
const missingRegistry = await new ModRegistry({ store: new MemoryModStore() }).init();
await missingRegistry.install(missingMod, { assetLibrary, prefabLibrary: installPrefabLib });
const ghostWorld = missingRegistry.getModWorld(missingMod.id);
const ghostManager = new WorldObjectManager(new THREE.Scene(), { assetLibrary });
await ghostManager.loadWorldObjects(validateWorldDocument(ghostWorld.document).document.objects);
assert.equal(ghostManager.objects.size, 1);
assert.equal([...ghostManager.objects.values()][0].userData.asset.type, "missing");

// Security hardening (from adversarial review):
// Prohibited key at array index 0 followed by many fillers is still caught
// (scan examines index 0 first; it cannot be starved by trailing entries).
const evilFirst = createModPackage({ name: "EvilFirst" });
evilFirst.contents.assets = [{ id: "evil", script: "payload" }, ...Array.from({ length: 4000 }, (_, i) => ({ id: `f${i}` }))];
const evilResult = validateModPackage(evilFirst);
assert.equal(evilResult.ok, false);
assert.ok(evilResult.errors.some((e) => /prohibited|executable/i.test(e)));

// Excessive content record count is rejected before deep work.
const huge = createModPackage({ name: "Huge" });
huge.contents.assets = Array.from({ length: 5001 }, (_, i) => ({ id: `a${i}` }));
assert.equal(validateModPackage(huge).ok, false);
assert.ok(validateModPackage(huge).errors.some((e) => /content records/i.test(e)));

// Executable / markup MIME types are rejected.
const htmlMime = createModPackage({ name: "HtmlMime" });
htmlMime.contents.assets = [{ id: "x", type: "image", mimeType: "text/html", dataBase64: "AQID" }];
assert.equal(validateModPackage(htmlMime).ok, false);

// A JSON-parsed __proto__ key is rejected and never pollutes Object.prototype.
const protoParsed = parseModPackage(
  '{"format":"grass-world-mod-v1","version":1,"id":"p","name":"Proto","contents":{"worlds":[{"version":2,"objects":[],"__proto__":{"polluted":true}}]}}'
);
assert.equal(protoParsed.validation.ok, false);
assert.equal(protoParsed.modpack, null);
assert.equal({}.polluted, undefined); // no prototype pollution occurred

// Zip entry names are stripped of traversal segments on read.
const slipZip = createZip([{ path: "a/../evil.txt", text: "x" }]);
assert.ok(readZip(slipZip).every((e) => !e.path.includes("..")));

// --- Stage 10: rigged asset runtime -----------------------------------------

// Metadata extraction from a (fake) parsed GLB: clip + skinned-mesh detection.
const fakeScene = new THREE.Group();
const skinned = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
skinned.isSkinnedMesh = true;
fakeScene.add(skinned);
const extracted = extractAnimationMetadata(fakeScene, [new THREE.AnimationClip("Idle", 1.5, [])]);
assert.equal(extracted.clips.length, 1);
assert.equal(extracted.clips[0].name, "Idle");
assert.equal(extracted.clips[0].duration, 1.5);
assert.equal(extracted.hasSkinnedMesh, true);
assert.equal(extracted.defaultClip, "Idle");
const staticExtract = extractAnimationMetadata(new THREE.Group(), []);
assert.equal(staticExtract.clips.length, 0);
assert.equal(staticExtract.hasSkeleton, false);

// Invalid metadata is repaired, not fatal.
const dirty = sanitizeAssetAnimation({
  clips: [{ name: "A", duration: -5 }, { name: "A", duration: 1 }, { name: "B", duration: 2 }],
  defaultClip: "NoSuch",
  playbackSpeed: 999,
  autoplay: "yes",
  loop: 0,
}).animation;
assert.equal(dirty.clips.length, 2); // duplicate "A" dropped
assert.equal(dirty.clips[0].duration, 0); // negative repaired to 0
assert.equal(dirty.defaultClip, "A"); // missing default → first clip
assert.equal(dirty.playbackSpeed, 8); // clamped to max
assert.equal(dirty.autoplay, true); // non-bool → default
assert.equal(dirty.loop, true);
assert.equal(sanitizeAssetAnimation(null).animation, null);
const placedDirty = sanitizePlacedAnimation({ clip: 123, playbackSpeed: -10, startOffset: -3, autoplay: false, loop: true });
assert.equal(placedDirty.clip, null);
assert.equal(placedDirty.playbackSpeed, 0.05); // clamped to min
assert.equal(placedDirty.startOffset, 0);
assert.equal(placedDirty.autoplay, false);
assert.equal(sanitizePlacedAnimation(null), null);

// Runtime clip resolution + missing-clip fallback.
assert.equal(resolveClipName({ clip: "Walk" }, { defaultClip: "Idle" }, ["Idle", "Walk"]), "Walk");
assert.equal(resolveClipName({ clip: "Nope" }, { defaultClip: "Idle" }, ["Idle", "Walk"]), "Idle"); // missing → default
assert.equal(resolveClipName({}, { defaultClip: "Gone" }, ["Idle", "Walk"]), "Idle"); // default missing → first
assert.equal(resolveClipName(null, null, []), null);

// AnimationRuntime: independent mixers, no crash on empty/bad input.
const animRuntime = new AnimationRuntime();
assert.equal(animRuntime.register(new THREE.Group(), { animations: [] }, null), null); // no clips → static
assert.equal(animRuntime.register(null, null, null), null); // bad input → no crash
const rigRootA = new THREE.Group();
const rigRootB = new THREE.Group();
const idleClip = new THREE.AnimationClip("Idle", 1, []);
const asset10 = { animations: [idleClip], animation: { defaultClip: "Idle", autoplay: true, loop: true, playbackSpeed: 1 } };
assert.ok(animRuntime.register(rigRootA, asset10, { clip: "Idle" }));
assert.ok(animRuntime.register(rigRootB, asset10, { clip: "Idle" })); // second instance independent
assert.equal(animRuntime.count, 2);
animRuntime.update(0.016); // no throw
animRuntime.remove(rigRootA);
assert.equal(animRuntime.count, 1);
animRuntime.clear();
assert.equal(animRuntime.count, 0);

// Asset record round-trip: animation metadata survives store + manifest.
const riggedBlob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "model/gltf-binary" });
const riggedAsset = await assetLibrary.storeAsset(
  {
    id: "gltf-rigged-test",
    type: "gltf",
    name: "Rigged",
    sourceName: "rigged.glb",
    mimeType: "model/gltf-binary",
    sizeBytes: 4,
    animation: {
      hasSkeleton: true,
      hasSkinnedMesh: true,
      clips: [
        { name: "Idle", duration: 1.5, uuid: "u-idle", index: 0 },
        { name: "Walk", duration: 0.9, uuid: "u-walk", index: 1 },
      ],
      defaultClip: "Idle",
      autoplay: true,
      loop: true,
      playbackSpeed: 1,
    },
  },
  riggedBlob
);
assert.equal(riggedAsset.animation.clips.length, 2);
assert.equal(riggedAsset.animation.defaultClip, "Idle");
const riggedManifestItem = assetLibrary.createManifest().items.find((i) => i.id === riggedAsset.id);
assert.equal(riggedManifestItem.animation.clips.length, 2);

// Static GLB still supported (no animation → null, nothing breaks).
const staticGltf = await assetLibrary.storeAsset(
  { id: "gltf-static-test", type: "gltf", name: "Static", mimeType: "model/gltf-binary", sizeBytes: 4 },
  new Blob([new Uint8Array([5, 6, 7, 8])])
);
assert.equal(staticGltf.animation, null);

// Placed-object override round-trips through the world document (incl. gltf type).
const animWorld = createWorldDocument({
  metadata: { name: "Anim World" },
  player: { spawn: { x: -20, y: 0, z: -20 }, cameraMode: "third" },
  objects: [
    {
      id: "obj-rigged",
      name: "Rigged",
      type: "gltf",
      assetRef: riggedAsset.id,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      collider: { type: "box", enabled: true },
      exclusion: { grass: true, trees: true },
      animation: { clip: "Walk", autoplay: true, loop: false, playbackSpeed: 2, startOffset: 0.5 },
    },
  ],
});
const animValidated = validateWorldDocument(animWorld);
assert.equal(animValidated.warnings.length, 0);
assert.equal(animValidated.document.objects[0].type, "gltf"); // type now round-trips
assert.equal(animValidated.document.objects[0].animation.clip, "Walk");
assert.equal(animValidated.document.objects[0].animation.loop, false);
assert.equal(animValidated.document.objects[0].animation.playbackSpeed, 2);
assert.equal(animValidated.document.objects[0].animation.startOffset, 0.5);

// Worldpack export preserves animation metadata (asset + placed override).
const animPack = await buildWorldPack(animWorld, assetLibrary, { exportedAt: "2026-06-14T00:00:00.000Z" });
const packAsset = animPack.assets.find((a) => a.id === riggedAsset.id);
assert.ok(packAsset);
assert.equal(packAsset.animation.clips.length, 2);
assert.equal(animPack.world.objects.find((o) => o.assetRef === riggedAsset.id).animation.clip, "Walk");

// Mod package export → install → load preserves animation metadata.
const animMod = await buildWorldMod(animWorld, assetLibrary, modPrefabLib, { name: "Anim Mod", exportedAt: "2026-06-14T00:00:00.000Z" });
const animModPackObj = animMod.contents.worldpacks[0].world.objects.find((o) => o.assetRef === riggedAsset.id);
assert.equal(animModPackObj.animation.clip, "Walk");
assert.equal(animMod.contents.worldpacks[0].assets.find((a) => a.id === riggedAsset.id).animation.clips.length, 2);

const freshAssetLib = await new AssetLibrary({ store: new MemoryAssetStore() }).init();
const animModReg = await new ModRegistry({ store: new MemoryModStore() }).init();
const animInstallPrefabs = await new PrefabLibrary({ store: new MemoryPrefabStore() }).init();
await animModReg.install(animMod, { assetLibrary: freshAssetLib, prefabLibrary: animInstallPrefabs });
assert.equal(freshAssetLib.get(riggedAsset.id).animation.clips.length, 2); // asset imported with animation
const installedAnimWorld = animModReg.getModWorld(animMod.id);
assert.equal(installedAnimWorld.document.objects.find((o) => o.assetRef === riggedAsset.id).animation.clip, "Walk");

// A sparse placed override must NOT mask asset-level autoplay/loop defaults.
const maskRuntime = new AnimationRuntime();
const maskClip = new THREE.AnimationClip("Idle", 1, []);
const maskAsset = { animations: [maskClip], animation: { defaultClip: "Idle", autoplay: false, loop: true, playbackSpeed: 1 } };
const maskReg = maskRuntime.register(new THREE.Group(), maskAsset, sanitizePlacedAnimation({ clip: "Idle" }));
assert.equal(maskReg.action.isRunning(), false); // asset autoplay:false respected through a sparse override
const playReg = maskRuntime.register(new THREE.Group(), maskAsset, sanitizePlacedAnimation({ clip: "Idle", autoplay: true }));
assert.equal(playReg.action.isRunning(), true); // explicit override still wins
maskRuntime.clear();

// Interactive placement (addFromAsset) resolves a metadata-only asset and stashes
// animation state, so a freshly placed rigged GLB is configurable immediately.
const placeManager = new WorldObjectManager(new THREE.Scene(), { assetLibrary });
const reliefMetaOnly = assetLibrary.get(reliefAsset.id);
assert.ok(!reliefMetaOnly.geometry); // library entry is metadata-only
const placedRelief = await placeManager.addFromAsset(reliefMetaOnly, new THREE.Vector3(1, 0, 1));
assert.equal(placedRelief.userData.asset.type, "relief"); // resolved, not a cube fallback
assert.equal(placedRelief.userData.animation, null); // fresh placement → no override yet
const riggedResolved = {
  id: "gltf-fake-resolved",
  type: "gltf",
  name: "FakeRig",
  scene: new THREE.Group(),
  animations: [new THREE.AnimationClip("Idle", 1, [])],
  animation: { clips: [{ name: "Idle", duration: 1, uuid: "u", index: 0 }], defaultClip: "Idle", autoplay: true, loop: true, playbackSpeed: 1 },
};
const placedRig = await placeManager.addFromAsset(riggedResolved, new THREE.Vector3(2, 0, 2));
assert.equal(placedRig.userData.assetAnimation.clips.length, 1); // clip metadata for the editor panel
assert.equal(placedRig.userData.animationClips.length, 1); // parsed clips for preview

// --- Stage 10B: fixture-backed animation proof ------------------------------

// Deterministic fixture: extraction sees both clips + the skinned mesh/skeleton.
const fixture = buildAnimatedFixtureScene();
const fixtureMeta = extractAnimationMetadata(fixture.root, fixture.clips);
assert.deepEqual(fixtureMeta.clips.map((c) => c.name).sort(), [...FIXTURE_CLIP_NAMES].sort());
assert.equal(fixtureMeta.hasSkinnedMesh, true);
assert.equal(fixtureMeta.hasSkeleton, true);
assert.equal(fixtureMeta.defaultClip, "Slide");
assert.ok(fixtureMeta.clips.every((c) => c.duration > 0));

// Two SkeletonUtils clones must NOT share mutable skeleton state.
const cloneA = cloneSkeleton(fixture.root);
const cloneB = cloneSkeleton(fixture.root);
let skinnedA = null;
let skinnedB = null;
cloneA.traverse((o) => { if (o.isSkinnedMesh) skinnedA = o; });
cloneB.traverse((o) => { if (o.isSkinnedMesh) skinnedB = o; });
assert.ok(skinnedA && skinnedB);
assert.notEqual(skinnedA.skeleton, skinnedB.skeleton); // independent skeletons
assert.notEqual(skinnedA.skeleton.bones[1], skinnedB.skeleton.bones[1]); // distinct bone instances
skinnedA.skeleton.bones[1].position.x = 5; // mutate clone A's bone
assert.notEqual(skinnedB.skeleton.bones[1].position.x, 5); // clone B is unaffected

// Observability hook reports active mixer count, object ids and clip names.
const dbgRuntime = new AnimationRuntime();
const dbgRoot = new THREE.Group();
dbgRoot.userData.objectId = "obj-dbg";
dbgRuntime.register(
  dbgRoot,
  { animations: [new THREE.AnimationClip("Idle", 1, [])], animation: { defaultClip: "Idle", autoplay: true, loop: true, playbackSpeed: 1 } },
  { clip: "Idle" }
);
const snap = dbgRuntime.debugSnapshot();
assert.equal(snap.count, 1);
assert.equal(snap.objects[0].id, "obj-dbg");
assert.equal(snap.objects[0].clip, "Idle");
assert.equal(snap.objects[0].running, true);
assert.deepEqual(dbgRuntime.activeObjectIds(), ["obj-dbg"]);
assert.deepEqual(dbgRuntime.activeClipNames(), ["Idle"]);
dbgRuntime.clear();
assert.equal(dbgRuntime.debugSnapshot().count, 0);

// --- Stage 11: editor command stack (undo/redo) -----------------------------

const cubeAsset = { type: "primitive", kind: "cube", name: "Cube" };

// Add → undo removes, redo restores the EXACT same instance (object retention).
const histManager = new WorldObjectManager(new THREE.Scene());
const placed1 = await histManager.addFromAsset(cubeAsset, new THREE.Vector3(0, 0, 0));
const id1 = placed1.userData.objectId;
const stack = new CommandStack({ limit: 5 });
stack.push(new AddObjectsCommand(histManager, [placed1]));
assert.equal(histManager.objects.size, 1);
assert.equal(stack.canUndo, true);
assert.equal(stack.canRedo, false);
stack.undo();
assert.equal(histManager.objects.size, 0);
assert.equal(stack.canRedo, true);
stack.redo();
assert.equal(histManager.objects.size, 1);
assert.equal(histManager.objects.get(id1), placed1); // same object, same id
assert.equal(stack.canRedo, false);

// Transform → undo/redo restores exact position/rotation/scale.
const before1 = [
  { id: id1, position: placed1.position.toArray(), rotation: [placed1.rotation.x, placed1.rotation.y, placed1.rotation.z], scale: placed1.scale.toArray() },
];
placed1.position.set(7, 0, -3);
placed1.rotation.set(0, 0.5, 0);
placed1.scale.set(2, 2, 2);
placed1.updateMatrixWorld(true);
const after1 = [{ id: id1, position: [7, 0, -3], rotation: [0, 0.5, 0], scale: [2, 2, 2] }];
stack.push(new TransformObjectsCommand(histManager, before1, after1));
stack.undo();
assert.ok(Math.abs(placed1.position.x - 0) < 1e-9);
assert.ok(Math.abs(placed1.scale.x - 1) < 1e-9);
assert.ok(Math.abs(placed1.rotation.y - 0) < 1e-9);
stack.redo();
assert.ok(Math.abs(placed1.position.x - 7) < 1e-9);
assert.ok(Math.abs(placed1.scale.x - 2) < 1e-9);
assert.ok(Math.abs(placed1.rotation.y - 0.5) < 1e-9);

// Delete (execute) detaches; undo re-attaches the same instance; redo removes.
const placed2 = await histManager.addFromAsset(cubeAsset, new THREE.Vector3(5, 0, 5));
const id2 = placed2.userData.objectId;
stack.push(new AddObjectsCommand(histManager, [placed2]));
assert.equal(histManager.objects.size, 2);
stack.execute(new RemoveObjectsCommand(histManager, [placed2]));
assert.equal(histManager.objects.size, 1);
assert.equal(histManager.objects.has(id2), false);
stack.undo();
assert.equal(histManager.objects.size, 2);
assert.equal(histManager.objects.get(id2), placed2); // exact instance restored
stack.redo();
assert.equal(histManager.objects.has(id2), false);

// A fresh action discards the redo branch.
stack.undo(); // bring placed2 back so there is something to compare
assert.equal(histManager.objects.has(id2), true);
stack.undo(); // undo the add of placed2 → detached, sits in redo
assert.equal(stack.canRedo, true);
const placed3 = await histManager.addFromAsset(cubeAsset, new THREE.Vector3(9, 0, 9));
stack.push(new AddObjectsCommand(histManager, [placed3])); // new action clears redo
assert.equal(stack.canRedo, false);

// Multi-object add (prefab/duplicate shape): one command, N objects.
const multiManager = new WorldObjectManager(new THREE.Scene());
const a = await multiManager.addFromAsset(cubeAsset, new THREE.Vector3(0, 0, 0));
const b = await multiManager.addFromAsset(cubeAsset, new THREE.Vector3(1, 0, 0));
const multiStack = new CommandStack();
multiStack.push(new AddObjectsCommand(multiManager, [a, b]));
assert.equal(multiManager.objects.size, 2);
multiStack.undo();
assert.equal(multiManager.objects.size, 0); // both removed by one undo
multiStack.redo();
assert.equal(multiManager.objects.size, 2);

// Bounded history: evicting a LIVE (done) add command must NOT dispose its
// object — it is still in the scene.
const evManager = new WorldObjectManager(new THREE.Scene());
const evStack = new CommandStack({ limit: 2 });
for (let i = 0; i < 4; i++) {
  const o = await evManager.addFromAsset(cubeAsset, new THREE.Vector3(i, 0, 0));
  evStack.push(new AddObjectsCommand(evManager, [o]));
}
assert.equal(evStack.depth, 2); // only the two newest remain undoable
assert.equal(evManager.objects.size, 4); // evicted-but-live objects kept in scene
evStack.undo();
evStack.undo();
assert.equal(evStack.canUndo, false);
assert.equal(evManager.objects.size, 2); // only the two retained commands undone

// Discarding the redo branch disposes objects parked there (frees GPU memory).
const dispManager = new WorldObjectManager(new THREE.Scene());
let disposed = 0;
const realDispose = dispManager.disposeObject.bind(dispManager);
dispManager.disposeObject = (o) => { disposed++; return realDispose(o); };
const dispStack = new CommandStack({ limit: 5 });
const dObj = await dispManager.addFromAsset(cubeAsset, new THREE.Vector3(0, 0, 0));
dispStack.push(new AddObjectsCommand(dispManager, [dObj]));
dispStack.undo(); // dObj detached → parked in the redo branch
assert.equal(dispManager.objects.size, 0);
assert.equal(disposed, 0); // parked, not yet disposed
const dObj2 = await dispManager.addFromAsset(cubeAsset, new THREE.Vector3(1, 0, 0));
dispStack.push(new AddObjectsCommand(dispManager, [dObj2])); // clears redo
assert.equal(disposed, 1); // the discarded, parked dObj was disposed

// clear() disposes only parked (detached) objects, never live ones.
const clManager = new WorldObjectManager(new THREE.Scene());
let clDisposed = 0;
const clReal = clManager.disposeObject.bind(clManager);
clManager.disposeObject = (o) => { clDisposed++; return clReal(o); };
const clStack = new CommandStack();
const live = await clManager.addFromAsset(cubeAsset, new THREE.Vector3(0, 0, 0));
clStack.push(new AddObjectsCommand(clManager, [live])); // live, in undo stack
const gone = await clManager.addFromAsset(cubeAsset, new THREE.Vector3(1, 0, 0));
clStack.push(new AddObjectsCommand(clManager, [gone]));
clStack.undo(); // gone detached → parked in redo
clStack.clear();
assert.equal(clDisposed, 1); // only the parked object disposed
assert.equal(clManager.objects.has(live.userData.objectId), true); // live object untouched

// --- Stage 12: interaction / trigger objects (data-only) --------------------

// No-code guarantee: executable-looking keys are never read or stored.
const hostileTrigger = sanitizeInteraction({ role: "trigger", emitOnEnter: ["go"], script: "alert(1)", onEnter: "evil()", radius: 5 });
assert.equal("script" in hostileTrigger, false);
assert.equal("onEnter" in hostileTrigger, false);
assert.deepEqual(Object.keys(hostileTrigger).sort(), ["channel", "emitOnEnter", "emitOnExit", "once", "radius", "role", "shape"].sort());

// Unknown role / non-object → null.
assert.equal(sanitizeInteraction({ role: "wizard" }), null);
assert.equal(sanitizeInteraction(null), null);
assert.equal(sanitizeInteraction([1, 2, 3]), null);

// Event tokens: bad chars stripped, blanks/dups dropped, list capped at 16.
const tokTrigger = sanitizeInteraction({ role: "trigger", emitOnEnter: ["a b!c", "dup", "dup", "   ", "ok.name-1"] });
assert.deepEqual(tokTrigger.emitOnEnter, ["abc", "dup", "ok.name-1"]);
assert.equal(sanitizeInteraction({ role: "trigger", emitOnEnter: Array.from({ length: 50 }, (_, i) => `e${i}`) }).emitOnEnter.length, 16);

// Numeric clamps + sign text cap + token name sanitize.
assert.equal(sanitizeInteraction({ role: "trigger", radius: 9999 }).radius, 250);
assert.equal(sanitizeInteraction({ role: "trigger", radius: -5 }).radius, 0.1);
assert.equal(sanitizeInteraction({ role: "door", duration: 999 }).duration, 30);
assert.equal(sanitizeInteraction({ role: "sign", text: "x".repeat(400) }).text.length, 280);
assert.equal(sanitizeInteraction({ role: "spawn", name: "check point!" }).name, "checkpoint");

// Per-role door shape (move/rotate vec3 + flags).
const doorMeta = sanitizeInteraction({ role: "door", listenOpen: ["o"], listenClose: ["c"], move: { x: 1, y: 2, z: 3 }, rotate: { y: 1.5 }, duration: 0.4, startOpen: true });
assert.equal(doorMeta.startOpen, true);
assert.deepEqual(doorMeta.move, { x: 1, y: 2, z: 3 });
assert.deepEqual(doorMeta.rotate, { x: 0, y: 1.5, z: 0 });

// Sign text strips control/bidi chars (defense in depth; overlay uses textContent).
assert.equal(sanitizeInteraction({ role: "sign", text: "ok" + String.fromCharCode(0x202e) + String.fromCharCode(0x07) + "x" }).text, "okx");

// Object-count ceiling bounds a hostile/corrupt world document.
const flood = validateWorldDocument(createWorldDocument({
  objects: Array.from({ length: 20005 }, (_, i) => ({
    id: `flood-${i}`,
    type: "primitive",
    primitive: "cube",
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
  })),
}));
assert.equal(flood.document.objects.length, 20000);
assert.ok(flood.warnings.some((w) => /only the first 20000/.test(w)));

// Volume containment.
assert.equal(sphereContains({ x: 0, y: 0, z: 0 }, 5, { x: 3, y: 0, z: 0 }), true);
assert.equal(sphereContains({ x: 0, y: 0, z: 0 }, 5, { x: 6, y: 0, z: 0 }), false);
assert.equal(boxContains({ x: 0, y: 0, z: 0 }, 2, { x: 1.9, y: -1.9, z: 2 }), true);
assert.equal(boxContains({ x: 0, y: 0, z: 0 }, 2, { x: 2.1, y: 0, z: 0 }), false);
assert.equal(volumeContains("box", { x: 0, y: 0, z: 0 }, 1, { x: 0.5, y: 0.5, z: 0.5 }), true);
assert.equal(volumeContains("sphere", { x: 0, y: 0, z: 0 }, 1, { x: 0.9, y: 0, z: 0 }), true);

// EventBus: delivery, channel isolation, unsubscribe.
const bus = new EventBus();
let busHits = 0;
const off = bus.subscribe("default", "open", () => { busHits++; });
bus.subscribe("other", "open", () => { busHits += 100; });
assert.equal(bus.publish("default", "open"), 1);
assert.equal(busHits, 1);
bus.publish("default", "nope");
assert.equal(busHits, 1);
off();
assert.equal(bus.publish("default", "open"), 0);

// Runtime integration: trigger→event→door, pickup, sign, teleport, once.
function interactiveDescriptor(id, position, interaction) {
  return {
    id,
    name: id,
    type: "primitive",
    assetRef: "primitive-cube",
    primitive: "cube",
    transform: { position, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    exclusion: { grass: false, trees: false },
    interaction,
  };
}

const irMessages = [];
const irEvents = [];
const fakePlayer = { position: new THREE.Vector3(200, 0, 200), velocityY: 3, syncMesh() {} };
const interactionRuntime = new InteractionRuntime({
  player: fakePlayer,
  onMessage: (m) => irMessages.push(m),
  onEvent: (e) => irEvents.push(`${e.channel}/${e.name}`),
});
const irManager = new WorldObjectManager(new THREE.Scene());
await irManager.loadWorldObjects([
  interactiveDescriptor("door-1", { x: 0, y: 0, z: 0 }, { role: "door", channel: "default", listenOpen: ["open"], move: { x: 0, y: 3, z: 0 }, duration: 1, startOpen: false }),
  interactiveDescriptor("trig-1", { x: 10, y: 0, z: 0 }, { role: "trigger", channel: "default", radius: 3, emitOnEnter: ["open"] }),
  interactiveDescriptor("pick-1", { x: 20, y: 0, z: 0 }, { role: "pickup", radius: 2, emitOnCollect: ["got_coin"] }),
  interactiveDescriptor("sign-1", { x: 30, y: 0, z: 0 }, { role: "sign", text: "Hello traveler", showRadius: 4 }),
  interactiveDescriptor("spawn-1", { x: 50, y: 5, z: 50 }, { role: "spawn", name: "checkpoint" }),
  interactiveDescriptor("trig-2", { x: 40, y: 0, z: 0 }, { role: "trigger", radius: 2, teleportTo: "checkpoint", once: true }),
]);
interactionRuntime.load(irManager);
assert.equal(interactionRuntime.count, 6);
assert.deepEqual(interactionRuntime.debugSnapshot().spawns, ["checkpoint"]);

// Far away → nothing fires.
interactionRuntime.update(0.1);
assert.equal(irEvents.length, 0);

// Enter the trigger → emits "open"; the door begins opening the same frame.
fakePlayer.position.set(10, 0, 0);
interactionRuntime.update(0.5);
assert.ok(irEvents.includes("default/open"));
let door1 = interactionRuntime.debugSnapshot().doors.find((d) => d.id === "door-1");
assert.ok(door1.t > 0 && door1.t < 1); // ~half-open after 0.5s of a 1s door
interactionRuntime.update(0.6);
door1 = interactionRuntime.debugSnapshot().doors.find((d) => d.id === "door-1");
assert.equal(door1.open, true); // fully open and clamped at 1

// Pickup collect: hidden + event fired, exactly once.
fakePlayer.position.set(20, 0, 0);
interactionRuntime.update(0.1);
const coinEvents = irEvents.filter((e) => e === "default/got_coin").length;
assert.equal(coinEvents, 1);
const pick = interactionRuntime.debugSnapshot().pickups.find((p) => p.id === "pick-1");
assert.equal(pick.collected, true);
assert.equal(pick.visible, false);
interactionRuntime.update(0.1); // still inside → must not re-collect
assert.equal(irEvents.filter((e) => e === "default/got_coin").length, 1);

// Sign proximity shows literal text, then clears on leave.
fakePlayer.position.set(30, 0, 0);
interactionRuntime.update(0.1);
assert.equal(irMessages[irMessages.length - 1], "Hello traveler");
fakePlayer.position.set(0, 0, 0);
interactionRuntime.update(0.1);
assert.equal(irMessages[irMessages.length - 1], null);

// Teleport trigger (once) moves the player to the named spawn.
fakePlayer.position.set(40, 0, 0);
interactionRuntime.update(0.1);
assert.ok(Math.abs(fakePlayer.position.x - 50) < 1e-6 && Math.abs(fakePlayer.position.y - 5) < 1e-6 && Math.abs(fakePlayer.position.z - 50) < 1e-6);
assert.equal(fakePlayer.velocityY, 0);

// once=true → re-entering does not teleport again.
fakePlayer.position.set(0, 0, 0);
interactionRuntime.update(0.1);
fakePlayer.position.set(40, 0, 0);
interactionRuntime.update(0.1);
assert.ok(Math.abs(fakePlayer.position.x - 40) < 1e-6); // stayed put — trigger is spent

// Round-trip: interaction survives serialize → validate → export/import → worldpack → mod.
const rtManager = new WorldObjectManager(new THREE.Scene());
await rtManager.loadWorldObjects([
  interactiveDescriptor("rt-trigger", { x: 0, y: 0, z: 0 }, { role: "trigger", channel: "gate", emitOnEnter: ["open_gate"], radius: 5, once: true }),
  interactiveDescriptor("rt-door", { x: 5, y: 0, z: 0 }, { role: "door", channel: "gate", listenOpen: ["open_gate"], move: { x: 0, y: 4, z: 0 }, duration: 0.8 }),
]);
const rtObjects = rtManager.serializeWorldObjects();
assert.equal(rtObjects[0].interaction.role, "trigger");
assert.deepEqual(rtObjects[0].interaction.emitOnEnter, ["open_gate"]);
assert.equal(rtObjects[1].interaction.role, "door");
assert.deepEqual(rtObjects[1].interaction.listenOpen, ["open_gate"]);

const rtValidated = validateWorldDocument(createWorldDocument({ objects: rtObjects }));
assert.equal(rtValidated.warnings.length, 0);
assert.equal(rtValidated.document.objects[0].interaction.channel, "gate");
assert.equal(rtValidated.document.objects[1].interaction.listenOpen[0], "open_gate");

const rtImported = validateWorldDocument(JSON.parse(JSON.stringify({ ...rtValidated.document, objects: rtManager.serializeWorldObjects() })));
assert.equal(rtImported.document.objects[0].interaction.role, "trigger");

const rtPack = await buildWorldPack(rtValidated.document, assetLibrary, { exportedAt: "2026-06-14T00:00:00.000Z" });
assert.equal(rtPack.world.objects.find((o) => o.id === "rt-trigger").interaction.role, "trigger");

const rtMod = await buildWorldMod(rtValidated.document, assetLibrary, modPrefabLib, { name: "Interaction Mod", exportedAt: "2026-06-14T00:00:00.000Z" });
assert.equal(rtMod.contents.worldpacks[0].world.objects.find((o) => o.id === "rt-door").interaction.listenOpen[0], "open_gate");

// --- Stage 13A: lighting rig (data-driven) ----------------------------------

const lightDefaults = defaultLighting();
assert.deepEqual(sanitizeLighting(lightDefaults), lightDefaults); // defaults stable
assert.deepEqual(sanitizeLighting(null), lightDefaults);
assert.deepEqual(sanitizeLighting("nope"), lightDefaults);

// Clamps, color repair, azimuth wrap, fog near<far ordering.
const dirtyLight = sanitizeLighting({
  sun: { color: "ff0000", intensity: 999, azimuth: 400, elevation: -10, castShadow: false },
  hemisphere: { skyColor: "#abc", groundColor: "bad-color", intensity: -3 },
  fog: { color: "#123456", near: 500, far: 100, enabled: false },
});
assert.equal(dirtyLight.sun.color, "#ff0000"); // no-# hex accepted
assert.equal(dirtyLight.sun.intensity, 8); // clamped to MAX
assert.equal(dirtyLight.sun.azimuth, 40); // 400 wrapped
assert.equal(dirtyLight.sun.elevation, 5); // clamped to MIN
assert.equal(dirtyLight.hemisphere.skyColor, "#aabbcc"); // #abc expanded
assert.equal(dirtyLight.hemisphere.groundColor, lightDefaults.hemisphere.groundColor); // bad → default
assert.equal(dirtyLight.hemisphere.intensity, 0); // clamped to MIN
assert.ok(dirtyLight.fog.far > dirtyLight.fog.near); // far forced above near
assert.equal(dirtyLight.fog.enabled, false);

// Sun offset: elevation 90 → straight up.
const sunUp = computeSunOffset(0, 90, 100);
assert.ok(Math.abs(sunUp.y - 100) < 1e-6 && Math.abs(sunUp.x) < 1e-6 && Math.abs(sunUp.z) < 1e-6);

// applyLighting mutates a live THREE rig + scene fog/background.
const litScene = new THREE.Scene();
litScene.background = new THREE.Color(0x000000);
litScene.fog = new THREE.Fog(0x000000, 1, 2);
const rig = {
  sun: new THREE.DirectionalLight(0xffffff, 1),
  hemi: new THREE.HemisphereLight(0xffffff, 0x000000, 1),
  sunDirection: new THREE.Vector3(),
};
applyLighting({ lights: rig, scene: litScene }, sanitizeLighting({
  sun: { color: "#112233", intensity: 3.5, azimuth: 90, elevation: 45, castShadow: true },
  hemisphere: { skyColor: "#445566", groundColor: "#778899", intensity: 0.5 },
  fog: { color: "#abcdef", near: 40, far: 300, enabled: true },
}));
assert.equal("#" + rig.sun.color.getHexString(), "#112233");
assert.equal(rig.sun.intensity, 3.5);
assert.equal(rig.sun.castShadow, true);
assert.ok(rig.sunOffset && rig.sunOffset.isVector3);
assert.ok(Math.abs(rig.sunDirection.length() - 1) < 1e-6); // normalized
assert.equal(rig.hemi.intensity, 0.5);
assert.equal(litScene.fog.far, 300);
assert.equal("#" + litScene.fog.color.getHexString(), "#abcdef");
assert.equal("#" + litScene.background.getHexString(), "#abcdef");

// Fog disabled removes scene fog entirely.
applyLighting({ lights: rig, scene: litScene }, sanitizeLighting({ fog: { enabled: false } }));
assert.equal(litScene.fog, null);

// Round-trip: lighting survives validate → worldpack.
const litDoc = validateWorldDocument(createWorldDocument({ lighting: { sun: { intensity: 4.2, color: "#ff8800" }, fog: { far: 333 } } }));
assert.equal(litDoc.warnings.length, 0);
assert.equal(litDoc.document.lighting.sun.intensity, 4.2);
assert.equal(litDoc.document.lighting.sun.color, "#ff8800");
assert.equal(litDoc.document.lighting.fog.far, 333);
const litPack = await buildWorldPack(litDoc.document, assetLibrary, { exportedAt: "2026-06-14T00:00:00.000Z" });
assert.equal(litPack.world.lighting.sun.intensity, 4.2);
assert.equal(litPack.world.lighting.fog.far, 333);

// Grass material: null fog at construction is safe, and syncLighting pushes live
// fog/sun/ambient into the shader uniforms (editor lighting edits reach grass).
const grassLights = { sunDirection: new THREE.Vector3(1, 0, 0) };
const nullFogGrass = new GrassMaterial(createGrassConfig(), grassLights, null);
assert.ok(nullFogGrass.material.uniforms.uFogFar.value > 1e5); // no-fog default, no crash
nullFogGrass.syncLighting(
  sanitizeLighting({ sun: { color: "#ff0000" }, hemisphere: { skyColor: "#00ff00", groundColor: "#0000ff" }, fog: { color: "#abcdef", near: 12, far: 88, enabled: true } }),
  new THREE.Vector3(0, 1, 0)
);
const gu = nullFogGrass.material.uniforms;
assert.equal(gu.uFogNear.value, 12);
assert.equal(gu.uFogFar.value, 88);
assert.equal("#" + gu.uFogColor.value.getHexString(), "#abcdef");
assert.equal("#" + gu.uSunColor.value.getHexString(), "#ff0000");
assert.ok(Math.abs(gu.uSunDir.value.y - 1) < 1e-6 && Math.abs(gu.uSunDir.value.x) < 1e-6);
// Fog disabled pushes the grass fade out of range.
nullFogGrass.syncLighting(sanitizeLighting({ fog: { enabled: false } }));
assert.ok(gu.uFogFar.value > 1e5);
nullFogGrass.dispose();

// --- Stage 13B: particle emitters (data-only) -------------------------------

// Sanitize: kind allowlist, clamps, color repair, no-code (unknown keys dropped).
assert.equal(sanitizeParticles(null), null);
assert.equal(sanitizeParticles([1, 2]), null);
const hostileParticles = sanitizeParticles({ kind: "smoke", rate: 9999, max: 99999, color: "0f0", script: "x()", lifetime: -3 });
assert.equal("script" in hostileParticles, false);
assert.equal(hostileParticles.rate, 500); // MAX_RATE
assert.equal(hostileParticles.max, 2000); // MAX_PARTICLES
assert.equal(hostileParticles.color, "#00ff00"); // "0f0" → "#00ff00"
assert.equal(hostileParticles.lifetime, 0.05); // clamped to MIN
assert.equal(sanitizeParticles({ kind: "wizard" }), null); // invalid kind → no emitter
assert.deepEqual(
  Object.keys(sanitizeParticles({ kind: "spark" })).sort(),
  ["color", "colorEnd", "emitRadius", "gravity", "kind", "lifetime", "max", "opacity", "rate", "size", "sizeEnd", "speed"].sort().concat("spread").sort()
);

function particleDescriptor(id, position, particles) {
  return {
    id,
    name: id,
    type: "primitive",
    assetRef: "primitive-cube",
    primitive: "cube",
    transform: { position, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    exclusion: { grass: false, trees: false },
    particles,
  };
}

// Runtime: emitter spawns over time, stays within max, and recycles.
const partManager = new WorldObjectManager(new THREE.Scene());
await partManager.loadWorldObjects([
  particleDescriptor("emit-1", { x: 0, y: 0, z: 0 }, { kind: "smoke", rate: 50, max: 120, lifetime: 1 }),
]);
const partRuntime = new ParticleRuntime({ scene: new THREE.Scene() });
partRuntime.load(partManager);
assert.equal(partRuntime.count, 1);
assert.equal(partRuntime.debugSnapshot().emitters[0].alive, 0); // nothing spawned yet
for (let i = 0; i < 30; i++) partRuntime.update(0.05); // 1.5s
const partSnap = partRuntime.debugSnapshot();
assert.ok(partSnap.totalAlive > 0, "particles should be alive after spawning");
assert.ok(partSnap.emitters[0].alive <= 120, "alive stays within max");
assert.ok(partSnap.emitters[0].alive >= 10, "steady-state ≈ rate*lifetime");
partRuntime.clear();
assert.equal(partRuntime.count, 0);

// A high-rate emitter never exceeds its max (pool cap + recycling).
const capManager = new WorldObjectManager(new THREE.Scene());
await capManager.loadWorldObjects([particleDescriptor("emit-cap", { x: 0, y: 0, z: 0 }, { kind: "spark", rate: 500, max: 30, lifetime: 10 })]);
const capRuntime = new ParticleRuntime({ scene: new THREE.Scene() });
capRuntime.load(capManager);
for (let i = 0; i < 20; i++) capRuntime.update(0.1);
assert.equal(capRuntime.debugSnapshot().emitters[0].alive, 30); // capped at max

// Emitter-count ceiling bounds buffer/GPU memory from a hostile/corrupt world.
const floodManager = new WorldObjectManager(new THREE.Scene());
await floodManager.loadWorldObjects(
  Array.from({ length: 250 }, (_, i) => particleDescriptor(`flood-${i}`, { x: i, y: 0, z: 0 }, { kind: "dust", max: 10 }))
);
const floodRuntime = new ParticleRuntime({ scene: new THREE.Scene() });
floodRuntime.load(floodManager);
assert.equal(floodRuntime.count, 200); // capped at MAX_EMITTERS
floodRuntime.clear();

// Round-trip: particles survive serialize → validate → worldpack.
const rtPartManager = new WorldObjectManager(new THREE.Scene());
await rtPartManager.loadWorldObjects([
  particleDescriptor("p-smoke", { x: 1, y: 2, z: 3 }, { kind: "smoke", rate: 8, max: 90, color: "#ff0000", lifetime: 2 }),
]);
const rtPartObjects = rtPartManager.serializeWorldObjects();
assert.equal(rtPartObjects[0].particles.kind, "smoke");
assert.equal(rtPartObjects[0].particles.color, "#ff0000");
assert.equal(rtPartObjects[0].particles.rate, 8);
const rtPartValidated = validateWorldDocument(createWorldDocument({ objects: rtPartObjects }));
assert.equal(rtPartValidated.warnings.length, 0);
assert.equal(rtPartValidated.document.objects[0].particles.kind, "smoke");
const rtPartPack = await buildWorldPack(rtPartValidated.document, assetLibrary, { exportedAt: "2026-06-14T00:00:00.000Z" });
assert.equal(rtPartPack.world.objects[0].particles.color, "#ff0000");

// --- Stage 14A: grass v2 (clumping + view/distance tint) --------------------

// Grass-config round-trip: new fields validate (clamped) and survive worldpack.
const grassDoc = validateWorldDocument(createWorldDocument({ grass: { clumpStrength: 5, clumpScale: 0.08, distanceTint: 0.4, fresnelIntensity: 0.6 } }));
assert.equal(grassDoc.warnings.length, 0);
assert.equal(grassDoc.document.grass.clumpStrength, 1); // clamped to [0,1]
assert.equal(grassDoc.document.grass.clumpScale, 0.08);
assert.equal(grassDoc.document.grass.distanceTint, 0.4);
assert.equal(grassDoc.document.grass.fresnelIntensity, 0.6);
const grassPack = await buildWorldPack(grassDoc.document, assetLibrary, { exportedAt: "2026-06-14T00:00:00.000Z" });
assert.equal(grassPack.world.grass.clumpStrength, 1);
assert.equal(grassPack.world.grass.distanceTint, 0.4);

// Clumping is deterministic and thins the field; clumpStrength 0 = unchanged.
const cfgNoClump = createGrassConfig({ clumpStrength: 0 });
const cfgClump = createGrassConfig({ clumpStrength: 0.9, clumpScale: 0.05 });
// A single patch rebuilds identically (placement stays deterministic).
const patchA = generatePatchInstances(2, 3, cfgClump);
const patchB = generatePatchInstances(2, 3, cfgClump);
assert.equal(patchA.count, patchB.count);
if (patchA.count > 0) assert.equal(patchA.offset.length, patchA.count * 3); // buffer shape intact
// Aggregate over several patches: clumping removes blades, never adds.
let baseTotal = 0;
let clumpTotal = 0;
for (let g = 0; g < 12; g++) {
  baseTotal += generatePatchInstances(g, g + 1, cfgNoClump).count;
  clumpTotal += generatePatchInstances(g, g + 1, cfgClump).count;
}
assert.ok(baseTotal > 0, "found populated grass patches");
assert.ok(clumpTotal < baseTotal, "clumping thins the aggregate field");

// Grass shader exposes the new vegetation uniforms; syncVegetation pushes config.
const vegCfg = createGrassConfig({ distanceTint: 0.3, fresnelIntensity: 0.5 });
const vegMat = new GrassMaterial(vegCfg, { sunDirection: new THREE.Vector3(0, 1, 0) }, null);
assert.equal(vegMat.material.uniforms.uDistanceTint.value, 0.3);
assert.equal(vegMat.material.uniforms.uFresnelIntensity.value, 0.5);
vegCfg.distanceTint = 0.1;
vegCfg.fresnelIntensity = 0.2;
vegMat.syncVegetation();
assert.equal(vegMat.material.uniforms.uDistanceTint.value, 0.1);
assert.equal(vegMat.material.uniforms.uFresnelIntensity.value, 0.2);
vegMat.dispose();

// --- Stage 14B: bush layer ---------------------------------------------------

// Bush config round-trip: validates (clamped) and survives worldpack.
const bushDoc = validateWorldDocument(createWorldDocument({ bushes: { density: 0.09, clumpStrength: 0.7, seed: 4242, slopeLimit: 5, visibleDistance: 140 } }));
assert.equal(bushDoc.warnings.length, 0);
assert.equal(bushDoc.document.bushes.density, 0.09);
assert.equal(bushDoc.document.bushes.clumpStrength, 0.7);
assert.equal(bushDoc.document.bushes.seed, 4242);
assert.equal(bushDoc.document.bushes.slopeLimit, 1); // clamp01 (5 → 1)
assert.equal(bushDoc.document.bushes.keepDistance, 165); // max(visible, default)
const bushPack = await buildWorldPack(bushDoc.document, assetLibrary, { exportedAt: "2026-06-14T00:00:00.000Z" });
assert.equal(bushPack.world.bushes.density, 0.09);
assert.equal(bushPack.world.bushes.seed, 4242);

// Placement: deterministic for a fixed seed/config; clumping thins the field.
const bcfg = createBushConfig({ slopeLimit: 1, clumpStrength: 0 });
let bgx = 0;
let bgz = 0;
let bpd = generateBushPatchData(0, 0, bcfg);
for (let g = 1; bpd.count === 0 && g < 24; g++) {
  bpd = generateBushPatchData(g, g, bcfg);
  bgx = g;
  bgz = g;
}
assert.ok(bpd.count > 0, "found a populated bush patch");
const bpd2 = generateBushPatchData(bgx, bgz, bcfg);
assert.equal(bpd.count, bpd2.count); // deterministic count
assert.ok(bpd.matrices[0].elements.every((v, i) => Math.abs(v - bpd2.matrices[0].elements[i]) < 1e-9)); // deterministic matrices

const bcfgClump = createBushConfig({ slopeLimit: 1, clumpStrength: 0.9 });
let bBaseTotal = 0;
let bClumpTotal = 0;
for (let g = 0; g < 12; g++) {
  bBaseTotal += generateBushPatchData(g, g + 1, bcfg).count;
  bClumpTotal += generateBushPatchData(g, g + 1, bcfgClump).count;
}
assert.ok(bBaseTotal > 0, "found populated bush patches");
assert.ok(bClumpTotal < bBaseTotal, "bush clumping thins the aggregate field");

// Candidate count is capped, so a hostile density can't spin a huge loop.
const floodBush = generateBushPatchData(0, 0, createBushConfig({ density: 1e6, patchSize: 100, slopeLimit: 1, clumpStrength: 0 }));
assert.ok(floodBush.count <= 4096, `bush candidate count capped, got ${floodBush.count}`);
// And the validator caps density/patchSize from an untrusted document.
const floodDoc = validateWorldDocument(createWorldDocument({ bushes: { density: 1e9, patchSize: 9999 } }));
assert.ok(floodDoc.document.bushes.density <= 5 && floodDoc.document.bushes.patchSize <= 200);

// Streaming: builds patches, one instanced draw per visible patch, clean dispose.
const bushScene = new THREE.Scene();
const bushSys = new BushSystem(bushScene, createBushConfig({ density: 0.1, clumpStrength: 0, slopeLimit: 1 }), null);
const bcam = new THREE.PerspectiveCamera(70, 1.5, 0.1, 500);
bcam.position.set(0, 25, 0);
bcam.lookAt(0, 0, 0);
bcam.updateMatrixWorld(true);
bcam.matrixWorldInverse.copy(bcam.matrixWorld).invert();
bushSys.prewarm(bcam, 60);
bushSys.update(bcam);
assert.ok(bushSys.stats.activePatches > 0, "bush patches built");
assert.equal(bushSys.stats.drawCalls, bushSys.stats.visiblePatches); // one draw call per visible patch
assert.ok(bushSys.stats.visibleBushes >= 0);
bushSys.dispose();
assert.equal(bushSys.patches.size, 0); // disposed cleanly

// --- Stage 14C: terrain material v2 ------------------------------------------

// Defaults are present and the validator clamps every field into range.
const defTerrainDoc = validateWorldDocument(createWorldDocument());
assert.equal(defTerrainDoc.warnings.length, 0);
assert.deepEqual(defTerrainDoc.document.terrain.material, { ...DEFAULT_TERRAIN_MATERIAL });

const wildTerrainDoc = validateWorldDocument(
  createWorldDocument({ terrain: { material: { macroIntensity: 9, macroScale: 99, slopeRock: -3, heightTint: 0.4, detailIntensity: 2 } } })
);
assert.equal(wildTerrainDoc.warnings.length, 0);
const wm = wildTerrainDoc.document.terrain.material;
assert.equal(wm.macroIntensity, 1); // clamp01
assert.equal(wm.macroScale, 0.2); // capped at MAX_MACRO_SCALE
assert.equal(wm.slopeRock, 0); // clamp01
assert.equal(wm.heightTint, 0.4); // in range, preserved
assert.equal(wm.detailIntensity, 1); // clamp01

// A garbage material object falls back to safe defaults (no throw).
assert.deepEqual(sanitizeTerrainMaterial(null), { ...DEFAULT_TERRAIN_MATERIAL });
assert.deepEqual(sanitizeTerrainMaterial({ macroScale: "nope" }), { ...DEFAULT_TERRAIN_MATERIAL });

// Material round-trips through worldpack.
const terrPack = await buildWorldPack(wildTerrainDoc.document, assetLibrary, { exportedAt: "2026-06-14T00:00:00.000Z" });
assert.equal(terrPack.world.terrain.material.macroIntensity, 1);
assert.equal(terrPack.world.terrain.material.macroScale, 0.2);

// The live Terrain wires the upgrade without disturbing fog/shadow/vertex-color.
const terr = new Terrain({ size: 40, segments: 8, material: { macroIntensity: 0.6, slopeRock: 0.4 } });
const tmat = terr.mesh.material;
assert.equal(typeof tmat.onBeforeCompile, "function", "onBeforeCompile injected");
assert.equal(tmat.customProgramCacheKey(), "terrain-material-v2", "own program-cache identity");
assert.equal(tmat.vertexColors, true, "vertex colors remain the base signal");
assert.equal(tmat.fog, true, "material fog stays on so scene fog applies");
assert.equal(terr.mesh.receiveShadow, true, "terrain still receives shadows");
assert.ok(terr.mesh.geometry.attributes.color, "vertex colors still baked");
// Constructor clamped the input and exposes it for read-back.
assert.equal(terr.getMaterialSettings().macroIntensity, 0.6);
assert.equal(terr.getMaterialSettings().slopeRock, 0.4);

// syncMaterial mutates shared uniform values WITHOUT triggering a recompile
// (material.version must not change — that would force a program rebuild).
const versionBefore = tmat.version;
terr.syncMaterial({ macroIntensity: 0.2, macroScale: 0.05, detailIntensity: 1.5 });
assert.equal(tmat.version, versionBefore, "syncMaterial must not bump material.version (no recompile loop)");
assert.equal(terr._uniforms.uTerrainMacroIntensity.value, 0.2, "uniform updated live");
assert.equal(terr._uniforms.uTerrainMacroScale.value, 0.05, "uniform updated live");
assert.equal(terr._uniforms.uTerrainDetailIntensity.value, 1, "detail clamped to [0,1] on sync");
assert.equal(terr.getMaterialSettings().macroIntensity, 0.2, "settings read back after sync");
terr.dispose();

// --- Stage 15: reverse-Z depth status logic ----------------------------------

// Pure status: active only when reverse-Z is BOTH requested and supported.
assert.deepEqual(summarizeReverseDepth({ requested: true, extensionAvailable: true }), {
  requested: true,
  extensionAvailable: true,
  active: true,
  mode: "reverse-z",
});
// Requested but the GPU lacks EXT_clip_control → clean fallback to normal depth.
assert.deepEqual(summarizeReverseDepth({ requested: true, extensionAvailable: false }), {
  requested: true,
  extensionAvailable: false,
  active: false,
  mode: "normal-z",
});
// Never requested → normal depth, reported as not-requested.
assert.deepEqual(summarizeReverseDepth({ requested: false, extensionAvailable: true }), {
  requested: false,
  extensionAvailable: true,
  active: false,
  mode: "normal-z",
});
// Defensive: missing/garbage args never throw and default to normal-z.
assert.equal(summarizeReverseDepth().mode, "normal-z");
assert.equal(summarizeReverseDepth({ requested: "yes", extensionAvailable: 1 }).active, false);

// Renderer reader trusts three's resolved capability for `active`, and explains
// WHY via the extension cross-read. (Mock renderer — no GL context needed.)
const mockSupported = {
  _reverseDepthRequested: true,
  capabilities: { reverseDepthBuffer: true },
  extensions: { has: (n) => n === "EXT_clip_control" },
};
assert.deepEqual(getReverseDepthStatus(mockSupported), {
  requested: true,
  extensionAvailable: true,
  active: true,
  mode: "reverse-z",
});
const mockUnsupported = {
  _reverseDepthRequested: true,
  capabilities: { reverseDepthBuffer: false },
  extensions: { has: () => false },
};
assert.equal(getReverseDepthStatus(mockUnsupported).active, false);
assert.equal(getReverseDepthStatus(mockUnsupported).mode, "normal-z");
assert.equal(getReverseDepthStatus(mockUnsupported).requested, true); // requested, just unsupported

console.log("world document regression checks passed");
