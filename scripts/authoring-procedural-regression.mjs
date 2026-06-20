// test:authoring-procedural — pure-Node regression for Procedural Authoring-1's data,
// validation, and derivation layers (no browser needed):
//   - the authoring validation boundary (whitelist + caps + drop rules),
//   - falsey booleans survive save→load, unknown keys are dropped, no schema bump,
//   - the beacon-trail derivation is deterministic + mask-gated,
//   - a dangling modifier reference is skipped, not crashed,
//   - the authored benchmark scene is deterministic + has no nondeterministic sources.
// The live draw/triangle budget + editor undo/persist are covered by the browser proof.

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  AUTHORING_LIMITS,
  createMask,
  createModifier,
  createSpline,
  normalizeMaskDescriptor,
  normalizeModifierDescriptor,
  normalizeSplineDescriptor,
  sanitizeAuthoringBlock,
} from "../src/world/authoring/AuthoringTypes.js";
import { deriveBeaconTrail } from "../src/world/authoring/BeaconTrailModifier.js";
import { createWorldDocument, WORLD_DOCUMENT_VERSION } from "../src/world/WorldDocument.js";
import { validateWorldDocument } from "../src/world/WorldValidation.js";
import { WorldSerializer } from "../src/world/WorldSerializer.js";
import { authoredProceduralScene } from "../src/perf/BenchmarkScenes.js";

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

const flatPoints = [
  { x: 0, y: 0, z: 0 },
  { x: 10, y: 0, z: 0 },
  { x: 20, y: 0, z: 0 },
  { x: 30, y: 0, z: 0 },
];

// --- 1. spline validation ----------------------------------------------------
{
  assert.equal(normalizeSplineDescriptor({ id: "s", points: flatPoints.slice(0, 2) }), null, "<3 points → drop");
  const nanPoints = [...flatPoints]; nanPoints[1] = { x: NaN, y: 0, z: 0 };
  assert.equal(normalizeSplineDescriptor({ id: "s", points: nanPoints }), null, "a NaN point poisons + drops the spline");
  const infPoints = [...flatPoints]; infPoints[2] = { x: 0, y: Infinity, z: 0 };
  assert.equal(normalizeSplineDescriptor({ id: "s", points: infPoints }), null, "an Infinity point drops the spline");

  const many = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 0, z: 0 }));
  const capped = normalizeSplineDescriptor({ id: "s", points: many });
  assert.equal(capped.points.length, AUTHORING_LIMITS.MAX_SPLINE_POINTS, ">8 points clamp to MAX");

  // unknown keys dropped; falsey enabled survives; locked default false
  const s = normalizeSplineDescriptor({ id: "path!!", name: "P", points: flatPoints, enabled: false, evil: 1 });
  assert.equal(s.enabled, false, "enabled:false survives normalization");
  assert.equal(s.locked, false, "locked defaults false");
  assert.equal(s.id, "path", "id is sanitized (special chars stripped)");
  assert.equal("evil" in s, false, "unknown key is dropped");
  ok("spline validation: count guard, NaN/Inf drop, cap, whitelist, falsey-enabled");
}

// --- 2. mask validation ------------------------------------------------------
{
  assert.equal(normalizeMaskDescriptor({ shape: "circle", center: { x: 0, y: 0, z: 0 }, radius: 0 }), null, "circle radius 0 → drop");
  assert.equal(normalizeMaskDescriptor({ shape: "circle", center: { x: NaN, y: 0, z: 0 }, radius: 5 }), null, "non-finite center → drop");
  assert.equal(normalizeMaskDescriptor({ shape: "box", center: { x: 0, y: 0, z: 0 }, half: { x: -1, z: 5 } }), null, "box non-positive half → drop");
  const big = normalizeMaskDescriptor({ shape: "circle", center: { x: 0, y: 0, z: 0 }, radius: 99999 });
  assert.equal(big.radius, AUTHORING_LIMITS.MASK_RADIUS_MAX, "huge radius clamps to MAX");
  const m = normalizeMaskDescriptor({ id: "a", shape: "weird", center: { x: 1, y: 2, z: 3 }, radius: 8, falloff: 5 });
  assert.equal(m.shape, "circle", "unknown shape → circle");
  assert.equal(m.falloff, 1, "falloff clamps to [0,1]");
  ok("mask validation: radius/center guards, clamp, shape allowlist, falloff clamp");
}

