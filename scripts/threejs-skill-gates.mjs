#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const configPath = path.join(root, 'qa/threejs-skill-gates.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const results = [];

function rel(p) {
  return path.relative(root, p).replaceAll(path.sep, '/');
}

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function exists(file) {
  return fs.existsSync(path.join(root, file));
}

function pass(name, detail = '') {
  results.push({ level: 'PASS', name, detail });
}

function warn(name, detail = '') {
  results.push({ level: 'WARN', name, detail });
}

function fail(name, detail = '') {
  results.push({ level: 'FAIL', name, detail });
}

function assertContains(file, patterns, name) {
  if (!exists(file)) {
    fail(name, `${file} missing`);
    return;
  }
  const txt = read(file);
  const missing = patterns.filter((p) => !txt.includes(p));
  if (missing.length === 0) pass(name, file);
  else fail(name, `${file} missing: ${missing.join(', ')}`);
}

function walk(dir, out = []) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return out;
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    const p = path.join(abs, ent.name);
    if (ent.isDirectory()) walk(rel(p), out);
    else if (ent.isFile() && p.endsWith('.js')) out.push(rel(p));
  }
  return out;
}

function checkRequiredFiles() {
  const missing = config.requiredFiles.filter((file) => !exists(file));
  if (missing.length === 0) pass('source tree: required files present', `${config.requiredFiles.length} files`);
  else fail('source tree: required files present', `missing: ${missing.join(', ')}`);

  const missingDocs = config.docs.filter((file) => !exists(file));
  if (missingDocs.length === 0) pass('adoption docs: required docs present', `${config.docs.length} docs`);
  else fail('adoption docs: required docs present', `missing: ${missingDocs.join(', ')}`);
}

function checkSyntax() {
  const files = walk('src').concat(walk('scripts'));
  const bad = [];
  for (const file of files) {
    const r = spawnSync(process.execPath, ['--check', file], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (r.status !== 0) bad.push(`${file}: ${r.stderr.trim() || r.stdout.trim()}`);
  }
  if (bad.length === 0) pass('syntax: JavaScript parses', `${files.length} files`);
  else fail('syntax: JavaScript parses', bad.join('\n'));
}

function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return { ok: true, external: true };
  const base = path.dirname(path.join(root, fromFile));
  const direct = path.resolve(base, spec);
  const candidates = [direct, `${direct}.js`, path.join(direct, 'index.js')];
  const found = candidates.find((p) => fs.existsSync(p));
  return found ? { ok: true, file: rel(found) } : { ok: false, wanted: rel(direct) };
}

function checkImports() {
  const files = walk('src');
  const importRe = /import\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g;
  const bad = [];
  for (const file of files) {
    const txt = read(file);
    let m;
    while ((m = importRe.exec(txt))) {
      const res = resolveImport(file, m[1]);
      if (!res.ok) bad.push(`${file} -> ${m[1]} (${res.wanted})`);
    }
  }
  if (bad.length === 0) pass('imports: local module imports resolve', `${files.length} source files`);
  else fail('imports: local module imports resolve', bad.join('\n'));
}

function checkPackageAndHtml() {
  if (!exists('package.json')) {
    fail('package: package.json exists');
    return;
  }
  const pkg = JSON.parse(read('package.json'));
  const scripts = pkg.scripts || {};
  for (const script of ['dev', 'build', 'qa:skills', 'qa:browser', 'qa']) {
    if (scripts[script]) pass(`package script: ${script}`, scripts[script]);
    else fail(`package script: ${script}`, 'missing');
  }
  if (pkg.dependencies?.three) pass('dependency: three declared', pkg.dependencies.three);
  else fail('dependency: three declared', 'missing dependency');
  if (pkg.devDependencies?.vite) pass('dependency: vite declared', pkg.devDependencies.vite);
  else fail('dependency: vite declared', 'missing devDependency');

  assertContains('index.html', ['<script type="module" src="/src/main.js"></script>', '<div id="app"></div>'], 'index: loads reconstructed src entry');
}

function checkGameplaySystems() {
  assertContains(
    'src/core/input.js',
    ['class Input', 'getMoveAxis()', 'consumeMouseDelta()', 'requestPointerLock()', 'wasPressed(code)'],
    'gameplay/input: centralized axes, mouse look, edge presses'
  );
  assertContains(
    'src/player/PlayerController.js',
    ['getHeight', 'input.getMoveAxis()', 'input.wasPressed("Space")', 'sprintSpeed', 'this.cam.yaw', 'player.grounded'],
    'gameplay/player: camera-relative movement, sprint, jump, terrain grounding'
  );
  assertContains(
    'src/player/PlayerCameraController.js',
    ['mode = "third"', 'toggleMode()', 'consumeMouseDelta()', '_updateFirstPerson()', '_updateThirdPerson(dt)', 'getHeight'],
    'gameplay/camera: first-third toggle, pointer look, terrain-safe follow'
  );

  const collisionFiles = walk('src').filter((file) => /collid|physics|obstacle/i.test(file));
  if (collisionFiles.length === 0) {
    warn('gameplay/collision: obstacle-volume collision not implemented', 'current runtime has terrain-height grounding only');
  } else {
    pass('gameplay/collision: collision module present', collisionFiles.join(', '));
  }
}

