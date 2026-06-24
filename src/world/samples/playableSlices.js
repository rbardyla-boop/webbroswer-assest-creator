// Slice Select-1 — the playable-slice catalog metadata, authored BESIDE the sample registry (index.js) so the
// catalog has a single source of truth that lives next to the registration, not inside a runtime system.
//
// Not every registered sample is a player-facing slice: `vertical-slice-v1` and `enemy-archetype-lab` are
// developer/test worlds. PLAYABLE_SLICES is the curated subset a player sees in the catalog — the three authored
// 5–10 minute runs. Each entry carries the card copy (description / difficulty / readability / objective); the
// `title` MUST equal the slice's own authored `doc.slice.title` (the in-game completion identity) so the catalog
// never disagrees with the slice it launches (asserted in test:slice-select).
//
// Pure data + pure helpers (no THREE, no DOM, no RNG, no wall-clock) — AND deliberately a LEAF: it imports only
// the THREE-free storage-key constant, never the sample builders or WorldDocument.js (whose ESM closures pull in
// the whole engine). That keeps the catalog page's bundle tiny (it imports this module). The slice ids are kept
// as local literals; test:slice-select pins them to the builders' canonical *_ID exports, so a drift is caught
// at test time without a runtime import of the heavy modules.
//
// The per-slice storage key derives from the global WORLD_STORAGE_KEY so a catalog-launched slice persists its
// completion/reward under its OWN slot — each slice isolated, and never touching the global editor save (the
// cross-slice-contamination fix).

import { WORLD_STORAGE_KEY } from "../storageKeys.js";

// The registered sample ids of the three authored slices (canonical source: the *_ID exports in each builder;
// pinned here by test:slice-select). Held as literals so this leaf imports no engine-heavy sample module.
const VISUAL_BENCHMARK_ID = "visual-benchmark-1";
const ICE_CHAPEL_ID = "ice-chapel-1";
const FROST_CAUSEWAY_ID = "frost-causeway-1";

/**
 * The curated, ordered list of player-facing slices. `title` mirrors each slice's authored `doc.slice.title`.
 * @type {ReadonlyArray<{ id: string, title: string, description: string, difficulty: string, readability: string, objective: string }>}
 */
export const PLAYABLE_SLICES = Object.freeze([
  Object.freeze({
    id: VISUAL_BENCHMARK_ID,
    title: "The Relic Overlook",
    description: "An open glacial overlook above the pass. Bright, exposed, and easy to read — the gentlest of the three.",
    difficulty: "Gentle",
    readability: "Open & bright",
    objective: "Find the relic, carry it past the crossing to the cache beyond the pass · 3 encounters",
  }),
  Object.freeze({
    id: ICE_CHAPEL_ID,
    title: "The Ice Chapel",
    description: "A cold, enclosed descent down a broken stair into a misted chapel on the valley floor.",
    difficulty: "Steady",
    readability: "Enclosed & cold",
    objective: "Bear the relic down the broken stair to the chapel seal · 2 encounters",
  }),
  Object.freeze({
    id: FROST_CAUSEWAY_ID,
    title: "The Frost Causeway",
    description: "A pale whiteout crossing: climb a broken ridge to the relic, then bear it down across an exposed causeway.",
    difficulty: "Exposed",
    readability: "Pale whiteout",
    objective: "Climb to the relic, carry it down across the causeway to the basin seal · 3 encounters",
  }),
]);

const BY_ID = new Map(PLAYABLE_SLICES.map((s) => [s.id, s]));

/** The ordered catalog list (a fresh array; the entries are frozen). */
export function listPlayableSlices() {
  return PLAYABLE_SLICES.slice();
}

/** The catalog entry for an id, or null if the id is not a player-facing slice. */
export function getPlayableSlice(id) {
  return BY_ID.get(id) ?? null;
}

/** Whether an id is a curated player-facing slice (vs a dev/test sample or an unknown id). */
export function isPlayableSlice(id) {
  return BY_ID.has(id);
}

/**
 * The per-slice persistence key — a save slot derived from the global key, distinct per slice and NEVER equal to
 * the global key. A catalog-launched slice uses this so its completion/reward stay isolated (no cross-slice
 * contamination) and the global editor save is left untouched.
 */
export function playableSliceStorageKey(id) {
  return `${WORLD_STORAGE_KEY}:slice:${id}`;
}
