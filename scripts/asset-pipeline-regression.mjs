// test:asset-pipeline — pure-Node regression for Asset Pipeline-1's budget layer:
//   - computeAssetBudget counts triangles/materials/textures/nodes exactly,
//   - validateAssetBudget grades ok/warn/reject at the right tiers (non-vacuous),
//   - scale discipline flags oversized + sub-tiny assets,
//   - the budget field survives every persistence whitelist (asset metadata, the
//     library manifest, the world-document sanitizer) with NO schema bump,
//   - the asset-instances benchmark scene is deterministic + references its asset,
//   - the new modules have no nondeterministic sources / cross-layer imports.
// The live import-reject, placement, persistence + perf budget are the browser proof.

import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import {
  ASSET_BUDGET_LIMITS,
  AssetBudgetError,
  computeAssetBudget,
  sanitizeAssetBudget,
  validateAssetBudget,
} from "../src/assets/AssetBudget.js";
import { buildCleanAssetScene, buildHeavyAssetScene } from "../src/assets/fixtures/assetBudgetFixtures.js";
import { normalizeAssetMetadata } from "../src/assets/AssetValidation.js";
import { AssetLibrary } from "../src/assets/AssetLibrary.js";
import { createWorldDocument, WORLD_DOCUMENT_VERSION } from "../src/world/WorldDocument.js";
import { validateWorldDocument } from "../src/world/WorldValidation.js";
import { WorldSerializer } from "../src/world/WorldSerializer.js";
import { assetInstancesScene } from "../src/perf/BenchmarkScenes.js";

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

const meshScene = (geometry, material = new THREE.MeshStandardMaterial()) => {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, material));
  return root;
};

// --- 1. computeAssetBudget exact counts --------------------------------------
{
  const clean = computeAssetBudget(buildCleanAssetScene());
  assert.deepEqual(
    { triangles: clean.triangles, materials: clean.materials, textures: clean.textures, nodes: clean.nodes, meshes: clean.meshes },
    { triangles: 12, materials: 1, textures: 0, nodes: 2, meshes: 1 },
    "clean box: 12 triangles, 1 material, 0 textures, 2 nodes, 1 mesh"
  );
  assert.equal(clean.maxDimension, 1.2, "clean box max dimension = 1.2");

  const heavy = computeAssetBudget(buildHeavyAssetScene());
  assert.equal(heavy.triangles, 217560, "heavy sphere triangle count is exact + deterministic");
  assert.equal(heavy.materials, 1, "heavy sphere has one material");

  // Shared material across meshes counts ONCE; an array material counts each entry.
  const shared = new THREE.MeshStandardMaterial();
  const twoMeshShared = new THREE.Group();
  twoMeshShared.add(new THREE.Mesh(new THREE.BoxGeometry(), shared));
  twoMeshShared.add(new THREE.Mesh(new THREE.BoxGeometry(), shared));
  assert.equal(computeAssetBudget(twoMeshShared).materials, 1, "a material shared across meshes counts once (by uuid)");

  // Animation presence is captured (not gated).
  const withClips = computeAssetBudget(buildCleanAssetScene(), [new THREE.AnimationClip("c", 1, [])]);
  assert.equal(withClips.hasAnimation, true, "animation presence captured");
  assert.equal(withClips.clipCount, 1, "clip count captured");
  ok("computeAssetBudget: exact counts, unique-by-uuid materials, animation capture");
}

// --- 2. validateAssetBudget tiers (non-vacuous) ------------------------------
{
  assert.equal(validateAssetBudget(computeAssetBudget(buildCleanAssetScene())).severity, "ok", "clean asset → ok");

  const heavyVerdict = validateAssetBudget(computeAssetBudget(buildHeavyAssetScene()));
  assert.equal(heavyVerdict.severity, "reject", "heavy asset → reject");
  assert.ok(heavyVerdict.breaches.some((b) => b.metric === "triangles" && b.tier === "reject"), "reject cites the triangle breach");

  // Borderline triangles → warn (between warn and reject tiers).
  const borderline = computeAssetBudget(meshScene(new THREE.SphereGeometry(1, 200, 120)));
  assert.ok(borderline.triangles > ASSET_BUDGET_LIMITS.triangles.warn && borderline.triangles < ASSET_BUDGET_LIMITS.triangles.reject, "borderline sphere sits between warn and reject");
  assert.equal(validateAssetBudget(borderline).severity, "warn", "borderline triangle count → warn");

  // Too many materials → reject (array material with > reject entries).
  const manyMats = Array.from({ length: ASSET_BUDGET_LIMITS.materials.reject + 1 }, () => new THREE.MeshStandardMaterial());
  const multiMat = meshScene(new THREE.BoxGeometry().toNonIndexed(), manyMats);
  assert.equal(validateAssetBudget(computeAssetBudget(multiMat)).severity, "reject", "over-cap material count → reject");

  // Too many nodes → reject (a deep chain of empty Object3D).
  const bigTree = new THREE.Group();
  let cursor = bigTree;
  for (let i = 0; i < ASSET_BUDGET_LIMITS.nodes.reject + 2; i++) {
    const next = new THREE.Object3D();
    cursor.add(next);
    cursor = next;
  }
  assert.equal(validateAssetBudget(computeAssetBudget(bigTree)).severity, "reject", "over-cap node count → reject");
  ok("validateAssetBudget: ok/warn/reject at the right tiers for triangles, materials, nodes");
}

