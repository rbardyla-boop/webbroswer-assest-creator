// test:encounter-editor — pure-Node regression for Encounter Editor-0 (orchestrate the seams, not a new
// system). An "encounter" is an AUTHORED combat beat that, in play, projects ONE ephemeral Enemy-0 the
// player defeats via Combat-0. This proves the authoring + persistence + completion CONTRACT:
//   - normalizeEncounterDescriptor whitelists type/id/position/radius/enemyType/enemyCount/completed/
//     persistCompletion (unknown keys drop; a non-finite position REJECTS the encounter — no origin
//     relocation; an enemyType outside the Enemy-0 allow-list REJECTS it; enemyCount clamps to exactly 1),
//   - sanitizeEncountersBlock is zero-warning on an empty block + caps/filters untrusted input,
//   - EncounterStore add/replace/remove over the document's `encounters.items`,
//   - allDefeated is non-vacuous (empty → false; one alive → false; all down → true),
//   - the `encounters` doc block survives validation with completed/persistCompletion preserved,
//   - LOAD-BEARING: EnemyRuntime.spawnEphemeral registers a REAL combat target yet never touches
//     `document.enemies.items` (no baked enemy), snapshot() omits it, removeEphemeral tears down ONLY
//     ephemerals (a baked enemy is protected),
//   - the encounter modules have no nondeterministic sources / no combat/arsenal/objective imports.
// The author-in-editor → defeat → complete → reload-persists + 0-console-error path is the browser proof.

import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import {
  ENCOUNTER_TYPE,
  MAX_ENCOUNTERS,
  DEFAULT_RADIUS,
  RADIUS_MAX,
  normalizeEncounterDescriptor,
} from "../src/world/encounters/EncounterTypes.js";
import { sanitizeEncountersBlock } from "../src/world/encounters/EncounterValidation.js";
import { EncounterStore } from "../src/world/encounters/EncounterPersistence.js";
import { allDefeated } from "../src/world/encounters/EncounterCompletion.js";
import { ENEMY_TYPE, createEnemyState } from "../src/world/enemies/EnemyTypes.js";
import { applyDamage } from "../src/world/enemies/EnemyValidation.js";
import { EnemyRuntime } from "../src/world/enemies/EnemyRuntime.js";
import { CombatRuntime } from "../src/world/combat/CombatRuntime.js";
import { createWorldDocument } from "../src/world/WorldDocument.js";
import { validateWorldDocument } from "../src/world/WorldValidation.js";

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

function aimStub(ox, oy, oz, dx, dy, dz) {
  const dir = new THREE.Vector3(dx, dy, dz).normalize();
  return { aimRay: (o, d) => (o.set(ox, oy, oz), d.copy(dir), undefined) };
}
function inputStub() {
  const queued = new Set();
  return { press: (c) => queued.add(c), wasPressed: (c) => (queued.delete(c) ? true : false) };
}

