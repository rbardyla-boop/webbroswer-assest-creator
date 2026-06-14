// Shared shapes, defaults, and clamps for runtime animation metadata.
// Pure and Node-safe (no THREE, no DOM).
//
// Two metadata shapes:
//   - asset animation:  what a rigged GLB *offers* (clips, skeleton flags, defaults)
//   - placed override:  what a placed object *chooses* (clip, autoplay, loop, …)

export const MIN_PLAYBACK_SPEED = 0.05;
export const MAX_PLAYBACK_SPEED = 8;
export const DEFAULT_PLAYBACK_SPEED = 1;

export function clampPlaybackSpeed(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_PLAYBACK_SPEED;
  return Math.min(MAX_PLAYBACK_SPEED, Math.max(MIN_PLAYBACK_SPEED, n));
}

export function boolOr(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

export function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Asset-level animation metadata for a GLB with no clips/skeleton. Stored so the
// editor can show "0 clips" and static GLBs keep working unchanged.
export function emptyAssetAnimation() {
  return {
    hasSkeleton: false,
    hasSkinnedMesh: false,
    clips: [],
    defaultClip: null,
    autoplay: true,
    loop: true,
    playbackSpeed: DEFAULT_PLAYBACK_SPEED,
  };
}

// A placed-object override with all-default behaviour (plays the asset default).
export function defaultPlacedAnimation() {
  return {
    clip: null,
    autoplay: true,
    loop: true,
    playbackSpeed: DEFAULT_PLAYBACK_SPEED,
    startOffset: 0,
  };
}