// --- 3. scale discipline -----------------------------------------------------
{
  const oversized = computeAssetBudget(meshScene(new THREE.BoxGeometry(5000, 5000, 5000)));
  const oversizedVerdict = validateAssetBudget(oversized);
  assert.equal(oversizedVerdict.severity, "reject", "a 5000m asset → reject (likely a cm/m export mistake)");
  assert.ok(oversizedVerdict.breaches.some((b) => b.metric === "maxDimension" && b.tier === "reject"), "reject cites the maxDimension breach");

  const tiny = computeAssetBudget(meshScene(new THREE.BoxGeometry(0.01, 0.01, 0.01)));
  const tinyVerdict = validateAssetBudget(tiny);
  assert.equal(tinyVerdict.severity, "warn", "a 1cm asset → warn (the inverse scale mistake)");
  assert.ok(tinyVerdict.breaches.some((b) => b.metric === "tinyDimension"), "warn cites the tinyDimension breach");
  ok("scale discipline: oversized → reject, sub-tiny → warn");
}

// --- 4. AssetBudgetError carries the report ----------------------------------
{
  const budget = computeAssetBudget(buildHeavyAssetScene());
  const verdict = validateAssetBudget(budget);
  const err = new AssetBudgetError({ budget, verdict });
  assert.ok(err instanceof Error, "AssetBudgetError is an Error");
  assert.equal(err.name, "AssetBudgetError", "error name is stable");
  assert.equal(err.report.verdict.severity, "reject", "the report carries the reject verdict");
  assert.match(err.message, /triangles/, "the message names the breaching metric");
  ok("AssetBudgetError: instanceof Error, carries report + names the breach");
}

// --- 5. sanitizeAssetBudget round-trip + guards ------------------------------
{
  const raw = { triangles: 100, materials: 2, textures: 1, nodes: 5, meshes: 3, hasAnimation: true, clipCount: 2, maxDimension: 4.5, severity: "warn", evil: 1 };
  const clean = sanitizeAssetBudget(raw);
  assert.equal("evil" in clean, false, "unknown key dropped");
  assert.equal(clean.triangles, 100, "finite triangles survive");
  assert.equal(clean.hasAnimation, true, "hasAnimation survives");
  assert.equal(clean.severity, "warn", "valid severity survives");
  assert.equal(sanitizeAssetBudget({ ...raw, severity: "bogus" }).severity, "ok", "unknown severity → ok");
  assert.equal(sanitizeAssetBudget(null), null, "null → null");
  assert.equal(sanitizeAssetBudget({}), null, "empty object (no counts) → null");
  assert.equal(sanitizeAssetBudget({ triangles: "NaN-ish" }), null, "an object with only a non-finite count → null");
  assert.equal(sanitizeAssetBudget({ triangles: "NaN-ish", materials: 2 }).triangles, 0, "a non-finite count → 0 when another count is present");
  assert.equal(sanitizeAssetBudget({ triangles: -50, materials: 1 }).triangles, 0, "a negative count clamps to 0 (boundary hardening)");
  ok("sanitizeAssetBudget: whitelist, finite guards, severity allowlist, null on empty");
}

// --- 6. normalizeAssetMetadata whitelists the budget -------------------------
{
  const withBudget = normalizeAssetMetadata({ id: "gltf-x", type: "gltf", name: "X", budget: { triangles: 50, materials: 1, textures: 0, nodes: 2, severity: "ok" } });
  assert.ok(withBudget.budget && withBudget.budget.triangles === 50, "budget survives normalizeAssetMetadata");
  const noBudget = normalizeAssetMetadata({ id: "gltf-y", type: "gltf", name: "Y" });
  assert.equal(noBudget.budget, null, "absent budget normalizes to null (not undefined)");
  ok("normalizeAssetMetadata: budget whitelisted, null when absent");
}

