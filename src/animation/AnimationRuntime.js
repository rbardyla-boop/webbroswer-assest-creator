// Runtime animation playback. One THREE.AnimationMixer per registered object so
// multiple instances of the same rigged asset animate independently (each placed
// object carries its own SkeletonUtils clone → its own skeleton state).
//
// Used in runtime mode only; the editor uses AnimationPreview instead, so
// authoring never auto-plays gameplay animation.

import * as THREE from "three";
import { clampPlaybackSpeed } from "./AnimationTypes.js";
import { resolveClipName } from "./AnimationValidation.js";

export class AnimationRuntime {
  constructor() {
    this.entries = new Map(); // object3D -> { mixer, action }
  }

  get count() {
    return this.entries.size;
  }

  /**
   * Create a mixer for a placed, animated object. No-op (returns null) when the
   * asset has no clips — the object stays static. Never throws on bad metadata.
   *
   * @param {THREE.Object3D} object3D  the placed object (mixer roots here)
   * @param {object} asset             resolved asset ({ animations, animation })
   * @param {object|null} override     placed-object animation override
   */
  register(object3D, asset, override = null) {
    const clips = asset?.animations;
    if (!object3D || !Array.isArray(clips) || !clips.length) return null;
    if (this.entries.has(object3D)) this.remove(object3D);

    try {
      const assetAnimation = asset.animation ?? {};
      const names = clips.map((c) => c?.name).filter(Boolean);
      const clipName = resolveClipName(override, assetAnimation, names);
      const clip = clips.find((c) => c?.name === clipName) ?? clips[0];
      if (!clip) return null;

      const autoplay = pickBool(override?.autoplay, assetAnimation.autoplay, true);
      const loop = pickBool(override?.loop, assetAnimation.loop, true);
      const speed = clampPlaybackSpeed(override?.playbackSpeed ?? assetAnimation.playbackSpeed ?? 1);
      const offset = Math.max(0, Number(override?.startOffset) || 0);

      const mixer = new THREE.AnimationMixer(object3D);
      const action = mixer.clipAction(clip);
      action.loop = loop ? THREE.LoopRepeat : THREE.LoopOnce;
      if (!loop) action.clampWhenFinished = true;
      action.timeScale = speed;
      if (autoplay) {
        action.play();
        action.time = Math.min(offset, clip.duration || 0);
      }
      this.entries.set(object3D, { mixer, action, clipName: clip.name, objectId: object3D.userData?.objectId ?? null });
      return { mixer, action };
    } catch (error) {
      console.warn("Could not start animation for placed object", error);
      return null;
    }
  }

  /**
   * Advance all live mixers. An optional `isAwake(object3D)` predicate (from the
   * visibility kernel) skips mixers whose object is asleep — the mixer time simply
   * freezes and resumes seamlessly on wake. The mesh is never hidden, so this only
   * saves CPU; it never causes pop or breaks shadows.
   */
  update(dt, isAwake = null) {
    if (!(dt > 0)) return;
    for (const [object3D, { mixer }] of this.entries) {
      if (isAwake && !isAwake(object3D)) continue; // asleep: freeze, don't advance
      try {
        mixer.update(dt);
      } catch (error) {
        console.warn("Animation mixer update failed", error);
      }
    }
  }

  remove(object3D) {
    const entry = this.entries.get(object3D);
    if (!entry) return;
    try {
      entry.action?.stop();
      entry.mixer?.stopAllAction();
      entry.mixer?.uncacheRoot?.(object3D);
    } catch {
      // best-effort teardown
    }
    this.entries.delete(object3D);
  }

  clear() {
    for (const object3D of [...this.entries.keys()]) this.remove(object3D);
  }

  // --- observability (debug-safe; no UI) --------------------------------------

  activeObjectIds() {
    return [...this.entries.values()].map((e) => e.objectId);
  }

  activeClipNames() {
    return [...this.entries.values()].map((e) => e.clipName);
  }

  // Snapshot of live mixers for test/debug observation (active count, object ids,
  // clip names, running state, and playback head time).
  debugSnapshot() {
    const objects = [];
    for (const entry of this.entries.values()) {
      objects.push({
        id: entry.objectId,
        clip: entry.clipName,
        running: entry.action?.isRunning() ?? false,
        time: Number((entry.action?.time ?? 0).toFixed(4)),
      });
    }
    return { count: this.entries.size, objects };
  }
}

function pickBool(...values) {
  for (const value of values) if (typeof value === "boolean") return value;
  return true;
}
