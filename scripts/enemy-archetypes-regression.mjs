// test:enemy-archetypes — pure-Node regression for Enemy-2, a SECOND enemy archetype (`frost_wisp`)
// beside the original `glacial_sentinel`. The two share the FSM, the Combat-0 hit path, and the
// encounter projection; they differ only in DATA (health / movement / silhouette / feedback) owned by
// ENEMY_ARCHETYPES. This proves:
//   - the archetype registry exposes both types, resolves descriptors, and defaults health per type,
//   - the SENTINEL stays byte-identical (its feedback equals the legacy EnemyFeedback constants exactly),
//   - validation accepts a wisp (enemy + encounter), defaults its health lighter, and round-trips defeat,
//   - the movement profiles are distinct (sentinel ground / wisp bounded hover),
//   - the dedicated Enemy Archetype Lab scene is registered, valid (zero new warnings), and stages BOTH
//     archetypes as two independent beats.
// The live "same weapon defeats both, independently, persists across reload" path is the browser proof.

import assert from "node:assert/strict";
import {
  ENEMY_TYPE,
  SENTINEL_TYPE,
  WISP_TYPE,
  ENEMY_TYPES,
  ENEMY_ARCHETYPES,
  DEFAULT_MAX_HEALTH,
  MOVEMENT_GROUND,
  MOVEMENT_HOVER,
  archetypeFor,
  defaultMaxHealthFor,
} from "../src/world/enemies/EnemyTypes.js";
import { normalizeEnemyDescriptor } from "../src/world/enemies/EnemyValidation.js";
import { ENCOUNTER_TYPE, normalizeEncounterDescriptor } from "../src/world/encounters/EncounterTypes.js";
import { createWorldDocument } from "../src/world/WorldDocument.js";
import { validateWorldDocument } from "../src/world/WorldValidation.js";
import { getSampleWorld, listSampleWorlds } from "../src/world/samples/index.js";
import { buildEnemyArchetypeLab, ENEMY_ARCHETYPE_LAB_ID } from "../src/world/samples/enemyArchetypeLab.js";

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

// --- 1. the archetype registry exposes both types + resolves descriptors + per-type health ------
{
  assert.deepEqual([...ENEMY_TYPES].sort(), ["frost_wisp", "glacial_sentinel"], "the allow-list carries both archetypes");
  assert.equal(ENEMY_TYPES[0], SENTINEL_TYPE, "the sentinel stays first (order stable)");
  assert.equal(SENTINEL_TYPE, ENEMY_TYPE, "SENTINEL_TYPE aliases the original ENEMY_TYPE");
  assert.equal(WISP_TYPE, "frost_wisp", "the wisp type id is frost_wisp");

  assert.equal(archetypeFor(SENTINEL_TYPE).type, SENTINEL_TYPE, "archetypeFor resolves the sentinel");
  assert.equal(archetypeFor(WISP_TYPE).type, WISP_TYPE, "archetypeFor resolves the wisp");
  assert.equal(archetypeFor("does-not-exist").type, SENTINEL_TYPE, "an unknown type falls back to the sentinel");

  assert.equal(defaultMaxHealthFor(SENTINEL_TYPE), DEFAULT_MAX_HEALTH, "sentinel default health == DEFAULT_MAX_HEALTH (3)");
  assert.equal(defaultMaxHealthFor(WISP_TYPE), 2, "wisp default health is 2");
  assert.ok(defaultMaxHealthFor(WISP_TYPE) < defaultMaxHealthFor(SENTINEL_TYPE), "the wisp is LIGHTER than the sentinel");

  // Every archetype is deeply frozen + carries the required fields.
  for (const type of ENEMY_TYPES) {
    const a = ENEMY_ARCHETYPES[type];
    assert.ok(Object.isFrozen(a) && Object.isFrozen(a.feedback), `${type} archetype + feedback are frozen`);
    assert.equal(a.type, type, `${type} archetype.type matches its key`);
    assert.ok(Number.isFinite(a.maxHealth) && a.maxHealth >= 1, `${type} has a finite positive maxHealth`);
    assert.ok([MOVEMENT_GROUND, MOVEMENT_HOVER].includes(a.movement), `${type} has a known movement profile`);
    assert.equal(typeof a.silhouette, "string", `${type} names a silhouette`);
  }
  ok("archetype registry exposes both types, resolves descriptors, and defaults health per type");
}

