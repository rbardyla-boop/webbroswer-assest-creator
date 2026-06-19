import { generateWeaponRecipe } from "../../arsenal/WeaponGrammar.js";
import { rollConfig } from "../../arsenal/WeaponConfig.js";
import { getHeight } from "../../terrain/terrainSampling.js";
import { placeWeapon } from "../placement/WeaponPlacementTool.js";
import { AUDIO_CUES } from "../audio/AudioCues.js";
import { ProceduralAudio } from "../audio/ProceduralAudio.js";
import { CompletionCard } from "../feedback/CompletionCard.js";
import { InteractionPrompt } from "../feedback/InteractionPrompt.js";
import { ObjectiveBeacon } from "../feedback/ObjectiveBeacon.js";
import { deriveSliceBeat, sliceBanner } from "./SliceBeats.js";
import { buildSliceLandmarks, disposeSliceLandmarks } from "./SliceLandmarks.js";
import { SlicePrompts } from "./SlicePrompts.js";
import { SliceCompletion } from "./SliceCompletion.js";
import { SliceTrace } from "./SliceTrace.js";
import { ControlsHint } from "../feedback/ControlsHint.js";

export const TUTORIAL_WEAPON_ID = "frozen-cache-field-weapon";

// Slice-0A human-UX tuning. The arrival hint fades once the player demonstrably moves (or the
// window elapses); the stuck nudge only fires after a long unproductive dwell in a navigation beat,
// far beyond any scripted proof, so it guides a genuinely lost player without masking normal play.
const ARRIVAL_HINT_SECONDS = 8;
const MOVE_EPSILON = 0.6; // metres of travel that count as "the player figured out how to move"
const STUCK_SECONDS = 18; // dwell in a navigation beat before a gentle "follow the beacon" nudge
const NAV_BEATS = new Set(["journey", "return"]);

export class FrozenCacheSlice {
  constructor({ scene, player, objectiveRuntime, weaponCarryRuntime, weaponEquipRuntime, onRestart, instrument = false } = {}) {
    this.scene = scene;
    this.player = player;
    this.objective = objectiveRuntime;
    this.carry = weaponCarryRuntime;
    this.equip = weaponEquipRuntime;
    this.audio = new ProceduralAudio();
    this.prompts = new SlicePrompts();
    this.promptView = new InteractionPrompt();
    this.beacon = new ObjectiveBeacon(scene);
    this.card = new CompletionCard({ onRestart });
    this.completion = new SliceCompletion(this.card, this.audio);
    this.elapsed = 0;
    this.beat = "arrival";
    this.landmarks = null;
    this.store = null;
    this.placedWeapons = null;
    this._lastPhase = null;
    this._lastCarry = null;
    // Slice-0A human-UX hardening + instrumentation (play mode only — the bare ?runtime harness
    // never sees these, so the existing arsenal/visibility proofs are unaffected).
    this.instrument = instrument;
    this.controlsHint = instrument ? new ControlsHint() : null;
    this.trace = instrument ? new SliceTrace() : null;
    this._spawnPos = null; // player position at load, for first-movement detection
    this._firstMoveAt = null; // elapsed when the player first demonstrably moved
    this._beatEnteredAt = 0; // elapsed when the current beat began (dwell measurement)
    this._stuckBeats = new Set(); // beat-entries that already fired their stuck nudge (once each)
    this._nudge = null; // active "follow the beacon" nudge prompt, or null
    this._lastBeat = null; // previous beat (to record transitions once)
    this._lastPromptKey = undefined; // previous shown prompt key (to record prompt changes once)
    this._tracedComplete = false; // completion recorded once
  }

