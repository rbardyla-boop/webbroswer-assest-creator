// test:content-3 — pure-Node regression for Content-3 (a MIXED enemy encounter composition).
//
// Content-3 proves the existing combat / enemy / encounter stack produces a mixed engagement through
// AUTHORED COMPOSITION ALONE — no new enemy systems, no schema change, no waves. The visual benchmark's
// cache gate is now guarded by BOTH a glacial_sentinel AND a frost_wisp: two INDEPENDENT single-enemy
// beats whose zones overlap so they read as one engagement. This gate proves the authored artifact +
// the no-waves invariants at the data level:
//   - the cache gate stages a sentinel beat + a wisp beat whose zones OVERLAP (one mixed engagement),
//   - each beat is still exactly one enemy (enemyCount clamps to 1 — the no-waves gate, untouched),
//   - the two enemy types are distinct, ids are distinct, both grounded,
//   - the encounter SCHEMA is unchanged (clampCount still 1; the descriptor whitelist gained no key),
//   - the two beats' completions round-trip INDEPENDENTLY through validation,
//   - the mixed composition is deterministic + adds zero validation warnings.
// The live mixed loop (both telegraph, one weapon defeats both, independent completion, reload-safe,
// performance-green) is test:content-3-proof.

import assert from "node:assert/strict";

import { buildVisualBenchmarkV1, visualBenchmarkLayout } from "../src/world/samples/visualBenchmarkV1.js";
import { validateWorldDocument } from "../src/world/WorldValidation.js";
import { ENCOUNTER_TYPE, ENEMY_COUNT, clampCount, normalizeEncounterDescriptor } from "../src/world/encounters/EncounterTypes.js";
import { ENEMY_TYPES, SENTINEL_TYPE, WISP_TYPE } from "../src/world/enemies/EnemyTypes.js";

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const cacheBeats = () => {
  const items = buildVisualBenchmarkV1().encounters.items;
  return {
    items,
    sentinel: items.find((b) => b.id === "vb-cache-sentinel"),
    wisp: items.find((b) => b.id === "vb-cache-wisp"),
    crossing: items.find((b) => b.id === "vb-crossing-sentinel"),
  };
};

// --- 1. the cache gate is a MIXED engagement (sentinel + wisp, overlapping zones) ---------------
{
  const { sentinel, wisp, crossing } = cacheBeats();
  assert.ok(sentinel && wisp, "the cache gate authors BOTH a sentinel beat and a wisp beat");
  assert.equal(sentinel.enemyType, SENTINEL_TYPE, "the cache sentinel is a glacial_sentinel");
  assert.equal(wisp.enemyType, WISP_TYPE, "the cache wisp is a frost_wisp");
  assert.notEqual(sentinel.enemyType, wisp.enemyType, "the mixed pair are DIFFERENT archetypes");
  assert.notEqual(sentinel.id, wisp.id, "the mixed pair have distinct ids (two independent beats)");

  // The two zones OVERLAP → entering the cache gate engages both (one mixed engagement, not two errands).
  const sep = dist2(sentinel.position, wisp.position);
  assert.ok(sep < sentinel.radius + wisp.radius, `the sentinel + wisp zones OVERLAP (centres ${sep.toFixed(1)}m < r+r ${sentinel.radius + wisp.radius})`);
  // …but the bodies are not coincident, so combat can resolve each (the proof verifies the live strike).
  assert.ok(sep > 0.5, `the two bodies are distinct points, not coincident (${sep.toFixed(1)}m apart)`);

  // The mix is specifically at the CACHE — the crossing beat is a separate, distant engagement.
  const layout = visualBenchmarkLayout();
  assert.ok(dist2(sentinel.position, layout.cache) <= 6 && dist2(wisp.position, layout.cache) <= 9, "both mixed beats are staged at the cache gate");
  assert.ok(dist2(crossing.position, sentinel.position) >= 6, "the crossing engagement is separate from the mixed cache engagement");
  ok(`content-3: the cache gate is a MIXED sentinel+wisp engagement (overlapping zones, ${sep.toFixed(1)}m apart)`);
}

