// test:encounter-polish — pure-Node regression for Encounter-1 (the authored combat-beat PRESENTATION).
//
// Encounter-1 polishes the EXISTING combat beat (Combat-0 strike + Enemy-0 state + Encounter Editor-0
// orchestration) into a readable authored moment: a sentinel idle→alert telegraph, an encounter banner,
// a gate-light beacon, and a one-shot clear. It is a presentation OBSERVER — it never mutates encounter
// or enemy state. This gate proves the pure readability LOGIC (phase derivation + telegraph + banner +
// beacon) and the isolation/purity of the modules. The live behaviour is test:encounter-polish-proof.

import assert from "node:assert/strict";
import fs from "node:fs";

import {
  ENCOUNTER_PHASE,
  ENCOUNTER_ALERT_RANGE,
  CLEARED_BANNER_SECONDS,
  deriveEncounterPhase,
  telegraphActive,
  telegraphEmissive,
  encounterBannerText,
  beaconColor,
  beaconOpacity,
} from "../src/world/encounters/EncounterPresentationLogic.js";

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

// --- 1. phase derivation: dormant → alert → engaged → cleared ----------------
{
  const radius = 8;
  assert.equal(deriveEncounterPhase({ distance: 40, radius, enemyState: "idle", completed: false }), ENCOUNTER_PHASE.DORMANT, "far → dormant");
  assert.equal(deriveEncounterPhase({ distance: 15, radius, enemyState: "idle", completed: false }), ENCOUNTER_PHASE.ALERT, "within alert range, outside zone → alert");
  assert.equal(deriveEncounterPhase({ distance: 5, radius, enemyState: "idle", completed: false }), ENCOUNTER_PHASE.ENGAGED, "inside the zone → engaged");
  // Combat having begun engages the beat regardless of range (a fleeing player is still engaged).
  assert.equal(deriveEncounterPhase({ distance: 40, radius, enemyState: "hit-react", completed: false }), ENCOUNTER_PHASE.ENGAGED, "hit-react → engaged even when far");
  assert.equal(deriveEncounterPhase({ distance: 40, radius, enemyState: "defeated", completed: false }), ENCOUNTER_PHASE.ENGAGED, "defeated-but-not-yet-completed → engaged");
  // Completion is terminal and overrides everything.
  assert.equal(deriveEncounterPhase({ distance: 5, radius, enemyState: "idle", completed: true }), ENCOUNTER_PHASE.CLEARED, "completed → cleared (overrides distance/state)");
  // Boundary: exactly at the alert range edge is still alert; just past it is dormant.
  assert.equal(deriveEncounterPhase({ distance: ENCOUNTER_ALERT_RANGE, radius, enemyState: "idle", completed: false }), ENCOUNTER_PHASE.ALERT, "at the alert-range edge → alert");
  assert.equal(deriveEncounterPhase({ distance: ENCOUNTER_ALERT_RANGE + 0.1, radius, enemyState: "idle", completed: false }), ENCOUNTER_PHASE.DORMANT, "past the alert-range edge → dormant");
  ok("phase: dormant/alert/engaged/cleared derived from distance + enemy state + completion");
}

// --- 2. telegraph is active ONLY in alert/engaged AND idle -------------------
{
  assert.equal(telegraphActive(ENCOUNTER_PHASE.ALERT, "idle"), true, "alert + idle → telegraph on");
  assert.equal(telegraphActive(ENCOUNTER_PHASE.ENGAGED, "idle"), true, "engaged + idle → telegraph on");
  // The moment Enemy-0 owns the material, the telegraph backs off (no fighting EnemyFeedback).
  assert.equal(telegraphActive(ENCOUNTER_PHASE.ENGAGED, "hit-react"), false, "engaged + hit-react → telegraph OFF (EnemyFeedback owns the flash)");
  assert.equal(telegraphActive(ENCOUNTER_PHASE.ENGAGED, "defeated"), false, "engaged + defeated → telegraph OFF (EnemyFeedback owns the recolor)");
  assert.equal(telegraphActive(ENCOUNTER_PHASE.DORMANT, "idle"), false, "dormant → telegraph off");
  assert.equal(telegraphActive(ENCOUNTER_PHASE.CLEARED, "idle"), false, "cleared → telegraph off");
  ok("telegraph: active only while approaching/engaged AND the sentinel is still idle");
}

