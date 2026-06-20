// test:content-combat-beats — pure-Node regression for Content-1 (a SECOND authored combat beat).
//
// Content-1 proves the Encounter Editor-0 + Encounter-1 authoring model is REPEATABLE: the visual
// benchmark now authors TWO combat beats (the glacial-crossing skirmish + a final guardian at the cache
// gate) using the SAME systems and NO new runtime code — only authored data + an optional per-beat
// banner `label`. This gate proves the AUTHORED ARTIFACT and the label/banner LOGIC at the data level:
//   - the benchmark composes two distinct, independently-completable combat-beats (no waves),
//   - each beat carries a distinct location label, and the banner names each beat correctly,
//   - the legacy crossing banner stays BYTE-IDENTICAL (label "the crossing"),
//   - the two completions round-trip INDEPENDENTLY through validation,
//   - the two-beat composition is deterministic.
// The live two-beat loop (both completable, independent phase/completion, reload-safe, performance-green)
// is test:content-combat-beats-proof.

import assert from "node:assert/strict";

import { buildVisualBenchmarkV1, visualBenchmarkLayout } from "../src/world/samples/visualBenchmarkV1.js";
import { validateWorldDocument } from "../src/world/WorldValidation.js";
import { ENCOUNTER_TYPE, MAX_LABEL_LENGTH, sanitizeLabel, normalizeEncounterDescriptor } from "../src/world/encounters/EncounterTypes.js";
import { encounterBannerText, ENCOUNTER_PHASE } from "../src/world/encounters/EncounterPresentationLogic.js";

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// --- 1. the benchmark authors TWO distinct, independent combat beats ----------
{
  const enc = buildVisualBenchmarkV1().encounters;
  assert.equal(enc.items.length, 2, "two authored combat beats (the crossing skirmish + the cache gate)");
  const [crossingBeat, cacheBeat] = enc.items;

  // Same systems: both are combat-beat.v0 / glacial_sentinel / exactly one enemy (no waves).
  for (const beat of enc.items) {
    assert.equal(beat.type, ENCOUNTER_TYPE, "each beat is a combat-beat.v0");
    assert.equal(beat.enemyType, "glacial_sentinel", "each names the Enemy-0 sentinel");
    assert.equal(beat.enemyCount, 1, "each projects exactly one enemy (the no-waves invariant, per beat)");
    assert.equal(beat.completed, false, "each beat starts uncompleted (it completes in play)");
    assert.equal(beat.persistCompletion, true, "each beat persists its completion");
  }

  // Different identity + staging.
  assert.equal(crossingBeat.id, "vb-crossing-sentinel", "the crossing beat is items[0] (encounters[0] stable)");
  assert.equal(cacheBeat.id, "vb-cache-sentinel", "the cache-gate beat is items[1]");
  assert.notEqual(crossingBeat.id, cacheBeat.id, "distinct ids");
  const sep = dist2(crossingBeat.position, cacheBeat.position);
  assert.ok(sep >= 6, `the two beats are staged at distinct points (${sep.toFixed(1)}m apart)`);
  const layout = visualBenchmarkLayout();
  assert.ok(dist2(cacheBeat.position, layout.cache) <= 6, "the cache-gate beat is staged at the cache");
  ok(`content: two combat-beats (crossing + cache gate), distinct ids, ${sep.toFixed(1)}m apart, no waves`);
}

// --- 2. per-beat labels + label normalization (presentation noun, not prose) --
{
  const [crossingBeat, cacheBeat] = buildVisualBenchmarkV1().encounters.items;
  assert.equal(crossingBeat.label, "the crossing", "the crossing beat names its location");
  assert.equal(cacheBeat.label, "the pass", "the cache-gate beat names its location");
  assert.notEqual(crossingBeat.label, cacheBeat.label, "the two banner labels are distinct");

  // The label is whitelisted, sanitized + always emitted (string|null).
  assert.equal(sanitizeLabel("the pass"), "the pass", "a plain label is preserved (spaces kept)");
  assert.equal(sanitizeLabel("a<b>c"), "abc", "markup angle-brackets stripped (defense in depth)");
  assert.equal(sanitizeLabel("ab‮cd"), "abcd", "bidi-override (RLO) stripped — banner text can't be visually reordered");
  assert.equal(sanitizeLabel("a​b﻿c"), "abc", "zero-width + BOM formatting chars stripped");
  assert.equal(sanitizeLabel("gate \u{1f525}"), "gate \u{1f525}", "printable Unicode (emoji) is preserved");
  assert.equal(sanitizeLabel(123), null, "a non-string label → null");
  assert.equal(sanitizeLabel("   "), null, "a whitespace-only label → null");
  assert.ok(sanitizeLabel("y".repeat(120)).length <= MAX_LABEL_LENGTH, "an over-long label is capped");
  const noLabel = normalizeEncounterDescriptor({ type: ENCOUNTER_TYPE, id: "n", position: { x: 0, y: 0, z: 0 }, enemyType: "glacial_sentinel" });
  assert.equal(noLabel.label, null, "an unlabelled descriptor emits label:null (round-trips stably)");
  ok("labels: each beat names its location; the label is sanitized + always emitted (string|null)");
}

