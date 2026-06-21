// Audio/Feedback-1 — the runtime owner of the slice sensory layer. It OBSERVES the existing seams
// (encounters, the player's carried weapons, sign proximity, the relic objective) and plays
// differentiated cues through the EXISTING ProceduralAudio engine + mirrors the milestones on a visual
// toast. It mutates NO combat/enemy/arsenal/objective/interaction state and owns NO scene objects.
//
// All edge logic lives in the pure SliceSensoryLogic (Node-tested). This owner only gathers an
// observation each frame, runs the reducer, and emits the cues. The audio engine is INJECTED (shared
// with RuntimeFeedback) so the slice never spins up a second wind bed; this owner never disposes it.
//
// Dormancy is the byte-stability guarantee: bind() only activates for slices that carry authored
// sensory content. The frozen-cache / first-playable slices carry none, so this layer stays silent and
// those shipped slices are unchanged.

import {
  sliceHasSensoryContent,
  extractSensoryContent,
  createSensoryState,
  reduceSensory,
  CUE_LABELS,
  MILESTONE_KINDS,
} from "./SliceSensoryLogic.js";

const MILESTONE = new Set(MILESTONE_KINDS);

export class SliceSensory {
  constructor({ audio = null, player = null, carry = null, view = null, systemWeaponIds = [] } = {}) {
    this.audio = audio; // shared ProceduralAudio (owned by RuntimeFeedback — never disposed here)
    this.player = player;
    this.carry = carry; // WeaponCarryRuntime (slotOf(id) → carried?)
    this.view = view; // CueOverlay (the milestone toast) or null
    // The runtime-placed system weapons (relic, tutorial) — excluded from reward cues (they share the
    // runtimeAssets list with authored rewards but are not loot).
    this._systemWeaponIds = systemWeaponIds;
    this.active = false;
    this._signs = [];
    this._rewardIds = [];
    this._state = createSensoryState();
    this.cueAttempts = 0;
    this._counts = { hit: 0, defeat: 0, clear: 0, discovery: 0, reward: 0, complete: 0 };
    this._log = [];
    this._lastLabel = null;
  }

  /** (Re)bind to the loaded world: activate only for slices with authored sensory content, reset the
   *  one-shot state (the first update seeds a silent baseline → no replay across reload). */
  bind(document) {
    this.active = sliceHasSensoryContent(document);
    if (this.active) {
      const content = extractSensoryContent(document, this._systemWeaponIds);
      this._signs = content.signs;
      this._rewardIds = content.rewardIds;
    } else {
      this._signs = [];
      this._rewardIds = [];
    }
    this._state = createSensoryState();
    this.cueAttempts = 0;
    this._counts = { hit: 0, defeat: 0, clear: 0, discovery: 0, reward: 0, complete: 0 };
    this._log = [];
    this._lastLabel = null;
  }

  /** Observe one frame. encounterSnapshot = EncounterRuntime.snapshot(); objectiveCompleted = the relic
   *  objective completion latch. No-op when dormant. */
  update(encounterSnapshot, objectiveCompleted = false) {
    if (!this.active) return;
    const observation = {
      active: true,
      encounters: this._observeEncounters(encounterSnapshot),
      rewardsCarried: this._observeRewards(),
      signsInRange: this._observeSigns(),
      objectiveCompleted: objectiveCompleted === true,
    };
    const { state, cues } = reduceSensory(this._state, observation);
    this._state = state;
    for (const cue of cues) this._emit(cue);
  }

  _observeEncounters(encounterSnapshot) {
    const encounters = encounterSnapshot?.encounters;
    if (!Array.isArray(encounters)) return [];
    return encounters.map((e) => ({ id: e?.id ?? null, enemyState: e?.enemyState ?? null, completed: e?.completed === true }));
  }

  _observeRewards() {
    if (!this.carry || this._rewardIds.length === 0) return [];
    return this._rewardIds.filter((id) => this.carry.slotOf(id) != null);
  }

  _observeSigns() {
    const pos = this.player?.position;
    if (!pos || this._signs.length === 0) return [];
    const inRange = [];
    for (const s of this._signs) {
      const dx = pos.x - s.x;
      const dz = pos.z - s.z;
      if (dx * dx + dz * dz <= s.radius * s.radius) inRange.push(s.id);
    }
    return inRange;
  }

  _emit(cue) {
    this._log.push(cue.kind);
    if (Object.prototype.hasOwnProperty.call(this._counts, cue.kind)) this._counts[cue.kind] += 1;
    if (cue.audible && cue.audioName) {
      this.audio?.cue(cue.audioName);
      this.cueAttempts += 1;
    }
    if (MILESTONE.has(cue.kind)) {
      this._lastLabel = cue.label ?? CUE_LABELS[cue.kind] ?? null;
      this.view?.show(this._lastLabel);
    }
  }

  snapshot() {
    return {
      active: this.active,
      ambient: this.active && !!this.audio, // the slice's ambient bed (the shared wind) is engaged
      cueAttempts: this.cueAttempts,
      cues: { ...this._counts },
      log: [...this._log],
      lastLabel: this._lastLabel,
    };
  }

  dispose() {
    this.view?.dispose();
  }
}
