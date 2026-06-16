import * as THREE from 'three';
import './styles.css';
import {
  InputManager,
  TimeController,
  GravitySystem,
  DirectionalGravityField,
  PointGravityField,
  PhysicsWorld,
  PlaneCollider,
  BoxCollider,
  MovingPlatformCollider,
  SphereGroundCollider,
  CharacterController,
  CarController,
  DroneController,
  SmoothFollowCamera,
} from '../toolkit/index.js';

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1018);
scene.fog = new THREE.Fog(0x0b1018, 70, 190);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 500);

const hemi = new THREE.HemisphereLight(0xb8d6ff, 0x1b2218, 1.2);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dd, 2.6);
sun.position.set(35, 55, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -70; sun.shadow.camera.right = 70; sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
scene.add(sun);

const world = new PhysicsWorld();
const gravity = new GravitySystem(new THREE.Vector3(0, -24, 0));
const time = new TimeController();
const input = new InputManager(renderer.domElement, { enableTouch: true, pointerLock: true });
const followCamera = new SmoothFollowCamera(camera, { distance: 8, height: 1.7, targetHeight: 1.3, damping: 11 });

const visuals = new Map();
const gravityStrength = { value: 24 };

buildWorld();

const character = new CharacterController({ position: new THREE.Vector3(-7, 2, 3) });
const car = new CarController({ position: new THREE.Vector3(-18, 1, 13) });
const drone = new DroneController({ position: new THREE.Vector3(6, 9, 9) });
const characterMesh = makeCharacterMesh();
const carMesh = makeCarMesh();
const droneMesh = makeDroneMesh();
scene.add(characterMesh, carMesh, droneMesh);

let active = 'character';
let gravityMode = 'earth';
let ui = null;
setGravityMode('earth');

ui = buildUI();
const clock = new THREE.Clock();

function loop() {
  requestAnimationFrame(loop);
  const frame = time.update(clock.getDelta());
  input.beginFrame();
  world.update(frame.dt, frame.elapsed);

  if (input.wasPressed('Digit1')) setActive('character');
  if (input.wasPressed('Digit2')) setActive('car');
  if (input.wasPressed('Digit3')) setActive('drone');
  if (input.wasPressed('KeyB')) time.bulletTime(0.8, 0.16, ui.values.timeScale);
  if (input.wasPressed('KeyG')) cycleGravity();

  character.update(frame.dt, input, world, gravity, camera);
  car.update(active === 'car' ? frame.dt : frame.dt * 0.15, input, world, gravity);
  drone.update(active === 'drone' ? frame.dt : frame.dt * 0.12, input, world, gravity, camera);

  character.applyToObject(characterMesh);
  car.applyToObject(carMesh);
  drone.applyToObject(droneMesh);
  carMesh.visible = active === 'car' || ui.values.showAll;
  droneMesh.visible = active === 'drone' || ui.values.showAll;
  characterMesh.visible = active === 'character' || ui.values.showAll;

  const subject = active === 'car' ? car : active === 'drone' ? drone : character;
  followCamera.update(frame.dt, input, subject);
  updateSun(subject);
  updateUI(frame, subject);
  renderer.render(scene, camera);
  input.endFrame();
}
loop();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function buildWorld() {
  const floor = world.add(new PlaneCollider({ point: new THREE.Vector3(0, 0, 0), normal: new THREE.Vector3(0, 1, 0), halfSize: new THREE.Vector2(80, 80), name: 'floor' }));
  addPlaneVisual(floor, 0x273243);

  const slopeNormal = new THREE.Vector3(0, Math.cos(Math.PI / 6), -Math.sin(Math.PI / 6)).normalize();
  const slope = world.add(new PlaneCollider({ point: new THREE.Vector3(-9, 1.6, -10), normal: slopeNormal, tangent: new THREE.Vector3(1, 0, 0), halfSize: new THREE.Vector2(8, 7), name: '30deg-slope' }));
  addPlaneVisual(slope, 0x3a4b5d);

  const steepNormal = new THREE.Vector3(0, Math.cos(Math.PI / 3.05), Math.sin(Math.PI / 3.05)).normalize();
  const steep = world.add(new PlaneCollider({ point: new THREE.Vector3(12, 2.4, -13), normal: steepNormal, tangent: new THREE.Vector3(1, 0, 0), halfSize: new THREE.Vector2(6, 5), name: 'steep-slope' }));
  addPlaneVisual(steep, 0x4a3540);

  const wall = world.add(new PlaneCollider({ point: new THREE.Vector3(25, 6, 0), normal: new THREE.Vector3(-1, 0, 0), tangent: new THREE.Vector3(0, 1, 0), halfSize: new THREE.Vector2(11, 13), name: 'wall-walk-plane' }));
  addPlaneVisual(wall, 0x2d4050);

  const moving = world.add(new MovingPlatformCollider({ center: new THREE.Vector3(0, 2.4, 16), size: new THREE.Vector3(6, 0.42, 5), axis: new THREE.Vector3(1, 0, 0), amplitude: 6, speed: 1.15, name: 'moving-platform' }));
  const movingMesh = makeBoxMesh(moving.size, 0x89a6d8);
  scene.add(movingMesh);
  visuals.set(moving, movingMesh);

  const obstacleA = world.add(new BoxCollider({ center: new THREE.Vector3(-2, 1, -2), size: new THREE.Vector3(3, 2, 3), name: 'block' }));
  scene.add(makeBoxMesh(obstacleA.size, 0x53617a, obstacleA.center));
  const obstacleB = world.add(new BoxCollider({ center: new THREE.Vector3(7, 0.7, 5), size: new THREE.Vector3(7, 1.4, 2), name: 'low-wall' }));
  scene.add(makeBoxMesh(obstacleB.size, 0x46536d, obstacleB.center));

  const planet = world.add(new SphereGroundCollider({ center: new THREE.Vector3(42, 8, 0), radius: 7, name: 'tiny-planet' }));
  const planetMesh = new THREE.Mesh(new THREE.SphereGeometry(planet.radius, 48, 24), new THREE.MeshStandardMaterial({ color: 0x395f47, roughness: 0.92 }));
  planetMesh.position.copy(planet.center);
  planetMesh.receiveShadow = true;
  scene.add(planetMesh);
  visuals.set(planet, planetMesh);

  const tunnelGeo = new THREE.CylinderGeometry(5.2, 5.2, 32, 32, 1, true);
  tunnelGeo.rotateX(Math.PI / 2);
  const tunnel = new THREE.Mesh(tunnelGeo, new THREE.MeshBasicMaterial({ color: 0x7fb4ff, wireframe: true, transparent: true, opacity: 0.22 }));
  tunnel.position.set(-38, 7, 0);
  scene.add(tunnel);

  const grid = new THREE.GridHelper(160, 80, 0x4b5d72, 0x1a2430);
  grid.position.y = 0.015;
  scene.add(grid);
}

function updateMovingVisuals() {
  for (const [collider, mesh] of visuals) {
    if (collider.type === 'box') mesh.position.copy(collider.center);
  }
}

function addPlaneVisual(collider, color) {
  const geo = new THREE.PlaneGeometry(collider.halfSize.x * 2, collider.halfSize.y * 2, 1, 1);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.03, side: THREE.DoubleSide }));
  const mat = new THREE.Matrix4().makeBasis(collider.tangent, collider.bitangent, collider.normal);
  mesh.quaternion.setFromRotationMatrix(mat);
  mesh.position.copy(collider.point);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function makeBoxMesh(size, color, center = null) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshStandardMaterial({ color, roughness: 0.75 }));
  if (center) mesh.position.copy(center);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeCharacterMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.0, 8, 16), new THREE.MeshStandardMaterial({ color: 0xf08a5d, roughness: 0.65 }));
  body.position.y = 0.9;
  body.castShadow = true;
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), new THREE.MeshStandardMaterial({ color: 0x161b22 }));
  nose.position.set(0, 1.08, -0.42);
  nose.castShadow = true;
  g.add(body, nose);
  return g;
}

function makeCarMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.7, 4.1), new THREE.MeshStandardMaterial({ color: 0x6ca2ff, roughness: 0.48, metalness: 0.08 }));
  body.position.y = 0.55;
  body.castShadow = true;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 1.5), new THREE.MeshStandardMaterial({ color: 0x203146, roughness: 0.35 }));
  cab.position.set(0, 1.1, -0.35);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  for (const x of [-1.18, 1.18]) for (const z of [-1.45, 1.45]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.28, 16), wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.34, z);
    w.castShadow = true;
    g.add(w);
  }
  g.add(body, cab);
  return g;
}

function makeDroneMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x91e6b4, roughness: 0.48 });
  const hub = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 0.9), mat);
  const armA = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 0.12), mat);
  const armB = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 3.2), mat);
  g.add(hub, armA, armB);
  const rotorMat = new THREE.MeshBasicMaterial({ color: 0xd9f7ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
  for (const x of [-1.65, 1.65]) for (const z of [-1.65, 1.65]) {
    const r = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24), rotorMat);
    r.rotation.x = -Math.PI / 2;
    r.position.set(x, 0.05, z);
    g.add(r);
  }
  return g;
}

function setGravityMode(mode) {
  gravityMode = mode;
  gravity.clearFields();
  const s = gravityStrength.value;
  if (mode === 'earth') {
    gravity.setDefaultGravity(new THREE.Vector3(0, -s, 0));
  } else if (mode === 'planet') {
    gravity.setDefaultGravity(new THREE.Vector3(0, 0, 0));
    gravity.addField(new PointGravityField(new THREE.Vector3(42, 8, 0), s * 1.5, { radius: 55, minDistance: 4, priority: 10 }));
    character.position.set(42, 16, -7);
    character.velocity.set(0, 0, 0);
    followCamera.reset();
  } else if (mode === 'wall') {
    gravity.setDefaultGravity(new THREE.Vector3(s, 0, 0));
    character.position.set(23.9, 6, -5);
    character.velocity.set(0, 0, 0);
    followCamera.reset();
  } else if (mode === 'tunnel') {
    gravity.setDefaultGravity(new THREE.Vector3(0, 0, 0));
    gravity.addField({
      priority: 10,
      sample(position) {
        const center = new THREE.Vector3(-38, 7, THREE.MathUtils.clamp(position.z, -16, 16));
        const v = center.sub(position);
        if (Math.abs(position.z) > 24 || v.length() > 18) return null;
        return v.normalize().multiplyScalar(s * 1.25);
      }
    });
    character.position.set(-33, 7, -13);
    character.velocity.set(0, 0, 0);
    followCamera.reset();
  }
  updateButtons();
}