// --- 1. normalizeEncounterDescriptor: whitelist + finite/allow-list reject ----------------------
{
  const clean = normalizeEncounterDescriptor({
    type: ENCOUNTER_TYPE,
    id: "beat-1",
    position: { x: 4, y: 1, z: -6 },
    radius: 8,
    enemyType: ENEMY_TYPE,
    enemyCount: 1,
    completed: false,
    persistCompletion: true,
    waves: 9, // unknown key — must be dropped
  });
  assert.ok(clean, "a valid beat descriptor normalizes");
  assert.deepEqual(
    Object.keys(clean).sort(),
    // Content-1 added `label` (an optional presentation noun); Enemy-1 added `patrol` (object|null).
    ["completed", "enemyCount", "enemyType", "id", "label", "patrol", "persistCompletion", "position", "radius", "type"],
    "only whitelisted keys survive"
  );
  assert.equal(clean.waves, undefined, "an unknown key is dropped");
  assert.equal(clean.patrol, null, "a beat without a patrol emits patrol:null (always-emit key, stationary)");
  assert.equal(clean.completed, false, "completed:false survives (always emitted)");
  assert.equal(clean.persistCompletion, true, "persistCompletion:true survives");
  assert.equal(clean.label, null, "absent label → null (always emitted; banner falls back to a neutral noun)");

  // Content-1: the optional banner label is sanitized (markup stripped, capped) + always emitted.
  const labelled = normalizeEncounterDescriptor({ type: ENCOUNTER_TYPE, id: "l", position: { x: 0, y: 0, z: 0 }, enemyType: ENEMY_TYPE, label: "the pass" });
  assert.equal(labelled.label, "the pass", "an authored label survives normalization");
  const dirty = normalizeEncounterDescriptor({ type: ENCOUNTER_TYPE, id: "l2", position: { x: 0, y: 0, z: 0 }, enemyType: ENEMY_TYPE, label: "a<b>c" });
  assert.equal(dirty.label, "abc", "label markup angle-brackets are stripped (defense in depth)");
  const longLabel = normalizeEncounterDescriptor({ type: ENCOUNTER_TYPE, id: "l3", position: { x: 0, y: 0, z: 0 }, enemyType: ENEMY_TYPE, label: "x".repeat(120) });
  assert.ok(longLabel.label.length <= 48, "an over-long label is capped");

  // Booleans default correctly + survive when falsey.
  const def = normalizeEncounterDescriptor({ type: ENCOUNTER_TYPE, id: "d", position: { x: 0, y: 0, z: 0 }, enemyType: ENEMY_TYPE });
  assert.equal(def.completed, false, "absent completed defaults to false");
  assert.equal(def.persistCompletion, true, "absent persistCompletion defaults to true");
  assert.equal(def.radius, DEFAULT_RADIUS, "absent radius defaults");
  const replay = normalizeEncounterDescriptor({ type: ENCOUNTER_TYPE, id: "r", position: { x: 0, y: 0, z: 0 }, enemyType: ENEMY_TYPE, persistCompletion: false });
  assert.equal(replay.persistCompletion, false, "persistCompletion:false survives (replayable beat)");

  // Rejections.
  assert.equal(normalizeEncounterDescriptor({ type: "raid", id: "x", position: { x: 0, y: 0, z: 0 }, enemyType: ENEMY_TYPE }), null, "unknown encounter type → drop");
  assert.equal(normalizeEncounterDescriptor({ type: ENCOUNTER_TYPE, id: "x", position: { x: 0, y: NaN, z: 0 }, enemyType: ENEMY_TYPE }), null, "non-finite position REJECTS (never relocated to origin)");
  assert.equal(normalizeEncounterDescriptor({ type: ENCOUNTER_TYPE, id: "x", position: null, enemyType: ENEMY_TYPE }), null, "missing position → drop");
  assert.equal(normalizeEncounterDescriptor({ type: ENCOUNTER_TYPE, id: "x", position: { x: 0, y: 0, z: 0 }, enemyType: "dragon" }), null, "unspawnable enemyType → drop");
  assert.equal(normalizeEncounterDescriptor({ type: ENCOUNTER_TYPE, id: "x", position: { x: 0, y: 0, z: 0 } }), null, "absent enemyType → drop");
  assert.equal(normalizeEncounterDescriptor(null), null, "null → drop");

  // Clamps.
  assert.equal(normalizeEncounterDescriptor({ type: ENCOUNTER_TYPE, id: "x", position: { x: 0, y: 0, z: 0 }, enemyType: ENEMY_TYPE, radius: 9999 }).radius, RADIUS_MAX, "radius clamps to the max");
  assert.equal(normalizeEncounterDescriptor({ type: ENCOUNTER_TYPE, id: "x", position: { x: 0, y: 0, z: 0 }, enemyType: ENEMY_TYPE, radius: 0 }).radius >= 1, true, "radius clamps to the min");
  assert.equal(normalizeEncounterDescriptor({ type: ENCOUNTER_TYPE, id: "x", position: { x: 0, y: 0, z: 0 }, enemyType: ENEMY_TYPE, enemyCount: 5 }).enemyCount, 1, "enemyCount clamps to EXACTLY 1 (no waves)");
  assert.equal(normalizeEncounterDescriptor({ type: ENCOUNTER_TYPE, id: "x", position: { x: 0, y: 0, z: 0 }, enemyType: ENEMY_TYPE, enemyCount: 0 }).enemyCount, 1, "enemyCount of 0 still clamps to 1");
  ok("normalizeEncounterDescriptor whitelists keys, rejects bad transforms/enemy types, clamps radius + count");
}

