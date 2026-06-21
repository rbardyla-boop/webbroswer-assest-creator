// test:enemy — pure-Node regression for Enemy-0, a reactive combat TARGET (consume the seam, not AI):
//   - normalizeEnemyDescriptor whitelists type/id/position/maxHealth/defeated (unknown keys drop;
//     a non-finite transform REJECTS the enemy rather than relocating it to the origin),
//   - sanitizeEnemiesBlock produces zero warnings on an empty/default block + caps the list,
//   - applyDamage/advanceState are pure, finite-guarded, deterministic transitions; defeat is latched,
//   - EnemyTargetAdapter duck-types CombatTarget so it is a drop-in for combatRuntime.targets,
//   - the enemy CONSUMES the real Combat-0 path: registerTarget → combat raycast → registerHit →
//     enemy health drops (no duplicate hit detection; CombatRuntime stays the authority),
//   - the new `enemies` doc block survives validation with the same whitelist discipline as objectives,
//   - the enemy modules have no nondeterministic sources / no cross-layer (combat/arsenal/objective) imports.
// The live equip → strike → defeat → reload-persists + 0-console-error path is the browser proof.

import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import {
  ENEMY_TYPE,
  ENEMY_STATE,
  MAX_ENEMIES,
  DEFAULT_MAX_HEALTH,
  HIT_DAMAGE,
  HIT_REACT_TIME,
  createEnemyState,
} from "../src/world/enemies/EnemyTypes.js";
import {
  normalizeEnemyDescriptor,
  sanitizeEnemiesBlock,
  applyDamage,
  advanceState,
  isDefeated,
} from "../src/world/enemies/EnemyValidation.js";
import { EnemyTargetAdapter } from "../src/world/enemies/EnemyTargetAdapter.js";
import { CombatRuntime } from "../src/world/combat/CombatRuntime.js";
import { createWorldDocument } from "../src/world/WorldDocument.js";
import { validateWorldDocument } from "../src/world/WorldValidation.js";

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

// A camera-controller stub exposing only aimRay (combat's single source of the aim basis).
function aimStub(ox, oy, oz, dx, dy, dz) {
  const dir = new THREE.Vector3(dx, dy, dz).normalize();
  return { aimRay: (o, d) => (o.set(ox, oy, oz), d.copy(dir), undefined) };
}
function inputStub() {
  const queued = new Set();
  return { press: (c) => queued.add(c), wasPressed: (c) => (queued.delete(c) ? true : false) };
}

// --- 1. normalizeEnemyDescriptor: whitelist + finite transform reject (no origin relocation) ----
{
  const clean = normalizeEnemyDescriptor({
    type: ENEMY_TYPE,
    id: "sentinel-1",
    position: { x: 3, y: 1.2, z: -8 },
    maxHealth: 3,
    defeated: false,
    hp: 9999, // unknown key — must be dropped
  });
  assert.ok(clean, "a valid sentinel descriptor normalizes");
  assert.deepEqual(Object.keys(clean).sort(), ["defeated", "id", "maxHealth", "position", "type"], "only whitelisted keys survive");
  assert.equal(clean.hp, undefined, "an unknown key is dropped");
  assert.equal(clean.defeated, false, "a falsey-but-meaningful boolean survives (always emitted)");

  assert.equal(normalizeEnemyDescriptor({ type: "dragon", id: "x", position: { x: 0, y: 0, z: 0 } }), null, "unknown type → drop");
  assert.equal(
    normalizeEnemyDescriptor({ type: ENEMY_TYPE, id: "x", position: { x: 0, y: NaN, z: 0 } }),
    null,
    "non-finite position REJECTS the enemy (never relocated to origin)"
  );
  assert.equal(normalizeEnemyDescriptor({ type: ENEMY_TYPE, id: "x", position: null }), null, "missing position → drop");
  assert.equal(normalizeEnemyDescriptor(null), null, "null → drop");

  const clamped = normalizeEnemyDescriptor({ type: ENEMY_TYPE, id: "y", position: { x: 0, y: 0, z: 0 }, maxHealth: 9999 });
  assert.ok(Number.isFinite(clamped.maxHealth) && clamped.maxHealth >= 1 && clamped.maxHealth <= 50, "maxHealth is clamped to a sane finite range");
  const defaulted = normalizeEnemyDescriptor({ type: ENEMY_TYPE, id: "z", position: { x: 0, y: 0, z: 0 }, maxHealth: "bad" });
  assert.equal(defaulted.maxHealth, DEFAULT_MAX_HEALTH, "a non-finite maxHealth falls back to the default");
  const trueDef = normalizeEnemyDescriptor({ type: ENEMY_TYPE, id: "d", position: { x: 0, y: 0, z: 0 }, defeated: true });
  assert.equal(trueDef.defeated, true, "defeated:true survives");
  ok("normalizeEnemyDescriptor whitelists keys + rejects non-finite transforms (no origin relocation)");
}

