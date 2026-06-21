// test:enemy-patrol — pure-Node regression for Enemy-1 (bounded sentinel patrol). Movement is a MOTION
// OVERLAY on the Enemy-0 combat target, NOT AI: authored points only, deterministic, bounded to the
// encounter zone, terrain-safe, stops permanently on defeat. This proves the contract WITHOUT a browser:
//   - normalizePatrol whitelists points/speed/pauseSec/loop/alert/enabled; 2–4 points; <2 or non-finite
//     drops the patrol (→ null → stationary); clamps speed/pause; alert allow-list; round-trips,
//   - resolvePatrol is the terrain-safe gate (reuses height/water/snow/slope authority): a point over
//     water / above the snowline / too steep / outside the radius REJECTS the whole patrol (non-vacuous),
//     an all-good route is accepted with each point grounded to the surface,
//   - advancePatrol is deterministic (fixed dt → identical path), honors the dwell, ping-pongs and loops,
//     stays inside the radius every step, and a null/absent patrol never moves,
//   - the encounter descriptor carries `patrol` (object|null) through the whitelist + validation with ZERO
//     new warnings on a patrol-less beat (Enemy-0 byte-stable),
//   - the authored visual-benchmark crossing sentinel has a valid in-zone/dry/walkable patrol while the
//     cache sentinel stays stationary,
//   - the pure patrol modules have no THREE/DOM and no nondeterministic sources.
// The live move → strike-while-moving → defeat-freeze → reload-persists + 0-console-error path is the proof.

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  PATROL_POINTS_MIN,
  PATROL_POINTS_MAX,
  PATROL_SPEED_MIN,
  PATROL_SPEED_MAX,
  PATROL_SPEED_DEFAULT,
  PATROL_PAUSE_MAX,
  PATROL_RADIUS_MARGIN,
  ALERT_MODES,
  ALERT_DEFAULT,
  normalizePatrol,
  resolvePatrol,
} from "../src/world/enemies/PatrolTypes.js";
import { createPatrolMotion, advancePatrol } from "../src/world/enemies/PatrolMotion.js";
import { normalizeEncounterDescriptor, ENCOUNTER_TYPE } from "../src/world/encounters/EncounterTypes.js";
import { ENEMY_TYPE } from "../src/world/enemies/EnemyTypes.js";
import { createWorldDocument } from "../src/world/WorldDocument.js";
import { validateWorldDocument } from "../src/world/WorldValidation.js";
import { buildVisualBenchmarkV1 } from "../src/world/samples/visualBenchmarkV1.js";

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

// Synthetic terrain bundles (no real profile) so the gate's reject paths are non-vacuous and isolated.
const flatDry = {
  height: () => 10,
  waterLevel: () => 0, // 10 - 0 = 10 ≥ clearance → dry
  slope: () => 0.1, // gentle
  snowline: () => 1000, // far above → never snow
};
const point = (x, z, y = 0) => ({ x, y, z });

