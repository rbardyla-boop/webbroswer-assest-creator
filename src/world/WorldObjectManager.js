import * as THREE from "three";
import { getHeight } from "../terrain/terrainSampling.js";
import { normalizeCollider } from "../physics/ColliderProxy.js";
import { createPlacedObject, createPrimitiveMesh } from "./PlacedObject.js";

export class WorldObjectManager {
  constructor(scene, { colliderSystem, onChange } = {}) {
    this.scene = scene;
    this.colliderSystem = colliderSystem;
    this.onChange = onChange;
    this.root = new THREE.Group();
    this.root.name = "World Objects";
    this.scene.add(this.root);

    this.objects = new Map();
    this._nextId = 1;
    this.colliderSystem?.setManager(this);
    this._boxScratch = new THREE.Box3();
  }

  addFromAsset(asset, position) {
    const id = `obj-${this._nextId++}`;
    const object3D = this._buildObject3D(asset);
    const snapped = position.clone();
    snapped.y = getHeight(snapped.x, snapped.z);

    const object = createPlacedObject({
      id,
      asset,
      object3D,
      position: snapped.toArray(),
    });
    this.root.add(object);
    this.objects.set(id, object);
    this._changed({ boxes: [this.getWorldBox(object)] });
    return object;
  }

  duplicate(object) {
    if (!object) return null;
    const copy = this.addFromAsset(object.userData.asset, object.position.clone().add(new THREE.Vector3(3, 0, 3)));
    copy.rotation.copy(object.rotation);
    copy.scale.copy(object.scale);
    copy.userData.collider = normalizeCollider(object.userData.collider);
    copy.position.y = object.position.y;
    this._changed({ boxes: [this.getWorldBox(copy)] });
    return copy;
  }

