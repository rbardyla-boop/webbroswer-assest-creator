import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { generateCityLayout, generateCityDocument, computeLayoutSignature } from "../src/city/CityGenerator.js";
import { createMemoryStorage, saveCityDocument, loadCityDocument, serializeCityDocument } from "../src/city/CityDocument.js";
import { createCityConfig } from "../src/city/CityConfig.js";
import { CityChunk, disposeSharedCityResources } from "../src/city/CityChunk.js";

const root = resolve(import.meta.dirname, "..");
const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push({ name, pass: true });
  } catch (err) {
    checks.push({ name, pass: false, error: err.message });
    process.exitCode = 1;
  }
}
function file(path) {
  const full = resolve(root, path);
  assert.ok(existsSync(full), `Missing file: ${path}`);
  return readFileSync(full, "utf8");
}
function includesAll(text, terms, label) {
  const missing = terms.filter((t) => !text.includes(t));
  assert.deepEqual(missing, [], `${label} missing: ${missing.join(", ")}`);
}

check("Vite project scripts exist", () => {
  const pkg = JSON.parse(file("package.json"));
  assert.equal(pkg.type, "module");
  assert.equal(pkg.scripts.dev, "vite");
  assert.equal(pkg.scripts.build, "vite build");
  assert.equal(pkg.dependencies.three.startsWith("^0.169"), true);
});

check("Required modular architecture files exist", () => {
  [
    "src/main.js",
    "src/core/renderer.js", "src/core/scene.js", "src/core/camera.js", "src/core/lights.js", "src/core/input.js",
    "src/terrain/Terrain.js", "src/terrain/terrainSampling.js",
    "src/grass/GrassSystem.js", "src/grass/GrassPatch.js", "src/grass/GrassGeometry.js", "src/grass/GrassMaterial.js", "src/grass/GrassPlacement.js", "src/grass/GrassConfig.js",
    "src/city/CitySystem.js", "src/city/CityChunk.js", "src/city/CityGenerator.js", "src/city/CityDocument.js", "src/city/CityConfig.js", "src/city/CityLabels.js",
    "src/player/Player.js", "src/player/PlayerController.js", "src/player/PlayerCameraController.js",
    "src/debug/DebugPanel.js", "src/utils/math.js", "src/utils/random.js",
  ].forEach(file);
});

check("City generator creates city-builder style labeled zones", () => {
  const layout = generateCityLayout({ seed: "showcase-001", style: "showcase" });
  const types = new Set(layout.zones.map((z) => z.type));
  for (const type of ["downtown", "residential", "industrial", "park", "village", "military", "science", "drilling", "airport"]) {
    assert.ok(types.has(type), `Missing zone type: ${type}`);
  }
  assert.ok(layout.zones.every((z) => z.label && z.w > 0 && z.d > 0), "Zones must have labels and dimensions");
  assert.ok(layout.stats.buildings > 30, "Expected visible generated buildings");
  assert.ok(layout.stats.chunks > 2, "Expected chunked city layout");
});

check("City layouts are deterministic for same seed and vary by seed/style", () => {
  const a = generateCityLayout({ seed: "alpha", style: "showcase" });
  const b = generateCityLayout({ seed: "alpha", style: "showcase" });
  const c = generateCityLayout({ seed: "beta", style: "showcase" });
  const d = generateCityLayout({ seed: "alpha", style: "outpost" });
  assert.equal(computeLayoutSignature(a), computeLayoutSignature(b), "Same seed/style must reproduce exactly");
  assert.notEqual(computeLayoutSignature(a), computeLayoutSignature(c), "Different seed must change layout");
  assert.notEqual(computeLayoutSignature(a), computeLayoutSignature(d), "Different style must change layout");
});

check("City document save/load round-trips without losing layout", () => {
  const doc = generateCityDocument({ seed: "save-load-test", style: "outpost" });
  const storage = createMemoryStorage();
  const bytes = saveCityDocument(doc, storage, "unit-test-city");
  assert.ok(bytes > 1000, "Expected non-trivial serialized city document");
  const loaded = loadCityDocument(storage, "unit-test-city");
  assert.equal(serializeCityDocument(loaded), serializeCityDocument(doc), "Loaded city document must match saved document");
});

check("Runtime city system is instanced, chunked, and LOD/cull aware", () => {
  const chunk = file("src/city/CityChunk.js");
  const system = file("src/city/CitySystem.js");
  includesAll(chunk, ["InstancedMesh", "setMatrixAt", "setColorAt"], "CityChunk instancing");
  includesAll(system, ["Frustum", "intersectsSphere", "visibleDistance", "lodDistances", "visibleChunks", "drawCallsEstimate", "visibleDrawCount"], "CitySystem streaming/culling");
  assert.equal(system.includes("meshes.filter"), false, "CitySystem update must not allocate with meshes.filter per frame");
});


