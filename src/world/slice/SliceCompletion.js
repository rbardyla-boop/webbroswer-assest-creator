import { AUDIO_CUES } from "../audio/AudioCues.js";

export class SliceCompletion {
  constructor(card, audio) {
    this.card = card;
    this.audio = audio;
    this.completed = false;
  }

  load(completed) {
    this.completed = completed === true;
    if (this.completed) this.card.show();
    else this.card.hide();
  }

  update(completed) {
    if (completed !== true || this.completed) return false;
    this.completed = true;
    this.audio.cue(AUDIO_CUES.COMPLETE);
    this.card.show();
    return true;
  }
}
