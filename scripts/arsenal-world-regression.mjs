// test:arsenal-world — Node regression for Arsenal v2 (world placement / persistence /
// the recipe→world boundary). Imports THREE (headless, like the world regression) and
// exercises: deterministic rebuild, recipe validation/clamping, the runtimeAssets
// save/load round-trip, quaternion→euler at the boundary, terrain-grounded placement,
// finite markers, and the isolation invariant (world never imports arsenal UI).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { createWorldDocument } from "../src/world/WorldDocument.js";
import { validateWorldDocument } from "../src/world/WorldValidation.js";
import { generateWeaponRecipe } from "../src/arsenal/WeaponGrammar.js";
import { rollConfig, ARSENAL_LIMITS } from "../src/arsenal/WeaponConfig.js";
import { recipeHash, weaponAssetId } from "../src/arsenal/WeaponRecipe.js";
import { sanitizeWeaponRecipe } from "../src/arsenal/WeaponRecipeValidation.js";
import { buildWeaponFromRecipe } from "../src/arsenal/WeaponRuntime.js";
import { normalizeRuntimeAssetDescriptor } from "../src/world/assets/RuntimeAssetTypes.js";
import { PlacedAssetStore } from "../src/world/assets/PlacedAssetStore.js";
import { placeWeapon } from "../src/world/placement/WeaponPlacementTool.js";
import { getHeight } from "../src/terrain/terrainSampling.js";

const recipe = generateWeaponRecipe(rollConfig("v2-regress", "heavy"));

// 1. Deterministic rebuild: same recipe → same hash + same built summary.
assert.equal(recipeHash(recipe), recipeHash(JSON.parse(JSON.stringify(recipe))), "recipeHash deterministic");
const summary = (w) => ({ parts: w.stats.parts, energy: w.stats.energy, triangles: w.stats.triangles, vertices: w.stats.vertices, markers: w.markers });
const w1 = buildWeaponFromRecipe(recipe);
const w2 = buildWeaponFromRecipe(recipe);
assert.deepEqual(summary(w1), summary(w2), "same recipe → identical built summary");
assert.ok(["muzzle", "core", "equip", "socket"].every((n) => w1.group.getObjectByName(n)), "marker anchors present");
assert.ok(Object.values(w1.markers).every((m) => m.every(Number.isFinite)), "markers finite");
w1.dispose();
w2.dispose();
assert.equal(w1.group.children.length, 0, "dispose clears the group");

// 2. Recipe validation: reject invalid, clamp hostile.
assert.equal(sanitizeWeaponRecipe(null), null, "null recipe rejected");
assert.equal(sanitizeWeaponRecipe({ parts: [] }), null, "no-parts recipe rejected");
assert.equal(sanitizeWeaponRecipe({ parts: [{ shape: "nope", role: "x" }] }), null, "all-invalid-parts rejected");
const hostile = sanitizeWeaponRecipe({ type: "heavy", parts: Array(500).fill({ shape: "box", role: "alloy", size: [-9, 0, 0], pos: [0, 0, 0] }) });
assert.ok(hostile && hostile.parts.length <= ARSENAL_LIMITS.MAX_PARTS, "hostile part count clamped");
assert.ok(hostile.parts.every((p) => p.size.every((n) => n > 0)), "hostile sizes forced positive");
const hw = buildWeaponFromRecipe(hostile);
assert.ok(hw.group.children.length > 0 && hw.stats.vertices <= ARSENAL_LIMITS.MAX_VERTICES, "hostile recipe → bounded finite weapon");
hw.dispose();

// 3. Descriptor normalization: drop bad kind / bad recipe; quaternion → euler.
assert.equal(normalizeRuntimeAssetDescriptor({ kind: "bogus", recipe, transform: {} }), null, "bad kind dropped");
assert.equal(normalizeRuntimeAssetDescriptor({ kind: "generated.weapon", recipe: { parts: [] }, transform: {} }), null, "bad recipe dropped");
const quat = normalizeRuntimeAssetDescriptor({ kind: "generated.weapon", recipe, transform: { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0.7071, w: 0.7071 }, scale: { x: 1, y: 1, z: 1 } } });
assert.ok(quat && !("w" in quat.transform.rotation), "quaternion rotation normalized to euler");
assert.ok(Math.abs(quat.transform.rotation.z - Math.PI / 2) < 1e-3, "quaternion converted to the right euler angle");

// 4. runtimeAssets save/load round-trip through the document validator.
const doc = createWorldDocument({
  runtimeAssets: {
    version: 1,
    items: [
      { kind: "generated.weapon", id: weaponAssetId(recipe), recipe, transform: { position: { x: 5, y: 2, z: -3 }, rotation: { x: 0, y: 1, z: 0 }, scale: { x: 1, y: 1, z: 1 } } },
      { kind: "generated.weapon", recipe: { parts: [] }, transform: {} }, // dropped
    ],
  },
});
const v1 = validateWorldDocument(doc).document;
assert.equal(v1.runtimeAssets.items.length, 1, "only the valid weapon survives validation");
const v2 = validateWorldDocument(JSON.parse(JSON.stringify(v1))).document; // simulate save→load
assert.equal(v2.runtimeAssets.items.length, 1, "weapon survives the round-trip");
assert.equal(recipeHash(v2.runtimeAssets.items[0].recipe), recipeHash(recipe), "recipe preserved exactly");
assert.deepEqual(v2.runtimeAssets.items[0].transform.position, { x: 5, y: 2, z: -3 }, "transform preserved");

// 5. Placement service grounds the weapon on the terrain.
const store = new PlacedAssetStore(createWorldDocument({}));
const placed = placeWeapon(store, recipe, { x: 12, z: -7 });
assert.ok(placed, "placement returns a descriptor");
assert.ok(Math.abs(placed.transform.position.y - (getHeight(12, -7) + 1.0)) < 1e-6, "placed weapon grounded on terrain (+float)");
assert.equal(store.list().length, 1, "stored");
assert.equal(placeWeapon(store, recipe, { x: 12, z: -7, id: placed.id }), store.list()[0] || placed, "re-placing same id replaces, not duplicates");
assert.equal(store.list().length, 1, "no duplicate on re-place");

// 6. Isolation: no src/world file imports the arsenal UI (workbench / entry).
const worldFiles = walk("src/world");
const offenders = worldFiles.filter((f) => /WeaponWorkbench|arsenalMain/.test(fs.readFileSync(f, "utf8")));
assert.equal(offenders.length, 0, `world must not import arsenal UI — offenders: ${offenders.join(", ")}`);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

console.log("arsenal-world regression checks passed");
