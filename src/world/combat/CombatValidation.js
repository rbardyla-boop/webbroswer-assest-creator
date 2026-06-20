// Combat-0 validation boundary. PURE (imports only the combat value types). The seam's two
// gates live here: a strike requires an ACTIVE equipped weapon (no weapon → no event), and every
// ray/hit component must be finite (safety). `isCombatTarget` is the single predicate that decides
// whether a placed WorldObject is an inert hit target (by its reserved name).

import { createStrikeEvent, COMBAT_TARGET_NAME } from "./CombatTypes.js";

// Validate one strike attempt. Returns a finite StrikeEvent, or null when there is no active
// weapon or any component is non-finite. The finite-guarding itself lives in createStrikeEvent —
// this adds only the "must have an active weapon" gate so the rule is in one obvious place.
export function validateStrike({ activeId, weaponRecipeId, origin, direction, muzzle, hit }) {
  if (!activeId) return null; // holstered / empty rightHand → no combat event
  return createStrikeEvent({ weaponId: activeId, weaponRecipeId, origin, direction, muzzle, hit });
}

/** True when a placed object is a combat target (reserved name on the asset or the root group). */
export function isCombatTarget(object3D) {
  if (!object3D) return false;
  const name = object3D.userData?.asset?.name ?? object3D.name;
  return name === COMBAT_TARGET_NAME;
}
