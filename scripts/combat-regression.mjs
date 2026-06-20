// test:combat — pure-Node regression for the Combat-0 weapon-use seam:
//   - validateStrike gates on an active weapon (no weapon → no event) + finite-guards every ray/hit,
//   - createStrikeEvent rejects non-finite origin/direction/muzzle/hit (safety),
//   - the StrikeEvent summary is deterministic under fixed input/state (no wall-clock / no RNG),
//   - WeaponEquipRuntime.activeId is rightHand-only, so a holstered (back/hip) weapon never fires,
//   - CombatRuntime casts a real hitscan ray at a registered inert target + records the strike,
//   - CombatTarget is inert (counts hits, never removes); CombatFeedback fades + disposes (no leak),
//   - PlayerCameraController.aimRay is one shared aim basis (FP == TP),
//   - the combat modules have no nondeterministic sources / no cross-layer (arsenal workbench) imports.
// The live equip → fire → reload + 0-console-error path is the browser proof.

import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import {
  MAX_RANGE,
  USE_WEAPON_INPUT,
  COMBAT_TARGET_NAME,
  isFiniteVec3,
  toVec3Array,
  createStrikeEvent,
} from "../src/world/combat/CombatTypes.js";
import { validateStrike, isCombatTarget } from "../src/world/combat/CombatValidation.js";
import { CombatTarget } from "../src/world/combat/CombatTarget.js";
import { CombatFeedback } from "../src/world/combat/CombatFeedback.js";
import { CombatRuntime } from "../src/world/combat/CombatRuntime.js";
import { createPrimitiveMesh, createPlacedObject } from "../src/world/PlacedObject.js";
import { WeaponEquipRuntime } from "../src/world/placement/WeaponEquipRuntime.js";
import { PlayerCameraController } from "../src/player/PlayerCameraController.js";

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

// A production-built inert target dummy at (x,y,z): a primitive WorldObject named combat_target_dummy.
function buildDummy(id, x, y, z) {
  return createPlacedObject({
    id,
    asset: { type: "primitive", kind: "cube", name: COMBAT_TARGET_NAME, color: null },
    object3D: createPrimitiveMesh("cube"),
    position: [x, y, z],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  });
}

// A minimal placed-weapon entry (recipe identity + a group carrying markers) for the muzzle read.
function buildWeaponEntry(seed) {
  const group = new THREE.Group();
  group.position.set(0, 0, 0);
  group.userData.markers = { muzzle: [0.5, 1.4, -0.2], core: [0, 0, 0], equip: [0, 0, 0], socket: [0, 0, 0] };
  return { weapon: { recipe: { seed } }, group };
}

// A camera-controller stub exposing only aimRay (the real basis is unit-tested separately in check 8).
function aimStub(ox, oy, oz, dx, dy, dz) {
  const dir = new THREE.Vector3(dx, dy, dz).normalize();
  return { aimRay: (o, d) => (o.set(ox, oy, oz), d.copy(dir), undefined) };
}

// An input stub whose wasPressed(code) consumes a one-shot queued press, like the real edge.
function inputStub() {
  const queued = new Set();
  return { press: (c) => queued.add(c), wasPressed: (c) => (queued.delete(c) ? true : false) };
}

function makeRuntime({ activeId, entrySeed = 7, aim }) {
  const scene = new THREE.Scene();
  const dummy = buildDummy("dummy-1", 0, 1.6, -5);
  scene.add(dummy);
  scene.updateMatrixWorld(true);
  const objectManager = { objects: new Map([["dummy-1", dummy]]) };
  const equipRuntime = { activeId };
  const placedRuntime = { getEntry: (id) => (id === activeId ? buildWeaponEntry(entrySeed) : null) };
  const input = inputStub();
  const combat = new CombatRuntime({ equipRuntime, placedRuntime, cameraController: aim, input });
  combat.load({ scene, objectManager });
  return { combat, input, scene, objectManager };
}

// --- 1. validateStrike requires an active weapon -----------------------------------------------
{
  const base = { origin: [0, 1, 0], direction: [0, 0, -1], muzzle: [0, 1, 0], hit: null };
  assert.equal(validateStrike({ activeId: null, ...base }), null, "no active weapon → null event");
  assert.equal(validateStrike({ activeId: undefined, ...base }), null, "undefined active weapon → null event");
  const e = validateStrike({ activeId: "w1", weaponRecipeId: 9, ...base });
  assert.ok(e && e.weaponId === "w1" && e.weaponRecipeId === 9 && e.hit === null, "active weapon + finite ray → miss event");
  ok("validateStrike gates on an active weapon (no weapon = no event)");
}