// --- 2. the no-waves invariant holds: every beat is exactly one enemy ----------------------------
{
  const { items } = cacheBeats();
  for (const beat of items) {
    assert.equal(beat.enemyCount, 1, `${beat.id}: exactly one enemy (the no-waves invariant, per beat)`);
    assert.ok(["x", "y", "z"].every((k) => Number.isFinite(beat.position[k])), `${beat.id}: grounded at a finite position`);
  }
  // The clamp IS the no-waves gate — it pins enemyCount to 1 regardless of an authored/corrupt value.
  assert.equal(clampCount(5), ENEMY_COUNT, "clampCount pins a multi-enemy request to 1 (no waves)");
  assert.equal(clampCount(0), ENEMY_COUNT, "clampCount pins 0 to 1");
  assert.equal(ENEMY_COUNT, 1, "the Encounter-0 enemy count is exactly 1");
  ok("content-3: every beat is a single enemy; clampCount enforces the no-waves gate (schema unchanged)");
}

// --- 3. the encounter SCHEMA is unchanged (no new descriptor key; both types spawnable) ----------
{
  // The whitelist is byte-identical to the pre-Content-3 set — mixing types added NO schema field.
  const clean = normalizeEncounterDescriptor({ type: ENCOUNTER_TYPE, id: "x", position: { x: 0, y: 0, z: 0 }, enemyType: WISP_TYPE });
  assert.deepEqual(
    Object.keys(clean).sort(),
    ["completed", "enemyCount", "enemyType", "id", "label", "patrol", "persistCompletion", "position", "radius", "type"],
    "the encounter descriptor whitelist is unchanged (mixing types added no new key)"
  );
  // Both archetypes are nameable by an encounter; an unknown type is still rejected.
  assert.ok(ENEMY_TYPES.includes(SENTINEL_TYPE) && ENEMY_TYPES.includes(WISP_TYPE), "both mixed archetypes are spawnable");
  assert.equal(normalizeEncounterDescriptor({ type: ENCOUNTER_TYPE, id: "x", position: { x: 0, y: 0, z: 0 }, enemyType: "dragon" }), null, "an unspawnable enemyType is still rejected");
  ok("content-3: the encounter schema is unchanged (whitelist intact, no waves/director seam opened)");
}

// --- 4. the mixed pair's completions round-trip INDEPENDENTLY (no leak) --------------------------
{
  // Defeat the cache SENTINEL only; the cache WISP stays live. The two flags must survive independently.
  const doc = buildVisualBenchmarkV1();
  for (const b of doc.encounters.items) b.completed = b.id === "vb-cache-sentinel";
  const items = validateWorldDocument(doc).document.encounters.items;
  assert.equal(items.length, 3, "all three beats survive validation");
  assert.equal(items.find((b) => b.id === "vb-cache-sentinel").completed, true, "the defeated cache sentinel persists completed:true");
  assert.equal(items.find((b) => b.id === "vb-cache-wisp").completed, false, "the live cache wisp persists completed:false (independent — no leak)");
  // The inverse, to prove it is not an ordering artefact.
  const doc2 = buildVisualBenchmarkV1();
  for (const b of doc2.encounters.items) b.completed = b.id === "vb-cache-wisp";
  const items2 = validateWorldDocument(doc2).document.encounters.items;
  assert.equal(items2.find((b) => b.id === "vb-cache-sentinel").completed, false, "the live cache sentinel persists independently");
  assert.equal(items2.find((b) => b.id === "vb-cache-wisp").completed, true, "the defeated cache wisp persists independently");
  ok("content-3: the mixed pair's completions round-trip INDEPENDENTLY (defeating one never completes the other)");
}

// --- 5. the mixed composition adds zero validation warnings + is deterministic -------------------
{
  const { warnings } = validateWorldDocument(buildVisualBenchmarkV1());
  assert.equal(warnings.some((w) => /enem|encounter/i.test(w)), false, "the mixed composition adds no enemy/encounter validation warning");
  assert.deepEqual(buildVisualBenchmarkV1().encounters, buildVisualBenchmarkV1().encounters, "two builds → identical three-beat encounters block");
  ok("content-3: the mixed composition is warning-free + deterministic across builds");
}

console.log(`\ncontent-3 regression: ${passed} checks passed`);