  load({ document, placedAssetStore, placedWeaponRuntime }) {
    disposeSliceLandmarks(this.landmarks);
    this.store = placedAssetStore;
    this.placedWeapons = placedWeaponRuntime;
    this.elapsed = 0;
    const state = this.objective.debugSnapshot();
    if (!state.present || !state.cache) return false;
    const relic = state.relicPos;
    // Compose from the runtime-resolved spawn, not the requested document spawn: resolveSpawn may
    // relocate an authored point away from water/steep ground before the objective derives sites.
    const spawn = { x: this.player.position.x, z: this.player.position.z };
    this.landmarks = buildSliceLandmarks({ spawn, relic, cache: state.cache });
    this.scene.add(this.landmarks);
    const spawnedTutorial = this._ensureTutorialWeapon(spawn, relic);
    this.completion.load(state.completed);
    this._lastPhase = state.phase;
    this._lastCarry = this.carry.debugSnapshot();
    // Slice-0A: a fresh walk — reset the friction trace + movement/dwell tracking, and teach
    // movement first (unless this is a reload of an already-completed slice, which needs no hint).
    this._spawnPos = { x: spawn.x, z: spawn.z };
    this._firstMoveAt = null;
    this._beatEnteredAt = 0;
    this._stuckBeats.clear();
    this._nudge = null;
    this._lastBeat = null;
    this._lastPromptKey = undefined;
    this._tracedComplete = state.completed === true;
    if (this.instrument) {
      this.trace?.reset();
      this.trace?.record("load", state.completed ? "completed" : "fresh", 0);
      if (state.completed) this.controlsHint?.dismiss();
      else this.controlsHint?.show();
    }
    this.update(0);
    return spawnedTutorial;
  }

  _ensureTutorialWeapon(spawn, relic) {
    if (this.store.list().some((item) => item.id === TUTORIAL_WEAPON_ID)) return false;
    // Early enough to be visible from arrival, but outside the relic's interaction radius so the
    // post-pickup H lesson gets a clean moment before the relic's essential F prompt takes over.
    const x = spawn.x + (relic.x - spawn.x) * 0.35;
    const z = spawn.z + (relic.z - spawn.z) * 0.35;
    const recipe = generateWeaponRecipe(rollConfig("frozen-cache.field-weapon", "light"));
    const descriptor = placeWeapon(this.store, recipe, { id: TUTORIAL_WEAPON_ID, x, z, yaw: 0.35, runtime: { state: "idle" } });
    if (!descriptor) return false;
    this.placedWeapons.add(descriptor);
    return true;
  }

  update(dt) {
    if (!this.objective?.entry) return;
    this.elapsed += dt;
    const state = this.objective.debugSnapshot();
    const relicPos = state.relicPos;
    const distanceToRelic = relicPos ? Math.hypot(this.player.position.x - relicPos.x, this.player.position.z - relicPos.z) : Infinity;
    this.beat = deriveSliceBeat({ phase: state.phase, elapsed: this.elapsed, distanceToRelic });
    const target = state.phase === "find" ? relicPos : state.cache;
    if (target) this.beacon.setTarget({ ...target, y: getHeight(target.x, target.z) }, !state.completed);
    this.beacon.update(dt, this.elapsed, state.phase === "atCache");

    const carry = this.carry.debugSnapshot();
    const nearestId = this.equip.nearestUncarried(this.player);
    const contextPrompt = this.prompts.prompt({
      completed: state.completed,
      inZone: state.inZone,
      relicCarried: this.equip.slotOf(state.relicId) != null,
      nearestId,
      relicId: state.relicId,
      carriedCount: carry.carriedCount,
      activeId: carry.activeId,
    });

    // Slice-0A: record beat transitions, dismiss the arrival hint on first movement, and — only on a
    // long unproductive dwell — surface a "follow the beacon" nudge. The contextual prompt always
    // wins; the nudge only fills the quiet windows. Everything is logged to the friction trace.
    if (this.beat !== this._lastBeat) {
      this._beatEnteredAt = this.elapsed;
      this._lastBeat = this.beat;
      this.trace?.record("beat", this.beat, this.elapsed);
    }
    this._updateControlsHint();
    this._nudge = this._maybeStuckNudge(state, contextPrompt);
    const shownPrompt = contextPrompt ?? this._nudge;
    this.promptView.show(shownPrompt);
    if (this.instrument) {
      const key = shownPrompt?.key ?? null;
      if (key !== this._lastPromptKey) {
        this._lastPromptKey = key;
        this.trace?.record("prompt", shownPrompt ? `${shownPrompt.key} ${shownPrompt.text}` : "(clear)", this.elapsed);
      }
    }

    if (this._lastPhase === "find" && state.phase === "carry") this.audio.cue(AUDIO_CUES.PICKUP);
    if (this._lastPhase !== "atCache" && state.phase === "atCache") this.audio.cue(AUDIO_CUES.CACHE);
    if (this._lastCarry && carry.activeId !== this._lastCarry.activeId && state.phase !== "carry") this.audio.cue(AUDIO_CUES.EQUIP);
    this.audio.setEscalation(state.phase === "carry" || state.phase === "atCache");
    this.completion.update(state.completed);
    if (this.instrument && state.completed && !this._tracedComplete) {
      this._tracedComplete = true;
      this.trace?.record("complete", `${this.elapsed.toFixed(1)}s`, this.elapsed);
    }
    this._lastPhase = state.phase;
    this._lastCarry = carry;
  }

