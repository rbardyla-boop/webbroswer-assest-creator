// Built-in structural kit prefabs, generated procedurally from primitives.
// No external model assets, no IndexedDB blobs — every part references a stock
// primitive asset by id. These are stable, system-owned templates that appear
// in the Prefab Library alongside (but separate from) user prefabs.
//
// Parts are authored in local ground space (y = 0 is the ground, y values are
// the part's center height). The prefab origin is pinned to (0,0,0) so on
// placement the kit's footprint snaps to the terrain with parts at their
// authored heights — boxes rest on the ground instead of being half-buried.

import { prefabFromWorldObjects } from "./PrefabSerializer.js";

export const BUILTIN_TAG = "builtin";

// Primitive base dimensions (see PlacedObject.createPrimitiveMesh).
const CUBE = 1.8; // BoxGeometry(1.8^3)
const PLANE = 2.4; // PlaneGeometry(2.4 x 2.4), laid flat
const RAMP_W = 2; // ramp spans x[-1,1]
const RAMP_H = 1.2; // ramp spans y[0,1.2]
const RAMP_L = 2; // ramp spans z[-1,1]
const CYL_R = 0.8; // CylinderGeometry radius
const CYL_H = 1.6; // CylinderGeometry height
const SPH_R = 1; // SphereGeometry radius

// Collider/exclusion presets.
const WALK = { collider: "plane", grass: true, trees: true }; // walkable, suppresses
const RAMP = { collider: "ramp", grass: true, trees: true };
const SOLID = { collider: "box", grass: true, trees: true }; // blocks player
const BLOCK = { collider: "box", grass: true, trees: false }; // blocks, keeps trees off-list optional
const PROP = { collider: "cylinder", grass: true, trees: true };
const NONE = { collider: "none", grass: false, trees: false };

function descriptor(name, primitive, assetRef, position, scale, preset, rotation = { x: 0, y: 0, z: 0 }) {
  return {
    id: `${assetRef}-${name}`,
    name,
    type: "primitive",
    assetRef,
    primitive,
    asset: null,
    transform: { position, rotation, scale },
    collider: { type: preset.collider, dimensions: {}, enabled: preset.collider !== "none" },
    exclusion: { grass: preset.grass, trees: preset.trees, radius: 0, bounds: null },
    runtime: { visible: true, static: true, castShadow: true, receiveShadow: true },
  };
}

// w/d in world units; flat road surface on the ground.
function roadPart(name, w, l, preset, x = 0, z = 0) {
  return descriptor(name, "plane", "primitive-plane",
    { x, y: 0.02, z }, { x: w / PLANE, y: 1, z: l / PLANE }, preset);
}

// w(h)idth x h(eight) x d(epth); bottom rests on the ground (or yOverride).
function boxPart(name, w, h, d, preset, { x = 0, z = 0, y = null, rotY = 0 } = {}) {
  return descriptor(name, "cube", "primitive-cube",
    { x, y: y ?? h / 2, z }, { x: w / CUBE, y: h / CUBE, z: d / CUBE }, preset, { x: 0, y: rotY, z: 0 });
}

function rampPart(name, w, l, h, preset, { x = 0, z = 0, rotY = 0 } = {}) {
  return descriptor(name, "ramp", "primitive-ramp",
    { x, y: 0, z }, { x: w / RAMP_W, y: h / RAMP_H, z: l / RAMP_L }, preset, { x: 0, y: rotY, z: 0 });
}

function postPart(name, r, h, preset, { x = 0, z = 0 } = {}) {
  return descriptor(name, "cylinder", "primitive-cylinder",
    { x, y: h / 2, z }, { x: r / CYL_R, y: h / CYL_H, z: r / CYL_R }, preset);
}

function canopyPart(name, r, preset, { x = 0, y = 0, z = 0 } = {}) {
  return descriptor(name, "sphere", "primitive-sphere",
    { x, y, z }, { x: r / SPH_R, y: r / SPH_R, z: r / SPH_R }, preset);
}