// --- 7. createManifest emits the budget --------------------------------------
{
  const lib = new AssetLibrary();
  lib.assets.set("gltf-x", normalizeAssetMetadata({ id: "gltf-x", type: "gltf", name: "X", budget: { triangles: 75, materials: 2, textures: 1, nodes: 4, severity: "warn" } }));
  const item = lib.createManifest().items.find((i) => i.id === "gltf-x");
  assert.ok(item, "manifest carries the gltf asset");
  assert.ok(item.budget && item.budget.triangles === 75 && item.budget.severity === "warn", "manifest item carries the budget report");
  ok("createManifest: budget surfaced in the world-document manifest");
}

// --- 8. world-document persistence whitelist (no schema bump) -----------------
{
  globalThis.localStorage = (() => {
    const store = new Map();
    return { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() };
  })();

  // Empty assets block → zero warnings (additive, non-breaking).
  const emptyWarnings = validateWorldDocument(createWorldDocument()).warnings;
  assert.equal(emptyWarnings.length, 0, "a default document (empty assets) emits zero warnings");

  const doc = createWorldDocument();
  doc.assets.items = [
    { id: "gltf-x", type: "gltf", name: "Ruin", budget: { triangles: 1200, materials: 3, textures: 2, nodes: 9, severity: "ok" } },
  ];
  const serializer = new WorldSerializer();
  serializer.save(doc);
  const loaded = serializer.load().document;

  assert.equal(loaded.version, WORLD_DOCUMENT_VERSION, "version unchanged by the asset budget field");
  assert.equal(loaded.version, 2, "version is literally 2 (no schema bump)");
  const item = loaded.assets.items.find((i) => i.id === "gltf-x");
  assert.ok(item, "manifest item survives save→load");
  assert.ok(item.budget && item.budget.triangles === 1200 && item.budget.severity === "ok", "the budget survives the world-document whitelist");

  // A manifest item with no budget loads as null, not a crash.
  doc.assets.items = [{ id: "gltf-z", type: "gltf", name: "NoBudget" }];
  serializer.save(doc);
  const reloaded = serializer.load().document.assets.items.find((i) => i.id === "gltf-z");
  assert.equal(reloaded.budget, null, "a budget-less manifest item survives as budget:null");

  // Re-validation is a fixed point.
  const again = validateWorldDocument(loaded).document;
  assert.deepEqual(again.assets, loaded.assets, "re-validation of the assets block is idempotent");
  ok("world-document: budget round-trips, no schema bump, zero-warning-empty, idempotent");
}

// --- 9. asset-instances benchmark scene --------------------------------------
{
  const a = assetInstancesScene({ assetId: "gltf-x", count: 24 });
  const b = assetInstancesScene({ assetId: "gltf-x", count: 24 });
  // Compare the deterministic SCENE CONTENT — not document.metadata, whose createdAt/
  // updatedAt are wall-clock timestamps stamped by createWorldDocument (comparing the
  // whole document would be ~20% flaky across a millisecond boundary). This matches the
  // pattern performance-contract-regression already uses (`...document.objects`).
  assert.deepEqual(a.document.objects, b.document.objects, "assetInstancesScene objects are deterministic (same args → same objects)");
  assert.deepEqual(a.gated, b.gated, "assetInstancesScene ceilings are deterministic");
  assert.equal(a.id, b.id, "scene id is stable");
  assert.equal(a.document.objects.length, 24, "scene emits exactly `count` instances");
  assert.ok(a.document.objects.every((o) => o.type === "gltf" && o.assetRef === "gltf-x"), "every instance references the asset by assetRef (no embedded binary)");
  assert.ok(a.document.objects.every((o) => o.asset === null), "no instance embeds inline asset data");
  assert.ok(a.gated && Number.isFinite(a.gated.objects), "scene carries a gated ceiling map");
  ok("assetInstancesScene: deterministic, count instances, reference-only (no embedded binary)");
}

// --- 10. no nondeterministic sources / cross-layer imports -------------------
{
  const budgetSrc = fs.readFileSync(new URL("../src/assets/AssetBudget.js", import.meta.url), "utf8");
  assert.equal(/Math\.random|Date\.now|new Date\(/.test(budgetSrc), false, "AssetBudget.js has no nondeterministic sources");
  // Isolation: AssetBudget imports only three (no arsenal/authoring/world layers).
  const imports = [...budgetSrc.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  assert.deepEqual(imports, ["three"], "AssetBudget.js imports only three (no cross-layer dependency)");

  const fixSrc = fs.readFileSync(new URL("../src/assets/fixtures/assetBudgetFixtures.js", import.meta.url), "utf8");
  assert.equal(/Math\.random|Date\.now|new Date\(/.test(fixSrc), false, "asset fixtures have no nondeterministic sources");
  ok("isolation: AssetBudget three-only import boundary, no nondeterministic sources");
}

console.log(`\nasset-pipeline regression: ${passed} checks passed`);
