// test:slice-select — pure-Node regression for Slice Select-1: the Playable Slice Catalog.
//
// Slice Select-1 exposes the three authored slices through an in-app catalog (catalog.html) instead of relying
// on hand-typed ?world= query strings. The catalog's single source of truth is the registry-adjacent metadata
// module src/world/samples/playableSlices.js. This gate proves that metadata is valid, complete, consistent with
// the slices it launches, and isolates per-slice persistence — WITHOUT touching the registry, the slice builders,
// or the global save key. The live "launch → play → return → no contamination" proof is test:slice-select-proof.

import assert from "node:assert/strict";
import fs from "node:fs";

import {
  PLAYABLE_SLICES,
  listPlayableSlices,
  getPlayableSlice,
  isPlayableSlice,
  playableSliceStorageKey,
} from "../src/world/samples/playableSlices.js";
import { getSampleWorld, listSampleWorlds } from "../src/world/samples/index.js";
import { WORLD_STORAGE_KEY } from "../src/world/WorldDocument.js";
import { resolveSliceIdentity } from "../src/world/slice/SliceIdentity.js";
import { VISUAL_BENCHMARK_ID } from "../src/world/samples/visualBenchmarkV1.js";
import { ICE_CHAPEL_ID } from "../src/world/samples/iceChapelV1.js";
import { FROST_CAUSEWAY_ID } from "../src/world/samples/frostCausewayV1.js";

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

const EXPECTED_PLAYABLE = [VISUAL_BENCHMARK_ID, ICE_CHAPEL_ID, FROST_CAUSEWAY_ID];
const DEV_SAMPLES = ["vertical-slice-v1", "enemy-archetype-lab"];

// --- 1. the catalog lists exactly the three authored slices, each with complete card metadata ---------------
{
  assert.equal(PLAYABLE_SLICES.length, 3, "exactly three playable slices");
  assert.deepEqual(PLAYABLE_SLICES.map((s) => s.id), EXPECTED_PLAYABLE, "the three authored slices, in order");
  const ids = new Set();
  for (const s of PLAYABLE_SLICES) {
    for (const field of ["id", "title", "description", "difficulty", "readability", "objective"]) {
      assert.ok(typeof s[field] === "string" && s[field].trim() !== "", `${s.id}: non-empty ${field}`);
    }
    assert.ok(!ids.has(s.id), `unique id ${s.id}`);
    ids.add(s.id);
  }
  // listPlayableSlices returns a fresh array (callers can't mutate the source).
  const a = listPlayableSlices();
  assert.notEqual(a, PLAYABLE_SLICES, "listPlayableSlices returns a fresh array");
  assert.deepEqual(a.map((s) => s.id), EXPECTED_PLAYABLE, "…with the same contents");
  ok("metadata: exactly three playable slices, each with complete, unique card metadata");
}

// --- 2. every playable id is a registered sample; the dev/test samples are NOT in the catalog ---------------
{
  for (const s of PLAYABLE_SLICES) {
    const doc = getSampleWorld(s.id);
    assert.ok(doc && typeof doc === "object", `${s.id} resolves via getSampleWorld (a real registered sample)`);
  }
  const registeredIds = new Set(listSampleWorlds().map((s) => s.id));
  for (const s of PLAYABLE_SLICES) assert.ok(registeredIds.has(s.id), `${s.id} is in the sample registry`);
  for (const dev of DEV_SAMPLES) {
    assert.ok(registeredIds.has(dev), `${dev} is a registered sample`);
    assert.equal(isPlayableSlice(dev), false, `${dev} is NOT a player-facing catalog slice`);
    assert.ok(!PLAYABLE_SLICES.some((s) => s.id === dev), `${dev} is not listed in the catalog`);
  }
  ok("registry: every catalog slice is registered; the dev/test samples are excluded");
}

// --- 3. each card title equals the slice's OWN authored identity (the catalog never disagrees with the slice) -
{
  for (const s of PLAYABLE_SLICES) {
    const doc = getSampleWorld(s.id);
    assert.equal(s.title, doc.slice.title, `${s.id}: card title "${s.title}" == authored doc.slice.title "${doc.slice?.title}"`);
    assert.equal(s.title, resolveSliceIdentity(doc).title, `${s.id}: card title matches the resolved in-game identity`);
  }
  ok("fidelity: each card title equals the slice's authored completion identity");
}

