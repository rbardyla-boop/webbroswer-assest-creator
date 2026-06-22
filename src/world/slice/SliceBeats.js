import { DEFAULT_SLICE_IDENTITY, sliceArrivalBanner } from "./SliceIdentity.js";

export const SLICE_BEATS = Object.freeze({
  ARRIVAL: "arrival",
  JOURNEY: "journey",
  DISCOVERY: "discovery",
  RETURN: "return",
  DEPOSIT: "deposit",
  COMPLETE: "complete",
});

export function deriveSliceBeat({ phase = "find", elapsed = 0, distanceToRelic = Infinity } = {}) {
  if (phase === "complete") return SLICE_BEATS.COMPLETE;
  if (phase === "atCache") return SLICE_BEATS.DEPOSIT;
  if (phase === "carry") return SLICE_BEATS.RETURN;
  if (elapsed < 6) return SLICE_BEATS.ARRIVAL;
  if (distanceToRelic <= 8) return SLICE_BEATS.DISCOVERY;
  return SLICE_BEATS.JOURNEY;
}

export function sliceBanner(beat, objectiveText = "", identity = DEFAULT_SLICE_IDENTITY) {
  // The ARRIVAL line names the slice (Content-5). The default identity reproduces the pre-Content-5 string
  // "THE FROZEN CACHE · Recover the marked relic" byte-for-byte, so a 2-arg caller is unchanged.
  if (beat === SLICE_BEATS.ARRIVAL) return sliceArrivalBanner(identity);
  return objectiveText;
}
