// Audio/Feedback-1 — the PURE core of the slice sensory layer (Node-testable; no THREE, no DOM, no
// RNG, no clock). It decides WHICH cues an authored slice's events should fire, by edge-detecting
// transitions across two successive observations. The owner (SliceSensory.js) feeds it observations and
// plays the audible cues through the EXISTING ProceduralAudio engine.
//
// The sensory layer only acts on slices that carry AUTHORED sensory content — encounters or sign
// interactions. These are signals the runtime never injects, so worlds without them (the frozen-cache /
// first-playable slices) make the layer dormant and stay byte-stable. (Reward weapons are NOT an
// activation signal: the runtime places the relic + tutorial weapons into runtimeAssets in every world,
// so keying activation on runtimeAssets would wrongly activate every slice. Reward cues are still keyed
// to authored reward weapons — see extractSensoryContent's excludeRewardIds.)

import { AUDIO_CUES } from "../audio/AudioCues.js";
import { ENEMY_STATE } from "../enemies/EnemyTypes.js";

// One-shot milestone labels mirrored on the visual cue overlay (accessibility). Per-hit is intentionally
// NOT a milestone — combat hits are already mirrored by the enemy's emissive flash, so showing them here
// would make combat visually noisy. Kept generic (no benchmark coupling) but reads well in the slice.
export const CUE_LABELS = Object.freeze({
  hit: "⚔ Strike",
  defeat: "☠ Sentinel down",
  clear: "✦ Path clear",
  discovery: "✦ Discovery",
  reward: "✦ Reward found",
  complete: "✦ Cache sealed",
});

// The cue kinds whose label is surfaced on the visual overlay (the milestone toast).
export const MILESTONE_KINDS = Object.freeze(["defeat", "clear", "discovery", "reward", "complete"]);

// kind -> the ProceduralAudio cue name. 'clear' has NO audio: RuntimeFeedback already plays the
// COMPLETE chord on the encounter-cleared edge, so the sensory layer only LOGS clear (audible:false)
// for ordering + the visual mirror, never double-fires a sound.
const CUE_AUDIO = Object.freeze({
  hit: AUDIO_CUES.HIT,
  defeat: AUDIO_CUES.DEFEAT,
  discovery: AUDIO_CUES.DISCOVERY,
  reward: AUDIO_CUES.REWARD,
  complete: AUDIO_CUES.COMPLETE,
});

function cue(kind) {
  const audioName = CUE_AUDIO[kind] ?? null;
  return { kind, label: CUE_LABELS[kind] ?? kind, audible: audioName != null, audioName };
}

/** True when a document carries AUTHORED sensory content the slice layer should react to (encounters or
 *  sign interactions — signals the runtime never injects, so non-authored slices stay dormant). */
export function sliceHasSensoryContent(document) {
  if (!document || typeof document !== "object") return false;
  if (Array.isArray(document.encounters?.items) && document.encounters.items.length > 0) return true;
  if (Array.isArray(document.objects) && document.objects.some((o) => o?.interaction?.role === "sign")) return true;
  return false;
}

/**
 * Pull the sign discovery volumes + AUTHORED reward weapon ids the owner watches each frame.
 * `excludeRewardIds` are the runtime-placed system weapons (relic, tutorial) — they live in the same
 * `runtimeAssets.items` list but are NOT authored rewards, so picking them up must not fire a reward cue.
 */
export function extractSensoryContent(document, excludeRewardIds = []) {
  const exclude = new Set(excludeRewardIds);
  const signs = [];
  const rewardIds = [];
  for (const o of document?.objects ?? []) {
    const sign = o?.interaction;
    if (sign?.role !== "sign") continue;
    const p = o.transform?.position;
    const radius = Number(sign.showRadius);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z) || !Number.isFinite(radius) || radius <= 0) continue;
    signs.push({ id: o.id, x: p.x, z: p.z, radius });
  }
  for (const it of document?.runtimeAssets?.items ?? []) {
    if (it?.kind === "generated.weapon" && typeof it.id === "string" && !exclude.has(it.id)) rewardIds.push(it.id);
  }
  return { signs, rewardIds, hasEncounters: (document?.encounters?.items?.length ?? 0) > 0 };
}

