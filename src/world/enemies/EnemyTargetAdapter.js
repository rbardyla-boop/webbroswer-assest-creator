// The bridge that lets an enemy CONSUME the Combat-0 hit path without any new hit detection.
//
// It duck-types Combat-0's CombatTarget ({ id, object3D, hitCount, lastHit, registerHit }) so it is a
// drop-in for `combatRuntime.targets`. CombatRuntime stays the sole authority for aiming, raycasting,
// StrikeEvent creation, and hit dispatch; when it resolves a strike to this enemy it calls the SAME
// `registerHit(...)` it calls on a dummy. This adapter records the inert hit (so combat's snapshot
// still reports hitCount) and forwards the strike to `onHit`, which the EnemyRuntime uses to apply
// damage. PURE: owns no THREE objects and no scene nodes — nothing to dispose.

export class EnemyTargetAdapter {
  /**
   * @param {string} id            registration key in combatRuntime.targets (matches mesh userData.objectId)
   * @param {THREE.Object3D} object3D  the enemy mesh combat raycasts
   * @param {(hit: {point:number[], normal:number[], weaponId:string}) => void} onHit
   */
  constructor(id, object3D, onHit) {
    this.id = id;
    this.object3D = object3D;
    this.hitCount = 0;
    this.lastHit = null;
    this._onHit = typeof onHit === "function" ? onHit : null;
  }

  /** Combat dispatch entry point (same signature as CombatTarget.registerHit). */
  registerHit({ point, normal, weaponId }) {
    this.hitCount += 1;
    this.lastHit = {
      point: [point[0], point[1], point[2]],
      normal: [normal[0], normal[1], normal[2]],
      weaponId,
    };
    this._onHit?.(this.lastHit);
  }
}
