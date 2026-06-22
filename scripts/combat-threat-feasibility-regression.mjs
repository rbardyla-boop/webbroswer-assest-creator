// test:combat-threat-feasibility — pure-Node regression for Combat-1 (enemy threat feasibility). The threat
// is a SEPARATE, transient seam (not CombatRuntime, which owns player→enemy strikes): an enemy telegraphs a
// danger window, the player CROSSING into it fires ONE bounded non-lethal feedback event, a cooldown blocks
// re-fire spam, and a defeated enemy never threatens. This proves the pure entry-trigger state machine +
// geometry + bounds; the live "ring telegraph / knockback / dormant outside / defeat stops / still
// completable / reload drops it" path is the browser proof.
//
// Non-goals (asserted by absence here): no health, no death, no projectiles, no chase, no waves. The logic
// only decides WHEN one bounded event fires; the feedback (shake/audio/overlay/knockback) is the runtime's.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  THREAT_DANGER_FACTOR,
  THREAT_COOLDOWN,
  THREAT_KNOCKBACK,
  THREAT_SHAKE,
  threatDangerRadius,
  inDangerWindow,
  createThreatState,
  stepThreat,
} from "../src/world/combat/ThreatLogic.js";

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const DT = 1 / 60;

// --- 1. threatDangerRadius is bounded (0 ≤ r ≤ zoneRadius) + finite; inDangerWindow is the planar test ----
{
  for (const zr of [1, 4, 6, 12, 40]) {
    const r = threatDangerRadius(zr);
    assert.ok(Number.isFinite(r), `dangerRadius finite at zoneRadius=${zr}`);
    assert.ok(r >= 0 && r <= zr, `0 ≤ dangerRadius ${r} ≤ zoneRadius ${zr} (always inside the encounter)`);
    assert.ok(near(r, zr * THREAT_DANGER_FACTOR), `dangerRadius is a fixed fraction of the zone at ${zr}`);
  }
  assert.equal(threatDangerRadius(0), 0, "zoneRadius 0 → no danger window");
  assert.equal(threatDangerRadius(-5), 0, "negative zoneRadius → 0 (safety)");
  assert.equal(threatDangerRadius(NaN), 0, "non-finite zoneRadius → 0 (safety)");

  const dr = threatDangerRadius(6); // = 3
  assert.equal(inDangerWindow(0, dr), true, "at the centre → inside the danger window");
  assert.equal(inDangerWindow(dr, dr), true, "exactly at the danger radius → inside (inclusive)");
  assert.equal(inDangerWindow(dr + 1e-6, dr), false, "just beyond the danger radius → outside");
  assert.equal(inDangerWindow(100, dr), false, "far away → outside");
  assert.equal(inDangerWindow(NaN, dr), false, "non-finite distance → outside (safety)");
  assert.equal(inDangerWindow(1, 0), false, "danger radius 0 → never inside (dormant)");
  ok("threatDangerRadius bounded [0, zoneRadius] + finite; inDangerWindow is the inclusive planar disk test");
}

// --- 2. stepThreat rising-edge: ONE fire on enter; standing inside never re-fires; defeated never fires ----
{
  // Enter the window from outside → fires exactly once.
  let s = createThreatState();
  let r = stepThreat(s, { inWindow: true, defeated: false, dt: DT });
  assert.equal(r.fired, true, "crossing INTO the danger window fires the event");
  assert.ok(near(r.next.cooldownLeft, THREAT_COOLDOWN), "firing arms the cooldown");
  assert.equal(r.next.inWindowPrev, true, "in-window is latched after firing");

  // Standing inside for a long time → fires exactly once total (the rising-edge gate, NON-VACUOUS).
  let fires = 0;
  s = createThreatState();
  for (let k = 0; k < 1200; k++) {
    r = stepThreat(s, { inWindow: true, defeated: false, dt: DT });
    if (r.fired) fires++;
    s = r.next;
  }
  assert.equal(fires, 1, "standing inside for 1200 steps (20 s) fires exactly ONCE (does not spam)");

  // Defeated → never fires, even on a fresh crossing.
  s = createThreatState();
  let defeatedFires = 0;
  for (let k = 0; k < 300; k++) {
    r = stepThreat(s, { inWindow: k % 2 === 0, defeated: true, dt: DT }); // toggle in/out → still nothing
    if (r.fired) defeatedFires++;
    s = r.next;
  }
  assert.equal(defeatedFires, 0, "a defeated enemy NEVER fires a threat (toggling in/out → 0 events)");
  ok("stepThreat fires once on enter; standing inside never re-fires; defeated never fires");
}

