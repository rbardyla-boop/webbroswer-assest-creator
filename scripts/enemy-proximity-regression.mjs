// test:enemy-proximity — pure-Node regression for Enemy-3 (light proximity response). The response is a
// MOTION/PRESENTATION overlay: enemies orient/lean toward the player + bias their hover drift when the
// player is in the encounter zone — NEVER attacks/damage/chase. Every output is BOUNDED and dormant unless
// the enemy is alive, in-zone, and not reacting. This proves the pure math + the archetype caps; the live
// "in-zone responds / out-of-zone dormant / defeated stops / still combat targets" path is the browser proof.

import assert from "node:assert/strict";

import { bearingTo, stepYaw, hoverBias, leanAmount, proximityActive } from "../src/world/enemies/EnemyProximityLogic.js";
import { archetypeFor, SENTINEL_TYPE, WISP_TYPE } from "../src/world/enemies/EnemyTypes.js";

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

const PI = Math.PI;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// --- 1. bearingTo + stepYaw: shortest-path clamped turn ------------------------------------------
{
  // bearingTo matches the runtime's atan2(dx,dz) facing basis.
  assert.ok(near(bearingTo(0, 0, 0, 1), 0), "due +Z → yaw 0");
  assert.ok(near(bearingTo(0, 0, 1, 0), PI / 2), "due +X → yaw π/2");
  assert.ok(near(bearingTo(0, 0, 0, -1), PI), "due -Z → yaw π");
  assert.equal(bearingTo(0, 0, 0, 0), 0, "coincident → 0 (no defined bearing)");
  assert.equal(bearingTo(NaN, 0, 1, 0), 0, "non-finite → 0 (safety)");

  // stepYaw turns toward the target, clamped to maxStep, idempotent within reach.
  assert.ok(near(stepYaw(0, 0.05, 0.1), 0.05), "within maxStep → snaps to target (idempotent)");
  assert.ok(near(stepYaw(0.5, 0.5, 0.1), 0.5), "already at target → unchanged (idempotent)");
  assert.ok(near(stepYaw(0, 1.0, 0.1), 0.1), "far target → turns exactly maxStep toward it");
  assert.ok(near(stepYaw(0, -1.0, 0.1), -0.1), "far negative target → turns -maxStep");
  // Shortest path across the ±π seam: 3.0 → -3.0 is +0.283 (through π), NOT -6.0.
  assert.ok(near(stepYaw(3.0, -3.0, 0.1), 3.1), "shortest path wraps across ±π (3.0 → 3.1 toward π)");
  assert.equal(stepYaw(0.7, 1.0, 0), 0.7, "maxStep 0 → no-op");
  assert.equal(stepYaw(0.7, NaN, 0.1), 0.7, "non-finite target → no-op");
  // Determinism: identical inputs → identical output.
  assert.equal(stepYaw(0.3, 2.0, 0.15), stepYaw(0.3, 2.0, 0.15), "stepYaw is deterministic");
  ok("bearingTo + stepYaw: correct facing, shortest-path clamped turn, idempotent + deterministic");
}

// --- 2. hoverBias is bounded + away-from-player + finite -----------------------------------------
{
  const maxBias = 0.5;
  // Bound holds for a sweep of player distances (non-vacuous: includes very close + very far).
  for (const d of [0.1, 0.5, 1, 2, 5, 20, 100]) {
    const b = hoverBias(d, 0, 0, 0, maxBias); // actor at (d,0), player at origin
    const mag = Math.hypot(b.x, b.z);
    assert.ok(mag <= maxBias + 1e-12, `‖bias‖ ${mag.toFixed(4)} ≤ maxBias ${maxBias} at d=${d}`);
    assert.ok(mag > 0, `bias is non-zero at d=${d}`);
    assert.ok(b.x > 0, `bias points AWAY from the player (+X) at d=${d}`);
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.z), `bias is finite at d=${d}`);
  }
  // Closer ⇒ stronger.
  const close = Math.hypot(...Object.values(hoverBias(0.5, 0, 0, 0, maxBias)));
  const far = Math.hypot(...Object.values(hoverBias(10, 0, 0, 0, maxBias)));
  assert.ok(close > far, `the bias is stronger when closer (${close.toFixed(3)} > ${far.toFixed(3)})`);
  // Degenerate cases → zero.
  assert.deepEqual(hoverBias(0, 0, 0, 0, maxBias), { x: 0, z: 0 }, "coincident → no bias");
  assert.deepEqual(hoverBias(1, 0, 0, 0, 0), { x: 0, z: 0 }, "maxBias 0 → no bias");
  assert.deepEqual(hoverBias(1, 0, 0, 0, NaN), { x: 0, z: 0 }, "non-finite maxBias → no bias");
  assert.deepEqual(hoverBias(2, 0, 0, 0, 0.5), hoverBias(2, 0, 0, 0, 0.5), "hoverBias is deterministic");
  ok("hoverBias is bounded (≤ maxBias), away-from-player, stronger-when-closer, finite + deterministic");
}

