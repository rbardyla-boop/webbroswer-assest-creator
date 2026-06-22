// Content-5 — the playable slice's COMPLETION IDENTITY (its name + arrival tagline + ending copy). PURE
// glue: no THREE, no DOM, no RNG, no clock. The generic slice wrapper (FrozenCacheSlice) loads for ANY
// objective-bearing world, so without this every slice's completion card / arrival banner reads "The Frozen
// Cache". An optional authored `document.slice` block lets a scene name its own ending; absent → the DEFAULT
// (the exact frozen-cache copy), so the frozen-cache + first-playable slices stay byte-identical.
//
// The block is OPTIONAL and NOT part of createWorldDocument's defaults: worlds that author none keep no
// `slice` key (zero-warning-empty, byte-stable validation). When present it is sanitized on load — it can
// arrive from untrusted localStorage and flows to the completion card, so the fields are whitelisted +
// length-capped here and rendered via textContent (never innerHTML) by the card.

// The default identity is byte-exact to the strings the CompletionCard markup and sliceBanner ARRIVAL line
// carried before Content-5 (title.toUpperCase() === "THE FROZEN CACHE"). Changing these reverts that copy.
export const DEFAULT_SLICE_IDENTITY = Object.freeze({
  title: "The Frozen Cache",
  arrivalTagline: "Recover the marked relic",
  completeBody: "The relic is secure. Its trophy remains in the valley.",
});

// Per-field length caps (defense in depth against an over-long persisted/authored value reaching the UI).
const FIELD_MAX = Object.freeze({ title: 64, arrivalTagline: 96, completeBody: 240 });
const FIELDS = Object.freeze(["title", "arrivalTagline", "completeBody"]);

/** A trimmed, length-capped non-empty string, or null. */
function cleanString(value, max) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * Sanitize an authored/persisted `slice` identity block. Whitelists ONLY the three known string fields
 * (drops unknown keys + non-strings), trims + length-caps each. Returns `undefined` when nothing valid is
 * present so the caller can drop the key entirely (keeping default worlds byte-stable). Never throws.
 * @param {unknown} block
 * @param {string[]} [warnings]
 * @returns {{title?:string,arrivalTagline?:string,completeBody?:string}|undefined}
 */
export function sanitizeSliceIdentity(block, warnings = []) {
  if (!block || typeof block !== "object" || Array.isArray(block)) {
    if (block !== undefined && block !== null) warnings.push("Slice identity was not an object; it was dropped.");
    return undefined;
  }
  const out = {};
  for (const key of FIELDS) {
    const cleaned = cleanString(block[key], FIELD_MAX[key]);
    if (cleaned != null) out[key] = cleaned;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Resolve the effective slice identity for a loaded document: the authored `doc.slice` fields merged over
 * the DEFAULT (per-field fallback), so a missing block or a partial block always yields a complete, sane
 * identity. Pure + deterministic. (Param named `doc`, not `document`, so this module reads as DOM-free.)
 * @param {{slice?:object}} [doc]
 * @returns {{title:string,arrivalTagline:string,completeBody:string}}
 */
export function resolveSliceIdentity(doc) {
  const block = doc && typeof doc.slice === "object" && !Array.isArray(doc.slice) ? doc.slice : null;
  const out = {};
  for (const key of FIELDS) {
    out[key] = cleanString(block?.[key], FIELD_MAX[key]) ?? DEFAULT_SLICE_IDENTITY[key];
  }
  return out;
}

/** The arrival-beat banner line for an identity: "<TITLE> · <tagline>" (title upper-cased). */
export function sliceArrivalBanner(identity = DEFAULT_SLICE_IDENTITY) {
  const id = identity ?? DEFAULT_SLICE_IDENTITY;
  const title = typeof id.title === "string" && id.title.trim() !== "" ? id.title : DEFAULT_SLICE_IDENTITY.title;
  const tagline = typeof id.arrivalTagline === "string" && id.arrivalTagline.trim() !== "" ? id.arrivalTagline : DEFAULT_SLICE_IDENTITY.arrivalTagline;
  return `${title.toUpperCase()} · ${tagline}`;
}
