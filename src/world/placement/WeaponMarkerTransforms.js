// Weapon marker-transform contract (Arsenal v4). Lifts the position-only `userData.markers`
// arrays a weapon exposes (built by src/arsenal/WeaponRuntime — muzzle/core/equip/socket as
// bare [x,y,z]) into full finite TRANSFORMS {position, rotation}. This is the authoritative
// marker contract the equip runtime composes against: attachment is
// `weaponLocal = slotMatrix × equipMatrix⁻¹`, so the weapon's equip marker lands exactly on a
// player slot in world space.
//
// Marker rotation defaults to IDENTITY (the weapon's model grip frame — weapons are modeled
// along +X, grip −Y). The meaningful per-attach orientation lives in the SLOT rotations
// (WeaponEquipSlots.js), NOT here — keeping the arsenal source untouched (markers stay arrays,
// so the v1/v2 arsenal tests stay green). Pure of arsenal UI: imports only THREE and reads the
// plain marker map off a placed weapon. Finite-guarded — a poisoned (non-finite) marker yields
// null so the caller refuses the attach instead of corrupting the scene-graph matrix.

import * as THREE from "three";

export const MARKER_KEYS = Object.freeze(["muzzle", "core", "equip", "socket"]);

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);

/** Return a finite [x,y,z] marker array, or null. */
function finiteVec(m) {
  return Array.isArray(m) && m.length >= 3 && Number.isFinite(m[0]) && Number.isFinite(m[1]) && Number.isFinite(m[2]) ? m : null;
}

/**
 * The local-space transform of the `equip` marker as a Matrix4 (position from the marker,
 * identity rotation, unit scale). Returns null when the marker is missing or non-finite.
 * @param {Record<string, number[]>} markers the weapon's userData.markers map
 * @param {THREE.Matrix4} [out] reused output matrix (a fresh one by default)
 * @returns {THREE.Matrix4 | null}
 */
export function equipMatrix(markers, out = new THREE.Matrix4()) {
  const e = finiteVec(markers?.equip);
  if (!e) return null;
  _pos.set(e[0], e[1], e[2]);
  _quat.identity();
  _scale.set(1, 1, 1);
  return out.compose(_pos, _quat, _scale);
}

/**
 * One marker's full transform {position:Vector3, rotation:Quaternion}. Rotation is identity —
 * the contract carries it so the attach math composes a full transform; today the value is the
 * weapon's model grip frame. Returns null for a missing/non-finite marker.
 * @param {Record<string, number[]>} markers
 * @param {string} key
 * @returns {{position: THREE.Vector3, rotation: THREE.Quaternion} | null}
 */
export function markerTransform(markers, key) {
  const m = finiteVec(markers?.[key]);
  if (!m) return null;
  return { position: new THREE.Vector3(m[0], m[1], m[2]), rotation: new THREE.Quaternion() };
}

/** True iff every standard marker (muzzle/core/equip/socket) is present and finite. */
export function markersAllFinite(markers) {
  return !!markers && MARKER_KEYS.every((k) => finiteVec(markers[k]) !== null);
}
