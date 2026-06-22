// test:content-5-slice-completion — pure-Node regression for Content-5 (playable slice completion pass). The
// generic playable-slice wrapper loads for ANY objective-bearing world, so without a per-scene identity every
// slice's completion card + arrival banner read "The Frozen Cache". Content-5 adds an OPTIONAL authored
// `document.slice` identity (default = the byte-exact frozen-cache copy) + an opening orientation sign, so the
// benchmark run reads as a deliberate beginning + ending. This proves: the DEFAULT identity is byte-stable
// (frozen-cache/first-playable unchanged), the resolve/sanitize behaviour, the authored benchmark identity +
// orientation sign, the additive/optional/persistence-safe block, and SliceIdentity purity. The live run
// (opening banner, de-noised threat, recovery, scene-coherent completion card, reload) is the browser proof.
//
// Non-goals (asserted by absence): no health/death/attacks/combat rules — Content-5 is authored data + a
// scene-coherent identity over the EXISTING feedback stack.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  DEFAULT_SLICE_IDENTITY,
  resolveSliceIdentity,
  sanitizeSliceIdentity,
  sliceArrivalBanner,
} from "../src/world/slice/SliceIdentity.js";
import { sliceBanner, SLICE_BEATS } from "../src/world/slice/SliceBeats.js";
import { buildVisualBenchmarkV1 } from "../src/world/samples/visualBenchmarkV1.js";
import { validateWorldDocument } from "../src/world/WorldValidation.js";
import { createWorldDocument } from "../src/world/WorldDocument.js";

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

// --- 1. the DEFAULT identity is byte-exact (frozen-cache / first-playable stay unchanged) --------------
{
  // The exact strings the CompletionCard markup + the sliceBanner ARRIVAL line carried before Content-5.
  assert.equal(DEFAULT_SLICE_IDENTITY.title, "The Frozen Cache", "default title is byte-exact");
  assert.equal(DEFAULT_SLICE_IDENTITY.arrivalTagline, "Recover the marked relic", "default arrival tagline is byte-exact");
  assert.equal(DEFAULT_SLICE_IDENTITY.completeBody, "The relic is secure. Its trophy remains in the valley.", "default completion body is byte-exact");
  // A 2-arg sliceBanner caller (or a doc with no slice) reproduces the original arrival banner string.
  assert.equal(sliceBanner(SLICE_BEATS.ARRIVAL, ""), "THE FROZEN CACHE · Recover the marked relic", "ARRIVAL banner unchanged for the default identity (2-arg call)");
  assert.equal(sliceArrivalBanner(), "THE FROZEN CACHE · Recover the marked relic", "sliceArrivalBanner() default is byte-exact");
  // A document with NO authored slice (the frozen-cache / first-playable play slices) resolves to default.
  assert.deepEqual(resolveSliceIdentity(createWorldDocument()), { ...DEFAULT_SLICE_IDENTITY }, "a doc with no `slice` resolves to the byte-exact default");
  assert.equal(sliceBanner(SLICE_BEATS.JOURNEY, "Relic Objective — carry"), "Relic Objective — carry", "non-ARRIVAL beats are unchanged (pass-through objective text)");
  ok("the DEFAULT slice identity is byte-exact — the frozen-cache/first-playable card + arrival banner are unchanged");
}

// --- 2. resolveSliceIdentity merges over default; sanitizeSliceIdentity whitelists + bounds -------------
{
  // Full authored block → used verbatim.
  const full = resolveSliceIdentity({ slice: { title: "The Pass", arrivalTagline: "Cross over", completeBody: "Done." } });
  assert.deepEqual(full, { title: "The Pass", arrivalTagline: "Cross over", completeBody: "Done." }, "a full authored block is resolved verbatim");
  // Partial block → per-field fallback to default.
  const partial = resolveSliceIdentity({ slice: { title: "The Pass" } });
  assert.equal(partial.title, "The Pass", "authored field wins");
  assert.equal(partial.arrivalTagline, DEFAULT_SLICE_IDENTITY.arrivalTagline, "missing field falls back to default");
  assert.equal(partial.completeBody, DEFAULT_SLICE_IDENTITY.completeBody, "missing field falls back to default");
  // Missing / malformed blocks → full default.
  assert.deepEqual(resolveSliceIdentity({}), { ...DEFAULT_SLICE_IDENTITY }, "no block → default");
  assert.deepEqual(resolveSliceIdentity({ slice: null }), { ...DEFAULT_SLICE_IDENTITY }, "null block → default");
  assert.deepEqual(resolveSliceIdentity({ slice: [] }), { ...DEFAULT_SLICE_IDENTITY }, "array block → default (not an object)");
  assert.deepEqual(resolveSliceIdentity(undefined), { ...DEFAULT_SLICE_IDENTITY }, "no document → default");

  // sanitize: whitelist known string fields, drop unknown keys + non-strings, trim, cap length.
  const warnings = [];
  const clean = sanitizeSliceIdentity({ title: "  The Pass  ", arrivalTagline: 42, completeBody: "End.", evil: "<script>", onclick: "x" }, warnings);
  assert.deepEqual(clean, { title: "The Pass", completeBody: "End." }, "sanitize keeps only valid known string fields (trimmed), drops unknown keys + non-strings");
  assert.equal(sanitizeSliceIdentity(undefined), undefined, "absent block → undefined (caller drops the key)");
  assert.equal(sanitizeSliceIdentity({}), undefined, "empty block → undefined");
  assert.equal(sanitizeSliceIdentity({ title: "   " }), undefined, "all-whitespace → undefined");
  const long = sanitizeSliceIdentity({ title: "x".repeat(500) });
  assert.ok(long.title.length <= 64, `over-long title is length-capped (${long.title.length} <= 64)`);
  ok("resolveSliceIdentity merges over default; sanitizeSliceIdentity whitelists known strings, drops the rest, bounds length");
}

