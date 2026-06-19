// Slot occupancy oracle (Arsenal v6). The PURE data model for which weapon occupies which player
// slot when carrying MULTIPLE weapons at once. No THREE scene ops, no time, no randomness — every
// function is a deterministic transform over a plain `{ rightHand, back, hip }` map of weaponId|null,
// so the conflict/slot logic is unit-testable in isolation (test:arsenal-carry) and the stateful
// attach engine (WeaponEquipRuntime) just applies the maps this module computes.
//
// Invariants this module enforces:
//   - at most one weapon per slot (a map key holds a single id or null),
//   - a weapon never occupies two slots (withWeaponAt removes it from any prior slot),
//   - duplicate persisted slot claims resolve deterministically (first valid claimant in order wins;
//     losers are reported as `evicted` for the caller to drop into the world).
//
// The slot NAMES + order are the canonical contract from WeaponEquipSlots (single source of truth —
// not re-declared here), so rotateOccupants and the cycle order stay in lock-step with the equip
// slot table and never drift.

import { SLOT_CYCLE, isSlot, nextSlot } from "./WeaponEquipSlots.js";

/** A fresh empty occupancy map: every known slot present and null. */
export function createOccupancy() {
  const occ = {};
  for (const slot of SLOT_CYCLE) occ[slot] = null;
  return occ;
}

/** The weapon id at `slot`, or null (also null for an unknown slot). */
export function idAt(occ, slot) {
  return isSlot(slot) ? occ[slot] ?? null : null;
}

/** The slot holding `id` (searched in cycle order), or null. */
export function slotOf(occ, id) {
  if (id == null) return null;
  for (const slot of SLOT_CYCLE) if (occ[slot] === id) return slot;
  return null;
}

/** True iff `id` occupies some slot. */
export function isCarried(occ, id) {
  return slotOf(occ, id) !== null;
}

/** Occupied slot names, in cycle order (rightHand → back → hip). */
export function occupiedSlots(occ) {
  return SLOT_CYCLE.filter((slot) => occ[slot] != null);
}

/** Free slot names, in cycle order. */
export function freeSlots(occ) {
  return SLOT_CYCLE.filter((slot) => occ[slot] == null);
}

/** The first free slot in cycle order, or null when all are occupied. */
export function firstFreeSlot(occ) {
  return freeSlots(occ)[0] ?? null;
}

/**
 * The "primary" slot — the first occupied slot in cycle order (rightHand → back → hip), or null.
 * This is what the v4 single-weapon `equippedSlot`/`equippedId` getters report: with one carried
 * weapon it is simply that weapon's slot wherever it sits, so v3/v4 behavior reduces exactly.
 */
export function primarySlot(occ) {
  return occupiedSlots(occ)[0] ?? null;
}

/** The count of carried weapons. */
export function carriedCount(occ) {
  return occupiedSlots(occ).length;
}

/**
 * A new occupancy with `id` placed at `slot` (and removed from any other slot it held). Returns the
 * map unchanged-shaped (a fresh copy) and never mutates the input. Unknown slot → unchanged copy.
 */
export function withWeaponAt(occ, slot, id) {
  if (!isSlot(slot)) return { ...occ };
  const next = { ...occ };
  for (const s of SLOT_CYCLE) if (next[s] === id) next[s] = null; // a weapon lives in one slot
  next[slot] = id;
  return next;
}

/** A new occupancy with `id` removed from whatever slot it held (no-op copy if absent). */
export function withoutWeapon(occ, id) {
  const next = { ...occ };
  for (const s of SLOT_CYCLE) if (next[s] === id) next[s] = null;
  return next;
}

/**
 * A new occupancy with every occupant shifted to the next slot in the cycle (rightHand → back →
 * hip → rightHand). Because nextSlot is a cyclic permutation of all slots, distinct occupied slots
 * map to distinct targets — no collisions. With a single weapon this walks it through the slots,
 * exactly reproducing the v4 cycleSlot.
 */
export function rotateOccupants(occ) {
  const next = createOccupancy();
  for (const slot of SLOT_CYCLE) {
    const id = occ[slot];
    if (id != null) next[nextSlot(slot)] = id;
  }
  return next;
}

/**
 * Resolve a list of slot claims into a conflict-free occupancy. Claims are consumed in array order
 * (the caller passes them in stable document order), and for each slot the FIRST valid claimant
 * wins; a claim is evicted when its slot is unknown, its slot is already taken, or its id already
 * won another slot. Deterministic and side-effect-free.
 * @param {Array<{id: string, slot: string}>} claims
 * @returns {{ occupancy: Record<string, string|null>, evicted: string[] }}
 */
export function resolveConflicts(claims) {
  const occupancy = createOccupancy();
  const evicted = [];
  const seen = new Set();
  for (const claim of Array.isArray(claims) ? claims : []) {
    const { id, slot } = claim ?? {};
    if (id == null || !isSlot(slot) || occupancy[slot] != null || seen.has(id)) {
      if (id != null) evicted.push(id);
      continue;
    }
    occupancy[slot] = id;
    seen.add(id);
  }
  return { occupancy, evicted };
}