// --- 3. cooldown blocks rapid re-entry; re-fires only after the cooldown elapses AND a fresh enter --------
{
  // Fire, leave for ONE step (prev clears, cooldown barely decays), re-enter → cooldown blocks the re-fire.
  let s = createThreatState();
  let r = stepThreat(s, { inWindow: true, dt: DT }); // fire #1
  assert.equal(r.fired, true, "first crossing fires");
  s = r.next;
  r = stepThreat(s, { inWindow: false, dt: DT }); // step OUT
  assert.equal(r.fired, false, "stepping out does not fire");
  s = r.next;
  r = stepThreat(s, { inWindow: true, dt: DT }); // re-enter immediately
  assert.equal(r.fired, false, "re-entering within the cooldown is BLOCKED (no spam on rapid re-entry)");
  s = r.next;

  // Now wait OUT of the window long enough for the cooldown to elapse, then re-enter → fires again.
  for (let k = 0; k < Math.ceil(THREAT_COOLDOWN / DT) + 2; k++) s = stepThreat(s, { inWindow: false, dt: DT }).next;
  r = stepThreat(s, { inWindow: true, dt: DT });
  assert.equal(r.fired, true, "after the cooldown elapses AND a fresh enter → fires again (not permanently latched)");

  // Bounded over a long oscillation: in/out every 0.2 s for 60 s → fires are bounded by elapsed/cooldown.
  s = createThreatState();
  let fires = 0;
  const STEPS = Math.round(60 / DT);
  for (let k = 0; k < STEPS; k++) {
    const inWindow = Math.floor(k * DT / 0.2) % 2 === 0; // 0.2 s in, 0.2 s out, repeating
    r = stepThreat(s, { inWindow, dt: DT });
    if (r.fired) fires++;
    s = r.next;
  }
  assert.ok(fires <= Math.ceil(60 / THREAT_COOLDOWN) + 1, `fires over 60 s of oscillation are cooldown-bounded (${fires} ≤ ~${Math.ceil(60 / THREAT_COOLDOWN) + 1})`);
  assert.ok(fires > 0, "the oscillation still fires at least once (non-vacuous)");
  ok("cooldown blocks rapid re-entry; re-fires only after it elapses + a fresh enter; fires are cooldown-bounded");
}

// --- 4. bounded/finite invariants over arbitrary input; deterministic ----------------------------------
{
  let s = createThreatState();
  for (let k = 0; k < 500; k++) {
    const r = stepThreat(s, { inWindow: k % 3 === 0, defeated: k % 7 === 0, dt: DT });
    assert.ok(Number.isFinite(r.next.cooldownLeft) && r.next.cooldownLeft >= 0, `cooldownLeft finite + ≥ 0 at k=${k}`);
    assert.ok(r.next.cooldownLeft <= THREAT_COOLDOWN + 1e-9, `cooldownLeft ≤ THREAT_COOLDOWN at k=${k}`);
    assert.equal(typeof r.fired, "boolean", `fired is a boolean at k=${k}`);
    s = r.next;
  }
  // Non-finite dt is a safe no-op step (no cooldown change, no fire).
  const r0 = stepThreat(createThreatState(), { inWindow: false, dt: NaN });
  assert.ok(Number.isFinite(r0.next.cooldownLeft), "non-finite dt → finite cooldown (safety)");
  // Deterministic: identical inputs → identical output.
  const a = stepThreat({ cooldownLeft: 1.0, inWindowPrev: false }, { inWindow: true, dt: DT });
  const b = stepThreat({ cooldownLeft: 1.0, inWindowPrev: false }, { inWindow: true, dt: DT });
  assert.deepEqual(a, b, "stepThreat is deterministic");
  ok("stepThreat outputs are finite + bounded [0, cooldown] for arbitrary inputs; deterministic");
}

// --- 5. constants are bounded; ThreatLogic.js is a PURE module (no THREE/DOM/RNG/clock) -----------------
{
  for (const [name, v] of [["THREAT_DANGER_FACTOR", THREAT_DANGER_FACTOR], ["THREAT_COOLDOWN", THREAT_COOLDOWN], ["THREAT_KNOCKBACK", THREAT_KNOCKBACK], ["THREAT_SHAKE", THREAT_SHAKE]]) {
    assert.ok(Number.isFinite(v) && v > 0, `${name} is finite + positive`);
  }
  assert.ok(THREAT_DANGER_FACTOR <= 1, "THREAT_DANGER_FACTOR ≤ 1 (danger window stays inside the zone)");
  assert.ok(THREAT_KNOCKBACK <= 1.5, "THREAT_KNOCKBACK is small (a stagger, not a launch)");

  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, "..", "src", "world", "combat", "ThreatLogic.js"), "utf8");
  // Strip comments so doctrine prose ("no RNG / no wall-clock") is not mistaken for a forbidden call.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of [/\bfrom\s+["']three["']/, /\bMath\.random\b/, /\bDate\.now\b/, /\bperformance\.now\b/, /\bdocument\b/, /\bwindow\b/, /\brequestAnimationFrame\b/]) {
    assert.ok(!forbidden.test(code), `ThreatLogic.js is pure — no ${forbidden}`);
  }
  ok("threat constants are bounded; ThreatLogic.js imports no THREE and uses no RNG/clock/DOM (pure)");
}

console.log(`\ncombat threat feasibility regression: ${passed} checks passed`);