// --- 2. sanitizeEnemiesBlock: zero warnings on empty; caps the list -----------------------------
{
  let warnings = [];
  const empty = sanitizeEnemiesBlock(undefined, warnings);
  assert.deepEqual(empty, { version: 1, items: [] }, "an absent block → empty default");
  assert.equal(warnings.length, 0, "an empty/default block emits ZERO warnings");

  warnings = [];
  const defBlock = sanitizeEnemiesBlock({ version: 1, items: [] }, warnings);
  assert.deepEqual(defBlock.items, [], "an explicit empty block stays empty");
  assert.equal(warnings.length, 0, "an explicit empty block emits ZERO warnings");

  warnings = [];
  const many = { items: Array.from({ length: MAX_ENEMIES + 5 }, (_, i) => ({ type: ENEMY_TYPE, id: `e${i}`, position: { x: i, y: 0, z: 0 } })) };
  const capped = sanitizeEnemiesBlock(many, warnings);
  assert.equal(capped.items.length, MAX_ENEMIES, "the list is capped at MAX_ENEMIES");
  assert.ok(warnings.some((w) => /enem/i.test(w)), "over-cap emits a warning");

  const mixed = sanitizeEnemiesBlock({ items: [{ type: ENEMY_TYPE, id: "good", position: { x: 0, y: 0, z: 0 } }, { type: "bad" }, null] });
  assert.equal(mixed.items.length, 1, "invalid items are filtered out");
  ok("sanitizeEnemiesBlock is zero-warning on empty + caps/filters untrusted input");
}

// --- 3. applyDamage: finite, clamped, latched defeat -------------------------------------------
{
  let s = createEnemyState({ health: DEFAULT_MAX_HEALTH, maxHealth: DEFAULT_MAX_HEALTH });
  assert.equal(s.state, ENEMY_STATE.IDLE, "a fresh enemy starts IDLE");
  assert.equal(s.health, DEFAULT_MAX_HEALTH, "at full health");

  s = applyDamage(s, HIT_DAMAGE);
  assert.equal(s.health, DEFAULT_MAX_HEALTH - 1, "a strike decrements health");
  assert.equal(s.state, ENEMY_STATE.HIT_REACT, "a non-fatal strike → HIT_REACT");
  assert.ok(s.reactTimer > 0, "the react timer is armed");

  s = applyDamage(s, HIT_DAMAGE);
  s = applyDamage(s, HIT_DAMAGE);
  assert.equal(s.health, 0, "health clamps at 0");
  assert.equal(s.state, ENEMY_STATE.DEFEATED, "reaching 0 health → DEFEATED");
  assert.equal(isDefeated(s), true, "isDefeated reflects the terminal state");

  const after = applyDamage(s, HIT_DAMAGE);
  assert.deepEqual(after, s, "damaging a DEFEATED enemy is a no-op (latched, idempotent)");

  const big = applyDamage(createEnemyState({ health: 2, maxHealth: 3 }), 9999);
  assert.equal(big.health, 0, "overkill clamps health to 0 (never negative)");
  assert.equal(big.state, ENEMY_STATE.DEFEATED, "overkill → DEFEATED");

  const safe = applyDamage(createEnemyState({ health: 3, maxHealth: 3 }), NaN);
  assert.equal(safe.health, 3, "a non-finite damage amount does nothing (safety)");
  assert.equal(safe.state, ENEMY_STATE.IDLE, "a non-finite damage amount leaves the state unchanged");
  ok("applyDamage is finite-guarded, clamped, and latches defeat");
}

// --- 4. advanceState: HIT_REACT → IDLE; deterministic; safe dt ---------------------------------
{
  let s = applyDamage(createEnemyState({ health: 3, maxHealth: 3 }), HIT_DAMAGE);
  assert.equal(s.state, ENEMY_STATE.HIT_REACT, "struck → HIT_REACT");
  s = advanceState(s, HIT_REACT_TIME * 0.5);
  assert.equal(s.state, ENEMY_STATE.HIT_REACT, "mid-timer stays HIT_REACT");
  s = advanceState(s, HIT_REACT_TIME);
  assert.equal(s.state, ENEMY_STATE.IDLE, "after the react time elapses → IDLE");

  const defeated = applyDamage(createEnemyState({ health: 1, maxHealth: 1 }), HIT_DAMAGE);
  assert.equal(advanceState(defeated, 10).state, ENEMY_STATE.DEFEATED, "DEFEATED is terminal under advanceState");

  const idle = createEnemyState({ health: 3, maxHealth: 3 });
  assert.deepEqual(advanceState(idle, NaN), idle, "a non-finite dt is a no-op");
  assert.deepEqual(advanceState(idle, -1), idle, "a negative dt is a no-op");

  // Determinism: identical strike + tick sequence → identical state summary (no wall-clock / RNG).
  const run = () => {
    let x = createEnemyState({ health: 3, maxHealth: 3 });
    x = applyDamage(x, HIT_DAMAGE);
    x = advanceState(x, 0.1);
    x = applyDamage(x, HIT_DAMAGE);
    return x;
  };
  assert.deepEqual(run(), run(), "identical input → identical state (deterministic)");
  ok("advanceState ticks HIT_REACT → IDLE deterministically with safe dt handling");
}

