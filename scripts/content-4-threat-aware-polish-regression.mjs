// test:content-4-threat-aware-polish — pure-Node regression for Content-4 (threat-aware encounter polish). It
// makes the Combat-1 threat READ better in the authored slice WITHOUT new combat rules: (1) a PURE
// presentation helper de-noises overlapping danger rings to one prominent ring; (2) the encounter label is
// threaded so the warning names the moment; (3) a data-only teaching sign explains the (non-lethal) wards.
// This proves the pure de-noise selection + the authored sign + the label source. The live ring de-noise,
// moment-named warning, recovery, and completability are the browser proof.
//
// Non-goals (asserted by absence + by ThreatLogic byte-stability): no health/death/attacks/balance — the
// threat state machine (stepThreat + its constants) is unchanged; only presentation + authored data change.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  pickProminent,
  stepThreat,
  THREAT_COOLDOWN,
  THREAT_KNOCKBACK,
} from "../src/world/combat/ThreatLogic.js";
import { buildVisualBenchmarkV1 } from "../src/world/samples/visualBenchmarkV1.js";
import { validateWorldDocument } from "../src/world/WorldValidation.js";

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

// --- 1. the threat-teaching sign is authored, data-only, and readable ----------------------------------
{
  const doc = buildVisualBenchmarkV1();
  const sign = doc.objects.find((o) => o.id === "vb-threat-sign");
  assert.ok(sign, "the benchmark authors a vb-threat-sign primitive");
  assert.ok(sign.interaction && sign.interaction.role === "sign", "the sign carries a data-only sign interaction");
  assert.ok(typeof sign.interaction.text === "string" && sign.interaction.text.length > 20, "the sign text is non-empty");
  assert.ok(/fell you|shove you back|fall back/i.test(sign.interaction.text), "the sign teaches the non-lethal threat + recovery");
  assert.ok(Number.isFinite(sign.interaction.showRadius) && sign.interaction.showRadius > 0, "the sign has a finite show radius");
  assert.ok(Number.isFinite(sign.transform.position.x) && Number.isFinite(sign.transform.position.z), "the sign is placed on finite ground");
  assert.equal(sign.assetRef, null, "the sign is a primitive (no asset dependency)");
  ok("the threat-teaching sign is authored, data-only (role 'sign'), readable, and finitely placed");
}

// --- 2. pickProminent: the nearest in-zone alive enemy de-noises overlapping rings ---------------------
{
  // nearest in-outer-zone alive wins.
  const r = pickProminent([
    { id: "a", distance: 5, inOuterZone: true, defeated: false },
    { id: "b", distance: 2, inOuterZone: true, defeated: false },
    { id: "c", distance: 1, inOuterZone: false, defeated: false }, // closer but OUT of zone → excluded
  ]);
  assert.equal(r, "b", "the nearest IN-ZONE alive enemy is prominent (out-of-zone excluded even if closer)");

  assert.equal(pickProminent([{ id: "a", distance: 1, inOuterZone: true, defeated: true }]), null, "a defeated enemy is never prominent");
  assert.equal(pickProminent([{ id: "a", distance: 1, inOuterZone: false, defeated: false }]), null, "an out-of-zone enemy is never prominent");
  assert.equal(pickProminent([]), null, "no enemies → no prominent ring (null)");
  assert.equal(pickProminent([{ id: "a", distance: NaN, inOuterZone: true, defeated: false }]), null, "a non-finite distance is excluded");
  assert.equal(pickProminent(null), null, "non-array input → null (safety)");

  // deterministic tie-break (equal distance → the smaller id), and determinism.
  const tie = pickProminent([
    { id: "z", distance: 3, inOuterZone: true, defeated: false },
    { id: "a", distance: 3, inOuterZone: true, defeated: false },
  ]);
  assert.equal(tie, "a", "an exact distance tie breaks toward the smaller id (deterministic)");
  assert.equal(
    pickProminent([{ id: "p", distance: 4, inOuterZone: true, defeated: false }]),
    pickProminent([{ id: "p", distance: 4, inOuterZone: true, defeated: false }]),
    "pickProminent is deterministic"
  );
  // At a mixed gate (two in-zone) at most ONE id is returned → the ring de-noise guarantee.
  const mixed = pickProminent([
    { id: "sentinel", distance: 1.8, inOuterZone: true, defeated: false },
    { id: "wisp", distance: 4.4, inOuterZone: true, defeated: false },
  ]);
  assert.equal(mixed, "sentinel", "at the mixed gate the nearer enemy is the single prominent ring");
  ok("pickProminent selects the nearest in-zone alive enemy (≤ 1 prominent), excludes defeated/out-of-zone/non-finite, deterministic");
}

