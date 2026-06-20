// Enemy-0 body feedback — drives an enemy's own visual from its logical state: a bright emissive
// flash on a strike that decays over the react timer, and a one-time desaturated "slump" color on
// defeat. This is the enemy REACTING (distinct from Combat-0's transient impact mark at the hit
// point). It holds NO THREE objects of its own — it only mutates materials the EnemyRuntime built,
// owns, and disposes, so there is nothing here to leak and dispose() is a formality.

import * as THREE from "three";
import { ENEMY_STATE, HIT_REACT_TIME } from "./EnemyTypes.js";

const FLASH_INTENSITY = 1.5; // peak emissive boost on a fresh hit, above the idle base
const DEFEAT_COLOR = new THREE.Color(0x39424d); // cold, desaturated defeated look
const DEFEAT_EMISSIVE_INTENSITY = 0.12;

export class EnemyFeedback {
  /**
   * Apply the visual for `state` to a handle built by EnemyRuntime:
   *   { materials: THREE.Material[], baseEmissiveIntensity: number, defeatedApplied: boolean }
   * Compositor-friendly (emissive only); deterministic given the logical state (the snapshot reports
   * state, not emissive, so this never affects determinism).
   */
  sync(handle, state) {
    if (!handle || !state) return;
    const mats = handle.materials;
    if (!Array.isArray(mats) || mats.length === 0) return;

    if (state.state === ENEMY_STATE.DEFEATED) {
      if (!handle.defeatedApplied) {
        for (const m of mats) {
          if (m.color) m.color.copy(DEFEAT_COLOR);
          if (m.emissive) m.emissive.copy(DEFEAT_COLOR);
          m.emissiveIntensity = DEFEAT_EMISSIVE_INTENSITY;
        }
        handle.defeatedApplied = true;
      }
      return;
    }

    // A fresh hit fully arms the react timer; the flash decays linearly back to the idle base as it
    // ticks down. IDLE → k = 0 → exactly the base intensity.
    const k =
      state.state === ENEMY_STATE.HIT_REACT
        ? Math.max(0, Math.min(1, state.reactTimer / HIT_REACT_TIME))
        : 0;
    for (const m of mats) {
      m.emissiveIntensity = handle.baseEmissiveIntensity + k * FLASH_INTENSITY;
    }
  }

  dispose() {}
}
