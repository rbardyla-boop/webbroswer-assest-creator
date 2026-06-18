// Player equip slots (Arsenal v4). Explicit attach points on the player avatar, each a local
// transform { bone, localPosition, localRotation } in player.mesh space. The weapon's `equip`
// marker is aligned onto a slot via `weaponLocal = slotMatrix(name) × equipMatrix(markers)⁻¹`
// (see WeaponEquipRuntime), so the marker coincides with the slot in world space.
//
// `bone` is a forward-looking hook for skeletal attachment — null today (the player avatar is a
// plain capsule group, no skeleton), so slots are pure transforms composed into the weapon's
// player-local matrix and the equipped weapon stays a DIRECT child of player.mesh (the v3 proof
// asserts `group.parent.name === "Player"`). Pure of arsenal UI: imports only THREE.
//
// Convention: weapons are modeled along +X (muzzle toward +X), grip toward −Y; the player faces
// +Z (the nose marker). rightHand keeps the weapon in its model frame (identity rotation) and
// its localPosition equals the v3 handLocal EXACTLY (0.35, 1.1, 0.25), so the rightHand attach
// math reduces to the v3 `position = handLocal − equip` result and the v3 tests stay green.
// back/hip carry the meaningful orientation: muzzle up along the spine / angled down on the hip.

import * as THREE from "three";

const SQRT1_2 = 0.7071067811865476; // sin/cos(45°) — a normalized ±90° quaternion component

// Deep-freeze so the contract table (and its nested arrays) can't be mutated at runtime —
// Object.freeze is shallow, and slotMatrix/handLocal read these arrays every call.
function deepFreeze(o) {
  for (const k of Object.getOwnPropertyNames(o)) {
    const v = o[k];
    if (v && typeof v === "object") deepFreeze(v);
  }
  return Object.freeze(o);
}

export const PLAYER_SLOTS = deepFreeze({
  // identity rotation — weapon in its model frame; localPosition == the v3 handLocal default.
  rightHand: { bone: null, localPosition: [0.35, 1.1, 0.25], localRotation: [0, 0, 0, 1] },
  // +90° about Z → muzzle (+X) points up (+Y): laid vertically along the spine, behind the torso.
  back: { bone: null, localPosition: [-0.05, 1.25, -0.28], localRotation: [0, 0, SQRT1_2, SQRT1_2] },
  // −90° about Z → muzzle points down: holstered on the right hip.
  hip: { bone: null, localPosition: [0.42, 0.78, 0.05], localRotation: [0, 0, -SQRT1_2, SQRT1_2] },
});

export const SLOT_NAMES = Object.freeze(Object.keys(PLAYER_SLOTS));
export const SLOT_CYCLE = Object.freeze(["rightHand", "back", "hip"]);
export const DEFAULT_SLOT = "rightHand";

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);

/** True iff `name` is a known slot. */
export function isSlot(name) {
  return Object.prototype.hasOwnProperty.call(PLAYER_SLOTS, name);
}

/** The next slot in the cycle rightHand → back → hip → rightHand (unknown → rightHand). */
export function nextSlot(name) {
  const i = SLOT_CYCLE.indexOf(name);
  return SLOT_CYCLE[(i + 1) % SLOT_CYCLE.length]; // i === -1 → index 0 → rightHand
}

/**
 * A slot's local transform (relative to player.mesh) as a Matrix4: localPosition + normalized
 * localRotation + unit scale. Returns null for an unknown slot.
 * @param {string} name
 * @param {THREE.Matrix4} [out] reused output matrix (a fresh one by default)
 * @returns {THREE.Matrix4 | null}
 */
export function slotMatrix(name, out = new THREE.Matrix4()) {
  const s = PLAYER_SLOTS[name];
  if (!s) return null;
  _pos.fromArray(s.localPosition);
  _quat.fromArray(s.localRotation).normalize(); // compose() does NOT normalize — pin it here
  _scale.set(1, 1, 1);
  return out.compose(_pos, _quat, _scale);
}
