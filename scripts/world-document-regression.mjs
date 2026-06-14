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
import { createZip, crc32 } from "../src/export/BuildZip.js";

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

console.log("world document regression checks passed");
