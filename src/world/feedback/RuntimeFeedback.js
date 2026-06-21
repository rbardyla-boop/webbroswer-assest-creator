// Additive runtime feedback (Environment Polish-1): fires an audio cue when an authored encounter is
// CLEARED. The relic find→carry→cache loop already gets its audio from FrozenCacheSlice (active in every
// runtime world); the remaining gap was encounter completion. This owner reuses the existing
// ProceduralAudio + AUDIO_CUES WITHOUT touching the frozen slice (which stays byte-stable). Worlds with no
// encounters (the frozen-cache / first-playable slices) see no completions → no cue → no behavior change.
//
// Headless-graceful: ProceduralAudio.cue() no-ops without a user gesture (suspended AudioContext), so the
// proof cannot hear a sound — but `cueAttempts` records that the WIRING fired on the completion edge, which
// makes the audio-feedback path provable in the SwiftShader harness.

import { AUDIO_CUES } from "../audio/AudioCues.js";
import { ProceduralAudio } from "../audio/ProceduralAudio.js";

export class RuntimeFeedback {
  constructor({ audio } = {}) {
    this.audio = audio ?? new ProceduralAudio();
    // Own (and dispose) the audio only if we created it. When a shared engine is injected (Audio/Feedback-1
    // hoists one ProceduralAudio for both this owner and SliceSensory), the injector owns disposal.
    this._ownsAudio = !audio;
    this._cued = new Set(); // encounter ids already cued (edge-trigger once each)
    this.cueAttempts = 0;
  }

  /** Observe an EncounterRuntime.snapshot(); cue once on each encounter's completion edge. */
  update(encounterSnapshot) {
    const encounters = encounterSnapshot?.encounters;
    if (!Array.isArray(encounters)) return;
    for (const encounter of encounters) {
      if (!encounter || encounter.completed !== true || encounter.id == null) continue;
      if (this._cued.has(encounter.id)) continue;
      this._cued.add(encounter.id);
      this.audio.cue(AUDIO_CUES.COMPLETE);
      this.cueAttempts += 1;
    }
  }

  snapshot() {
    return { cueAttempts: this.cueAttempts, cuedEncounters: this._cued.size };
  }

  dispose() {
    if (this._ownsAudio) this.audio?.dispose?.();
    this._cued.clear();
  }
}