check("City chunk render flags avoid flat-overlay shadow artifacts", () => {
  const cfg = createCityConfig({ seed: "shadow-flags", style: "showcase" });
  const layout = generateCityLayout(cfg);
  const chunkData = layout.chunks.find((c) => c.zones.length && c.roads.length);
  assert.ok(chunkData, "Expected at least one chunk with zones and roads");
  const chunk = new CityChunk(chunkData, cfg);
  const zones = chunk.meshes.find((m) => m.name.endsWith("_zones"));
  const roads = chunk.meshes.find((m) => m.name.endsWith("_roads") || m.name.endsWith("_runways"));
  const buildings = chunk.meshes.find((m) => m.name.endsWith("_buildings"));
  assert.ok(zones, "Expected zone overlay mesh");
  assert.ok(roads, "Expected road/runway mesh");
  assert.equal(zones.castShadow, false, "Zone overlays must not cast shadow");
  assert.equal(zones.receiveShadow, false, "Zone overlays are translucent UI plates, not terrain receivers");
  assert.equal(roads.castShadow, false, "Roads/sidewalks/runways must not cast shadow");
  assert.equal(roads.receiveShadow, true, "Roads/sidewalks/runways should receive shadows");
  if (buildings) assert.equal(buildings.castShadow, true, "Buildings should cast shadows");
  chunk.setLOD(2);
  assert.ok(chunk.visibleDrawCount <= chunk.meshes.length, "visibleDrawCount must be bounded by mesh count");
  chunk.dispose();
  disposeSharedCityResources();
});

check("Grass architecture is instanced, patch-based, shader-wind animated, and configurable", () => {
  includesAll(file("src/grass/GrassPatch.js"), ["InstancedBufferAttribute", "lodCounts", "setLOD", "visibleBladeCount"], "GrassPatch");
  includesAll(file("src/grass/GrassSystem.js"), ["patches", "_buildQueue", "_cullAndLOD", "Frustum", "visiblePatches", "visibleBlades"], "GrassSystem");
  includesAll(file("src/grass/GrassMaterial.js"), ["ShaderMaterial", "uWindDir", "uWindStrength", "aPhase", "sin(phase)", "uTime"], "GrassMaterial");
  includesAll(file("src/grass/GrassConfig.js"), ["density", "patchSize", "visibleDistance", "lodDistances", "grassSize", "wind", "debug"], "GrassConfig");
});

check("Grass placement uses reusable terrain height, normal, slope, and placement rules", () => {
  includesAll(file("src/terrain/terrainSampling.js"), ["getHeight", "getNormal", "getSlope", "canPlaceGrass", "findGoodSpawn"], "terrainSampling");
  includesAll(file("src/grass/GrassPlacement.js"), ["getHeight", "canPlaceGrass", "generatePatchInstances", "mulberry32"], "GrassPlacement");
});

check("Player and camera satisfy capsule, grounded movement, FP/TP toggle, and camera-relative motion", () => {
  includesAll(file("src/player/Player.js"), ["CapsuleGeometry", "eyeHeight", "position", "syncMesh"], "Player");
  includesAll(file("src/player/PlayerController.js"), ["getMoveAxis", "getHeight", "grounded", "Space", "yaw", "walkSpeed", "sprintSpeed"], "PlayerController");
  includesAll(file("src/player/PlayerCameraController.js"), ["mode", "first", "third", "toggleMode", "eyeHeight", "followRate", "damp", "lookAt"], "PlayerCameraController");
});

check("Debug panel exposes FPS, grass, city chunks, draw calls, player position, and camera mode", () => {
  includesAll(file("src/debug/DebugPanel.js"), ["fps", "draw calls", "patches", "blades", "LOD", "player xyz", "camera", "city chunks", "zone"], "DebugPanel");
});

check("Main browser demo wires terrain, lighting, grass, city, capsule player, controls, save/load, and FP/TP switch", () => {
  const main = file("src/main.js");
  includesAll(main, ["createRenderer", "createScene", "createLights", "Terrain", "GrassSystem", "CitySystem", "Player", "PlayerController", "PlayerCameraController", "city.save", "city.loadSaved", "KeyV"], "main.js");
  const html = file("index.html");
  includesAll(html, ["city-style", "city-seed", "city-regenerate", "city-save", "city-load", "Move", "Camera", "Debug"], "index.html controls");
});

check("Performance guardrails keep generated demo bounded", () => {
  const showcase = generateCityLayout({ seed: "bound-check", style: "showcase" });
  assert.ok(showcase.stats.buildings <= 520, `Too many buildings: ${showcase.stats.buildings}`);
  assert.ok(showcase.stats.props <= 360, `Too many props: ${showcase.stats.props}`);
  assert.ok(showcase.stats.chunks <= 32, `Too many chunks for demo: ${showcase.stats.chunks}`);
  assert.ok(showcase.stats.roads <= 24, `Too many road instances for demo: ${showcase.stats.roads}`);
});

for (const result of checks) {
  console.log(`${result.pass ? "PASS" : "FAIL"} - ${result.name}${result.error ? ` :: ${result.error}` : ""}`);
}

if (process.exitCode) {
  console.error("\nRuntime city verification failed.");
  process.exit(process.exitCode);
}
console.log(`\nRuntime city verification passed: ${checks.length}/${checks.length} checks.`);