// --- 2. createStrikeEvent finite-guards every component (safety) --------------------------------
{
  const good = { weaponId: "w1", origin: [0, 1, 0], direction: [0, 0, -1], muzzle: [0, 1, 0] };
  assert.ok(createStrikeEvent({ ...good, hit: { targetId: "t", point: [1, 2, 3], normal: [0, 1, 0], distance: 4 } }), "clean hit event builds");
  assert.equal(createStrikeEvent({ ...good, origin: [NaN, 1, 0], hit: null }), null, "NaN origin → null");
  assert.equal(createStrikeEvent({ ...good, direction: [0, Infinity, -1], hit: null }), null, "Infinite direction → null");
  assert.equal(createStrikeEvent({ ...good, muzzle: [0, 1], hit: null }), null, "malformed muzzle → null");
  assert.equal(
    createStrikeEvent({ ...good, hit: { targetId: "t", point: [NaN, 0, 0], normal: [0, 1, 0], distance: 4 } }),
    null,
    "NaN hit point → whole event rejected"
  );
  assert.equal(
    createStrikeEvent({ ...good, hit: { targetId: "t", point: [1, 2, 3], normal: [0, 1, 0], distance: NaN } }),
    null,
    "NaN hit distance → whole event rejected"
  );
  assert.equal(
    createStrikeEvent({ ...good, hit: { targetId: "", point: [1, 2, 3], normal: [0, 1, 0], distance: 4 } }),
    null,
    "empty targetId → rejected"
  );
  ok("createStrikeEvent rejects non-finite origin/direction/muzzle/hit (safety)");
}

// --- 3. CombatRuntime fires a real hitscan ray at a registered target ---------------------------
{
  const { combat, input } = makeRuntime({ activeId: "wpn-1", entrySeed: 1234, aim: aimStub(0, 1.6, 0, 0, 0, -1) });
  assert.equal(combat.canFire, true, "active rightHand weapon → canFire");
  input.press(USE_WEAPON_INPUT);
  combat.update(1 / 60);
  const e = combat.lastEvent;
  assert.ok(e, "strike produced an event");
  assert.equal(e.weaponId, "wpn-1", "event carries the active weapon id");
  assert.equal(e.weaponRecipeId, 1234, "event carries the recipe identity (seed)");
  assert.ok(e.hit, "ray hit the dummy");
  assert.equal(e.hit.targetId, "dummy-1", "hit targets the dummy by its object id");
  assert.ok(isFiniteVec3(e.hit.point) && isFiniteVec3(e.hit.normal), "hit point + normal are finite");
  assert.ok(isFiniteVec3(e.origin) && isFiniteVec3(e.direction) && isFiniteVec3(e.muzzle), "ray origin/dir/muzzle finite");
  // The muzzle is READ from the equipped weapon's marker (group at identity → world == the marker),
  // NOT the eye-origin fallback [0,1.6,0]. This fails if _muzzleWorld silently regresses to the eye.
  assert.deepEqual(e.muzzle, [0.5, 1.4, -0.2], "muzzle reads the equipped weapon's marker (not the eye fallback)");
  assert.notDeepEqual(e.muzzle, e.origin, "muzzle is distinct from the eye origin");
  assert.ok(e.hit.distance > 0 && e.hit.distance < MAX_RANGE, "hit distance within range");
  assert.equal(combat.snapshot().targets[0].hitCount, 1, "the target recorded exactly one hit");
  assert.equal(combat.feedback.activeMarks, 1, "an impact feedback mark spawned");
  ok("CombatRuntime casts a real hitscan ray + records the strike");
}

// --- 4. determinism: same input/state → identical event summary --------------------------------
{
  const a = makeRuntime({ activeId: "wpn-1", entrySeed: 42, aim: aimStub(0, 1.6, 0, 0, 0, -1) });
  a.input.press(USE_WEAPON_INPUT);
  a.combat.update(1 / 60);
  const b = makeRuntime({ activeId: "wpn-1", entrySeed: 42, aim: aimStub(0, 1.6, 0, 0, 0, -1) });
  b.input.press(USE_WEAPON_INPUT);
  b.combat.update(1 / 60);
  assert.deepEqual(a.combat.lastEvent, b.combat.lastEvent, "identical state → identical StrikeEvent (no wall-clock / no RNG)");
  ok("StrikeEvent summaries are deterministic under fixed input/state");
}