// --- 3. modifier validation --------------------------------------------------
{
  assert.equal(normalizeModifierDescriptor({ type: "beacon-trail" }), null, "no splineId → drop");
  assert.equal(normalizeModifierDescriptor({ type: "nope", splineId: "s" }), null, "unknown type → drop");
  const mod = normalizeModifierDescriptor({ id: "mymod", type: "beacon-trail", splineId: "s", markerCount: 9999, ring: false, enabled: false });
  assert.equal(mod.markerCount, AUTHORING_LIMITS.MAX_MARKERS, "markerCount clamps to MAX");
  assert.equal(mod.ring, false, "ring:false survives");
  assert.equal(mod.enabled, false, "enabled:false survives");
  assert.equal(mod.maskId, null, "absent maskId → null (mask is optional)");
  assert.equal(mod.seed, "mymod", "seed falls back to the modifier id (a stable string, not random)");
  ok("modifier validation: splineId required, type allowlist, clamp, optional mask, falsey survival");
}

// --- 4. block sanitization + caps + warnings ---------------------------------
{
  const warnings = [];
  const empty = sanitizeAuthoringBlock(undefined, warnings);
  assert.deepEqual(empty, { version: 1, splines: [], masks: [], modifiers: [] }, "empty/undefined block → clean default");
  assert.deepEqual(warnings, [], "empty block emits ZERO warnings");

  const overCap = { splines: Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, points: flatPoints })) };
  const w2 = [];
  const safe = sanitizeAuthoringBlock(overCap, w2);
  assert.equal(safe.splines.length, AUTHORING_LIMITS.MAX_SPLINES, "splines capped at MAX_SPLINES");
  assert.equal(w2.length, 1, "over-cap emits exactly one warning");
  ok("block sanitization: clean default, zero-warning empty, cap + warning");
}

// --- 5. derivation determinism + mask gating ---------------------------------
{
  const spline = createSpline({ id: "s", points: flatPoints });
  const mask = createMask({ id: "m", center: { x: 15, y: 0, z: 0 }, radius: 30 });
  const mod = createModifier({ id: "mod", splineId: "s", maskId: "m", seed: "fixed", markerCount: 16 });

  const a = deriveBeaconTrail(mod, spline, mask);
  const b = deriveBeaconTrail(mod, spline, mask);
  assert.deepEqual(a, b, "same (modifier, spline, mask) → byte-identical layout");
  assert.ok(a.markers.length > 0, "covering mask yields markers");
  assert.ok(a.markers.every((m) => Number.isFinite(m.x) && Number.isFinite(m.y) && Number.isFinite(m.z) && m.scale > 0), "every marker is finite + positively scaled");
  assert.ok(a.ring && Number.isFinite(a.ring.radius), "a ring is derived from the mask");

  // A mask far from the path gates ALL markers out (deterministically empty trail).
  const farMask = createMask({ id: "m2", center: { x: 1000, y: 0, z: 1000 }, radius: 5 });
  const empty = deriveBeaconTrail(createModifier({ id: "mod2", splineId: "s", maskId: "m2", seed: "fixed" }), spline, farMask);
  assert.equal(empty.markers.length, 0, "a non-covering mask yields zero markers");

  // markerCount caps the sample budget (ungated).
  const ungated = deriveBeaconTrail(createModifier({ id: "mod3", splineId: "s", seed: "fixed", markerCount: 12 }), spline, null);
  assert.equal(ungated.markers.length, 12, "ungated trail places exactly markerCount markers");
  assert.equal(ungated.ring, null, "no mask → no ring");
  ok("derivation: deterministic, mask-gated, marker-count-bounded, finite");
}

