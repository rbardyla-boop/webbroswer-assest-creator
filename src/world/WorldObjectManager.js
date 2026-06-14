import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { getHeight } from "../terrain/terrainSampling.js";
import { normalizeCollider } from "../physics/ColliderProxy.js";
import { createImageMesh, createMissingAssetMesh, createPlacedObject, createPrimitiveMesh } from "./PlacedObject.js";
import { ASSET_TYPES } from "../assets/AssetTypes.js";
import { sanitizePlacedAnimation } from "../animation/AnimationValidation.js";
import { sanitizeInteraction } from "../interaction/InteractionValidation.js";

export class WorldObjectManager {
  constructor(scene, { colliderSystem, onChange, assetLibrary, animationRuntime = null } = {}) {
    this.scene = scene;
    this.colliderSystem = colliderSystem;
    this.assetLibrary = assetLibrary;
    this.animationRuntime = animationRuntime;
    this.onChange = onChange;
    this.root = new THREE.Group();
    this.root.name = "World Objects";
    this.scene.add(this.root);

    this.objects = new Map();
    this._nextId = 1;
    this.colliderSystem?.setManager(this);
    this._boxScratch = new THREE.Box3();
  }

  async addFromAsset(asset, position) {
    // Resolve metadata-only library assets so GLB/relief/image render correctly
    // (and rigged GLBs expose their clips) the moment they are placed.
    const resolved = await this._resolveForPlacement(asset);
    const id = `obj-${this._nextId++}`;
    const object3D = await this._buildObject3D(resolved);
    const snapped = position.clone();
    snapped.y = getHeight(snapped.x, snapped.z);

    const object = createPlacedObject({
      id,
      asset: resolved,
      object3D,
      position: snapped.toArray(),
    });
    object.userData.assetRef = resolved.id ?? asset.id ?? null;
    this._attachAnimation(object, resolved, null);
    object.userData.interaction = null; // fresh placement has no interaction yet
    this.root.add(object);
    this.objects.set(id, object);
    this._changed({ boxes: [this.getWorldBox(object)] });
    return object;
  }

  // Resolve a metadata-only asset to its loaded form (scene/texture/geometry +
  // animation clips). Primitives and already-resolved assets pass through.
  async _resolveForPlacement(asset) {
    if (!this.assetLibrary || !asset?.id || asset.type === "primitive") return asset;
    if (asset.scene || asset.texture || asset.geometry) return asset;
    return (await this.assetLibrary.resolve(asset.id)) ?? asset;
  }

  // Attach animation state to a placed object: the serialized override, the
  // asset-level clip metadata (for the editor panel) and the parsed clips (for
  // preview/runtime). Registers with the runtime when one is present (runtime
  // mode only) so authoring never auto-plays.
  _attachAnimation(object, asset, overrideInput) {
    object.userData.animation = sanitizePlacedAnimation(overrideInput);
    object.userData.assetAnimation = asset?.animation ?? null;
    object.userData.animationClips = Array.isArray(asset?.animations) ? asset.animations : null;
    if (this.animationRuntime && object.userData.animationClips?.length) {
      this.animationRuntime.register(object, asset, object.userData.animation);
    }
  }

  // Stash sanitized, data-only interaction metadata on a placed object (trigger /
  // door / sign / pickup / spawn). The InteractionRuntime reads userData.interaction
  // after load; the editor never runs it.
  _attachInteraction(object, input) {
    object.userData.interaction = sanitizeInteraction(input);
  }

  duplicate(object) {
    if (!object) return null;
    const copy = this.addFromObject(object, object.position.clone().add(new THREE.Vector3(3, 0, 3)));
    return copy;
  }