// --- 5. holstered weapon blocked via the real activeId contract --------------------------------
{
  // The real engine: activeId is the rightHand occupant only. A weapon in back / hip is holstered.
  const eq = new WeaponEquipRuntime({ getEntry: () => null }, { scene: null });
  assert.equal(eq.activeId, null, "empty occupancy → no active weapon");
  eq._bySlot.back = "held-1";
  eq._bySlot.hip = "held-2";
  assert.equal(eq.activeId, null, "weapons in back + hip only → still no active weapon (holstered)");
  eq._bySlot.rightHand = "drawn-1";
  assert.equal(eq.activeId, "drawn-1", "rightHand occupant → active");

  // Integration: a CombatRuntime over an equip runtime with nothing drawn produces no event.
  const { combat, input } = makeRuntime({ activeId: null, aim: aimStub(0, 1.6, 0, 0, 0, -1) });
  assert.equal(combat.canFire, false, "no drawn weapon → cannot fire");
  input.press(USE_WEAPON_INPUT);
  combat.update(1 / 60);
  assert.equal(combat.lastEvent, null, "holstered/empty → no combat event");
  assert.equal(combat.snapshot().targets[0].hitCount, 0, "the dummy was never struck");
  ok("holstered (back/hip) weapon cannot fire — activeId contract is rightHand-only");
}

// --- 6. a miss leaves the target untouched -----------------------------------------------------
{
  const { combat, input } = makeRuntime({ activeId: "wpn-1", aim: aimStub(0, 1.6, 0, 0, 0, 1) }); // aim +z, away
  input.press(USE_WEAPON_INPUT);
  combat.update(1 / 60);
  assert.ok(combat.lastEvent, "a use with an active weapon still emits a strike event");
  assert.equal(combat.lastEvent.hit, null, "aiming away → miss (hit is null)");
  assert.equal(combat.snapshot().targets[0].hitCount, 0, "a miss never increments the target");
  ok("a miss emits a strike with no hit + leaves the target untouched");
}

// --- 7. CombatTarget is inert; CombatFeedback fades + disposes (no leak) ------------------------
{
  const target = new CombatTarget("t1", new THREE.Object3D());
  target.registerHit({ point: [1, 2, 3], normal: [0, 1, 0], weaponId: "w" });
  target.registerHit({ point: [4, 5, 6], normal: [0, 1, 0], weaponId: "w" });
  assert.equal(target.hitCount, 2, "repeated hits increment the count");
  assert.deepEqual(target.lastHit.point, [4, 5, 6], "lastHit reflects the most recent strike");
  assert.ok(target.object3D, "inert: the target object is never removed");

  const scene = new THREE.Scene();
  const fb = new CombatFeedback(scene);
  fb.spawn([0, 0, 0]);
  fb.spawn([1, 1, 1]);
  assert.equal(fb.activeMarks, 2, "two marks spawned");
  assert.equal(scene.children.length, 2, "marks were added to the scene");
  fb.spawn([NaN, 0, 0]);
  assert.equal(fb.activeMarks, 2, "a non-finite impact point is ignored");
  // A non-finite tick is a no-op: it must never write NaN to a mesh nor pin a mark (it would never
  // retire since NaN >= 1 is false). The marks stay finite + still retire on a later finite tick.
  fb.update(NaN);
  assert.equal(fb.activeMarks, 2, "a non-finite dt is ignored (no mark pinned)");
  assert.ok(Number.isFinite(fb._marks[0].mesh.scale.x) && Number.isFinite(fb._marks[0].mesh.material.opacity), "a non-finite dt wrote no NaN to the mesh");
  fb.update(1); // > LIFETIME → all marks retire
  assert.equal(fb.activeMarks, 0, "marks fade out + retire");
  assert.equal(scene.children.length, 0, "retired marks are removed from the scene");
  fb.spawn([2, 2, 2]);
  fb.clear();
  assert.equal(fb.activeMarks, 0, "clear() removes all marks");
  fb.clear(); // idempotent
  assert.equal(fb.activeMarks, 0, "clear() is idempotent (no leak on reload)");
  ok("CombatTarget is inert; CombatFeedback fades, disposes, and clear() is idempotent");
}