// --- 2. SENTINEL byte-stability: its feedback equals the legacy EnemyFeedback constants exactly --
{
  const fb = archetypeFor(SENTINEL_TYPE).feedback;
  assert.equal(fb.baseEmissive, 0.25, "sentinel base emissive == legacy BASE_EMISSIVE_INTENSITY");
  assert.equal(fb.flashIntensity, 1.5, "sentinel flash == legacy FLASH_INTENSITY");
  assert.equal(fb.defeatColor, 0x39424d, "sentinel defeat colour == legacy DEFEAT_COLOR");
  assert.equal(fb.defeatEmissive, 0.12, "sentinel defeat emissive == legacy DEFEAT_EMISSIVE_INTENSITY");
  assert.equal(fb.flickerAmp, 0, "sentinel has NO idle flicker (byte-stable idle emissive)");

  // The wisp's feedback is genuinely different (it must FEEL different).
  const wfb = archetypeFor(WISP_TYPE).feedback;
  assert.ok(wfb.baseEmissive > fb.baseEmissive, "the wisp glows brighter at rest");
  assert.ok(wfb.flashIntensity !== fb.flashIntensity, "the wisp's strike burst differs");
  assert.ok(wfb.flickerAmp > 0, "the wisp has an idle flicker (the sentinel does not)");
  assert.notEqual(wfb.defeatColor, fb.defeatColor, "the wisp's defeated look differs from the sentinel's");
  ok("the sentinel feedback equals the legacy constants exactly; the wisp differs deliberately");
}

// --- 3. normalizeEnemyDescriptor: a wisp validates + defaults lighter; defeat round-trips both ---
{
  const wisp = normalizeEnemyDescriptor({ type: WISP_TYPE, id: "w1", position: { x: 1, y: 2, z: 3 }, hp: 7 });
  assert.ok(wisp, "a frost_wisp descriptor normalizes (it is in the allow-list)");
  assert.equal(wisp.type, WISP_TYPE, "the type survives");
  assert.equal(wisp.maxHealth, 2, "an absent health defaults to the WISP archetype's value (2), not the sentinel's");
  assert.equal(wisp.hp, undefined, "an unknown key is still dropped (whitelist intact)");
  assert.deepEqual(Object.keys(wisp).sort(), ["defeated", "id", "maxHealth", "position", "type"], "the whitelist shape is unchanged");

  const sentinel = normalizeEnemyDescriptor({ type: SENTINEL_TYPE, id: "s1", position: { x: 0, y: 0, z: 0 } });
  assert.equal(sentinel.maxHealth, DEFAULT_MAX_HEALTH, "an absent sentinel health still defaults to 3 (byte-stable)");

  // Defeat bit round-trips for BOTH types (always-emitted boolean).
  for (const type of [SENTINEL_TYPE, WISP_TYPE]) {
    const down = normalizeEnemyDescriptor({ type, id: "d", position: { x: 0, y: 0, z: 0 }, defeated: true });
    assert.equal(down.defeated, true, `${type}: defeated:true survives`);
    const up = normalizeEnemyDescriptor({ type, id: "u", position: { x: 0, y: 0, z: 0 }, defeated: false });
    assert.equal(up.defeated, false, `${type}: defeated:false survives (always emitted)`);
  }
  ok("normalizeEnemyDescriptor accepts a wisp, defaults its health lighter, and round-trips defeat for both");
}

