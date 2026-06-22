export const AUDIO_CUES = Object.freeze({
  PICKUP: "pickup",
  EQUIP: "equip",
  CACHE: "cache",
  COMPLETE: "complete",
  // Audio/Feedback-1 — slice sensory cues (additive; the original four are unchanged so the
  // FrozenCacheSlice / RuntimeFeedback owners stay byte-stable).
  HIT: "hit",
  DEFEAT: "defeat",
  DISCOVERY: "discovery",
  REWARD: "reward",
  // Combat-1 — the player-side warning for an enemy threat pulse (additive; the cues above are unchanged so
  // every existing cue owner stays byte-stable).
  THREAT: "threat",
});

export const CUE_NOTES = Object.freeze({
  [AUDIO_CUES.PICKUP]: [440, 660],
  [AUDIO_CUES.EQUIP]: [180, 240],
  [AUDIO_CUES.CACHE]: [220, 330],
  [AUDIO_CUES.COMPLETE]: [261.63, 329.63, 392, 523.25],
  // Timbre-distinct from the four above: HIT is a short descending impact, DEFEAT a low fall,
  // DISCOVERY a bright rising shimmer, REWARD a high triumphant pair.
  [AUDIO_CUES.HIT]: [349.23, 233.08],
  [AUDIO_CUES.DEFEAT]: [196, 130.81, 98],
  [AUDIO_CUES.DISCOVERY]: [523.25, 659.25, 783.99],
  [AUDIO_CUES.REWARD]: [659.25, 880],
  // Timbre-distinct from the cues above: a low two-note warning thrum (danger, not impact or triumph).
  [AUDIO_CUES.THREAT]: [146.83, 110],
});
