// An INERT combat target — a thin record over an existing placed WorldObject. It counts how many
// times it has been struck and remembers the last hit. There is no health, death, or removal:
// Combat-0 is a seam, not a damage economy, and the target never mutates the world. Enemy-0 will
// layer health/destruction on top by consuming the same registration + the strike's hit data.
//
// PURE: owns no scene nodes and no THREE objects, so it needs nothing to dispose.

export class CombatTarget {
  constructor(id, object3D) {
    this.id = id;
    this.object3D = object3D;
    this.hitCount = 0;
    this.lastHit = null; // { point:[x,y,z], normal:[x,y,z], weaponId }
  }

  /** Record an inert strike. Stores finite copies; never removes or hides the object. */
  registerHit({ point, normal, weaponId }) {
    this.hitCount += 1;
    this.lastHit = {
      point: [point[0], point[1], point[2]],
      normal: [normal[0], normal[1], normal[2]],
      weaponId,
    };
  }
}