// --- 4. per-slice persistence isolation (the cross-slice-contamination fix) ---------------------------------
{
  const keys = PLAYABLE_SLICES.map((s) => playableSliceStorageKey(s.id));
  // distinct per slice
  assert.equal(new Set(keys).size, keys.length, "each slice has a distinct storage key");
  for (const s of PLAYABLE_SLICES) {
    const key = playableSliceStorageKey(s.id);
    assert.ok(key.startsWith(WORLD_STORAGE_KEY), `${s.id}: key derives from the global key`);
    assert.notEqual(key, WORLD_STORAGE_KEY, `${s.id}: key is NOT the global key (no contamination of the editor save)`);
    assert.ok(key.includes(s.id), `${s.id}: key is namespaced by the slice id`);
  }
  // helpers behave for playable / dev / unknown ids
  for (const s of PLAYABLE_SLICES) {
    assert.equal(isPlayableSlice(s.id), true, `${s.id} is playable`);
    assert.equal(getPlayableSlice(s.id)?.id, s.id, `getPlayableSlice(${s.id}) returns it`);
  }
  assert.equal(getPlayableSlice("nope-not-a-slice"), null, "getPlayableSlice(unknown) is null");
  assert.equal(isPlayableSlice("nope-not-a-slice"), false, "isPlayableSlice(unknown) is false");
  assert.equal(isPlayableSlice(undefined), false, "isPlayableSlice(undefined) is false");
  ok("isolation: per-slice keys are distinct, derived-but-not-equal to the global key; helpers behave");
}

// --- 5. the metadata module is pure (no RNG / wall-clock) ----------------------------------------------------
{
  const src = fs.readFileSync(new URL("../src/world/samples/playableSlices.js", import.meta.url), "utf8");
  assert.equal(/Math\.random|Date\.now|new Date\(|performance\.now/.test(src), false, "playableSlices.js has no RNG/wall-clock");
  ok("static: the catalog metadata is deterministic (no RNG / wall-clock)");
}

// --- 6b. the catalog entry is a LEAF: it imports no engine-heavy module (so the catalog bundle stays tiny) ---
// playableSlices.js once imported the three FULL sample builders just to read three string-literal ids, which
// (via the ESM import closure) pulled the whole THREE engine into the catalog page bundle. Pin the catalog
// files to a strict leaf allow-list so that can never regress — the menu must not boot the engine.
{
  const importsOf = (rel) =>
    [...fs.readFileSync(new URL(rel, import.meta.url), "utf8").matchAll(/^\s*import\b[^;]*?["']([^"']+)["']/gm)].map((m) => m[1]);
  assert.deepEqual(importsOf("../src/world/samples/playableSlices.js"), ["../storageKeys.js"], "playableSlices.js imports ONLY the THREE-free storage-key leaf (no sample builders / WorldDocument / THREE)");
  assert.deepEqual(importsOf("../src/catalog/catalogMain.js"), ["../world/samples/playableSlices.js"], "catalogMain.js imports ONLY the catalog metadata");
  assert.deepEqual(importsOf("../src/world/storageKeys.js"), [], "the storage-key leaf imports nothing (a true leaf)");
  ok("bundle: the catalog entry is a leaf — no engine-heavy import reaches the catalog page");
}

// --- 6c. the local slice ids stay pinned to the builders' canonical *_ID exports (no drift) -----------------
// playableSlices.js holds the ids as literals (so it imports no heavy builder); assert they still match the
// canonical exports here in Node (where importing the builders is free).
{
  const expected = { "visual-benchmark-1": VISUAL_BENCHMARK_ID, "ice-chapel-1": ICE_CHAPEL_ID, "frost-causeway-1": FROST_CAUSEWAY_ID };
  for (const s of PLAYABLE_SLICES) {
    assert.equal(s.id, expected[s.id], `card id ${s.id} equals the builder's canonical *_ID export`);
  }
  ok("ids: the catalog's local slice ids are pinned to the builders' canonical exports (drift-guarded)");
}

// --- 6. byte-stability guards: registry + global key + default identity unchanged ---------------------------
{
  assert.equal(WORLD_STORAGE_KEY, "grass-world-builder-save", "the global save key is unchanged");
  assert.equal(listSampleWorlds().length, 5, "the sample registry still lists all five samples (catalog adds none)");
  assert.equal(resolveSliceIdentity({}).title, "The Frozen Cache", "the default slice identity is unchanged (frozen slices safe)");
  ok("byte-stability: global save key, sample registry, and default identity all unchanged");
}

console.log(`\nslice-select (Playable Slice Catalog) regression: ${passed} checks passed`);
