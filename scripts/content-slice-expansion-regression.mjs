// test:content-slice-expansion — pure-Node regression for Content-2 (authored slice expansion).
//
// Content-2 turns the visual-benchmark corridor into a fuller authored slice using EXISTING systems only
// (no new runtime code, no movement AI, no renderer work). It adds ONE discoverable off-route moment — a
// frozen shrine alcove beside the relic ruin — that bundles three beats:
//   - EXPLORATION: a shrine structure (vb-shrine-* primitives) tucked ~9m off the route,
//   - READABLE:    a sign (data-only Interaction) that names the place + points on to the cache,
//   - ENVIRONMENT: a brooding fog pocket (smoke particles) on the idol,
//   - REWARD:      an optional generated weapon (runtimeAssets) the player may claim or ignore.
// The two combat beats + the relic/cache objective are UNCHANGED (byte-stable). This gate proves the
// AUTHORED ARTIFACT + the data contracts; the live slice (visible, claimable, both encounters + objective
// complete, reload-safe, performance-green) is test:content-slice-expansion-proof.

import assert from "node:assert/strict";

import { buildVisualBenchmarkV1, visualBenchmarkLayout } from "../src/world/samples/visualBenchmarkV1.js";
import { validateWorldDocument } from "../src/world/WorldValidation.js";
import { PARTICLE_KINDS } from "../src/particles/ParticleTypes.js";
import { normalizeRuntimeAssetDescriptor } from "../src/world/assets/RuntimeAssetTypes.js";

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz || 1;
  let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}
const onRoute = (p, L) => Math.min(distToSegment(p, L.spawn, L.relic), distToSegment(p, L.relic, L.cache), distToSegment(p, L.spawn, L.cache));

const SHRINE_IDS = ["vb-shrine-base", "vb-shrine-idol", "vb-shrine-ward-l", "vb-shrine-ward-r"];

// --- 1. the frozen shrine alcove (exploration beat, off-route) ---------------
{
  const doc = buildVisualBenchmarkV1();
  const L = visualBenchmarkLayout();
  const shrine = doc.objects.filter((o) => typeof o.id === "string" && o.id.startsWith("vb-shrine-"));
  assert.equal(shrine.length, 4, "the shrine alcove authors four vb-shrine-* primitives");
  assert.deepEqual(shrine.map((o) => o.id).sort(), [...SHRINE_IDS].sort(), "the shrine primitives have the expected ids");
  for (const o of shrine) {
    assert.equal(o.type, "primitive", `${o.id} is a primitive (no new GLB)`);
    assert.ok(["x", "y", "z"].every((k) => Number.isFinite(o.transform.position[k])), `${o.id} has a finite grounded position`);
    // Off-route but within the route band (a short detour, not scattered) — and clear of the carry line.
    assert.ok(onRoute(o.transform.position, L) <= 14, `${o.id} stays within the route band (${onRoute(o.transform.position, L).toFixed(1)}m <= 14)`);
  }
  // The shrine is on the RELIC side (a discovery by the ruin), not on the open carry centerline.
  const idol = shrine.find((o) => o.id === "vb-shrine-idol");
  assert.ok(dist2(idol.transform.position, L.relic) <= 14, "the shrine sits beside the relic ruin (a tied-in discovery)");
  const mid = { x: (L.spawn.x + L.cache.x) / 2, z: (L.spawn.z + L.cache.z) / 2 };
  assert.ok(Math.min(...shrine.map((o) => dist2(o.transform.position, mid))) >= 6, "the shrine never obstructs the carry centerline midpoint");
  ok("exploration: a 4-piece frozen shrine alcove beside the relic ruin, off-route within the corridor band");
}

// --- 2. the readable sign (data-only interaction; wayfinding flavour) ---------
{
  const doc = buildVisualBenchmarkV1();
  const idol = doc.objects.find((o) => o.id === "vb-shrine-idol");
  const sign = idol?.interaction;
  assert.ok(sign, "the shrine idol carries an interaction");
  assert.equal(sign.role, "sign", "it is a sign (a readable beat, not a mechanic gate)");
  assert.ok(typeof sign.text === "string" && sign.text.length > 0, "the sign has text");
  assert.ok(sign.text.length <= 280, "the sign text is within the interaction limit (<=280)");
  assert.match(sign.text, /cache|crossing|pass/i, "the sign points the player on (wayfinding / objective clarity)");
  assert.ok(Number.isFinite(sign.showRadius) && sign.showRadius > 0, "the sign has a finite show radius");
  // The sign survives validation (sanitizeInteraction keeps it, strips nothing material here).
  const res = validateWorldDocument(doc);
  const loadedIdol = res.document.objects.find((o) => o.id === "vb-shrine-idol");
  assert.equal(loadedIdol?.interaction?.role, "sign", "the sign survives save→load validation");
  assert.equal(loadedIdol?.interaction?.text, sign.text, "the sign text round-trips intact");
  ok("readable: the shrine idol carries a save-stable sign that names the place + points on to the cache");
}