function tree(prefix, x, z) {
  return [
    postPart(`${prefix}-trunk`, 0.28, 2.2, PROP, { x, z }),
    canopyPart(`${prefix}-canopy`, 1.3, NONE, { x, y: 2.9, z }),
  ];
}

// Each entry: { id, name, tags, parts }.
function kitDefinitions() {
  return [
    {
      id: "builtin-straight-road",
      name: "Road — Straight",
      tags: [BUILTIN_TAG, "road"],
      parts: [roadPart("surface", 4, 8, WALK)],
    },
    {
      id: "builtin-wide-road",
      name: "Road — Wide",
      tags: [BUILTIN_TAG, "road"],
      parts: [roadPart("surface", 8, 8, WALK)],
    },
    {
      id: "builtin-ramp",
      name: "Ramp",
      tags: [BUILTIN_TAG, "ramp"],
      parts: [rampPart("ramp", 4, 6, 2, RAMP)],
    },
    {
      id: "builtin-platform",
      name: "Platform",
      tags: [BUILTIN_TAG, "platform"],
      parts: [boxPart("deck", 6, 0.6, 6, SOLID)],
    },
    {
      id: "builtin-wall",
      name: "Wall Segment",
      tags: [BUILTIN_TAG, "wall"],
      parts: [boxPart("wall", 4, 3, 0.4, SOLID)],
    },
    {
      id: "builtin-low-barrier",
      name: "Low Barrier",
      tags: [BUILTIN_TAG, "fence"],
      parts: [boxPart("barrier", 4, 1, 0.4, BLOCK)],
    },
    {
      id: "builtin-stairs",
      name: "Stair Block",
      tags: [BUILTIN_TAG, "stairs"],
      parts: [
        boxPart("step-0", 4, 0.5, 1, SOLID, { z: 0, y: 0.25 }),
        boxPart("step-1", 4, 1.0, 1, SOLID, { z: 1, y: 0.5 }),
        boxPart("step-2", 4, 1.5, 1, SOLID, { z: 2, y: 0.75 }),
      ],
    },
    {
      id: "builtin-signboard",
      name: "Signboard",
      tags: [BUILTIN_TAG, "sign"],
      parts: [
        postPart("post", 0.15, 2.4, BLOCK),
        boxPart("board", 3, 1.2, 0.2, NONE, { y: 2.0 }),
      ],
    },
    {
      id: "builtin-tree-cluster",
      name: "Tree Cluster",
      tags: [BUILTIN_TAG, "tree"],
      parts: [...tree("a", 0, 0), ...tree("b", 2.6, 1.6), ...tree("c", -2.2, 2.0)],
    },
    {
      id: "builtin-hut",
      name: "Blockout Hut",
      tags: [BUILTIN_TAG, "house"],
      parts: [
        boxPart("wall-n", 6, 3, 0.4, SOLID, { z: -3 }),
        boxPart("wall-s", 6, 3, 0.4, SOLID, { z: 3 }),
        boxPart("wall-e", 0.4, 3, 6, SOLID, { x: 3 }),
        boxPart("wall-w", 0.4, 3, 6, SOLID, { x: -3 }),
        boxPart("roof", 6.6, 0.3, 6.6, BLOCK, { y: 3.15 }),
      ],
    },
  ];
}

// Build the built-in prefab documents (stable ids, origin pinned to ground).
export function createBuiltinPrefabs() {
  return kitDefinitions().map((kit) =>
    prefabFromWorldObjects(kit.parts, {
      name: kit.name,
      tags: kit.tags,
      id: kit.id,
      origin: { x: 0, y: 0, z: 0 },
    })
  );
}

export function isBuiltinPrefab(prefab) {
  return !!prefab?.metadata?.tags?.includes(BUILTIN_TAG) || String(prefab?.id ?? "").startsWith("builtin-");
}
