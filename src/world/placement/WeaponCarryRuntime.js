// Weapon carry runtime (Arsenal v6). The ONLY verb layer for carrying multiple weapons: pick up,
// draw, holster, cycle, drop, store. It owns NO scene/attach math and NO occupancy STATE — that
// lives in WeaponEquipRuntime (the attach engine) and WeaponSlotOccupancy (the pure map). This layer
// is pure POLICY: which slot a pickup goes to, how a draw swaps the hand, where a holster lands. It
// computes a target occupancy with the pure helpers and asks the engine to apply it, so every move
// goes through the same finite-guarded attach and nothing is ever orphaned.
//
// Model (positional): rightHand is the single drawn/active slot; back + hip are holstered. "active"
// is DERIVED (the rightHand occupant) — never persisted. Holster/draw is slot movement; there is no
// separate holster state. Stored/dropped weapons occupy no slot. Pure of arsenal UI.

import { idAt, slotOf, occupiedSlots, freeSlots, firstFreeSlot, withWeaponAt } from "./WeaponSlotOccupancy.js";

const HOLSTER_SLOTS = ["back", "hip"]; // the non-drawn slots, in holster-preference order

export class WeaponCarryRuntime {
  constructor(equipRuntime) {
    this.equip = equipRuntime;
  }

  // --- accessors (delegate to the engine) ------------------------------------------------------
  get activeId() {
    return this.equip.activeId;
  }

  get carriedCount() {
    return this.equip.carriedCount;
  }

  slotOf(id) {
    return this.equip.slotOf(id);
  }

  occupiedSlots() {
    return this.equip.occupiedSlots();
  }

  // --- verbs -----------------------------------------------------------------------------------

  /**
   * Pick up the nearest un-carried placed weapon into a free slot: the hand if empty, else the first
   * free holster; if every slot is full, the drawn weapon is dropped to the world to make room and
   * the new one is taken in hand. Returns the picked-up id, or false when nothing is in range.
   */
  pickUp(player) {
    const id = this.equip._nearestUncarried(player);
    if (!id) return false;
    const occ = this.equip.occupancy();
    let slot = occ.rightHand == null ? "rightHand" : firstFreeSlot(occ);
    if (slot == null) {
      // all slots full → free the hand by dropping the active weapon into the world
      if (this.equip.activeId) this.equip.unequipWeapon(this.equip.activeId, player, "drop");
      slot = "rightHand";
    }
    return this.equip.equip(id, player, slot) ? id : false;
  }

  /** F: pick up a nearby weapon when there's room, otherwise drop the active one. */
  pickUpOrDrop(player) {
    const occ = this.equip.occupancy();
    const near = this.equip._nearestUncarried(player);
    if (near && freeSlots(occ).length > 0) return this.pickUp(player) !== false;
    if (occ.rightHand != null) return this.dropActive(player);
    return false;
  }

  /** Drop the active (drawn) weapon into the world. */
  dropActive(player) {
    return this.equip.activeId ? this.equip.unequipWeapon(this.equip.activeId, player, "drop") : false;
  }

  /** Store (hide) the active (drawn) weapon — it occupies no slot afterward. */
  storeActive(player) {
    return this.equip.activeId ? this.equip.unequipWeapon(this.equip.activeId, player, "store") : false;
  }

  /** Drop a SPECIFIC carried weapon by id (the objective uses this to deposit the relic). */
  dropWeapon(id, player) {
    return this.equip.unequipWeapon(id, player, "drop");
  }

  /**
   * Draw the weapon at `slot` into the hand, swapping the current hand weapon (if any) into the
   * vacated slot. No-op-true when that slot is already the hand; false when the slot is empty.
   * Both weapons stay carried — nothing is orphaned.
   */
  drawSlot(slot, player) {
    const occ = this.equip.occupancy();
    const id = idAt(occ, slot);
    if (id == null) return false;
    if (slot === "rightHand") return true; // already drawn
    const handId = idAt(occ, "rightHand");
    // target → rightHand, hand → the vacated slot (handId may be null → that slot empties)
    const swapped = withWeaponAt(withWeaponAt(occ, "rightHand", id), slot, handId);
    return this.equip.applyOccupancy(swapped, player);
  }

  /**
   * H: holster the drawn weapon to the first free holster (back, then hip); or, when the hand is
   * empty, draw the first holstered weapon into the hand. Returns false when neither is possible.
   */
  holsterOrDraw(player) {
    const occ = this.equip.occupancy();
    const handId = idAt(occ, "rightHand");
    if (handId != null) {
      const target = HOLSTER_SLOTS.find((s) => occ[s] == null);
      if (!target) return false; // both holsters full — nowhere to holster
      return this.equip.applyOccupancy(withWeaponAt(occ, target, handId), player); // hand → holster
    }
    const src = occupiedSlots(occ).find((s) => s !== "rightHand"); // first holstered weapon
    return src ? this.drawSlot(src, player) : false;
  }

  /** R: rotate every carried weapon to the next slot (brings the next weapon to hand). */
  cycle(player) {
    return this.equip.cycleSlot(player);
  }

  /** 1/2/3: select a slot — draw the weapon there into the hand. */
  selectSlot(slot, player) {
    return this.drawSlot(slot, player);
  }

  /** Re-attach the persisted carry state on world load (delegates to the engine). */
  load(player) {
    this.equip.load(player);
  }

  debugSnapshot() {
    const snap = this.equip.debugSnapshot();
    return { ...snap, present: true, carriedCount: this.equip.carriedCount, activeId: this.equip.activeId };
  }
}
