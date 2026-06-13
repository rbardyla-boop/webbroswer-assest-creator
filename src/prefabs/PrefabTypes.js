// Canonical shapes, constants, and small factories for the prefab system.
// Pure and dependency-free so it is safe to import in Node (tests) and the
// browser alike. A prefab is an authoring template: it references assets by
// `assetRef` and never embeds large binary asset blobs.

export const PREFAB_VERSION = 1;

// localStorage key for the small prefab document manifest, and the IndexedDB
// name used only for large preview thumbnails.
export const PREFAB_STORAGE_KEY = "grass-world-prefabs";
export const PREFAB_DB_NAME = "grass-world-prefab-thumbnails";

// High-level classification of a prefab. Drives panel grouping and is advisory;
// it never changes how a prefab is expanded.
export const PREFAB_KINDS = {
  single: "single",
  group: "group",
  primitive: "primitive",
  asset: "asset",
  relief: "relief",
  image: "image",
  structural: "structural",
};

// World object types a prefab child can carry. Includes "gltf" because
// WorldObjectManager.serializeWorldObject emits type "gltf" for imported GLB
// assets; without it, gltf prefab children would degrade to "primitive" on a
// world-manifest round-trip (the asset itself is still resolved via assetRef).
export const PREFAB_OBJECT_TYPES = new Set(["primitive", "relief", "imported", "image", "custom", "gltf"]);

// Structural hints used to tag kit-style prefabs (road segment, wall, etc.).
export const STRUCTURAL_TAGS = ["road", "wall", "ramp", "platform", "fence", "stairs"];

export function createPrefabId(name = "") {
  const clean =
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 36) || "prefab";
  return `prefab-${clean}-${shortRandom()}`;
}

export function shortRandom() {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return String(random).replace(/-/g, "").slice(0, 8);
}

export function identityTransform() {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

export function vec3(x = 0, y = 0, z = 0) {
  return { x, y, z };
}

// Infer a kind from the set of child object types. Single child → its type;
// multiple children → group (or structural when tagged).
export function inferPrefabKind(objects = [], tags = []) {
  if (tags.some((tag) => STRUCTURAL_TAGS.includes(String(tag).toLowerCase()))) {
    return PREFAB_KINDS.structural;
  }
  if (objects.length > 1) return PREFAB_KINDS.group;
  const type = objects[0]?.type;
  if (type === "relief") return PREFAB_KINDS.relief;
  if (type === "image") return PREFAB_KINDS.image;
  if (type === "imported" || type === "custom" || type === "gltf") return PREFAB_KINDS.asset;
  return PREFAB_KINDS.primitive;
}