// --- 2. sanitizeEncountersBlock: zero warnings on empty; caps + filters --------------------------
{
  let warnings = [];
  assert.deepEqual(sanitizeEncountersBlock(undefined, warnings), { version: 1, items: [] }, "an absent block → empty default");
  assert.equal(warnings.length, 0, "an empty/default block emits ZERO warnings");

  warnings = [];
  const many = { items: Array.from({ length: MAX_ENCOUNTERS + 5 }, (_, i) => ({ type: ENCOUNTER_TYPE, id: `e${i}`, position: { x: i, y: 0, z: 0 }, enemyType: ENEMY_TYPE })) };
  const capped = sanitizeEncountersBlock(many, warnings);
  assert.equal(capped.items.length, MAX_ENCOUNTERS, "the list is capped at MAX_ENCOUNTERS");
  assert.ok(warnings.some((w) => /encounter/i.test(w)), "over-cap emits a warning");

  const mixed = sanitizeEncountersBlock({ items: [{ type: ENCOUNTER_TYPE, id: "good", position: { x: 0, y: 0, z: 0 }, enemyType: ENEMY_TYPE }, { type: "bad" }, null] });
  assert.equal(mixed.items.length, 1, "invalid items are filtered out");
  ok("sanitizeEncountersBlock is zero-warning on empty + caps/filters untrusted input");
}

// --- 3. EncounterStore: add / replace / remove --------------------------------------------------
{
  const doc = createWorldDocument();
  const store = new EncounterStore(doc);
  assert.deepEqual(store.list(), [], "a fresh document has no encounters");

  const a = store.add({ type: ENCOUNTER_TYPE, id: "a", position: { x: 1, y: 0, z: 2 }, enemyType: ENEMY_TYPE });
  assert.ok(a, "add returns the normalized descriptor");
  assert.equal(store.list().length, 1, "the encounter is appended");

  const replaced = store.add({ type: ENCOUNTER_TYPE, id: "a", position: { x: 9, y: 0, z: 9 }, enemyType: ENEMY_TYPE, radius: 12 });
  assert.equal(store.list().length, 1, "re-adding the same id replaces in place (no duplicate)");
  assert.equal(replaced.radius, 12, "the replacement descriptor wins");

  assert.equal(store.add({ type: "bad" }), null, "an invalid descriptor is rejected by the store");
  assert.equal(store.remove("a"), true, "remove deletes by id");
  assert.equal(store.list().length, 0, "the list is empty after removal");
  assert.equal(store.remove("missing"), false, "removing an absent id is a no-op");
  ok("EncounterStore appends, replaces by id, and removes encounters");
}

// --- 4. allDefeated: non-vacuous completion rule ------------------------------------------------
{
  const idle = createEnemyState({ health: 3, maxHealth: 3 });
  let down = createEnemyState({ health: 1, maxHealth: 1 });
  down = applyDamage(down, 1); // → defeated

  assert.equal(allDefeated([]), false, "an EMPTY actor set is NOT complete (vacuous guard)");
  assert.equal(allDefeated([idle]), false, "a living enemy → not complete");
  assert.equal(allDefeated([down, idle]), false, "one alive among the down → not complete");
  assert.equal(allDefeated([down]), true, "every enemy down → complete");
  ok("allDefeated requires at least one actor and every actor defeated (non-vacuous)");
}