// --- 3. leanAmount ∈ [0, maxLean], 0 at the edge ------------------------------------------------
{
  const maxLean = 0.18;
  const radius = 6;
  assert.ok(near(leanAmount(0, radius, maxLean), maxLean), "at the centre → full lean");
  assert.equal(leanAmount(radius, radius, maxLean), 0, "at the zone edge → no lean");
  assert.equal(leanAmount(radius + 5, radius, maxLean), 0, "beyond the edge → clamped to 0");
  const mid = leanAmount(radius / 2, radius, maxLean);
  assert.ok(mid > 0 && mid < maxLean, `mid-zone lean is between 0 and maxLean (${mid.toFixed(3)})`);
  for (const d of [-1, 0, 1, 3, 6, 9]) {
    const l = leanAmount(d, radius, maxLean);
    assert.ok(l >= 0 && l <= maxLean, `lean ∈ [0, maxLean] at d=${d} (${l.toFixed(3)})`);
  }
  assert.equal(leanAmount(1, radius, 0), 0, "maxLean 0 → no lean");
  assert.equal(leanAmount(1, 0, maxLean), 0, "non-positive radius → no lean (safety)");
  ok("leanAmount is bounded [0, maxLean], full at centre, zero at/beyond the edge");
}

// --- 4. proximityActive is the single dormancy gate ---------------------------------------------
{
  assert.equal(proximityActive({ hasZone: true, inZone: true, defeated: false, reacting: false }), true, "alive + in-zone + not-reacting → active");
  assert.equal(proximityActive({ hasZone: false, inZone: true }), false, "no zone → dormant (no encounter)");
  assert.equal(proximityActive({ hasZone: true, inZone: false }), false, "out of zone → dormant");
  assert.equal(proximityActive({ hasZone: true, inZone: true, defeated: true }), false, "defeated → dormant (stops permanently)");
  assert.equal(proximityActive({ hasZone: true, inZone: true, reacting: true }), false, "reacting → dormant (combat feedback wins)");
  assert.equal(proximityActive(), false, "empty → dormant (safe default)");
  ok("proximityActive gates on zone + in-zone + alive + not-reacting (dormant otherwise)");
}

// --- 5. archetype proximity caps exist + are bounded; sentinel feedback is byte-stable ----------
{
  const s = archetypeFor(SENTINEL_TYPE).proximity;
  const w = archetypeFor(WISP_TYPE).proximity;
  assert.ok(s && Object.isFrozen(s), "the sentinel archetype carries a frozen proximity spec");
  assert.ok(Number.isFinite(s.turnRate) && s.turnRate > 0, "sentinel turnRate is finite + positive");
  assert.ok(Number.isFinite(s.maxLean) && s.maxLean > 0, "sentinel maxLean is finite + positive");
  assert.ok(w && Object.isFrozen(w), "the wisp archetype carries a frozen proximity spec");
  assert.ok(Number.isFinite(w.maxBias) && w.maxBias > 0, "wisp maxBias is finite + positive");
  assert.ok(w.maxBias < archetypeFor(WISP_TYPE).hover.radius, "the wisp bias is small vs its hover radius (stays in-zone)");

  // Byte-stability guard: adding `proximity` did NOT perturb the sentinel feedback constants.
  const fb = archetypeFor(SENTINEL_TYPE).feedback;
  assert.equal(fb.baseEmissive, 0.25, "sentinel base emissive unchanged");
  assert.equal(fb.flashIntensity, 1.5, "sentinel flash unchanged");
  assert.equal(fb.defeatColor, 0x39424d, "sentinel defeat colour unchanged");
  assert.equal(fb.defeatEmissive, 0.12, "sentinel defeat emissive unchanged");
  assert.equal(fb.flickerAmp, 0, "sentinel has no idle flicker (unchanged)");
  ok("archetype proximity caps are frozen + bounded; the sentinel feedback constants stay byte-stable");
}

console.log(`\nenemy proximity regression: ${passed} checks passed`);
