export const AUDIO_CUES = Object.freeze({
  PICKUP: "pickup",
  EQUIP: "equip",
  CACHE: "cache",
  COMPLETE: "complete",
});

export const CUE_NOTES = Object.freeze({
  [AUDIO_CUES.PICKUP]: [440, 660],
  [AUDIO_CUES.EQUIP]: [180, 240],
  [AUDIO_CUES.CACHE]: [220, 330],
  [AUDIO_CUES.COMPLETE]: [261.63, 329.63, 392, 523.25],
});
