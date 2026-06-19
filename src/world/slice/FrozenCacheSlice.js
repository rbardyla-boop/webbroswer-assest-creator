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

export const TUTORIAL_WEAPON_ID = "frozen-cache-field-weapon";

export class FrozenCacheSlice {
  constructor({ scene, player, objectiveRuntime, weaponCarryRuntime, weaponEquipRuntime, onRestart } = {}) {
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
    this.promptView.show(this.prompts.prompt({
      completed: state.completed,
      inZone: state.inZone,
      relicCarried: this.equip.slotOf(state.relicId) != null,
      nearestId,
      relicId: state.relicId,
      carriedCount: carry.carriedCount,
      activeId: carry.activeId,
    }));

    if (this._lastPhase === "find" && state.phase === "carry") this.audio.cue(AUDIO_CUES.PICKUP);
    if (this._lastPhase !== "atCache" && state.phase === "atCache") this.audio.cue(AUDIO_CUES.CACHE);
    if (this._lastCarry && carry.activeId !== this._lastCarry.activeId && state.phase !== "carry") this.audio.cue(AUDIO_CUES.EQUIP);
    this.audio.setEscalation(state.phase === "carry" || state.phase === "atCache");
    this.completion.update(state.completed);
    this._lastPhase = state.phase;
    this._lastCarry = carry;
  }

  noteAction(key, succeeded = true) {
    if (succeeded) this.prompts.markUsed(key);
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
    };
  }

  dispose() {
    disposeSliceLandmarks(this.landmarks);
    this.promptView.dispose();
    this.beacon.dispose();
    this.card.dispose();
    this.audio.dispose();
  }
}
