// Runtime asset descriptor types + normalization. A "runtime asset" is a thing the
// world rebuilds from a recipe on every load (NEVER baked geometry) — currently a
// generated weapon. This module is the validation boundary the world calls on an
// untrusted descriptor (from a save file or the arsenal handoff queue): it validates
// the kind/id/transform/runtime envelope and delegates the recipe to the arsenal's
// pure recipe validator. This is the allowed dependency direction (recipe → validator
// → world placed asset); it imports the arsenal's PURE validator, never the workbench.

import * as THREE from "three";
import { sanitizeWeaponRecipe } from "../../arsenal/WeaponRecipeValidation.js";
import { weaponAssetId } from "../../arsenal/WeaponRecipe.js";

export const RUNTIME_ASSET_KINDS = Object.freeze(["generated.weapon"]);
export const MAX_RUNTIME_ASSETS = 256; // defense in depth; far above any real placement count
const RUNTIME_STATES = new Set(["idle", "equipped", "held", "stored"]);

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function vec3(value, fallback) {
  if (!value || typeof value !== "object") return { ...fallback };
  return { x: num(value.x, fallback.x), y: num(value.y, fallback.y), z: num(value.z, fallback.z) };
}

// Rotation is stored as EULER {x,y,z} radians (the world convention). A quaternion
// {x,y,z,w} is ACCEPTED at the boundary and converted to euler XYZ.
function rotationEuler(rot) {
  if (!rot || typeof rot !== "object") return { x: 0, y: 0, z: 0 };
  if (Number.isFinite(Number(rot.w))) {
    const q = new THREE.Quaternion(num(rot.x, 0), num(rot.y, 0), num(rot.z, 0), num(rot.w, 1));
    const e = new THREE.Euler().setFromQuaternion(q, "XYZ");
    return { x: e.x, y: e.y, z: e.z };
  }
  return vec3(rot, { x: 0, y: 0, z: 0 });
}

function transform(t) {
  const position = vec3(t?.position, { x: 0, y: 0, z: 0 });
  const rotation = rotationEuler(t?.rotation);
  const scale = vec3(t?.scale, { x: 1, y: 1, z: 1 });
  if (Math.abs(scale.x) < 1e-5 || Math.abs(scale.y) < 1e-5 || Math.abs(scale.z) < 1e-5) return null;
  // Reject a non-finite rotation (e.g. a pathological quaternion) before it can corrupt
  // the placed group's matrix — the quat→euler path is benign today, but this pins it.
  if (!Number.isFinite(rotation.x) || !Number.isFinite(rotation.y) || !Number.isFinite(rotation.z)) return null;
  return { position, rotation, scale };
}

function sanitizeId(value, recipe) {
  if (typeof value === "string") {
    const cleaned = value.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64);
    if (cleaned.length) return cleaned;
  }
  return weaponAssetId(recipe); // deterministic fallback id
}

/**
 * Normalize one untrusted runtime-asset descriptor, or null if it can't yield a valid
 * placed asset.
 * @param {unknown} item
 */
export function normalizeRuntimeAssetDescriptor(item) {
  if (!item || typeof item !== "object" || !RUNTIME_ASSET_KINDS.includes(item.kind)) return null;
  const recipe = sanitizeWeaponRecipe(item.recipe);
  if (!recipe) return null;
  const tf = transform(item.transform);
  if (!tf) return null;
  const rt = item.runtime && typeof item.runtime === "object" ? item.runtime : {};
  return {
    kind: item.kind,
    id: sanitizeId(item.id, recipe),
    recipe,
    transform: tf,
    runtime: {
      state: RUNTIME_STATES.has(rt.state) ? rt.state : "idle",
      owner: typeof rt.owner === "string" ? rt.owner.slice(0, 64) : null,
      durability: clamp01(num(rt.durability, 1)),
      visible: rt.visible !== false,
      castShadow: rt.castShadow !== false,
      receiveShadow: rt.receiveShadow !== false,
    },
  };
}

/** Sanitize the whole `runtimeAssets` block for the WorldDocument validator. */
export function sanitizeRuntimeAssetsBlock(block, warnings = null) {
  const src = block && typeof block === "object" ? block : {};
  const items = Array.isArray(src.items) ? src.items : [];
  if (items.length > MAX_RUNTIME_ASSETS && warnings) {
    warnings.push(`Runtime assets had ${items.length} items; only the first ${MAX_RUNTIME_ASSETS} were kept.`);
  }
  const safe = items.slice(0, MAX_RUNTIME_ASSETS).map(normalizeRuntimeAssetDescriptor).filter(Boolean);
  return { version: Math.max(1, Math.floor(num(src.version, 1))), items: safe };
}
