// Editor-only animation preview. A single reusable mixer (never one-per-frame):
// play() tears down any prior preview and starts a fresh action; stop()/dispose()
// release it. Advanced by the editor's update loop, not by gameplay systems.

import * as THREE from "three";
import { clampPlaybackSpeed } from "./AnimationTypes.js";

export class AnimationPreview {
  constructor() {
    this.mixer = null;
    this.root = null;
  }

  get isPlaying() {
    return !!this.mixer;
  }

  /**
   * Preview a clip on a placed object's subtree.
   * @param {THREE.Object3D} object3D
   * @param {object[]} clips         THREE.AnimationClip[]
   * @param {object} opts            { clip, loop, speed, offset }
   * @returns {boolean} whether a clip started
   */
  play(object3D, clips, { clip = null, loop = true, speed = 1, offset = 0 } = {}) {
    this.stop();
    if (!object3D || !Array.isArray(clips) || !clips.length) return false;
    const target = clips.find((c) => c?.name === clip) ?? clips[0];
    if (!target) return false;
    try {
      this.mixer = new THREE.AnimationMixer(object3D);
      const action = this.mixer.clipAction(target);
      action.loop = loop ? THREE.LoopRepeat : THREE.LoopOnce;
      if (!loop) action.clampWhenFinished = true;
      action.timeScale = clampPlaybackSpeed(speed);
      action.play();
      action.time = Math.min(Math.max(0, offset), target.duration || 0);
      this.root = object3D;
      return true;
    } catch (error) {
      console.warn("Animation preview failed", error);
      this.stop();
      return false;
    }
  }

  update(dt) {
    if (this.mixer && dt > 0) {
      try {
        this.mixer.update(dt);
      } catch {
        this.stop();
      }
    }
  }

  // Stop preview if the given object is the one being previewed (e.g. on delete).
  stopFor(object3D) {
    if (this.root === object3D) this.stop();
  }

  stop() {
    if (this.mixer) {
      try {
        this.mixer.stopAllAction();
        this.mixer.uncacheRoot?.(this.root);
      } catch {
        // best-effort
      }
    }
    this.mixer = null;
    this.root = null;
  }
}
