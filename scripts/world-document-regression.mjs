import assert from "node:assert/strict";
import * as THREE from "three";

import { createWorldDocument } from "../src/world/WorldDocument.js";
import { validateWorldDocument } from "../src/world/WorldValidation.js";
import { WorldObjectManager } from "../src/world/WorldObjectManager.js";
import { createAssetId, defaultColliderTypeForAsset } from "../src/assets/AssetTypes.js";
import { normalizeAssetMetadata } from "../src/assets/AssetValidation.js";

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

console.log("world document regression checks passed");
