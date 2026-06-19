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

export function sliceBanner(beat, objectiveText = "") {
  if (beat === SLICE_BEATS.ARRIVAL) return "THE FROZEN CACHE · Recover the marked relic";
  return objectiveText;
}