  /** Dismiss the arrival controls hint once the player demonstrably moves, or the window elapses. */
  _updateControlsHint() {
    const hint = this.controlsHint;
    if (!this.instrument || !hint || hint.dismissed) return;
    const moved = this._spawnPos
      ? Math.hypot(this.player.position.x - this._spawnPos.x, this.player.position.z - this._spawnPos.z)
      : 0;
    if (moved >= MOVE_EPSILON) {
      this._firstMoveAt = this.elapsed;
      this.trace?.record("firstMove", `${this.elapsed.toFixed(1)}s`, this.elapsed);
      hint.dismiss();
    } else if (this.elapsed >= ARRIVAL_HINT_SECONDS) {
      hint.dismiss(); // window elapsed — stop nagging even if they haven't moved yet
    } else {
      hint.show();
    }
  }

  /** A "follow the beacon" nudge after a long unproductive dwell in a navigation beat — far beyond
   *  any scripted proof, so it only ever guides a genuinely lost player. Records the stuck signal
   *  (once per beat-entry) so a tester sees exactly where the slice lost them. */
  _maybeStuckNudge(state, contextPrompt) {
    if (contextPrompt || state.completed) return null; // a real prompt is showing, or it's done
    if (!NAV_BEATS.has(this.beat)) return null;
    const dwell = this.elapsed - this._beatEnteredAt;
    if (dwell < STUCK_SECONDS) return null;
    const toCache = state.phase === "carry" || state.phase === "atCache";
    const stuckKey = `${this.beat}@${Math.floor(this._beatEnteredAt)}`;
    if (this.instrument && !this._stuckBeats.has(stuckKey)) {
      this._stuckBeats.add(stuckKey);
      this.trace?.record("stuck", `${this.beat} ${dwell.toFixed(0)}s`, this.elapsed);
    }
    return { key: "↑", text: toCache ? "Follow the beacon to the cache" : "Follow the beacon to the relic" };
  }

  /** Toggle the on-screen friction-trace panel (bound to L in play mode). */
  toggleTrace() {
    this.trace?.togglePanel();
  }

  noteAction(key, succeeded = true) {
    if (succeeded) this.prompts.markUsed(key);
    if (this.instrument && succeeded) this.trace?.record("action", key, this.elapsed);
  }

  bannerText() {
    return sliceBanner(this.beat, this.objective.bannerText());
  }

  debugSnapshot() {
    const state = this.objective.debugSnapshot();
    return {
      present: true,
      beat: this.beat,
      banner: this.bannerText(),
      prompt: this.promptView.element.classList.contains("visible") ? {
        key: this.promptView.element.querySelector("kbd").textContent,
        text: this.promptView.element.querySelector("span").textContent,
      } : null,
      beaconVisible: this.beacon.root.visible,
      landmarks: this.landmarks?.children.map((child) => child.name) ?? [],
      tutorialWeaponPresent: !!this.store?.list().some((item) => item.id === TUTORIAL_WEAPON_ID),
      completionCardVisible: this.card.visible,
      completed: state.completed,
      trophyPresent: !!this.objective._trophyAura,
      // Slice-0A instrumentation surface (null when not in play mode).
      controlsHintVisible: !!this.controlsHint?.visible,
      controlsHintDismissed: !!this.controlsHint?.dismissed,
      firstMoveAt: this._firstMoveAt,
      nudgeActive: this._nudge != null,
      nudge: this._nudge ? { key: this._nudge.key, text: this._nudge.text } : null,
      dwell: Math.round((this.elapsed - this._beatEnteredAt) * 10) / 10,
      trace: this.trace?.summary() ?? null,
    };
  }

  dispose() {
    disposeSliceLandmarks(this.landmarks);
    this.promptView.dispose();
    this.beacon.dispose();
    this.card.dispose();
    this.audio.dispose();
    this.controlsHint?.dispose();
    this.trace?.dispose();
  }
}