// --- 4. EncounterTypes: an encounter may NAME the wisp; unknown types still rejected -------------
{
  const wispBeat = normalizeEncounterDescriptor({ type: ENCOUNTER_TYPE, id: "wb", position: { x: 0, y: 0, z: 0 }, enemyType: WISP_TYPE });
  assert.ok(wispBeat, "an encounter naming frost_wisp validates");
  assert.equal(wispBeat.enemyType, WISP_TYPE, "the encounter's enemyType is the wisp");

  const sentinelBeat = normalizeEncounterDescriptor({ type: ENCOUNTER_TYPE, id: "sb", position: { x: 0, y: 0, z: 0 }, enemyType: SENTINEL_TYPE });
  assert.ok(sentinelBeat && sentinelBeat.enemyType === SENTINEL_TYPE, "a sentinel encounter still validates");

  assert.equal(
    normalizeEncounterDescriptor({ type: ENCOUNTER_TYPE, id: "x", position: { x: 0, y: 0, z: 0 }, enemyType: "dragon" }),
    null,
    "an enemyType outside the allow-list is still rejected"
  );
  ok("an encounter may name either archetype; an unspawnable enemyType is still rejected");
}

// --- 5. movement profiles are distinct (sentinel ground / wisp bounded hover) -------------------
{
  assert.equal(archetypeFor(SENTINEL_TYPE).movement, MOVEMENT_GROUND, "the sentinel is grounded");
  assert.equal(archetypeFor(WISP_TYPE).movement, MOVEMENT_HOVER, "the wisp hovers");
  assert.equal(archetypeFor(SENTINEL_TYPE).hover, undefined, "the sentinel has no hover spec");

  const hover = archetypeFor(WISP_TYPE).hover;
  assert.ok(hover && Object.isFrozen(hover), "the wisp carries a frozen hover spec");
  assert.ok(Number.isFinite(hover.radius) && hover.radius > 0, "the hover radius is finite + positive (bounded)");
  assert.ok(Number.isFinite(hover.height) && hover.height > 0, "the hover height is finite + positive (it floats)");
  assert.ok(Number.isFinite(hover.bobAmp) && Number.isFinite(hover.driftSpeed), "the hover bob/drift are finite");
  ok("the two archetypes have distinct movement profiles (ground vs bounded hover)");
}

// --- 6. the Enemy Archetype Lab scene: registered, valid, stages BOTH archetypes -----------------
{
  assert.ok(listSampleWorlds().some((s) => s.id === ENEMY_ARCHETYPE_LAB_ID), "the lab is in the sample-world list");
  assert.ok(getSampleWorld(ENEMY_ARCHETYPE_LAB_ID), "getSampleWorld returns the lab");

  const doc = buildEnemyArchetypeLab();
  // Validation: no NEW enemy/encounter warnings (the scene is clean, like every shipped sample).
  const { warnings, document: safe } = validateWorldDocument(doc);
  assert.equal(warnings.some((w) => /enem|encounter/i.test(w)), false, "the lab validates with no enemy/encounter warnings");

  const items = safe.encounters.items;
  assert.equal(items.length, 2, "exactly two beats (one per archetype)");
  const types = items.map((e) => e.enemyType).sort();
  assert.deepEqual(types, ["frost_wisp", "glacial_sentinel"], "one sentinel beat + one wisp beat");

  const sentinelBeat = items.find((e) => e.enemyType === SENTINEL_TYPE);
  const wispBeat = items.find((e) => e.enemyType === WISP_TYPE);
  const sp = [sentinelBeat.position.x, sentinelBeat.position.y, sentinelBeat.position.z];
  const wp = [wispBeat.position.x, wispBeat.position.y, wispBeat.position.z];
  assert.ok(sp.every(Number.isFinite) && wp.every(Number.isFinite), "both beats are grounded at finite positions");
  assert.ok(dist2(sp, wp) >= 6, `the two beats are staged apart (${dist2(sp, wp).toFixed(1)}m) so defeating one never touches the other`);
  assert.notEqual(sentinelBeat.id, wispBeat.id, "the two beats have distinct ids");
  for (const t of types) assert.ok(ENEMY_TYPES.includes(t), `${t} is spawnable (in the allow-list)`);

  // Determinism: a fresh build yields the identical authored composition.
  const again = buildEnemyArchetypeLab();
  assert.deepEqual(again.encounters.items.map((e) => [e.id, e.enemyType]), items.map((e) => [e.id, e.enemyType]), "the lab composition is deterministic");
  ok("the Enemy Archetype Lab is registered, valid, and stages both archetypes as two independent beats");
}

console.log(`\nenemy archetypes regression: ${passed} checks passed`);