// --- 1. normalizePatrol: whitelist, point count, clamps, allow-list, round-trip -----------------
{
  const clean = normalizePatrol({
    enabled: true,
    points: [point(1, 0), point(-1, 0)],
    speed: 0.8,
    pauseSec: 1.0,
    loop: false,
    alert: "track",
    bogus: "dropped", // unknown key
  });
  assert.ok(clean, "a valid 2-point patrol normalizes");
  assert.equal(clean.points.length, 2, "both points kept");
  assert.equal(clean.bogus, undefined, "unknown keys are dropped");
  assert.equal(clean.alert, "track", "a known alert mode is kept");

  // <2 valid points → null (stationary)
  assert.equal(normalizePatrol({ points: [point(1, 0)] }), null, "1 point → null");
  assert.equal(normalizePatrol({ points: [] }), null, "0 points → null");
  assert.equal(normalizePatrol({ points: [point(1, 0), { x: NaN, y: 0, z: 0 }] }), null, "<2 FINITE points → null");
  assert.equal(normalizePatrol(null), null, "null raw → null");
  assert.equal(normalizePatrol({ enabled: false, points: [point(1, 0), point(-1, 0)] }), null, "enabled:false → null");

  // >4 points → capped to 4
  const many = normalizePatrol({ points: [point(0, 0), point(1, 0), point(2, 0), point(3, 0), point(4, 0), point(5, 0)] });
  assert.equal(many.points.length, PATROL_POINTS_MAX, "more than MAX points are capped to MAX");
  assert.ok(PATROL_POINTS_MAX === 4 && PATROL_POINTS_MIN === 2, "the 2–4 bound holds");

  // accepts array-form points too
  const arr = normalizePatrol({ points: [[1, 0, 2], [3, 0, 4]] });
  assert.deepEqual(arr.points, [{ x: 1, y: 0, z: 2 }, { x: 3, y: 0, z: 4 }], "array-form points canonicalize to {x,y,z}");

  // clamps
  assert.equal(normalizePatrol({ points: [point(1, 0), point(-1, 0)], speed: 999 }).speed, PATROL_SPEED_MAX, "speed clamps to MAX");
  assert.equal(normalizePatrol({ points: [point(1, 0), point(-1, 0)], speed: -5 }).speed, PATROL_SPEED_MIN, "speed clamps to MIN");
  assert.equal(normalizePatrol({ points: [point(1, 0), point(-1, 0)], speed: "x" }).speed, PATROL_SPEED_DEFAULT, "non-finite speed → default");
  assert.equal(normalizePatrol({ points: [point(1, 0), point(-1, 0)], pauseSec: 999 }).pauseSec, PATROL_PAUSE_MAX, "pause clamps to MAX");

  // alert allow-list + loop/enabled bools
  assert.equal(normalizePatrol({ points: [point(1, 0), point(-1, 0)], alert: "rampage" }).alert, ALERT_DEFAULT, "unknown alert → default (halt)");
  assert.deepEqual(ALERT_MODES, ["halt", "track", "none"], "the three alert modes are the allow-list");
  assert.equal(normalizePatrol({ points: [point(1, 0), point(-1, 0)], loop: "yes" }).loop, false, "non-true loop → false");
  assert.equal(normalizePatrol({ points: [point(1, 0), point(-1, 0)], loop: true }).loop, true, "loop:true kept");

  // round-trip: normalize(normalize(x)) === normalize(x)
  const once = normalizePatrol({ points: [point(1, 0), point(-1, 0)], speed: 0.8, pauseSec: 1, loop: true, alert: "none" });
  assert.deepEqual(normalizePatrol(once), once, "normalize is idempotent (round-trips)");
  ok("normalizePatrol: whitelist + 2–4 points + clamps + alert allow-list + round-trip");
}

// --- 2. resolvePatrol: terrain-safe gate (each reject path is non-vacuous) -----------------------
{
  const center = { x: 0, z: 0 };
  const radius = 8;
  const inZone = normalizePatrol({ points: [point(2, 0), point(-2, 0)], alert: "halt" });

  const good = resolvePatrol(inZone, { center, radius, terrain: flatDry });
  assert.ok(good, "an in-zone patrol on flat dry ground resolves");
  assert.equal(good.points.length, 2, "both points survive");
  assert.equal(good.points[0].y, 10, "each point's Y is snapped to terrain.height");
  assert.equal(good.alert, "halt", "alert mode carries through resolve");

  // outside radius (distance > radius - margin) → reject whole patrol
  const farPt = normalizePatrol({ points: [point(2, 0), point(radius + 1, 0)] });
  assert.equal(resolvePatrol(farPt, { center, radius, terrain: flatDry }), null, "a point outside the radius rejects the patrol");
  // a point exactly at the inner edge is fine; just past the margin is not
  const edge = normalizePatrol({ points: [point(0, 0), point(radius - PATROL_RADIUS_MARGIN - 0.01, 0)] });
  assert.ok(resolvePatrol(edge, { center, radius, terrain: flatDry }), "a point just inside the inner margin resolves");

  // over water → reject
  const water = { ...flatDry, waterLevel: () => 9.5 }; // height 10 < 9.5 + clearance(1.0) → submerged
  assert.equal(resolvePatrol(inZone, { center, radius, terrain: water }), null, "a point too near/under water rejects the patrol");
  // above snowline → reject
  const snow = { ...flatDry, snowline: () => 11 }; // height 10 > 11 - margin(2.0)=9 → snow band
  assert.equal(resolvePatrol(inZone, { center, radius, terrain: snow }), null, "a point above the snowline rejects the patrol");
  // too steep → reject
  const steep = { ...flatDry, slope: () => 0.9 }; // > slope limit 0.6
  assert.equal(resolvePatrol(inZone, { center, radius, terrain: steep }), null, "a point on steep ground rejects the patrol");
  // non-finite height → reject
  const nanH = { ...flatDry, height: () => NaN };
  assert.equal(resolvePatrol(inZone, { center, radius, terrain: nanH }), null, "a non-finite height rejects the patrol");

  // null patrol / bad ctx → null
  assert.equal(resolvePatrol(null, { center, radius, terrain: flatDry }), null, "null patrol → null");
  assert.equal(resolvePatrol(inZone, { center, radius, terrain: null }), null, "no terrain → null");
  assert.equal(resolvePatrol(inZone, { center, radius: 0, terrain: flatDry }), null, "non-positive radius → null");

  // auto-degrade: a dry/no-snow world (water -Infinity, snowline +Infinity) passes with only height
  const bare = { height: () => 5 };
  assert.ok(resolvePatrol(inZone, { center, radius, terrain: bare }), "a height-only (dry, no-snow) terrain auto-passes");
  ok("resolvePatrol: water/snow/steep/out-of-radius each reject (non-vacuous) + grounds Y + auto-degrades");
}