// --- 3. the environmental beat (a brooding fog pocket on the idol) ------------
{
  const doc = buildVisualBenchmarkV1();
  const idol = doc.objects.find((o) => o.id === "vb-shrine-idol");
  assert.ok(idol?.particles, "the shrine idol emits particles (the environmental beat)");
  assert.equal(idol.particles.kind, "smoke", "the shrine pocket is a smoke (fog) emitter");
  assert.ok(PARTICLE_KINDS.includes(idol.particles.kind), "the emitter kind is valid");
  // The slice now stages FOUR ambient emitters (relic spark, crossing dust, cache spark, shrine smoke).
  const emitters = doc.objects.filter((o) => o.particles);
  assert.ok(emitters.length >= 4, `the slice now stages >=4 ambient emitters (${emitters.length})`);
  const res = validateWorldDocument(doc);
  assert.equal(res.document.objects.find((o) => o.id === "vb-shrine-idol")?.particles?.kind, "smoke", "the fog pocket survives validation");
  ok(`environment: a brooding smoke fog pocket on the shrine idol; ${emitters.length} ambient emitters total`);
}

// --- 4. the optional reward weapon (runtimeAssets, rebuilt from a recipe) -----
{
  const doc = buildVisualBenchmarkV1();
  const block = doc.runtimeAssets;
  assert.ok(block && Array.isArray(block.items), "the slice authors a runtimeAssets block");
  assert.equal(block.items.length, 1, "exactly one authored optional weapon (the relic is runtime-spawned, not authored)");
  const weapon = block.items[0];
  assert.equal(weapon.kind, "generated.weapon", "the reward is a generated weapon");
  assert.equal(weapon.id, "vb-shrine-relic-weapon", "the reward has its own id (distinct from the objective relic)");
  assert.notEqual(weapon.id, "relic-weapon-fp1", "the reward is NOT the objective relic (independent loot)");
  assert.equal(weapon.recipe?.type, "exotic", "the reward is an exotic relic");
  assert.equal(weapon.runtime?.state, "idle", "the reward starts idle (findable in the world)");
  // It is a valid runtime-asset descriptor (would instantiate at load) + deterministic.
  assert.ok(normalizeRuntimeAssetDescriptor(weapon), "the reward descriptor normalizes (would instantiate)");
  assert.deepEqual(buildVisualBenchmarkV1().runtimeAssets, block, "the reward (recipe + transform) is deterministic across builds");
  // It survives validation as a runtime asset.
  const res = validateWorldDocument(doc);
  assert.equal(res.document.runtimeAssets.items.length, 1, "the reward weapon survives validation");
  assert.equal(res.document.runtimeAssets.items[0].id, "vb-shrine-relic-weapon", "the reward id round-trips");
  ok("reward: one optional exotic generated weapon (recipe-rebuilt, deterministic, distinct from the relic)");
}

// --- 5. the two combat beats + the objective axis are UNCHANGED (byte-stable) -
{
  const doc = buildVisualBenchmarkV1();
  const L = visualBenchmarkLayout();
  // Encounters: the two Content-1 SENTINEL beats are byte-stable (Content-2 added no encounter). Content-3
  // later APPENDED one frost_wisp beat at items[2]; items[0]/[1] (the sentinels) stay byte-identical.
  const enc = doc.encounters.items;
  assert.equal(enc.length, 3, "three combat beats (Content-2 added none; Content-3 appended the cache wisp)");
  assert.deepEqual(enc.slice(0, 2).map((b) => b.id), ["vb-crossing-sentinel", "vb-cache-sentinel"], "the two Content-1 sentinel beats are byte-stable (id/order — Content-2 added no encounter)");
  assert.deepEqual(enc.slice(0, 2).map((b) => b.label), ["the crossing", "the pass"], "the two sentinel beat labels are unchanged");
  assert.equal(enc[0].radius, 8, "the crossing beat radius is unchanged");
  assert.equal(enc[1].radius, 6, "the cache-gate beat radius is unchanged");
  assert.equal(enc[2].id, "vb-cache-wisp", "Content-3 appended the frost_wisp beat at items[2] (sentinels unmoved)");
  // The relic/cache objective axis is unchanged (the runtime auto-objective is untouched — no objectives block).
  assert.equal(doc.objectives.items.length, 0, "no authored objectives block (the runtime still owns the relic loop)");
  // The spawn + the carry axis are unchanged.
  assert.deepEqual(doc.player.spawn, { x: L.spawn.x, y: doc.player.spawn.y, z: L.spawn.z }, "the spawn is unchanged");
  ok("invariants: the two combat beats + the relic/cache objective axis are byte-stable (Content-2 only added off-route content)");
}

// --- 6. determinism + object budget headroom ---------------------------------
{
  const a = buildVisualBenchmarkV1();
  const b = buildVisualBenchmarkV1();
  assert.deepEqual(a.objects, b.objects, "the expanded object composition is deterministic");
  // The slice stays a compact corridor well under the authored cap, with perf headroom. The Performance
  // Contract gates the LIVE runtime object count (objectManager.objects.size) at objects: 24 for this scene
  // (re-locked for Content-2; that runtime count also includes runtime-spawned weapons). This authored
  // primitive count is the separate, tighter source guard that the authored cluster stays within it.
  assert.ok(a.objects.length <= 60, `compact slice: ${a.objects.length} authored objects (<= 60)`);
  const primitives = a.objects.filter((o) => o.type === "primitive").length;
  assert.ok(primitives <= 24, `authored primitive count within the re-locked Performance Contract objects ceiling (${primitives} <= 24)`);
  ok(`determinism: the expanded slice is deterministic; ${a.objects.length} objects (${primitives} primitives) within budget`);
}

console.log(`\ncontent-slice-expansion regression: ${passed} checks passed`);
