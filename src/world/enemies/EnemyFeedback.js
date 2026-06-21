// Enemy body feedback — drives an enemy's own visual from its logical state: a bright emissive
// flash/"burst" on a strike that decays over the react timer, and a one-time defeated look (the
// sentinel desaturates + slumps; the wisp dims out). This is the enemy REACTING (distinct from
// Combat-0's transient impact mark at the hit point). It holds NO THREE objects of its own — it
// only mutates materials the EnemyRuntime built, owns, and disposes, so there is nothing here to
// leak and dispose() is a formality.
//
// Enemy-2 makes the look ARCHETYPE-DRIVEN: every tunable (idle base, flash, defeat colour/emissive,
// idle flicker) is read off `handle.feedback`. When that is absent the SENTINEL_FEEDBACK defaults
// reproduce the original sentinel constants exactly, so the legacy enemy stays byte-identical.

import * as THREE from "three";
import { ENEMY_STATE, HIT_REACT_TIME } from "./EnemyTypes.js";

// The legacy sentinel feedback values — the default when a handle carries no archetype feedback,
// so a sentinel (or any pre-Enemy-2 caller) reacts exactly as before.
const SENTINEL_FEEDBACK = Object.freeze({
  flashIntensity: 1.5,
  defeatColor: 0x39424d,
  defeatEmissive: 0.12,
  flickerAmp: 0,
  flickerSpeed: 0,
});

export class EnemyFeedback {
  /**
   * Apply the visual for `state` to a handle built by EnemyRuntime:
   *   { materials: THREE.Material[], baseEmissiveIntensity: number, feedback?: {...}, defeatedApplied }
   * `phase` is the actor's monotonic anim clock (drives the idle flicker; 0 for non-flickering
   * archetypes → exactly the base intensity). Compositor-friendly (emissive only); deterministic
   * given the logical state + phase (the snapshot reports state, not emissive, so determinism holds).
   */
  sync(handle, state, phase = 0) {
    if (!handle || !state) return;
    const mats = handle.materials;
    if (!Array.isArray(mats) || mats.length === 0) return;
    const fb = handle.feedback ?? SENTINEL_FEEDBACK;

    if (state.state === ENEMY_STATE.DEFEATED) {
      if (!handle.defeatedApplied) {
        const defeatColor = new THREE.Color(fb.defeatColor ?? SENTINEL_FEEDBACK.defeatColor);
        const defeatEmissive = Number.isFinite(fb.defeatEmissive) ? fb.defeatEmissive : SENTINEL_FEEDBACK.defeatEmissive;
        for (const m of mats) {
          if (m.color) m.color.copy(defeatColor);
          if (m.emissive) m.emissive.copy(defeatColor);
          m.emissiveIntensity = defeatEmissive;
        }
        handle.defeatedApplied = true;
      }
      return;
    }

    // A fresh hit fully arms the react timer; the flash decays linearly back to the idle base as it
    // ticks down. IDLE → k = 0 → the base intensity, plus an optional idle flicker (amp 0 = none).
    const flash = Number.isFinite(fb.flashIntensity) ? fb.flashIntensity : SENTINEL_FEEDBACK.flashIntensity;
    const k =
      state.state === ENEMY_STATE.HIT_REACT
        ? Math.max(0, Math.min(1, state.reactTimer / HIT_REACT_TIME))
        : 0;
    const flickerAmp = k === 0 && Number.isFinite(fb.flickerAmp) ? fb.flickerAmp : 0;
    const flickerSpeed = Number.isFinite(fb.flickerSpeed) ? fb.flickerSpeed : 0;
    const flick = flickerAmp > 0 && Number.isFinite(phase) ? flickerAmp * Math.sin(phase * flickerSpeed) : 0;
    for (const m of mats) {
      m.emissiveIntensity = handle.baseEmissiveIntensity + k * flash + flick;
    }
  }

  dispose() {}
}