// --- 5. the `encounters` doc block follows the whitelist discipline -----------------------------
{
  const def = createWorldDocument();
  assert.deepEqual(def.encounters, { version: 1, items: [] }, "a fresh document has an empty encounters block");

  const { warnings } = validateWorldDocument(createWorldDocument());
  assert.equal(warnings.some((w) => /encounter/i.test(w)), false, "an empty encounters block produces no validation warning");

  const hostile = createWorldDocument({
    encounters: {
      version: 1,
      items: [
        { type: ENCOUNTER_TYPE, id: "keep", position: { x: 2, y: 1, z: -3 }, enemyType: ENEMY_TYPE, completed: false, persistCompletion: false, secret: "drop-me" },
        { type: ENCOUNTER_TYPE, id: "bad", position: { x: 0, y: Infinity, z: 0 }, enemyType: ENEMY_TYPE },
        { type: "raid", id: "wrong", position: { x: 0, y: 0, z: 0 }, enemyType: ENEMY_TYPE },
      ],
    },
  });
  const { document: safe } = validateWorldDocument(hostile);
  assert.equal(safe.encounters.items.length, 1, "only the valid encounter survives validation");
  assert.equal(safe.encounters.items[0].id, "keep", "the valid encounter is kept");
  assert.equal(safe.encounters.items[0].secret, undefined, "an unknown key was dropped");
  assert.equal(safe.encounters.items[0].completed, false, "completed:false survived save→load (whitelist)");
  assert.equal(safe.encounters.items[0].persistCompletion, false, "persistCompletion:false survived save→load (whitelist)");

  const done = createWorldDocument({ encounters: { version: 1, items: [{ type: ENCOUNTER_TYPE, id: "done", position: { x: 0, y: 0, z: 0 }, enemyType: ENEMY_TYPE, completed: true }] } });
  const { document: rt } = validateWorldDocument(done);
  assert.equal(rt.encounters.items[0].completed, true, "a completed encounter persists its cleared state");
  ok("the encounters doc block whitelists keys, rejects bad descriptors, and persists completed/persistCompletion");
}