// --- 3. telegraph emissive: above base, banded, deterministic ---------------
{
  const base = 0.25;
  for (const t of [0, 0.3, 0.7, 1.1, 2.5]) {
    const a = telegraphEmissive(base, t, ENCOUNTER_PHASE.ALERT);
    assert.ok(a > base, `alert emissive (${a.toFixed(3)}) lifts above base ${base}`);
    assert.ok(Number.isFinite(a), "emissive is finite");
  }
  // Deterministic given the clock; engaged pulses harder than alert at the same instant.
  assert.equal(telegraphEmissive(base, 0.5, ENCOUNTER_PHASE.ALERT), telegraphEmissive(base, 0.5, ENCOUNTER_PHASE.ALERT), "deterministic given t");
  assert.ok(telegraphEmissive(base, 0.5, ENCOUNTER_PHASE.ENGAGED) > telegraphEmissive(base, 0.5, ENCOUNTER_PHASE.ALERT), "engaged pulse > alert pulse at the same t");
  ok("telegraph emissive: always above base, finite, deterministic, engaged > alert");
}

// --- 4. banner text per phase (cleared lingers then releases) ---------------
{
  assert.equal(encounterBannerText(ENCOUNTER_PHASE.DORMANT, {}), null, "dormant → no encounter banner (objective shows through)");
  assert.match(encounterBannerText(ENCOUNTER_PHASE.ALERT, {}), /ready your weapon/, "alert → ready-weapon prompt");
  assert.match(encounterBannerText(ENCOUNTER_PHASE.ENGAGED, {}), /[Ss]trike/, "engaged → strike prompt");
  assert.equal(encounterBannerText(ENCOUNTER_PHASE.CLEARED, { clearedRecently: false }), null, "cleared but window elapsed → release to objective banner");
  assert.match(encounterBannerText(ENCOUNTER_PHASE.CLEARED, { clearedRecently: true }), /clear|open/, "cleared recently → route-open message");
  assert.ok(CLEARED_BANNER_SECONDS > 0, "the cleared banner has a positive linger window");
  ok("banner: per-phase text; dormant/elapsed-cleared yield to the objective banner");
}

// --- 5. beacon colour + opacity per phase (hostile → green) -----------------
{
  assert.notEqual(beaconColor(ENCOUNTER_PHASE.ALERT), beaconColor(ENCOUNTER_PHASE.CLEARED), "alert (hostile) ≠ cleared (green)");
  assert.equal(beaconColor(ENCOUNTER_PHASE.CLEARED), 0x7fdca0, "cleared beacon is route-open green");
  assert.ok(beaconOpacity(ENCOUNTER_PHASE.DORMANT) < beaconOpacity(ENCOUNTER_PHASE.ENGAGED), "the beacon reads stronger when engaged than dormant");
  for (const p of Object.values(ENCOUNTER_PHASE)) {
    assert.ok(beaconOpacity(p) >= 0 && beaconOpacity(p) <= 1, `beacon opacity for ${p} is in [0,1]`);
  }
  ok("beacon: hostile→green colour and dormant→engaged opacity ramp");
}

// --- 6. purity: the logic module is THREE-free + deterministic --------------
{
  const src = fs.readFileSync(new URL("../src/world/encounters/EncounterPresentationLogic.js", import.meta.url), "utf8");
  assert.equal(/from ["']three/.test(src), false, "the logic module is THREE-free (pure, Node-importable)");
  assert.equal(/Math\.random|Date\.now|new Date\(|performance\.now/.test(src), false, "no RNG / wall-clock in the logic module");
  ok("purity: the presentation logic is THREE-free + deterministic (no RNG / wall-clock)");
}

// --- 7. isolation: the presentation OBSERVES, never mutates the seams --------
{
  const pres = fs.readFileSync(new URL("../src/world/encounters/EncounterPresentation.js", import.meta.url), "utf8");
  // It may read EncounterRuntime/the enemy actor groups, but must NOT write encounter/enemy STATE:
  // no descriptor.completed assignment, no actor.state mutation, no EnemyRuntime/EncounterRuntime method
  // that changes the beat. It only reads snapshots/groups and mutates ITS OWN beacon + the enemy MATERIAL.
  // Assignment-only (negative lookahead so `=== comparisons` are NOT flagged) — the layer reads facts.
  assert.equal(/\.completed\s*=(?!=)/.test(pres), false, "presentation never assigns encounter .completed (observer only)");
  assert.equal(/\.state\s*=(?!=)/.test(pres), false, "presentation never reassigns enemy .state");
  assert.equal(/applyDamage|advanceState|spawnEphemeral|takePersistRequest/.test(pres), false, "presentation calls no state-changing seam method");
  ok("isolation: the presentation reads facts + drives its own visuals; it mutates no encounter/enemy STATE");
}

console.log(`\nencounter-polish regression: ${passed} checks passed`);