  async addFromObject(object, position) {
    const copy = await this.addFromAsset(object.userData.asset, position);
    copy.rotation.copy(object.rotation);
    copy.scale.copy(object.scale);
    copy.userData.collider = normalizeCollider(object.userData.collider);
    // Preserve identity metadata so duplicates keep their asset + prefab links.
    if (object.userData.assetRef) copy.userData.assetRef = object.userData.assetRef;
    copy.userData.prefabRef = object.userData.prefabRef ?? null;
    // Carry the source's animation override + clips so the duplicate matches.
    this._attachAnimation(copy, object.userData.asset, object.userData.animation);
    this._attachInteraction(copy, object.userData.interaction);
    copy.position.y = object.position.y;
    this._changed({ boxes: [this.getWorldBox(copy)] });
    return copy;
  }

  // Detach a placed object from the scene + registry WITHOUT disposing its GPU
  // resources, so it can be re-attached later (the editor undo/redo stack parks
  // detached objects and only disposes them when their command leaves history).
  // Returns the world box it occupied so callers can rebuild grass/trees.
  detach(object) {
    if (!object) return null;
    const box = this.getWorldBox(object);
    this.animationRuntime?.remove(object);
    this.objects.delete(object.userData.objectId);
    object.removeFromParent();
    this._changed({ boxes: [box] });
    return box;
  }

  // Re-attach a previously detached placed object under its original id. In
  // runtime mode this re-registers animation; the editor has no runtime, so
  // authoring never auto-plays.
  attach(object) {
    if (!object) return;
    this.root.add(object);
    this.objects.set(object.userData.objectId, object);
    if (this.animationRuntime && object.userData.animationClips?.length) {
      this.animationRuntime.register(object, object.userData.asset, object.userData.animation);
    }
    this._changed({ boxes: [this.getWorldBox(object)] });
  }

