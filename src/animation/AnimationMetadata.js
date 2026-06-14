// Extract animation metadata from a parsed GLB/GLTF: clip names/durations plus
// skeleton / skinned-mesh detection. Works against THREE objects but takes them
// as plain inputs, so a minimal fake scene + clip list exercises it in Node.

import { emptyAssetAnimation } from "./AnimationTypes.js";

/**
 * @param {object} scene       gltf.scene (anything with a `traverse` method)
 * @param {object[]} animations gltf.animations (THREE.AnimationClip[] or plain)
 * @returns asset animation metadata (never throws; empty shape when not animated)
 */
export function extractAnimationMetadata(scene, animations = []) {
  const clips = (Array.isArray(animations) ? animations : []).map((clip, index) => ({
    name: typeof clip?.name === "string" && clip.name ? clip.name : `clip-${index}`,
    duration: Number.isFinite(clip?.duration) && clip.duration > 0 ? clip.duration : 0,
    uuid: typeof clip?.uuid === "string" ? clip.uuid : "",
    index,
  }));

  let hasSkinnedMesh = false;
  let hasSkeleton = false;
  try {
    scene?.traverse?.((obj) => {
      if (obj?.isSkinnedMesh) {
        hasSkinnedMesh = true;
        if (obj.skeleton) hasSkeleton = true;
      }
      if (obj?.isBone) hasSkeleton = true;
    });
  } catch {
    // A malformed scene must not break import; treat as no skeleton.
  }

  if (!clips.length && !hasSkeleton && !hasSkinnedMesh) return emptyAssetAnimation();

  return {
    hasSkeleton,
    hasSkinnedMesh,
    clips,
    defaultClip: clips[0]?.name ?? null,
    autoplay: true,
    loop: true,
    playbackSpeed: 1,
  };
}

/** Human summary for the asset library UI. */
export function summarizeAssetAnimation(animation) {
  if (!animation || !animation.clips?.length) return "static";
  const names = animation.clips.map((c) => c.name).slice(0, 3).join(", ");
  const extra = animation.clips.length > 3 ? "…" : "";
  return `${animation.clips.length} clip${animation.clips.length === 1 ? "" : "s"}: ${names}${extra}`;
}