// --- 3. the encounter labels (the warning's moment-naming source) are intact ---------------------------
{
  const doc = buildVisualBenchmarkV1();
  const enc = doc.encounters.items;
  const crossing = enc.find((b) => b.id === "vb-crossing-sentinel");
  const cacheS = enc.find((b) => b.id === "vb-cache-sentinel");
  const cacheW = enc.find((b) => b.id === "vb-cache-wisp");
  assert.equal(crossing.label, "the crossing", "the crossing beat keeps its label (warning: 'The crossing — fall back')");
  assert.equal(cacheS.label, "the pass", "the cache sentinel keeps its label (warning: 'The pass — fall back')");
  assert.equal(cacheW.label, "the pass", "the cache wisp keeps its label");
  ok("the encounter labels are intact — the moment-naming source for the threat warning is byte-stable");
}

// --- 4. the benchmark (with the sign) still validates + round-trips deterministically -------------------
{
  const a = buildVisualBenchmarkV1();
  const b = buildVisualBenchmarkV1();
  // Compare the COMPOSITION (objects + encounters), not the whole doc — createWorldDocument stamps a
  // wall-clock createdAt/updatedAt in metadata, so the full JSON differs by time, not by content.
  assert.equal(JSON.stringify(a.objects), JSON.stringify(b.objects), "the authored objects (incl. the sign) are deterministic");
  assert.equal(JSON.stringify(a.encounters), JSON.stringify(b.encounters), "the authored encounters are deterministic");
  const res = validateWorldDocument(a);
  assert.ok(res && res.document, "the benchmark with the threat sign validates");
  const signAfter = res.document.objects.find((o) => o.id === "vb-threat-sign");
  assert.ok(signAfter && signAfter.interaction && signAfter.interaction.role === "sign", "the sign interaction survives validation (sanitizeInteraction)");
  assert.ok(res.document.objects.length <= 60, `compact scene stays within the authored-object budget (${res.document.objects.length} <= 60)`);
  ok("the benchmark validates + round-trips with the sign; the sign interaction survives sanitization");
}

// --- 5. ThreatLogic stays PURE + the threat state machine is byte-stable (no new behaviour) -------------
{
  // pickProminent added no THREE/RNG/clock/DOM to the pure module.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, "..", "src", "world", "combat", "ThreatLogic.js"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of [/\bfrom\s+["']three["']/, /\bMath\.random\b/, /\bDate\.now\b/, /\bperformance\.now\b/, /\bdocument\b/, /\bwindow\b/]) {
    assert.ok(!forbidden.test(code), `ThreatLogic.js stays pure — no ${forbidden}`);
  }
  // The threat constants + the rising-edge state machine are UNCHANGED (no balance tuning in Content-4).
  assert.equal(THREAT_COOLDOWN, 2.5, "the cooldown is unchanged (no balance tuning)");
  assert.equal(THREAT_KNOCKBACK, 0.6, "the knockback magnitude is unchanged (no balance tuning)");
  let s = { cooldownLeft: 0, inWindowPrev: false };
  const r1 = stepThreat(s, { inWindow: true, defeated: false, dt: 1 / 60 });
  assert.equal(r1.fired, true, "stepThreat still fires once on a fresh crossing (state machine byte-stable)");
  assert.equal(stepThreat(r1.next, { inWindow: true, defeated: false, dt: 1 / 60 }).fired, false, "stepThreat still does not re-fire while inside");
  ok("ThreatLogic stays pure; the cooldown/knockback constants + the rising-edge fire are byte-stable (presentation-only change)");
}

console.log(`\ncontent-4 threat-aware-polish regression: ${passed} checks passed`);