  // Free an object's geometry/material GPU resources. Call only when the object
  // is gone for good (never on one that may be re-attached via undo).
  disposeObject(object) {
    if (!object) return;
    object.traverse((child) => {
      if (child.geometry) child.geometry.dispose?.();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
        else child.material.dispose?.();
      }
    });
  }

  remove(object) {
    if (!object) return;
    this.detach(object);
    this.disposeObject(object);
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
    return [...this.objects.values()].map((object) => this.serializeWorldObject(object));
  }

  // Serialize a single placed object to a world-object descriptor. Used by the
  // export path and by prefab creation (capturing the selected object).
  serializeWorldObject(object) {
    const asset = serializeAsset(object.userData.asset);
    const collider = normalizeCollider(object.userData.collider);
    const primitive = asset.kind ?? object.userData.asset?.kind ?? "cube";
    return {
      id: object.userData.objectId,
      name: object.name,
      type: asset.type === "relief" || asset.type === "gltf" || asset.type === "image" ? asset.type : "primitive",
      assetRef: object.userData.assetRef ?? object.userData.asset?.id ?? null,
      primitive: asset.type === "primitive" ? primitive : null,
      asset: object.userData.assetRef ? null : asset,
      prefabRef: object.userData.prefabRef ?? null,
      transform: {
        position: vectorToObject(object.position),
        rotation: { x: object.rotation.x, y: object.rotation.y, z: object.rotation.z },
        scale: vectorToObject(object.scale),
      },
      collider: {
        type: collider.type,
        dimensions: collider.dimensions ?? {},
        enabled: collider.type !== "none",
      },
      exclusion: {
        grass: collider.excludeGrass,
        trees: object.userData.collider?.excludeTrees ?? collider.excludeGrass,
        radius: 0,
        bounds: null,
      },
      animation: object.userData.animation ?? null,
      interaction: object.userData.interaction ?? null,
      runtime: {
        visible: object.visible,
        static: true,
        castShadow: true,
        receiveShadow: true,
      },
    };
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

  async loadWorldObjects(objects = []) {
    this.clear();
    for (const item of objects) {
      const object = await this._buildPlacedFromDescriptor(item, { id: item.id ?? null });
      if (!object) continue;
      const objectId = object.userData.objectId;
      this.root.add(object);
      this.objects.set(objectId, object);
      this._nextId = Math.max(this._nextId, parseInt(String(objectId).replace("obj-", ""), 10) + 1 || this._nextId);
    }
    this._changed({ full: true });
  }

  // Add a single placed object from a world-object descriptor without clearing
  // the scene. Allocates a fresh id and rebuilds grass/trees around its box.
  // Used by the prefab instancer to place prefabs as normal world objects.
  async addWorldObject(item) {
    const object = await this._buildPlacedFromDescriptor(item, { id: null });
    if (!object) return null;
    this.root.add(object);
    this.objects.set(object.userData.objectId, object);
    this._changed({ boxes: [this.getWorldBox(object)] });
    return object;
  }

  // Shared builder for load + prefab placement. Resolves the asset (falling back
  // to a placeholder for missing assetRefs), applies transform/collider/
  // exclusion, and threads assetRef + prefabRef onto userData.
  async _buildPlacedFromDescriptor(item, { id = null } = {}) {
    const asset = await this.resolveAssetForWorldObject(item);
    if (!asset) return null;
    const objectId = id ?? `obj-${this._nextId++}`;
    const t = item.transform ?? {};
    const object = createPlacedObject({
      id: objectId,
      asset,
      object3D: await this._buildObject3D(asset),
      position: vecObjectToArray(t.position, [0, 0, 0]),
      rotation: vecObjectToArray(t.rotation, [0, 0, 0]),
      scale: vecObjectToArray(t.scale, [1, 1, 1]),
    });
    object.visible = item.runtime?.visible !== false;
    object.userData.assetRef = item.assetRef ?? asset.id ?? null;
    object.userData.prefabRef = item.prefabRef ?? null;
    object.userData.collider = normalizeCollider({
      type: item.collider?.enabled === false ? "none" : item.collider?.type,
      dimensions: item.collider?.dimensions ?? {},
      excludeGrass: item.exclusion?.grass ?? false,
      excludeTrees: item.exclusion?.trees ?? item.exclusion?.grass ?? false,
    });
    object.userData.collider.excludeTrees = item.exclusion?.trees ?? item.exclusion?.grass ?? false;

    // Animation: stash override + asset clip metadata + parsed clips, and (in
    // runtime mode) start playback. In the editor no runtime is present, so
    // authoring never auto-plays.
    this._attachAnimation(object, asset, item.animation);
    this._attachInteraction(object, item.interaction);
    return object;
  }

  clear() {
    const boxes = [...this.objects.values()].map((object) => this.getWorldBox(object));
    for (const object of [...this.objects.values()]) {
      this.animationRuntime?.remove(object);
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

  async resolveAssetForWorldObject(item) {
    if (item?.assetRef && this.assetLibrary) {
      const resolved = await this.assetLibrary.resolve(item.assetRef);
      if (resolved) return resolved;
      console.warn(`Missing asset "${item.assetRef}" or local blob data; using placeholder.`);
      return {
        id: item.assetRef,
        type: "missing",
        name: `Missing ${item.assetRef}`,
        kind: "cube",
      };
    }
    return assetFromWorldObject(item);
  }

  async _buildObject3D(asset) {
    if (asset.type === ASSET_TYPES.primitive) return createPrimitiveMesh(asset.kind);
    if (asset.type === ASSET_TYPES.image && asset.texture) return createImageMesh(asset.texture);
    if (asset.type === ASSET_TYPES.relief && (asset.geometry || asset.geometryData)) {
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
    if (asset.type === ASSET_TYPES.gltf && asset.scene) {
      // SkeletonUtils.clone duplicates skeletons/bones so each placed instance
      // animates independently; it is also correct for non-skinned scenes.
      const clone = cloneSkeleton(asset.scene);
      clone.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      return clone;
    }
    if (asset.type === "missing") return createMissingAssetMesh(asset.name);
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
  if (asset.type === "image") return { type: "image", name: asset.name };
  if (asset.type === "gltf") return { type: "gltf", name: asset.name };
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