// --- 3. advancePatrol: determinism, dwell, ping-pong/loop, boundedness, defeat-freeze ------------
{
  const center = { x: 0, z: 0 };
  const radius = 8;
  const resolved = resolvePatrol(normalizePatrol({ points: [point(3, 0), point(-3, 0)], speed: 1.0, pauseSec: 0.5 }), { center, radius, terrain: flatDry });

  // determinism: two identical drives produce identical paths
  const drive = () => {
    let m = createPatrolMotion();
    const path = [];
    for (let k = 0; k < 200; k++) {
      const r = advancePatrol(m, resolved, 1 / 30);
      m = r.motion;
      path.push(r.position);
    }
    return path;
  };
  assert.deepEqual(drive(), drive(), "a fixed dt sequence yields an identical path (deterministic)");

  // boundedness: every sampled position is within the radius of center (convex blend of in-zone points)
  let m = createPatrolMotion();
  let moved = false;
  let dwelled = false;
  const start = { ...advancePatrol(m, resolved, 0).position };
  for (let k = 0; k < 600; k++) {
    const r = advancePatrol(m, resolved, 1 / 30);
    m = r.motion;
    const d = Math.hypot(r.position.x - center.x, r.position.z - center.z);
    assert.ok(d <= radius + 1e-6, `patrol stays within the radius (d=${d.toFixed(3)} ≤ ${radius})`);
    if (Math.hypot(r.position.x - start.x, r.position.z - start.z) > 0.5) moved = true;
    if (m.pauseLeft > 0) dwelled = true;
  }
  assert.ok(moved, "the body actually travels");
  assert.ok(dwelled, "the body dwells (pause is honored) at a turn point");

  // null/absent patrol never moves
  const r0 = advancePatrol(createPatrolMotion(), { points: [] }, 1 / 30);
  assert.deepEqual(r0.position, { x: 0, y: 0, z: 0 }, "an empty patrol holds at origin (no movement)");

  // ping-pong vs loop differ for ≥3 points
  const three = [point(3, 0), point(0, 3), point(-3, 0)];
  const pp = resolvePatrol(normalizePatrol({ points: three, loop: false, speed: 2, pauseSec: 0 }), { center, radius, terrain: flatDry });
  const lp = resolvePatrol(normalizePatrol({ points: three, loop: true, speed: 2, pauseSec: 0 }), { center, radius, terrain: flatDry });
  const visit = (res) => {
    let mm = createPatrolMotion();
    const seq = [];
    for (let k = 0; k < 400; k++) {
      const r = advancePatrol(mm, res, 1 / 30);
      mm = r.motion;
      if (r.position && mm.pauseLeft === 0 && mm.t === 0) seq.push(mm.i); // index just arrived
    }
    return seq.slice(0, 6).join(",");
  };
  assert.notEqual(visit(pp), visit(lp), "ping-pong and loop produce different visit orders for 3 points");

  // non-finite dt is a no-op (no NaN written)
  const safe = advancePatrol(createPatrolMotion(), resolved, NaN);
  assert.ok(Number.isFinite(safe.position.x) && Number.isFinite(safe.position.y) && Number.isFinite(safe.position.z), "a non-finite dt never writes NaN");
  ok("advancePatrol: deterministic + bounded + dwell + ping-pong≠loop + NaN-safe");
}

