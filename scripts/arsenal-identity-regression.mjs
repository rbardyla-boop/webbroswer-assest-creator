// test:arsenal-identity — pure-Node regression for Arsenal v5 derived identity. Identity
// (name/tier/hash/profile) is recomputed from the recipe, never persisted, so it must be
// deterministic AND byte-stable across the sanitize round-trip the persistence path applies.
// Also re-asserts the strengthened variant grammar's invariants and that the three new arsenal
// identity modules stay deterministic (no Math.random/Date/performance). Imports THREE only via
// the geometry builder (works headless, like arsenal-regression).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rollConfig, WEAPON_TYPES, ARSENAL_LIMITS } from "../src/arsenal/WeaponConfig.js";
import { generateWeaponRecipe } from "../src/arsenal/WeaponGrammar.js";
import { buildWeaponParts } from "../src/arsenal/WeaponGeometry.js";
import { recipeHash, weaponAssetId } from "../src/arsenal/WeaponRecipe.js";
import { sanitizeWeaponRecipe } from "../src/arsenal/WeaponRecipeValidation.js";
import { weaponIdentity, weaponName, weaponTier } from "../src/arsenal/WeaponIdentity.js";
import { relicProfile, tierColor, tierLabel } from "../src/arsenal/WeaponRelicProfiles.js";

const recipeOf = (seed, type) => generateWeaponRecipe(rollConfig(seed, type));

// --- 1. determinism + canonical reuse ----------------------------------------------
{
  const r = recipeOf("det", "longarm");
  assert.equal(weaponName(r), weaponName(r), "name deterministic");
  assert.deepEqual(weaponIdentity(r), weaponIdentity(r), "identity deterministic");
  assert.equal(weaponIdentity(r).id, weaponAssetId(r), "id reuses canonical weaponAssetId");
  assert.equal(weaponIdentity(r).hash, recipeHash(r), "hash reuses canonical recipeHash");
  assert.ok(typeof weaponName(r) === "string" && weaponName(r).length > 0, "name is a non-empty string");
}

// --- 2. reload-stability across the persistence sanitize boundary -------------------
// The derived-identity-survives-reload claim: sanitizeWeaponRecipe preserves every identity
// input, so identity recomputed on the sanitized recipe is byte-identical (no persisted field).
for (const type of WEAPON_TYPES) {
  const recipe = recipeOf(`reload-${type}`, type);
  const san = sanitizeWeaponRecipe(recipe);
  assert.equal(recipeHash(san), recipeHash(recipe), `${type}: recipeHash stable across sanitize`);
  assert.equal(weaponName(san), weaponName(recipe), `${type}: name stable across sanitize`);
  assert.deepEqual(weaponIdentity(san), weaponIdentity(recipe), `${type}: identity stable across sanitize`);
  // The persistence path sanitizes more than once (store add + load); pin idempotency so a
  // second pass can never drift identity.
  assert.deepEqual(weaponIdentity(sanitizeWeaponRecipe(san)), weaponIdentity(recipe), `${type}: identity stable across a double sanitize`);
}

// --- 3. names visibly differ across seeds (collision-tolerant) ----------------------
{
  const N = 24;
  // Either the grand "<Noun> of the <Adj> <Core>" form or "<Prefix> <Core> <Suffix> Mk.N".
  const SHAPE = /^.+ of the .+ .+$|^.+ .+ .+ Mk\.\d+$/;
  for (const type of WEAPON_TYPES) {
    const names = [];
    for (let i = 0; i < N; i++) names.push(weaponName(recipeOf(`dist-${type}-${i}`, type)));
    for (const n of names) assert.match(n, SHAPE, `${type}: name is well-formed ("${n}")`);
    const uniq = new Set(names).size;
    assert.ok(uniq >= Math.ceil(N * 0.9), `${type}: names distinct across seeds (${uniq}/${N})`);
  }
}

// --- 4. tier mapping: 1..5, monotonic vs rarity floor, energy bump, clamp ------------
{
  assert.equal(weaponTier({ rarity: "common", counts: { energy: 0 } }), 1, "common low-energy → tier 1");
  assert.equal(weaponTier({ rarity: "mythic", counts: { energy: 10 } }), 5, "mythic high-energy → tier 5");
  assert.equal(weaponTier({ rarity: "mythic", counts: { energy: 0 } }), 4, "mythic floor without the energy bump");
  assert.deepEqual(
    ["common", "rare", "epic", "mythic"].map((r) => weaponTier({ rarity: r, counts: { energy: 0 } })),
    [1, 2, 3, 4],
    "tier monotonic vs rarity floor",
  );
  assert.equal(weaponTier({ rarity: "nope", counts: {} }), 1, "unknown rarity → tier 1 (no NaN)");
  for (const type of WEAPON_TYPES) {
    const t = weaponTier(recipeOf(`tier-${type}`, type));
    assert.ok(Number.isInteger(t) && t >= 1 && t <= 5, `${type}: tier in [1,5]`);
  }
}

// --- 5. relic profile: relic-grade forcing + tier palette ---------------------------
{
  assert.equal(tierLabel(5), "Relic", "top tier reads Relic");
  assert.equal(tierColor(5), "#ffe070", "relic-grade gold matches the objective marker colour");
  assert.equal(tierLabel(99), "Relic", "tier label clamps high");
  assert.equal(tierLabel(-3), "Tier I", "tier label clamps low");
  assert.match(tierColor(2), /^#[0-9a-f]{6}$/i, "tier colour is a hex string");

  const heavy = recipeOf("relic.fp1", "heavy"); // mirrors RelicWeaponObjective.relicRecipe()
  const forced = relicProfile(heavy, { relicGrade: true });
  assert.equal(forced.tier, 5, "relicGrade forces tier 5 regardless of rolled rarity");
  assert.equal(forced.label, "Relic", "relicGrade label is Relic");
  assert.equal(forced.color, "#ffe070", "relicGrade colour is relic gold");
  assert.equal(forced.identity.name, weaponName(heavy), "profile carries the derived procedural name");
  assert.deepEqual(relicProfile(heavy, { relicGrade: true }), forced, "relicProfile deterministic");
  const natural = relicProfile(heavy);
  assert.ok(natural.tier >= 1 && natural.tier <= 5, "natural (un-forced) tier in range");
}

// --- 6. strengthened variant grammar keeps its hard invariants ----------------------
for (const type of WEAPON_TYPES) {
  const r = recipeOf(`v5-${type}`, type);
  assert.ok(r.counts.energy >= 1, `${type}: still >=1 energy part (core anchor)`);
  assert.ok(r.counts.parts > 0 && r.counts.parts <= ARSENAL_LIMITS.MAX_PARTS, `${type}: parts within cap (${r.counts.parts})`);
  const { parts, vertexCount } = buildWeaponParts(r);
  assert.ok(parts.length >= 1, `${type}: geometry built`);
  assert.ok(vertexCount <= ARSENAL_LIMITS.MAX_VERTICES, `${type}: vertex budget honoured (${vertexCount})`);
  for (const p of parts) assert.ok(p.position.every(Number.isFinite), `${type}: finite part position`);
}

// --- 7. the new arsenal identity modules are deterministic --------------------------
for (const f of ["WeaponIdentity.js", "WeaponRelicProfiles.js", "WeaponVariantGrammar.js"]) {
  const src = readFileSync(new URL(`../src/arsenal/${f}`, import.meta.url), "utf8");
  assert.ok(!/Math\.random\s*\(|Date\.now\s*\(|performance\.now\s*\(/.test(src), `${f} calls no nondeterministic time/random`);
}

console.log("arsenal-identity regression checks passed");
