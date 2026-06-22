// Slice Authoring Kit-1 — composition validators. Turn the coherence rules both slice regressions assert by
// hand into ONE reusable check, so the next slice proves it is coherent (and a malformed slice is rejected
// with a precise reason) before it ships. Pure + Node-safe.
//
// NOTE: validateSliceComposition activates the document's terrain profile (setTerrainProfile) so walkability is
// sampled against the slice's OWN seeded field — this flips the global active profile as a side effect, exactly
// as the slice builders' activateProfile does. Validate one document at a time; re-validating re-activates.

import { setTerrainProfile } from "../../terrain/terrainSampling.js";
import { createTerrainProfile } from "../../terrain/profiles/index.js";
import { deriveSites, isWalkable } from "../objectives/RelicWeaponObjective.js";
import { ENCOUNTER_TYPE } from "../encounters/EncounterTypes.js";
import { SENTINEL_TYPE, WISP_TYPE } from "../enemies/EnemyTypes.js";

const CARRY_MIN = 20; // relic + cache must be meaningfully apart (a real route)
const ROUTE_BAND = 14; // landmarks must frame the spawn→relic→cache route within this perp distance
const CENTERLINE_CLEAR = 2.5; // the carry-centerline midpoint must be unobstructed by this margin
const REWARD_OFFSET_MIN = 4; // an optional reward must sit off the direct carry line (a detour, not a blocker)
const VALID_ENEMY_TYPES = new Set([SENTINEL_TYPE, WISP_TYPE]);

export const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Perpendicular distance from point p to the segment a→b.
export function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz || 1;
  let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

// Distance from p to the nearest of the three route legs (spawn→relic, relic→cache, spawn→cache).
export function onRoute(p, { spawn, relic, cache }) {
  return Math.min(distToSegment(p, spawn, relic), distToSegment(p, relic, cache), distToSegment(p, spawn, cache));
}

/**
 * Validate an authored slice WorldDocument's composition. Returns { ok, issues:[] } (issues are precise,
 * human-readable reasons). Checks: an authored identity; a dry-walkable spawn; coherent auto-derived objective
 * sites (relic/cache walkable + a real carry); landmarks that frame the route with the carry centerline clear;
 * an orientation sign; an optional reward kept off the carry line; and valid, distinct combat beats.
 *
 * @param {object} doc - a WorldDocument (built by a slice builder)
 * @param {{ expectBeats?: number }} opts
 */
export function validateSliceComposition(doc, { expectBeats } = {}) {
  const issues = [];
  if (!doc || typeof doc !== "object") return { ok: false, issues: ["document is not an object"] };

  // Sample against THIS document's terrain (the seeded field its landmarks/objective were grounded on).
  setTerrainProfile(createTerrainProfile(doc.terrain ?? {}));

  // 1. authored slice identity
  if (!doc.slice || typeof doc.slice !== "object" || typeof doc.slice.title !== "string" || doc.slice.title.trim() === "") {
    issues.push("missing authored slice identity (doc.slice.title)");
  }

  // 2. dry-walkable spawn
  const spawn = doc.player?.spawn;
  if (!spawn || !Number.isFinite(spawn.x) || !Number.isFinite(spawn.z)) {
    issues.push("missing/invalid player spawn");
    return { ok: false, issues }; // everything downstream depends on the spawn
  }
  if (!isWalkable(spawn.x, spawn.z)) issues.push("spawn is not on dry walkable ground");

  // 3. coherent auto-derived objective sites (the runtime derives relic→cache from the spawn)
  const sites = deriveSites({ x: spawn.x, z: spawn.z });
  const relicWalkable = isWalkable(sites.relic.x, sites.relic.z);
  const cacheWalkable = isWalkable(sites.cache.x, sites.cache.z);
  const carry = dist2(sites.relic, sites.cache);
  if (!relicWalkable) issues.push("derived relic site is not walkable");
  if (!cacheWalkable) issues.push("derived cache site is not walkable");
  if (carry <= CARRY_MIN) issues.push(`relic↔cache carry too short (${carry.toFixed(1)} <= ${CARRY_MIN}) — no real route`);

  const layout = { spawn: { x: spawn.x, z: spawn.z }, relic: sites.relic, cache: sites.cache };

  // 4. landmarks frame the route + the carry centerline is unobstructed
  const landmarks = Array.isArray(doc.objects) ? doc.objects.filter((o) => o?.transform?.position && Number.isFinite(o.transform.position.x)) : [];
  if (landmarks.length < 1) {
    issues.push("no authored landmarks");
  } else {
    const strays = landmarks.filter((lm) => onRoute(lm.transform.position, layout) > ROUTE_BAND);
    if (strays.length) issues.push(`${strays.length} landmark(s) stray off the route (>${ROUTE_BAND}m): ${strays.slice(0, 3).map((s) => s.id).join(", ")}`);
    const mid = { x: (layout.spawn.x + layout.cache.x) / 2, z: (layout.spawn.z + layout.cache.z) / 2 };
    const nearestToMid = Math.min(...landmarks.map((lm) => dist2(lm.transform.position, mid)));
    if (nearestToMid < CENTERLINE_CLEAR) issues.push(`carry centerline midpoint blocked (nearest landmark ${nearestToMid.toFixed(1)}m < ${CENTERLINE_CLEAR}m)`);
  }

  // 5. an orientation sign (a readable role:"sign" interaction)
  const signs = landmarks.filter((o) => o.interaction && o.interaction.role === "sign");
  if (signs.length < 1) issues.push('no orientation sign (an object with interaction.role === "sign")');

  // 6. optional reward stays off the carry line (a detour, not a blocker)
  const rewards = Array.isArray(doc.runtimeAssets?.items) ? doc.runtimeAssets.items.filter((i) => i?.kind === "generated.weapon") : [];
  for (const r of rewards) {
    const p = r.transform?.position;
    if (p && distToSegment(p, layout.spawn, layout.cache) <= REWARD_OFFSET_MIN) {
      issues.push(`reward ${r.id} sits on the carry line (a detour must be off it)`);
    }
  }

  // 7. valid, distinct combat beats
  const beats = Array.isArray(doc.encounters?.items) ? doc.encounters.items : [];
  if (typeof expectBeats === "number" && beats.length !== expectBeats) {
    issues.push(`expected ${expectBeats} combat beats, found ${beats.length}`);
  }
  const beatIds = new Set();
  for (const b of beats) {
    if (b.type !== ENCOUNTER_TYPE) issues.push(`beat ${b.id} is not a ${ENCOUNTER_TYPE}`);
    if (b.enemyCount !== 1) issues.push(`beat ${b.id} has enemyCount ${b.enemyCount} (slices stage single-enemy beats, no waves)`);
    if (!VALID_ENEMY_TYPES.has(b.enemyType)) issues.push(`beat ${b.id} has unknown enemyType ${b.enemyType}`);
    if (!b.position || !["x", "y", "z"].every((k) => Number.isFinite(b.position[k]))) issues.push(`beat ${b.id} has a non-finite position`);
    if (beatIds.has(b.id)) issues.push(`duplicate beat id ${b.id}`);
    beatIds.add(b.id);
  }

  return { ok: issues.length === 0, issues };
}

/** Throwing wrapper (for tests / authoring scripts). */
export function assertSliceComposition(doc, opts) {
  const { ok, issues } = validateSliceComposition(doc, opts);
  if (!ok) throw new Error(`slice composition invalid:\n  - ${issues.join("\n  - ")}`);
  return true;
}