// --- 5. EnemyTargetAdapter duck-types CombatTarget --------------------------------------------
{
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  const seen = [];
  const adapter = new EnemyTargetAdapter("e1", mesh, (hit) => seen.push(hit));
  assert.equal(adapter.id, "e1", "exposes id");
  assert.equal(adapter.object3D, mesh, "exposes object3D (the enemy mesh combat raycasts)");
  assert.equal(adapter.hitCount, 0, "starts with no hits");
  assert.equal(typeof adapter.registerHit, "function", "exposes registerHit (the CombatTarget surface)");

  adapter.registerHit({ point: [1, 2, 3], normal: [0, 1, 0], weaponId: "w" });
  assert.equal(adapter.hitCount, 1, "registerHit increments hitCount (snapshot-compatible)");
  assert.deepEqual(adapter.lastHit.point, [1, 2, 3], "registerHit stores a finite lastHit copy");
  assert.equal(seen.length, 1, "registerHit forwards the strike to onHit");
  assert.deepEqual(seen[0], { point: [1, 2, 3], normal: [0, 1, 0], weaponId: "w" }, "onHit receives the full strike");
  ok("EnemyTargetAdapter is a drop-in CombatTarget that forwards hits to the enemy");
}

// --- 6. CONSUMPTION: the enemy takes damage through the REAL combat hit path -------------------
{
  // No duplicate detection: register an enemy adapter into a real CombatRuntime, fire a real ray,
  // and assert the enemy lost health via combat's own registerHit dispatch. CombatRuntime remains
  // the authority for aim/raycast/StrikeEvent/dispatch; the enemy only consumes registerHit.
  const scene = new THREE.Scene();
  const enemyMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial());
  enemyMesh.position.set(0, 1.6, -5);
  enemyMesh.userData.objectId = "enemy-1"; // so _ownerId resolves to the registration key
  scene.add(enemyMesh);
  scene.updateMatrixWorld(true);

  let state = createEnemyState({ health: 3, maxHealth: 3 });
  const adapter = new EnemyTargetAdapter("enemy-1", enemyMesh, () => (state = applyDamage(state, HIT_DAMAGE)));

  const equipRuntime = { activeId: "wpn-1" };
  const placedRuntime = { getEntry: () => ({ weapon: { recipe: { seed: 5 } }, group: new THREE.Group() }) };
  const input = inputStub();
  const combat = new CombatRuntime({ equipRuntime, placedRuntime, cameraController: aimStub(0, 1.6, 0, 0, 0, -1), input });
  combat.load({ scene, objectManager: { objects: new Map() } }); // no authored dummies — only the enemy
  combat.registerTarget("enemy-1", adapter);

  assert.equal(combat.snapshot().targets.length, 1, "the registered enemy appears in the combat target set");
  assert.equal(combat.snapshot().targets[0].id, "enemy-1", "the target is the enemy");

  input.press("Mouse0");
  combat.update(1 / 60);
  assert.ok(combat.lastEvent?.hit, "combat produced a real StrikeEvent hit");
  assert.equal(combat.lastEvent.hit.targetId, "enemy-1", "the strike resolved to the enemy");
  assert.equal(state.health, 2, "the enemy lost health through combat's registerHit (no duplicate detection)");
  assert.equal(state.state, ENEMY_STATE.HIT_REACT, "the enemy reacted to the strike");

  // three more strikes → defeated + latched
  for (let i = 0; i < 3; i++) {
    input.press("Mouse0");
    combat.update(1 / 60);
  }
  assert.equal(state.health, 0, "repeated strikes drop the enemy to 0 health");
  assert.equal(state.state, ENEMY_STATE.DEFEATED, "repeated strikes DEFEAT the enemy");

  // unregister → the corpse leaves the combat target set, no longer hittable
  combat.unregisterTarget("enemy-1");
  assert.equal(combat.snapshot().targets.length, 0, "unregisterTarget removes the enemy from combat");
  const healthBefore = state.health;
  input.press("Mouse0");
  combat.update(1 / 60);
  assert.equal(combat.lastEvent.hit, null, "an unregistered enemy is no longer raycast (miss)");
  assert.equal(state.health, healthBefore, "an unregistered enemy takes no further hits");
  ok("the enemy consumes the real Combat-0 hit path via registerTarget + registerHit");
}

