// test:arsenal — pure-Node determinism + safety regression for the Procedural Arsenal
// Lab. Imports THREE (works headless, like the world regression) and exercises the
// grammar + geometry directly: same seed → identical recipe, different seed varies,
// hostile config is clamped, every type yields ≥1 energy part, and the built geometry
// is finite + within the vertex budget. No browser needed.

import assert from "node:assert/strict";
import { createWeaponConfig, rollConfig, WEAPON_TYPES, ARSENAL_LIMITS, PARAM_RANGES } from "../src/arsenal/WeaponConfig.js";
import { generateWeaponRecipe, hslToHex } from "../src/arsenal/WeaponGrammar.js";
import { buildWeaponParts } from "../src/arsenal/WeaponGeometry.js";

// --- config clamping (defense in depth) --------------------------------------------
const hostile = createWeaponConfig({ seed: "a<script> b", type: "nope", rarity: "x", length: 999, bulk: -5, barrelCount: 99, coilRings: 1e9, fins: -3, energyHue: 5, glassIOR: 0 });
assert.equal(hostile.type, "sidearm", "unknown type → sidearm");
assert.equal(hostile.rarity, "common", "unknown rarity → common");
assert.equal(hostile.seed, "ascript b", "seed sanitized to safe charset");
assert.equal(hostile.length, PARAM_RANGES.length.max, "length clamped to max");
assert.equal(hostile.bulk, PARAM_RANGES.bulk.min, "bulk clamped to min");
assert.equal(hostile.barrelCount, ARSENAL_LIMITS.MAX_BARRELS, "barrelCount clamped to cap");
assert.equal(hostile.fins, PARAM_RANGES.fins.min, "fins clamped to min");
assert.ok(Number.isInteger(hostile.coilRings) && hostile.coilRings <= ARSENAL_LIMITS.MAX_COIL_RINGS, "coilRings integer + capped");
assert.equal(createWeaponConfig(null).type, "sidearm", "null override → valid default config");

// --- color helper -------------------------------------------------------------------
assert.match(hslToHex(0.55, 0.85, 0.6), /^#[0-9a-f]{6}$/, "hslToHex → #rrggbb");
assert.equal(hslToHex(0, 0, 0), "#000000");
assert.equal(hslToHex(0, 0, 1), "#ffffff");

// --- per-type: determinism, variation, caps, geometry -------------------------------
for (const type of WEAPON_TYPES) {
  const cfg = rollConfig("regress", type);
  assert.deepEqual(rollConfig("regress", type), cfg, "rollConfig fully deterministic");

  const r1 = generateWeaponRecipe(cfg);
  const r2 = generateWeaponRecipe(cfg);
  assert.deepEqual(r1, r2, `${type}: same config → identical recipe`);
  assert.notDeepEqual(generateWeaponRecipe(rollConfig("other-seed", type)), r1, `${type}: different seed varies`);

  assert.ok(r1.counts.parts > 0 && r1.counts.parts <= ARSENAL_LIMITS.MAX_PARTS, `${type}: parts within cap (${r1.counts.parts})`);
  assert.ok(r1.counts.energy >= 1, `${type}: has ≥1 energy part (the identity)`);
  assert.equal(r1.type, type);
  assert.match(r1.material.energyColor, /^#[0-9a-f]{6}$/);

  const { parts, vertexCount } = buildWeaponParts(r1);
  assert.ok(parts.length >= 1, `${type}: geometry built`);
  assert.ok(vertexCount <= ARSENAL_LIMITS.MAX_VERTICES, `${type}: vertex budget honored (${vertexCount})`);
  for (const p of parts) {
    assert.ok(p.position.every(Number.isFinite) && p.axis.every(Number.isFinite), `${type}: finite transform`);
    assert.ok(p.geometry.attributes.position.array.every(Number.isFinite), `${type}: finite vertex positions`);
    assert.ok(p.geometry.attributes.color, `${type}: vertex colors present`);
    assert.ok(p.geometry.attributes.normal, `${type}: normals present`);
  }
}

// --- a hostile config still produces a bounded, finite weapon ------------------------
const hostileBuild = buildWeaponParts(generateWeaponRecipe(hostile));
assert.ok(hostileBuild.parts.length >= 1 && hostileBuild.vertexCount <= ARSENAL_LIMITS.MAX_VERTICES, "hostile config → bounded weapon");
for (const p of hostileBuild.parts) {
  assert.ok(p.geometry.attributes.position.array.every(Number.isFinite), "hostile config: finite vertex positions");
}

console.log("arsenal regression checks passed");