function cycleGravity() {
  const modes = ['earth', 'planet', 'wall', 'tunnel'];
  setGravityMode(modes[(modes.indexOf(gravityMode) + 1) % modes.length]);
}

function setActive(kind) {
  active = kind;
  followCamera.reset();
  updateButtons();
}

function updateSun(subject) {
  sun.position.copy(subject.position).add(new THREE.Vector3(35, 55, 20));
  updateMovingVisuals();
}

function buildUI() {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="title">Plain Three Controllers</div>
    <div class="sub">Vanilla Vite + Three.js. No React, no Rapier. Character, car, drone, custom gravity zones, moving platform, mobile touch, animation state, and time scale.</div>
    <div class="row" id="modeBtns">
      <button data-active="character">1 Character</button>
      <button data-active="car">2 Car</button>
      <button data-active="drone">3 Drone</button>
    </div>
    <div class="row" id="gravityBtns">
      <button data-gravity="earth">Earth</button>
      <button data-gravity="planet">Tiny planet</button>
      <button data-gravity="wall">Wall walk</button>
      <button data-gravity="tunnel">Gravity tunnel</button>
    </div>
    <div class="grid" id="sliders"></div>
    <div class="row"><button id="bullet">B Bullet time</button><button id="showAll">Show all actors</button></div>
    <div class="readout" id="readout"></div>`;
  document.body.appendChild(panel);
  const corner = document.createElement('div');
  corner.className = 'corner';
  corner.innerHTML = `<b>Controls</b><br><kbd>WASD</kbd> move / drive / fly · <kbd>Shift</kbd> run / descend · <kbd>Space</kbd> jump / ascend · click viewport for mouse-look · <kbd>G</kbd> gravity mode · <kbd>B</kbd> bullet time.`;
  document.body.appendChild(corner);

  const values = { timeScale: 1, showAll: true };
  const sliders = panel.querySelector('#sliders');
  const addSlider = (key, label, min, max, value, step, onInput) => {
    values[key] = value;
    const l = document.createElement('label');
    l.textContent = `${label}: ${value}`;
    const r = document.createElement('input');
    r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = value;
    r.addEventListener('input', () => {
      const v = Number(r.value);
      values[key] = v;
      l.textContent = `${label}: ${v}`;
      onInput(v);
    });
    sliders.append(l, r);
  };
  addSlider('timeScale', 'Time scale', 0.05, 1.5, 1, 0.05, (v) => time.setTimeScale(v, { smooth: true }));
  addSlider('walk', 'Walk speed', 2, 12, character.walkSpeed, 0.5, (v) => character.walkSpeed = v);
  addSlider('run', 'Run speed', 4, 20, character.runSpeed, 0.5, (v) => character.runSpeed = v);
  addSlider('jump', 'Jump', 3, 16, character.jumpSpeed, 0.5, (v) => character.jumpSpeed = v);
  addSlider('slope', 'Max slope deg', 20, 75, 50, 1, (v) => character.maxSlopeAngle = THREE.MathUtils.degToRad(v));
  addSlider('gravity', 'Gravity', 5, 60, gravityStrength.value, 1, (v) => { gravityStrength.value = v; setGravityMode(gravityMode); });
  addSlider('camera', 'Camera damping', 2, 24, followCamera.damping, 1, (v) => followCamera.damping = v);
  addSlider('carAccel', 'Car accel', 8, 50, car.acceleration, 1, (v) => car.acceleration = v);
  addSlider('drone', 'Drone accel', 4, 36, drone.acceleration, 1, (v) => drone.acceleration = v);

  panel.querySelector('#modeBtns').addEventListener('click', (e) => e.target.dataset.active && setActive(e.target.dataset.active));
  panel.querySelector('#gravityBtns').addEventListener('click', (e) => e.target.dataset.gravity && setGravityMode(e.target.dataset.gravity));
  panel.querySelector('#bullet').addEventListener('click', () => time.bulletTime(0.8, 0.16, values.timeScale));
  panel.querySelector('#showAll').addEventListener('click', () => { values.showAll = !values.showAll; updateButtons(); });
  return { panel, readout: panel.querySelector('#readout'), values };
}

function updateButtons() {
  document.querySelectorAll('[data-active]').forEach((b) => b.classList.toggle('active', b.dataset.active === active));
  document.querySelectorAll('[data-gravity]').forEach((b) => b.classList.toggle('active', b.dataset.gravity === gravityMode));
  const showAll = document.getElementById('showAll');
  if (showAll) showAll.classList.toggle('active', ui?.values.showAll);
}

function updateUI(frame, subject) {
  updateButtons();
  const anim = subject.animation || {};
  ui.readout.textContent = [
    `active: ${active}`,
    `gravity: ${gravityMode}`,
    `animation.state: ${anim.state}`,
    `speed: ${(anim.speed || 0).toFixed(2)}`,
    `grounded: ${anim.grounded}`,
    `timeScale: ${frame.timeScale.toFixed(2)}`,
    `position: ${subject.position.x.toFixed(1)}, ${subject.position.y.toFixed(1)}, ${subject.position.z.toFixed(1)}`,
  ].join('\n');
}