// --- 6. LOAD-BEARING: spawnEphemeral registers a real combat target WITHOUT baking an enemy -----
{
  const scene = new THREE.Scene();
  const equipRuntime = { activeId: "wpn-1" };
  const placedRuntime = { getEntry: () => ({ weapon: { recipe: { seed: 5 } }, group: new THREE.Group() }) };
  const input = inputStub();
  const combat = new CombatRuntime({ equipRuntime, placedRuntime, cameraController: aimStub(0, 1.6, 0, 0, 0, -1), input });
  combat.load({ scene, objectManager: { objects: new Map() } });

  const enemyRuntime = new EnemyRuntime({ scene, combatRuntime: combat });

  // A doc with a BAKED enemy + an empty encounters block — the document the ephemeral must never touch.
  const document = createWorldDocument({
    enemies: { version: 1, items: [{ type: ENEMY_TYPE, id: "baked-1", position: { x: 20, y: 0, z: 0 }, maxHealth: 3, defeated: false }] },
  });
  enemyRuntime.load({ scene, document, groundHeight: null });
  assert.equal(enemyRuntime.snapshot().enemies.length, 1, "the baked enemy is present");
  const bakedItemCount = document.enemies.items.length;
  assert.equal(bakedItemCount, 1, "the document has exactly the one baked enemy");

  // Project an ephemeral enemy (what an encounter does).
  const actor = enemyRuntime.spawnEphemeral({ type: ENEMY_TYPE, id: "enc:beat-1:0", position: { x: 0, y: 1.6, z: -5 }, maxHealth: 3, defeated: false }, null);
  assert.ok(actor && actor.ephemeral === true, "spawnEphemeral returns an actor flagged ephemeral");
  actor.group.userData.objectId = "enc:beat-1:0"; // (set inside _spawn already; defensive in case of refactor)

  // It registered as a REAL combat target...
  assert.ok(combat.snapshot().targets.some((t) => t.id === "enc:beat-1:0"), "the ephemeral registered as a combat target (consumes the seam)");
  // ...but it is NOT in the document, and the baked-enemy view is unchanged.
  assert.equal(document.enemies.items.length, bakedItemCount, "spawnEphemeral did NOT push to document.enemies.items (no baked enemy)");
  assert.ok(!document.enemies.items.some((e) => e.id === "enc:beat-1:0"), "the ephemeral is absent from the document");
  // snapshot() still reports ONLY the baked enemy (ephemerals are the encounter's to report).
  const snap = enemyRuntime.snapshot();
  assert.equal(snap.enemies.length, 1, "snapshot() omits the ephemeral (byte-stable enemy view)");
  assert.equal(snap.enemies[0].id, "baked-1", "snapshot() reports the baked enemy only");

  // removeEphemeral tears down ONLY the ephemeral; the baked enemy is protected.
  assert.equal(enemyRuntime.removeEphemeral("baked-1"), false, "removeEphemeral refuses a baked (non-ephemeral) enemy");
  assert.equal(enemyRuntime.snapshot().enemies.length, 1, "the baked enemy is still present after the refused removal");
  assert.equal(enemyRuntime.removeEphemeral("enc:beat-1:0"), true, "removeEphemeral tears down the ephemeral");
  assert.ok(!combat.snapshot().targets.some((t) => t.id === "enc:beat-1:0"), "the ephemeral's combat target was unregistered");
  assert.equal(enemyRuntime.removeEphemeral("enc:beat-1:0"), false, "removeEphemeral is idempotent (already gone)");
  ok("spawnEphemeral registers a real combat target yet never bakes an enemy; removeEphemeral protects baked enemies");
}

// --- 7. static scans: determinism + isolation (encounters import no combat/arsenal/objective) ---
{
  const dir = new URL("../src/world/encounters/", import.meta.url);
  const files = ["EncounterTypes.js", "EncounterValidation.js", "EncounterPersistence.js", "EncounterCompletion.js", "EncounterMarkers.js", "EncounterRuntime.js"];
  const allowed = (p) =>
    p === "three" ||
    /^\.\/Encounter[A-Za-z]+\.js$/.test(p) ||
    p === "../enemies/EnemyTypes.js" ||
    p === "../enemies/EnemyValidation.js" ||
    // Enemy-1: PatrolTypes is a PURE enemy value/validation module (normalize + terrain-safe resolve),
    // the same kind of cross-layer value import as EnemyTypes — never the THREE-bound enemy runtime.
    p === "../enemies/PatrolTypes.js";
  const importRe = /(?:from\s+["']([^"']+)["'])|(?:import\s+["']([^"']+)["'])|(?:import\s*\(\s*["']([^"']+)["']\s*\))/g;
  const extractImports = (src) => [...src.matchAll(importRe)].map((m) => m[1] || m[2] || m[3]);
  for (const f of files) {
    const src = fs.readFileSync(new URL(f, dir), "utf8");
    assert.equal(/Math\.random|Date\.now|new Date\(|performance\.now/.test(src), false, `${f}: no nondeterministic sources`);
    for (const p of extractImports(src)) {
      assert.ok(allowed(p), `${f}: import "${p}" stays within three + encounter-internal + pure enemy value modules`);
      // Combat is INJECTED through the enemy runtime (never imported); arsenal/objective are other domains.
      assert.ok(!/combat|arsenal|objective|Workbench|EnemyRuntime|EnemyFeedback|EnemyTargetAdapter/i.test(p), `${f}: never imports a combat/arsenal/objective module or the THREE-bound enemy runtime`);
    }
  }
  ok("encounter modules have no nondeterministic sources / cross-layer imports (enemyRuntime injected)");
}

console.log(`\nencounter-editor regression: ${passed} checks passed`);