// --- 6. getHeight grounding is applied ---------------------------------------
{
  const spline = createSpline({ id: "s", points: flatPoints });
  const grounded = deriveBeaconTrail(createModifier({ id: "g", splineId: "s", seed: "s", markerCount: 4 }), spline, null, { getHeight: () => 12.5 });
  assert.ok(grounded.markers.every((m) => m.y > 12.4 && m.y < 13), "markers are grounded on getHeight (+clearance)");
  ok("derivation: getHeight grounding applied");
}

// --- 7. serialization round-trip (no schema bump, falsey survival) -----------
{
  globalThis.localStorage = (() => {
    const store = new Map();
    return { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() };
  })();

  const authoring = {
    version: 1,
    splines: [createSpline({ id: "s", points: flatPoints, name: "Path" })],
    masks: [createMask({ id: "m", center: { x: 0, y: 0, z: 0 }, radius: 20 })],
    modifiers: [createModifier({ id: "mod", splineId: "s", maskId: "m", seed: "seed", ring: false })],
  };
  authoring.splines[0].enabled = false; // prove a falsey boolean round-trips

  const doc = createWorldDocument({ authoring });
  const serializer = new WorldSerializer();
  serializer.save(doc);
  const loaded = serializer.load().document;

  assert.equal(loaded.version, WORLD_DOCUMENT_VERSION, "version stays 2 (no schema bump)");
  assert.equal(loaded.version, 2, "version is literally 2");
  assert.equal(loaded.authoring.splines.length, 1, "spline survives save→load");
  assert.equal(loaded.authoring.splines[0].enabled, false, "spline enabled:false survives the round-trip");
  assert.equal(loaded.authoring.modifiers[0].ring, false, "modifier ring:false survives the round-trip");
  assert.equal(loaded.authoring.masks[0].radius, 20, "mask radius survives the round-trip");

  // Idempotent: validating the loaded doc again is a fixed point (no drift, no growth).
  const again = validateWorldDocument(loaded).document;
  assert.deepEqual(again.authoring, loaded.authoring, "re-validation is a fixed point (idempotent)");
  ok("serialization: round-trips, no schema bump, falsey survival, idempotent");
}

// --- 8. dangling reference is tolerated (skipped, not crashed) ----------------
{
  // The validator keeps a syntactically-clean modifier whose spline was dropped — the
  // runtime resolves + skips it (tested in the browser proof). Here: it doesn't crash
  // validation and derivation guards a missing spline.
  const block = sanitizeAuthoringBlock({
    splines: [], // no splines
    modifiers: [{ id: "mod", type: "beacon-trail", splineId: "ghost", seed: "x" }],
  });
  assert.equal(block.modifiers.length, 1, "modifier with a dangling splineId is kept (resolved at runtime)");
  assert.equal(deriveBeaconTrail(block.modifiers[0], null, null), null, "derivation guards a missing spline → null, no throw");
  ok("dangling reference: kept syntactically, derivation guards null spline");
}

// --- 9. authored benchmark scene determinism + no nondeterministic sources ---
{
  // Compare the deterministic authored CONTENT — not document.metadata, whose createdAt/
  // updatedAt are wall-clock timestamps stamped by createWorldDocument (comparing the
  // whole scene would be ~20% flaky across a millisecond boundary).
  assert.deepEqual(authoredProceduralScene().document.authoring, authoredProceduralScene().document.authoring, "authoredProceduralScene authored content is deterministic (same call → same content)");
  const a = authoredProceduralScene().document.authoring;
  assert.equal(a.modifiers.length, 1, "authored scene carries one modifier");
  assert.equal(a.splines[0].points.length, 5, "authored scene spline has 5 points");

  for (const rel of ["AuthoringTypes.js", "BeaconTrailModifier.js", "AuthoringRuntime.js"]) {
    const src = fs.readFileSync(new URL(`../src/world/authoring/${rel}`, import.meta.url), "utf8");
    assert.equal(/Math\.random|Date\.now|new Date\(/.test(src), false, `${rel} has no Math.random/Date`);
  }
  ok("benchmark scene determinism + authoring modules have no nondeterministic sources");
}

console.log(`\nauthoring-procedural regression: ${passed} checks passed`);
