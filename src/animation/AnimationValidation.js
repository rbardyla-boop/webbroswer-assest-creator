// Sanitizers for animation metadata. Invalid metadata is repaired or dropped,
// never fatal. Pure, Node-safe.

import { clampPlaybackSpeed, boolOr, numberOr, DEFAULT_PLAYBACK_SPEED } from "./AnimationTypes.js";

/**
 * Sanitize asset-level animation metadata (the clips a GLB offers).
 * Returns { animation, warnings }. A null/absent input yields null (the asset is
 * simply not animated) — callers must tolerate null.
 */
export function sanitizeAssetAnimation(input) {
  const warnings = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return { animation: null, warnings };

  const clips = [];
  const seenNames = new Set();
  for (const [i, clip] of (Array.isArray(input.clips) ? input.clips : []).entries()) {
    const safe = sanitizeClip(clip, i, warnings);
    if (!safe) continue;
    // Drop duplicate clip names (mixer selection is name-keyed).
    if (seenNames.has(safe.name)) {
      warnings.push(`Duplicate animation clip name "${safe.name}" ignored.`);
      continue;
    }
    seenNames.add(safe.name);
    clips.push(safe);
  }

  let defaultClip = typeof input.defaultClip === "string" && input.defaultClip ? input.defaultClip : null;
  if (defaultClip && !seenNames.has(defaultClip)) {
    warnings.push(`Default clip "${defaultClip}" is not in the clip list; using the first clip.`);
    defaultClip = null;
  }
  if (!defaultClip && clips.length) defaultClip = clips[0].name;

  return {
    animation: {
      hasSkeleton: boolOr(input.hasSkeleton, false),
      hasSkinnedMesh: boolOr(input.hasSkinnedMesh, false),
      clips,
      defaultClip,
      autoplay: boolOr(input.autoplay, true),
      loop: boolOr(input.loop, true),
      playbackSpeed: clampPlaybackSpeed(input.playbackSpeed),
    },
    warnings,
  };
}

function sanitizeClip(clip, index, warnings) {
  if (!clip || typeof clip !== "object") return null;
  const name = typeof clip.name === "string" && clip.name.trim() ? clip.name.trim() : `clip-${index}`;
  let duration = numberOr(clip.duration, 0);
  if (!(duration > 0)) {
    warnings.push(`Animation clip "${name}" had a non-positive duration; treated as 0.`);
    duration = 0;
  }
  return {
    name,
    duration,
    uuid: typeof clip.uuid === "string" ? clip.uuid : "",
    index: Number.isInteger(clip.index) ? clip.index : index,
  };
}

/**
 * Sanitize a placed-object animation override. Returns the override object, or
 * null when there is nothing meaningful to store (keeps documents lean).
 *
 * Only keys actually supplied are kept — absent keys are left out (not defaulted)
 * so the runtime's override → asset-default → hardcoded fallback chain is not
 * short-circuited by sanitizer-injected defaults. A sparse override like
 * { clip: "Walk" } must NOT force autoplay/loop and mask the asset's intent.
 */
export function sanitizePlacedAnimation(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const out = {};
  if (typeof input.clip === "string" && input.clip) out.clip = input.clip;
  else if ("clip" in input) out.clip = null;
  if (typeof input.autoplay === "boolean") out.autoplay = input.autoplay;
  if (typeof input.loop === "boolean") out.loop = input.loop;
  if (input.playbackSpeed !== undefined && input.playbackSpeed !== null) out.playbackSpeed = clampPlaybackSpeed(input.playbackSpeed);
  if (input.startOffset !== undefined && input.startOffset !== null) out.startOffset = Math.max(0, numberOr(input.startOffset, 0));
  return out;
}

/**
 * Resolve which clip a runtime/preview should play given the placed override,
 * the asset defaults, and the available clip names. Returns a clip name or null.
 */
export function resolveClipName(override, assetAnimation, availableNames = []) {
  const names = new Set(availableNames);
  const wanted = override?.clip || assetAnimation?.defaultClip || null;
  if (wanted && names.has(wanted)) return wanted;
  if (assetAnimation?.defaultClip && names.has(assetAnimation.defaultClip)) return assetAnimation.defaultClip;
  return availableNames[0] ?? null;
}