// --- 3. the benchmark authors its identity + an opening orientation sign --------------------------------
{
  const doc = buildVisualBenchmarkV1();
  // the authored slice identity names this scene's run (NOT the frozen cache).
  assert.ok(doc.slice && typeof doc.slice === "object", "the benchmark authors a `slice` identity block");
  assert.equal(doc.slice.title, "The Relic Overlook", "the benchmark names itself 'The Relic Overlook' (not 'The Frozen Cache')");
  assert.notEqual(doc.slice.title, DEFAULT_SLICE_IDENTITY.title, "the benchmark identity differs from the default (the bug it fixes)");
  assert.equal(resolveSliceIdentity(doc).title, "The Relic Overlook", "resolveSliceIdentity returns the overlook identity for the benchmark");
  assert.equal(sliceBanner(SLICE_BEATS.ARRIVAL, "", resolveSliceIdentity(doc)), "THE RELIC OVERLOOK · Bear the relic to the cache beyond the pass", "the benchmark arrival banner names the slice + goal");

  // the opening orientation sign — data-only, readable, on-route.
  const sign = doc.objects.find((o) => o.id === "vb-orientation-sign");
  assert.ok(sign, "the benchmark authors a vb-orientation-sign primitive");
  assert.equal(sign.assetRef, null, "the orientation sign is a primitive (no asset dependency)");
  assert.ok(sign.interaction && sign.interaction.role === "sign", "the orientation sign carries a data-only sign interaction");
  assert.ok(typeof sign.interaction.text === "string" && sign.interaction.text.length > 20, "the sign text is non-empty");
  assert.ok(/relic|cache|pass/i.test(sign.interaction.text), "the sign frames the loop (relic → cache → pass)");
  assert.ok(/fell you|shove you back|fall back/i.test(sign.interaction.text), "the sign teaches the non-lethal recovery rule");
  assert.ok(Number.isFinite(sign.interaction.showRadius) && sign.interaction.showRadius > 0, "the sign has a finite show radius");
  assert.ok(Number.isFinite(sign.transform.position.x) && Number.isFinite(sign.transform.position.z), "the sign is placed on finite ground");
  ok("the benchmark authors the overlook identity + a data-only opening orientation sign");
}

// --- 4. the `slice` block is additive, sanitized, and persistence-safe (survives save→load) ------------
{
  // present: validate keeps the overlook identity (sanitized) and it survives a JSON round-trip + re-validate.
  const built = buildVisualBenchmarkV1();
  const v1 = validateWorldDocument(built);
  assert.ok(v1.document.slice && v1.document.slice.title === "The Relic Overlook", "validation keeps the authored identity");
  const round = validateWorldDocument(JSON.parse(JSON.stringify(v1.document))); // the WorldSerializer save→load path (minus localStorage)
  assert.deepEqual(round.document.slice, v1.document.slice, "the `slice` identity survives a save→load round-trip (persistence-safe)");
  // the orientation sign also survives validation (sanitizeInteraction) and the scene stays within budget.
  const signAfter = v1.document.objects.find((o) => o.id === "vb-orientation-sign");
  assert.ok(signAfter && signAfter.interaction && signAfter.interaction.role === "sign", "the orientation sign interaction survives validation");
  assert.ok(v1.document.objects.length <= 60, `compact scene stays within the authored-object budget (${v1.document.objects.length} <= 60)`);

  // absent: a world with NO slice validates WITHOUT adding the key + with no extra warnings (byte-stable).
  const plain = createWorldDocument();
  assert.equal(plain.slice, undefined, "createWorldDocument does NOT add a `slice` block by default");
  const vp = validateWorldDocument(plain);
  assert.equal(vp.document.slice, undefined, "validating a world with no `slice` leaves no `slice` key (absent-default, byte-stable)");
  assert.deepEqual(vp.warnings, [], "validating a slice-less world emits no warnings (zero-warning-empty)");
  // a malformed block is dropped (not an object) WITH a warning, never reaching the card unsanitized.
  const bad = validateWorldDocument({ ...createWorldDocument(), slice: "evil" });
  assert.equal(bad.document.slice, undefined, "a non-object `slice` is dropped on validation");
  assert.ok(bad.warnings.some((w) => /slice identity/i.test(w)), "a malformed `slice` records a warning");
  ok("the `slice` block is additive, sanitized, persistence-safe, and absent-by-default (no schema bump, zero-warning-empty)");
}

// --- 5. SliceIdentity stays PURE (no THREE/DOM/RNG/clock) ----------------------------------------------
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, "..", "src", "world", "slice", "SliceIdentity.js"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of [/\bfrom\s+["']three["']/, /\bMath\.random\b/, /\bDate\.now\b/, /\bperformance\.now\b/, /\bdocument\b/, /\bwindow\b/]) {
    assert.ok(!forbidden.test(code), `SliceIdentity.js stays pure — no ${forbidden}`);
  }
  ok("SliceIdentity stays pure — no THREE/DOM/RNG/clock (Node-testable identity glue)");
}

console.log(`\ncontent-5 slice-completion regression: ${passed} checks passed`);