/** A fresh, unseeded sensory state. The first reduceSensory() after this seeds a baseline silently. */
export function createSensoryState() {
  return {
    seeded: false,
    enemyStateById: {}, // beat id -> last seen ephemeral enemy state
    defeated: new Set(), // beat ids whose defeat cue already fired
    cleared: new Set(), // beat ids whose clear was already logged
    rewarded: new Set(), // reward ids already cued
    discovered: new Set(), // sign ids already cued
    objectiveCompleted: false, // last seen objective completion
  };
}

function clone(state) {
  return {
    seeded: state.seeded,
    enemyStateById: { ...state.enemyStateById },
    defeated: new Set(state.defeated),
    cleared: new Set(state.cleared),
    rewarded: new Set(state.rewarded),
    discovered: new Set(state.discovered),
    objectiveCompleted: state.objectiveCompleted,
  };
}

/**
 * Edge-detect cues from a new observation against the prior state.
 *
 * observation = {
 *   active: boolean,                                  // dormant slices emit nothing
 *   encounters: [{ id, enemyState, completed }],      // EncounterRuntime.snapshot().encounters
 *   rewardsCarried: string[],                         // reward ids currently carried
 *   signsInRange: string[],                           // sign ids the player is currently within
 *   objectiveCompleted: boolean,                      // the relic objective completion latch
 * }
 *
 * Returns { state, cues } where cues is ordered [hit…, defeat, clear (per beat), discovery, reward,
 * complete]. The FIRST call after a bind seeds the baseline from `observation` and emits no cues, so a
 * reload of an already-resolved slice never replays a completed one-shot.
 */
export function reduceSensory(prevState, observation) {
  if (!observation?.active) return { state: prevState, cues: [] };

  const next = clone(prevState);
  const encounters = Array.isArray(observation.encounters) ? observation.encounters : [];
  const rewardsCarried = Array.isArray(observation.rewardsCarried) ? observation.rewardsCarried : [];
  const signsInRange = Array.isArray(observation.signsInRange) ? observation.signsInRange : [];
  const objectiveCompleted = observation.objectiveCompleted === true;

  if (!prevState.seeded) {
    // Seed: capture every current truth as already-handled, so only later TRANSITIONS fire.
    for (const e of encounters) {
      if (e?.id == null) continue;
      next.enemyStateById[e.id] = e.enemyState ?? null;
      if (e.enemyState === ENEMY_STATE.DEFEATED) next.defeated.add(e.id);
      if (e.completed === true) next.cleared.add(e.id);
    }
    for (const id of rewardsCarried) next.rewarded.add(id);
    for (const id of signsInRange) next.discovered.add(id);
    next.objectiveCompleted = objectiveCompleted;
    next.seeded = true;
    return { state: next, cues: [] };
  }

  const cues = [];

  for (const e of encounters) {
    if (e?.id == null) continue;
    const prev = next.enemyStateById[e.id] ?? null;
    const cur = e.enemyState ?? null;
    // HIT re-arms each fresh transition into hit-react (one cue per strike).
    if (cur === ENEMY_STATE.HIT_REACT && prev !== ENEMY_STATE.HIT_REACT) cues.push(cue("hit"));
    // DEFEAT fires once per beat on the first transition into defeated.
    if (cur === ENEMY_STATE.DEFEATED && !next.defeated.has(e.id)) {
      next.defeated.add(e.id);
      cues.push(cue("defeat"));
    }
    // CLEAR is logged once per beat (audio owned by RuntimeFeedback's COMPLETE).
    if (e.completed === true && !next.cleared.has(e.id)) {
      next.cleared.add(e.id);
      cues.push(cue("clear"));
    }
    next.enemyStateById[e.id] = cur;
  }

  for (const id of signsInRange) {
    if (next.discovered.has(id)) continue;
    next.discovered.add(id);
    cues.push(cue("discovery"));
  }

  for (const id of rewardsCarried) {
    if (next.rewarded.has(id)) continue;
    next.rewarded.add(id);
    cues.push(cue("reward"));
  }

  if (objectiveCompleted && next.objectiveCompleted !== true) {
    cues.push(cue("complete"));
  }
  next.objectiveCompleted = objectiveCompleted;

  return { state: next, cues };
}