function checkGraphicsBuilder() {
  assertContains(
    'src/core/renderer.js',
    ['WebGLRenderer', 'powerPreference: "high-performance"', 'setPixelRatio(Math.min(window.devicePixelRatio, 1.75))', 'SRGBColorSpace', 'ACESFilmicToneMapping', 'shadowMap.enabled = true'],
    'graphics/renderer: DPR cap, SRGB, tone mapping, shadows'
  );
  assertContains(
    'src/core/scene.js',
    ['SKY_COLOR', 'new THREE.Fog', 'scene.background'],
    'graphics/scene: sky color and fog'
  );
  assertContains(
    'src/core/lights.js',
    ['DirectionalLight', 'HemisphereLight', 'castShadow = true', 'shadow.mapSize.set'],
    'graphics/lights: sun shadows and hemisphere fill'
  );
  assertContains(
    'src/terrain/Terrain.js',
    ['getHeight', 'getSlope', 'vertexColors: true', 'computeVertexNormals()', 'receiveShadow = true'],
    'graphics/terrain: sampled displacement, slope color, normals, shadows'
  );
  assertContains(
    'src/grass/GrassSystem.js',
    ['_buildQueue', '_frustum', 'setLOD', 'visibleDistance', 'keepDistance', 'maxPatchBuildsPerFrame', 'intersectsSphere'],
    'graphics/grass-system: streaming, culling, LOD, disposal budget'
  );
  assertContains(
    'src/grass/GrassMaterial.js',
    ['ShaderMaterial', 'uWindDir', 'uWindStrength', 'vertexShader', 'fragmentShader', 'uTime'],
    'graphics/grass-material: GPU wind shader'
  );
  assertContains(
    'src/grass/GrassPlacement.js',
    ['generatePatchInstances', 'mulberry32', 'hash2i', 'canPlaceGrass', 'getHeight'],
    'graphics/grass-placement: deterministic terrain-aware instances'
  );
}

function checkDebugProfiler() {
  assertContains(
    'src/debug/DebugPanel.js',
    ['fps', 'draw calls', 'visibleBlades', 'LOD 0/1/2', 'player xyz', 'grounded'],
    'debug/hud: FPS, draw calls, grass stats, player state'
  );
  assertContains(
    'src/main.js',
    ['renderer.info.render.calls', 'grass.stats', 'debug.update', 'cameraController.modeLabel', 'player.grounded'],
    'debug/main-loop: profiler data fed from runtime systems'
  );
  assertContains(
    'src/grass/GrassSystem.js',
    ['this.stats =', 'visiblePatches', 'activePatches', 'visibleBlades', 'builtThisFrame', 'queueLength'],
    'debug/grass: patch, blade, LOD, queue stats exposed'
  );
}

function checkQaRelease() {
  assertContains(
    'docs/THREEJS_SKILL_ADOPTION.md',
    ['Skill-to-engine map', 'Stage-completion rule', 'npm run qa:skills', 'Browser smoke'],
    'qa/adoption-manual: maps skills to gates'
  );
  assertContains(
    'scripts/browser-smoke.mjs',
    ['playwright', 'viewport', 'canvas', 'readPixels', 'screenshot'],
    'qa/browser-smoke: optional browser, viewport, screenshot, canvas checks'
  );
  const viteBin = path.join(root, 'node_modules/.bin/vite');
  if (fs.existsSync(viteBin)) pass('qa/build-environment: vite installed', rel(viteBin));
  else warn('qa/build-environment: vite not installed in this artifact sandbox', 'run npm install or npm ci before npm run build');
}

function checkAssetImageAudioGates() {
  assertContains(
    'docs/ASSET_IMPORT_GATE.md',
    ['GLB/FBX Asset Import Gate', 'Triangle count', 'Animation clips', 'THREE.AnimationMixer', 'Current state'],
    'asset/3d-generator: GLB/FBX acceptance gate documented'
  );
  assertContains(
    'docs/IMAGE_GENERATION_GATE.md',
    ['Image Generation Gate', 'Skybox concepts', 'Texture references', 'Runtime acceptance checks'],
    'asset/image-generator: image acceptance gate documented'
  );
  assertContains(
    'docs/AUDIO_GENERATION_GATE.md',
    ['Audio Generation Gate', 'deferred', 'No audio may block game start'],
    'asset/audio-generator: deferred audio gate documented'
  );
}

checkRequiredFiles();
checkSyntax();
checkImports();
checkPackageAndHtml();
checkGameplaySystems();
checkGraphicsBuilder();
checkDebugProfiler();
checkQaRelease();
checkAssetImageAudioGates();

const order = { FAIL: 0, WARN: 1, PASS: 2 };
const grouped = [...results].sort((a, b) => order[a.level] - order[b.level] || a.name.localeCompare(b.name));
for (const r of grouped) {
  const suffix = r.detail ? ` - ${r.detail}` : '';
  console.log(`${r.level.padEnd(4)} ${r.name}${suffix}`);
}

const fails = results.filter((r) => r.level === 'FAIL').length;
const warns = results.filter((r) => r.level === 'WARN').length;
const passes = results.filter((r) => r.level === 'PASS').length;
console.log(`\nsummary: ${passes} pass, ${warns} warn, ${fails} fail`);

if (fails > 0) process.exit(1);