// --- 8. PlayerCameraController.aimRay is one shared aim basis (FP == TP) ------------------------
{
  const camera = new THREE.PerspectiveCamera();
  const player = { position: new THREE.Vector3(3, 0, 7), eyeHeight: 1.6, mesh: { visible: true } };
  const input = { wasPressed: () => false, consumeMouseDelta: () => ({ x: 0, y: 0 }) };
  const cc = new PlayerCameraController(camera, player, input);
  cc.yaw = 0.5;
  cc.pitch = -0.2;
  const o = new THREE.Vector3();
  const d = new THREE.Vector3();
  cc.mode = "first";
  cc.aimRay(o, d);
  assert.deepEqual([o.x, o.y, o.z], [3, 1.6, 7], "origin = player position + eyeHeight");
  assert.ok(Math.abs(d.length() - 1) < 1e-9, "aim direction is normalized");
  const fp = d.clone();
  cc.mode = "third";
  cc.aimRay(o, d);
  assert.ok(d.distanceTo(fp) < 1e-12, "first- and third-person share the SAME aim basis (yaw/pitch)");
  // matches lookDir: (-sin(yaw)cos(pitch), sin(pitch), -cos(yaw)cos(pitch))
  const cp = Math.cos(-0.2);
  assert.ok(Math.abs(d.x - -Math.sin(0.5) * cp) < 1e-9 && Math.abs(d.y - Math.sin(-0.2)) < 1e-9, "aim basis matches the camera look trig");
  ok("aimRay returns one shared, normalized aim basis for both camera modes");
}

// --- 9. isCombatTarget predicate ---------------------------------------------------------------
{
  const dummy = buildDummy("d", 0, 0, 0);
  assert.equal(isCombatTarget(dummy), true, "a combat_target_dummy primitive is a target");
  const other = createPlacedObject({
    id: "x",
    asset: { type: "primitive", kind: "cube", name: "Just a Cube", color: null },
    object3D: createPrimitiveMesh("cube"),
    position: [0, 0, 0],
  });
  assert.equal(isCombatTarget(other), false, "an ordinary primitive is not a target");
  assert.equal(isCombatTarget(null), false, "null is not a target");
  ok("isCombatTarget matches only the reserved combat_target_dummy name");
}

// --- 10. static scans: determinism + isolation -------------------------------------------------
{
  const dir = new URL("../src/world/combat/", import.meta.url);
  const files = ["CombatTypes.js", "CombatValidation.js", "CombatTarget.js", "CombatFeedback.js", "CombatRuntime.js"];
  const allowed = (p) => p === "three" || /^\.\/Combat[A-Za-z]+\.js$/.test(p);
  // Cover ALL three import forms: `from "x"`, side-effect `import "x"`, and dynamic `import("x")` —
  // so an arsenal import can't slip past the isolation gate through a non-`from` form.
  const importRe = /(?:from\s+["']([^"']+)["'])|(?:import\s+["']([^"']+)["'])|(?:import\s*\(\s*["']([^"']+)["']\s*\))/g;
  const extractImports = (src) => [...src.matchAll(importRe)].map((m) => m[1] || m[2] || m[3]);
  for (const f of files) {
    const src = fs.readFileSync(new URL(f, dir), "utf8");
    // No nondeterministic time/RNG source (incl. performance.now — the wall-clock class behind the prior flake).
    assert.equal(/Math\.random|Date\.now|new Date\(|performance\.now/.test(src), false, `${f}: no nondeterministic sources`);
    for (const p of extractImports(src)) {
      assert.ok(allowed(p), `${f}: import "${p}" stays within three + combat-internal`);
      assert.ok(!/arsenal|Workbench/i.test(p), `${f}: never imports an arsenal/workbench module`);
    }
  }
  // Negative controls: the matcher must extract the path from every import form (so it can't regress
  // to vacuously matching nothing on a future side-effect / dynamic arsenal import).
  assert.deepEqual(extractImports(`import "../arsenal/WeaponWorkbench.js";`), ["../arsenal/WeaponWorkbench.js"], "scan catches side-effect imports");
  assert.deepEqual(extractImports(`const m = await import("../arsenal/x.js");`), ["../arsenal/x.js"], "scan catches dynamic imports");
  // toVec3Array reads a THREE.Vector3-like or an array uniformly.
  assert.deepEqual(toVec3Array(new THREE.Vector3(1, 2, 3)), [1, 2, 3], "toVec3Array reads a Vector3");
  assert.deepEqual(toVec3Array([4, 5, 6]), [4, 5, 6], "toVec3Array reads an array");
  assert.equal(toVec3Array([4, 5, NaN]), null, "toVec3Array rejects non-finite");
  ok("combat modules have no nondeterministic sources / cross-layer imports");
}

console.log(`\ncombat regression: ${passed} checks passed`);