// --- 7. the `enemies` doc block follows the objectives/assets whitelist discipline -------------
{
  const def = createWorldDocument();
  assert.deepEqual(def.enemies, { version: 1, items: [] }, "a fresh document has an empty enemies block");

  // A default document validates with ZERO enemy warnings (an empty enemy world is silent).
  const { warnings } = validateWorldDocument(createWorldDocument());
  assert.equal(warnings.some((w) => /enem/i.test(w)), false, "an empty enemies block produces no validation warning");

  // A hostile block: unknown keys drop; a non-finite transform rejects that enemy; defeated survives.
  const hostile = createWorldDocument({
    enemies: {
      version: 1,
      items: [
        { type: ENEMY_TYPE, id: "keep", position: { x: 2, y: 1, z: -3 }, defeated: false, secret: "drop-me" },
        { type: ENEMY_TYPE, id: "bad", position: { x: 0, y: Infinity, z: 0 } },
        { type: "ghost", id: "wrong", position: { x: 0, y: 0, z: 0 } },
      ],
    },
  });
  const { document: safe } = validateWorldDocument(hostile);
  assert.equal(safe.enemies.items.length, 1, "only the valid enemy survives validation");
  assert.equal(safe.enemies.items[0].id, "keep", "the valid enemy is kept");
  assert.equal(safe.enemies.items[0].secret, undefined, "an unknown key was dropped");
  assert.equal(safe.enemies.items[0].defeated, false, "defeated:false survived save→load (whitelist)");

  // Round-trip a DEFEATED enemy: the terminal state persists.
  const downed = createWorldDocument({ enemies: { version: 1, items: [{ type: ENEMY_TYPE, id: "downed", position: { x: 0, y: 0, z: 0 }, defeated: true }] } });
  const { document: rt } = validateWorldDocument(downed);
  assert.equal(rt.enemies.items[0].defeated, true, "a defeated enemy persists its terminal state");
  ok("the enemies doc block whitelists keys, rejects bad transforms, and persists defeated");
}

// --- 8. static scans: determinism + isolation (enemy imports no combat/arsenal/objective) ------
{
  const dir = new URL("../src/world/enemies/", import.meta.url);
  const files = ["EnemyTypes.js", "EnemyValidation.js", "EnemyTargetAdapter.js", "EnemyFeedback.js", "EnemyRuntime.js", "PatrolTypes.js", "PatrolMotion.js", "EnemyProximityLogic.js"];
  // Enemy-1: the pure Patrol* value/motion modules are enemy-internal (same isolation bar as Enemy*).
  const allowed = (p) => p === "three" || /^\.\/(Enemy|Patrol)[A-Za-z]+\.js$/.test(p);
  const importRe = /(?:from\s+["']([^"']+)["'])|(?:import\s+["']([^"']+)["'])|(?:import\s*\(\s*["']([^"']+)["']\s*\))/g;
  const extractImports = (src) => [...src.matchAll(importRe)].map((m) => m[1] || m[2] || m[3]);
  for (const f of files) {
    const src = fs.readFileSync(new URL(f, dir), "utf8");
    // No nondeterministic time/RNG source (incl. performance.now — the wall-clock class behind a prior flake).
    assert.equal(/Math\.random|Date\.now|new Date\(|performance\.now/.test(src), false, `${f}: no nondeterministic sources`);
    for (const p of extractImports(src)) {
      assert.ok(allowed(p), `${f}: import "${p}" stays within three + enemy-internal`);
      assert.ok(!/combat|arsenal|objective|Workbench/i.test(p), `${f}: never imports a combat/arsenal/objective module (combatRuntime is injected)`);
    }
  }
  // Negative controls: the matcher extracts the path from every import form.
  assert.deepEqual(extractImports(`import "../combat/CombatRuntime.js";`), ["../combat/CombatRuntime.js"], "scan catches side-effect imports");
  assert.deepEqual(extractImports(`const m = await import("../arsenal/x.js");`), ["../arsenal/x.js"], "scan catches dynamic imports");
  ok("enemy modules have no nondeterministic sources / cross-layer imports (combatRuntime injected)");
}

console.log(`\nenemy regression: ${passed} checks passed`);