// --- 4. encounter descriptor carries patrol (object|null) + zero new warnings on a patrol-less beat
{
  const withPatrol = normalizeEncounterDescriptor({
    type: ENCOUNTER_TYPE,
    id: "beat-p",
    position: { x: 0, y: 0, z: 0 },
    radius: 8,
    enemyType: ENEMY_TYPE,
    patrol: { points: [point(1, 0), point(-1, 0)], alert: "halt" },
  });
  assert.ok(withPatrol.patrol && withPatrol.patrol.points.length === 2, "an authored patrol survives the encounter whitelist");

  const noPatrol = normalizeEncounterDescriptor({ type: ENCOUNTER_TYPE, id: "beat-s", position: { x: 0, y: 0, z: 0 }, enemyType: ENEMY_TYPE });
  assert.equal(noPatrol.patrol, null, "a beat without a patrol emits patrol:null (always-emit key)");

  // round-trip through normalize keeps patrol stable
  assert.deepEqual(normalizeEncounterDescriptor(withPatrol).patrol, withPatrol.patrol, "encounter patrol round-trips");

  // an invalid authored patrol degrades to null (not a thrown error / partial)
  const badPatrol = normalizeEncounterDescriptor({ type: ENCOUNTER_TYPE, id: "beat-b", position: { x: 0, y: 0, z: 0 }, enemyType: ENEMY_TYPE, patrol: { points: [point(1, 0)] } });
  assert.equal(badPatrol.patrol, null, "a <2-point authored patrol degrades to null");

  // zero new validation warnings on a patrol-less encounter (Enemy-0 byte-stable)
  const doc = createWorldDocument({ encounters: { version: 1, items: [{ type: ENCOUNTER_TYPE, id: "plain", position: { x: 0, y: 0, z: 0 }, enemyType: ENEMY_TYPE }] } });
  const { warnings, document: validated } = validateWorldDocument(doc);
  assert.equal(warnings.some((w) => /patrol/i.test(w)), false, "a patrol-less beat produces no patrol warning");
  assert.equal(validated.encounters.items[0].patrol, null, "a validated patrol-less beat has patrol:null");

  // a hostile patrol survives validation as a degraded/clamped value, never throwing
  const hostile = createWorldDocument({ encounters: { version: 1, items: [{ type: ENCOUNTER_TYPE, id: "h", position: { x: 0, y: 0, z: 0 }, enemyType: ENEMY_TYPE, patrol: { points: "boom", speed: Infinity, alert: 42 } }] } });
  const { document: safe } = validateWorldDocument(hostile);
  assert.equal(safe.encounters.items[0].patrol, null, "a hostile patrol degrades to null through validation");
  ok("encounter descriptor: patrol round-trips, degrades safely, zero new warnings on a patrol-less beat");
}

// --- 5. authored benchmark: crossing patrols (in-zone/dry/walkable); cache is stationary ----------
{
  const doc = buildVisualBenchmarkV1();
  const items = doc.encounters.items;
  const crossing = items.find((e) => e.id === "vb-crossing-sentinel");
  const cache = items.find((e) => e.id === "vb-cache-sentinel");
  assert.ok(crossing && cache, "both benchmark beats are present");

  assert.ok(crossing.patrol && crossing.patrol.points.length === 2, "the crossing sentinel has a 2-point patrol");
  assert.equal(crossing.patrol.alert, "halt", "the crossing patrol uses the halt telegraph");
  assert.equal(cache.patrol ?? null, null, "the cache sentinel stays stationary (no patrol)");

  // every authored crossing point is inside the zone radius (the resolve gate's radius rule, checked here
  // against the authored center so the in-scene proof can't be the first to discover an out-of-zone point)
  for (const p of crossing.patrol.points) {
    const d = Math.hypot(p.x - crossing.position.x, p.z - crossing.position.z);
    assert.ok(d <= crossing.radius - PATROL_RADIUS_MARGIN, `crossing patrol point is inside the zone (d=${d.toFixed(2)} ≤ ${crossing.radius})`);
  }
  // the authored points round-trip through normalize (the document is internally consistent)
  assert.deepEqual(normalizePatrol(crossing.patrol), crossing.patrol, "the authored crossing patrol is already normalized");
  ok("benchmark: crossing sentinel patrols in-zone; cache sentinel stays static");
}

// --- 6. static scans: the pure patrol modules carry no THREE/DOM and no nondeterministic sources --
{
  for (const rel of ["../src/world/enemies/PatrolTypes.js", "../src/world/enemies/PatrolMotion.js"]) {
    const src = fs.readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.equal(/from\s+["']three["']|require\(["']three["']\)/.test(src), false, `${rel} imports no THREE`);
    assert.equal(/\bdocument\b|\bwindow\b/.test(src), false, `${rel} touches no DOM`);
    assert.equal(/Math\.random|Date\.now|new Date\(|performance\.now/.test(src), false, `${rel} has no nondeterministic source`);
  }
  ok("static scans: patrol modules are pure (no THREE/DOM, no clock/randomness)");
}

console.log(`\nenemy-patrol regression: ${passed} checks passed`);
