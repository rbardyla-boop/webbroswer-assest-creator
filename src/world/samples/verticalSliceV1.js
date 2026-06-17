// Vertical Slice World v1 — a small, coherent outdoor level authored entirely
// from built-in structural kits + procedural primitives. No external assets.
//
// The slice is built programmatically into the WorldDocument v2 shape: each kit
// is expanded (via the prefab serializer) at a terrain-snapped placement, so
// every part is grounded and carries its prefabRef. Baking activates the same
// terrain profile the runtime loader will apply for this document, so baked Y
// values match the loaded world.

import { createWorldDocument } from "../WorldDocument.js";
import { getHeight, findGoodSpawn, setTerrainProfile } from "../../terrain/terrainSampling.js";
import { createTerrainProfile } from "../../terrain/profiles/index.js";
import { createBuiltinPrefabs } from "../../prefabs/BuiltinKits.js";
import { worldObjectsFromPrefab } from "../../prefabs/PrefabSerializer.js";

export const VERTICAL_SLICE_ID = "vertical-slice-v1";

// Canonical (default) terrain shape for the slice. Kept explicit so baked Y
// values are deterministic regardless of any previously-loaded world.
const SLICE_TERRAIN = {
  size: 700,
  segments: 240,
  seed: 0,
  heightAmplitude: 14,
  featureScale: 0.012,
  detailScale: 0.06,
  detailAmount: 1.6,
};

export function buildVerticalSliceV1() {
  const doc = createWorldDocument({
    metadata: { name: "Vertical Slice v1" },
    terrain: { ...SLICE_TERRAIN },
  });

  // Activate the document's terrain profile before baking so getHeight() samples
  // the SAME field the runtime loader will apply on load (otherwise a previously
  // loaded world's profile would bake mismatched Y values).
  setTerrainProfile(createTerrainProfile(doc.terrain));

  const kits = new Map(createBuiltinPrefabs().map((p) => [p.id, p]));
  const base = findGoodSpawn(); // flat, open ground near the origin
  const objects = [];

  // Place a built-in kit at a layout offset, snapped to the terrain. `lift`
  // raises the placement (e.g. a railing sitting at the top of a ramp).
  function place(prefabId, dx, dz, { yaw = 0, scale = 1, lift = 0 } = {}) {
    const prefab = kits.get(prefabId);
    if (!prefab) return;
    const x = base.x + dx;
    const z = base.z + dz;
    const y = getHeight(x, z) + lift;
    objects.push(...worldObjectsFromPrefab(prefab, { position: { x, y, z }, yaw, scale }));
  }

  // --- layout (path runs north along +Z from the spawn) ----------------------
  // Signpost greeting near the spawn, facing back toward the player.
  place("builtin-signboard", 4, -9, { yaw: Math.PI });

  // The walkable path: two straight road segments (plane colliders, grass/tree
  // suppression) leading to the ramp.
  place("builtin-straight-road", 0, -4);
  place("builtin-straight-road", 0, 4);

  // A wall section bordering the east side of the path (blocks the player).
  place("builtin-wall", 4.2, 0, { yaw: Math.PI / 2 });

  // The elevation change: a ramp rising ~2 units, with a railing at the top.
  place("builtin-ramp", 0, 11);
  place("builtin-low-barrier", 0, 14.2, { lift: 2 });

  // A stand-on platform to the west of the path (low enough to be steppable).
  place("builtin-platform", -9, 0);

  // A blockout structure off to the east.
  place("builtin-hut", 12, 8);

  // Greenery framing the playable area (also demonstrates exclusions).
  place("builtin-tree-cluster", -11, -6);
  place("builtin-tree-cluster", 12, -4);

  doc.objects = objects;

  // Spawn on open ground south of the path, not inside any kit.
  const spawnX = base.x;
  const spawnZ = base.z - 12;
  doc.player.spawn = { x: spawnX, y: getHeight(spawnX, spawnZ), z: spawnZ };
  doc.player.cameraMode = "third";

  return doc;
}