  remove(object) {
    if (!object) return;
    const oldBox = this.getWorldBox(object);
    this.objects.delete(object.userData.objectId);
    object.removeFromParent();
    object.traverse((child) => {
      if (child.geometry) child.geometry.dispose?.();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
        else child.material.dispose?.();
      }
    });
    this._changed({ boxes: [oldBox] });
  }

  snapToTerrain(object) {
    if (!object) return;
    object.position.y = getHeight(object.position.x, object.position.z);
  }

  serialize() {
    return {
      version: 1,
      objects: [...this.objects.values()].map((object) => ({
        id: object.userData.objectId,
        asset: serializeAsset(object.userData.asset),
        position: object.position.toArray(),
        rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
        scale: object.scale.toArray(),
        collider: normalizeCollider(object.userData.collider),
      })),
    };
  }

  serializeWorldObjects() {
    return [...this.objects.values()].map((object) => {
      const asset = serializeAsset(object.userData.asset);
      const collider = normalizeCollider(object.userData.collider);
      const primitive = asset.kind ?? object.userData.asset?.kind ?? "cube";
      return {
        id: object.userData.objectId,
        name: object.name,
        type: asset.type === "relief" ? "relief" : "primitive",
        assetRef: object.userData.asset?.id ?? null,
        primitive,
        asset,
        transform: {
          position: vectorToObject(object.position),
          rotation: { x: object.rotation.x, y: object.rotation.y, z: object.rotation.z },
          scale: vectorToObject(object.scale),
        },
        collider: {
          type: collider.type,
          dimensions: {},
          enabled: collider.type !== "none",
        },
        exclusion: {
          grass: collider.excludeGrass,
          trees: object.userData.collider?.excludeTrees ?? collider.excludeGrass,
          radius: 0,
          bounds: null,
        },
        runtime: {
          visible: object.visible,
          static: true,
          castShadow: true,
          receiveShadow: true,
        },
      };
    });
  }

  load(document) {
    this.clear();
    for (const item of document?.objects ?? []) {
      if (!item.asset) continue;
      const id = item.id ?? `obj-${this._nextId++}`;
      const object = createPlacedObject({
        id,
        asset: item.asset,
        object3D: this._buildObject3D(item.asset),
        position: item.position,
        rotation: item.rotation,
        scale: item.scale,
      });
      if (item.collider) object.userData.collider = normalizeCollider(item.collider);
      this.root.add(object);
      this.objects.set(id, object);
      this._nextId = Math.max(this._nextId, parseInt(id.replace("obj-", ""), 10) + 1 || this._nextId);
    }
    this._changed({ full: true });
  }

  loadWorldObjects(objects = []) {
    this.clear();
    for (const item of objects) {
      const asset = assetFromWorldObject(item);
      if (!asset) continue;
      const id = item.id ?? `obj-${this._nextId++}`;
      const t = item.transform ?? {};
      const object = createPlacedObject({
        id,
        asset,
        object3D: this._buildObject3D(asset),
        position: vecObjectToArray(t.position, [0, 0, 0]),
        rotation: vecObjectToArray(t.rotation, [0, 0, 0]),
        scale: vecObjectToArray(t.scale, [1, 1, 1]),
      });
      object.visible = item.runtime?.visible !== false;
      object.userData.collider = normalizeCollider({
        type: item.collider?.enabled === false ? "none" : item.collider?.type,
        excludeGrass: item.exclusion?.grass ?? false,
        excludeTrees: item.exclusion?.trees ?? item.exclusion?.grass ?? false,
      });
      object.userData.collider.excludeTrees = item.exclusion?.trees ?? item.exclusion?.grass ?? false;
      this.root.add(object);
      this.objects.set(id, object);
      this._nextId = Math.max(this._nextId, parseInt(String(id).replace("obj-", ""), 10) + 1 || this._nextId);
    }
    this._changed({ full: true });
  }

  clear() {
    const boxes = [...this.objects.values()].map((object) => this.getWorldBox(object));
    for (const object of [...this.objects.values()]) {
      this.objects.delete(object.userData.objectId);
      object.removeFromParent();
      object.traverse((child) => {
        if (child.geometry) child.geometry.dispose?.();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
          else child.material.dispose?.();
        }
      });
    }
    this.objects.clear();
    this._changed({ boxes });
  }

  commitObjectChange(object, previousBox = null) {
    if (!object) return;
    const boxes = [this.getWorldBox(object)];
    if (previousBox) boxes.push(previousBox.clone());
    this._changed({ boxes });
  }

  getWorldBox(object) {
    object.updateMatrixWorld(true);
    return this._boxScratch.setFromObject(object).clone();
  }

  _changed(change = {}) {
    this.colliderSystem?.rebuildDebug();
    this.onChange?.(change);
  }

  _buildObject3D(asset) {
    if (asset.type === "primitive") return createPrimitiveMesh(asset.kind);
    if (asset.type === "relief" && (asset.geometry || asset.geometryData)) {
      const geometry = asset.geometry
        ? asset.geometry.clone()
        : new THREE.BufferGeometryLoader().parse(asset.geometryData);
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, side: THREE.DoubleSide })
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    }
    if (asset.type === "gltf" && asset.scene) {
      const clone = asset.scene.clone(true);
      clone.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      return clone;
    }
    return createPrimitiveMesh("cube");
  }
}

function serializeAsset(asset) {
  if (asset.type === "primitive") return { type: "primitive", kind: asset.kind, name: asset.name };
  if (asset.type === "relief") {
    return {
      type: "relief",
      name: asset.name,
      geometryData: asset.geometry?.toJSON() ?? asset.geometryData,
    };
  }
  if (asset.type === "gltf") return { type: "primitive", kind: "cube", name: `${asset.name} placeholder` };
  return { type: "primitive", kind: "cube", name: "Cube" };
}

function assetFromWorldObject(item) {
  if (item.asset?.type) return item.asset;
  if (item.type === "relief" && item.asset?.geometryData) return item.asset;
  if (item.type === "primitive" || item.primitive) {
    return {
      type: "primitive",
      kind: item.primitive ?? "cube",
      name: item.name ?? item.primitive ?? "Primitive",
    };
  }
  return { type: "primitive", kind: "cube", name: item.name ?? "Cube" };
}

function vectorToObject(vector) {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function vecObjectToArray(value, fallback) {
  return [value?.x ?? fallback[0], value?.y ?? fallback[1], value?.z ?? fallback[2]];
}