// --- 3. the banner reads location-correctly per beat (legacy crossing identical) ---
{
  const P = ENCOUNTER_PHASE;
  // With label "the crossing" the banner is BYTE-IDENTICAL to the pre-Content-1 hardcoded strings.
  assert.equal(encounterBannerText(P.ALERT, { label: "the crossing" }), "⚔ A glacial sentinel guards the crossing — ready your weapon", "crossing alert byte-identical");
  assert.equal(encounterBannerText(P.ENGAGED, { label: "the crossing" }), "⚔ Strike the sentinel to clear the crossing", "crossing engaged byte-identical");
  assert.equal(encounterBannerText(P.CLEARED, { clearedRecently: true, label: "the crossing" }), "✓ The crossing is clear — the route ahead is open", "crossing cleared byte-identical");

  // The second beat names its own location.
  assert.match(encounterBannerText(P.ALERT, { label: "the pass" }), /guards the pass/, "the cache-gate banner names the pass");
  assert.match(encounterBannerText(P.ENGAGED, { label: "the pass" }), /clear the pass/, "the cache-gate engaged banner names the pass");
  assert.match(encounterBannerText(P.CLEARED, { clearedRecently: true, label: "the pass" }), /^✓ The pass is clear/, "the cache-gate cleared banner names the pass + capitalises");

  // An unlabelled beat still reads (neutral fallback) — never a dangling template.
  assert.match(encounterBannerText(P.ALERT, {}), /guards the path/, "an unlabelled beat falls back to a neutral noun");
  assert.equal(encounterBannerText(P.DORMANT, { label: "the pass" }), null, "dormant yields to the objective banner regardless of label");
  ok("banner: location-aware per label; the crossing banner is byte-identical; unlabelled falls back");
}

// --- 4. the two completions round-trip INDEPENDENTLY through validation -------
{
  // Author one beat as completed, leave the other live, then validate (save→load). The two completion
  // flags must survive independently — neither beat's completion leaks onto the other.
  const doc = buildVisualBenchmarkV1();
  doc.encounters.items[0].completed = true; // the crossing beat is cleared
  doc.encounters.items[1].completed = false; // the cache-gate beat is still live
  const res = validateWorldDocument(doc);
  const items = res.document.encounters.items;
  assert.equal(items.length, 2, "both beats survive validation");
  const crossing = items.find((b) => b.id === "vb-crossing-sentinel");
  const cache = items.find((b) => b.id === "vb-cache-sentinel");
  assert.equal(crossing.completed, true, "the cleared crossing beat persists completed:true");
  assert.equal(cache.completed, false, "the live cache-gate beat persists completed:false (independent)");
  assert.equal(crossing.label, "the crossing", "the crossing label survives validation");
  assert.equal(cache.label, "the pass", "the cache-gate label survives validation");
  // The inverse, to prove it is not a fixed ordering artefact.
  const doc2 = buildVisualBenchmarkV1();
  doc2.encounters.items[0].completed = false;
  doc2.encounters.items[1].completed = true;
  const items2 = validateWorldDocument(doc2).document.encounters.items;
  assert.equal(items2.find((b) => b.id === "vb-crossing-sentinel").completed, false, "crossing live persists independently");
  assert.equal(items2.find((b) => b.id === "vb-cache-sentinel").completed, true, "cache-gate cleared persists independently");
  ok("persistence: the two beats' completions round-trip independently (neither leaks onto the other)");
}

// --- 5. the two-beat composition is deterministic -----------------------------
{
  assert.deepEqual(buildVisualBenchmarkV1().encounters, buildVisualBenchmarkV1().encounters, "two builds → identical two-beat encounters block");
  ok("determinism: the two-beat composition (ids/positions/labels) is identical across builds");
}

console.log(`\ncontent-combat-beats regression: ${passed} checks passed`);
