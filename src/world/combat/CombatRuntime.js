// Combat-0 — the validated weapon-use SEAM:
//
//     input edge → active equipped weapon → aim ray → hit query → StrikeEvent → feedback
//
// It READS the active equipped weapon (the rightHand occupant, via WeaponEquipRuntime) without
// mutating arsenal generation; casts ONE eye-aim hitscan ray (origin + direction from the camera's
// single shared aim basis) against the registered inert target set; and emits a finite-guarded,
// timestamp-free StrikeEvent. Holstered weapons (back / hip) are inactive by the activeId contract,
// so they produce no event. Enemy-0 consumes the seam by registering enemies as targets and reading
// StrikeEvent.hit — touching neither arsenal, objectives, nor input.
//
// Imports only THREE + the combat-internal modules (isolation: never an arsenal workbench module).

import * as THREE from "three";
import { MAX_RANGE, USE_WEAPON_INPUT, toVec3Array } from "./CombatTypes.js";
import { validateStrike, isCombatTarget } from "./CombatValidation.js";
import { CombatTarget } from "./CombatTarget.js";
import { CombatFeedback } from "./CombatFeedback.js";

export class CombatRuntime {
  constructor({ equipRuntime, placedRuntime, cameraController, input }) {
    this.equipRuntime = equipRuntime;
    this.placedRuntime = placedRuntime;
    this.cameraController = cameraController;
    this.input = input;
    this.feedback = null;
    this.targets = new Map(); // objectId -> CombatTarget
    this.lastEvent = null;
    this._scene = null;
    this._raycaster = new THREE.Raycaster();
    this._raycaster.far = MAX_RANGE;
    this._origin = new THREE.Vector3();
    this._dir = new THREE.Vector3();
  }

  // (Re)register inert targets from the loaded world. Idempotent: clears prior targets + feedback
  // first, so a world reload re-registers cleanly and never leaks an impact mark.
  load({ scene, objectManager }) {
    this.clear();
    this._scene = scene;
    this.feedback = new CombatFeedback(scene);
    for (const obj of objectManager?.objects?.values?.() ?? []) {
      if (!isCombatTarget(obj)) continue;
      const id = obj.userData?.objectId ?? obj.uuid;
      this.targets.set(id, new CombatTarget(id, obj));
    }
  }

  get activeId() {
    return this.equipRuntime?.activeId ?? null;
  }

  get canFire() {
    return this.activeId != null;
  }

  update(dt) {
    this.feedback?.update(dt);
    if (this.input?.wasPressed(USE_WEAPON_INPUT)) this.use();
  }

  // Use the active weapon once. Returns the StrikeEvent (also stored as lastEvent), or null when
  // there is no active weapon or the aim ray / hit is non-finite.
  use() {
    const activeId = this.activeId;
    if (!activeId) return null; // no active weapon → no combat event

    const entry = this.placedRuntime?.getEntry?.(activeId) ?? null;
    const recipe = entry?.weapon?.recipe ?? null;

    // Aim ray — the eye origin + normalized direction come from the camera's single source of the
    // aim basis (identical in first- and third-person).
    this.cameraController.aimRay(this._origin, this._dir);
    if (!isFiniteVector(this._origin) || !isFiniteVector(this._dir)) return null; // safety

    const muzzle = this._muzzleWorld(entry) ?? this._origin; // fall back to the eye if no finite muzzle
    const hit = this._queryHit();

    const event = validateStrike({
      activeId,
      weaponRecipeId: recipe?.seed ?? null,
      origin: this._origin,
      direction: this._dir,
      muzzle,
      hit,
    });
    if (!event) return null;

    if (event.hit) {
      const target = this.targets.get(event.hit.targetId);
      target?.registerHit({ point: event.hit.point, normal: event.hit.normal, weaponId: activeId });
      this.feedback?.spawn(event.hit.point);
    }
    this.lastEvent = event;
    return event;
  }

  // Cast the aim ray against the registered targets only (bounded + clear semantics). Returns the
  // nearest finite hit { targetId, point, normal, distance }, or null on a miss.
  _queryHit() {
    if (this.targets.size === 0) return null;
    const objs = [];
    for (const t of this.targets.values()) {
      if (!t.object3D) continue;
      t.object3D.updateWorldMatrix(true, false); // static dummies, but keep correct in synchronous driver steps
      objs.push(t.object3D);
    }
    if (objs.length === 0) return null;

    this._raycaster.set(this._origin, this._dir);
    this._raycaster.far = MAX_RANGE;
    const hits = this._raycaster.intersectObjects(objs, true);
    if (hits.length === 0) return null;

    const h = hits[0];
    const point = toVec3Array(h.point);
    const normal = this._hitNormal(h);
    const targetId = this._ownerId(h.object);
    if (!point || !normal || !targetId) return null;
    return { targetId, point, normal, distance: h.distance };
  }

  _hitNormal(h) {
    if (h.face) {
      const n = h.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(h.object.matrixWorld));
      n.normalize();
      if (Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z) && n.lengthSq() > 0) {
        return [n.x, n.y, n.z];
      }
    }
    return [-this._dir.x, -this._dir.y, -this._dir.z]; // fallback: oppose the ray
  }

  // Walk up from the hit mesh to the registered target root, returning its registration key. Mirrors
  // load()'s `objectId ?? uuid` keying so a target registered under either scheme still resolves.
  _ownerId(object) {
    let o = object;
    while (o) {
      const id = o.userData?.objectId;
      if (id != null && this.targets.has(id)) return id;
      if (this.targets.has(o.uuid)) return o.uuid;
      o = o.parent;
    }
    return null;
  }

  // The active weapon's muzzle marker in world space (proves the seam reads the equipped weapon),
  // or null when there is no finite muzzle.
  _muzzleWorld(entry) {
    const markers = entry?.group?.userData?.markers;
    if (!markers || !Array.isArray(markers.muzzle)) return null;
    entry.group.updateWorldMatrix(true, false);
    const v = new THREE.Vector3().fromArray(markers.muzzle).applyMatrix4(entry.group.matrixWorld);
    return isFiniteVector(v) ? [v.x, v.y, v.z] : null;
  }

  snapshot() {
    const scratch = new THREE.Vector3();
    return {
      activeWeaponId: this.activeId,
      canFire: this.canFire,
      targets: [...this.targets.values()].map((t) => {
        let position = null;
        if (t.object3D) {
          t.object3D.updateWorldMatrix(true, false);
          t.object3D.getWorldPosition(scratch);
          position = [scratch.x, scratch.y, scratch.z];
        }
        return { id: t.id, hitCount: t.hitCount, position };
      }),
      lastEvent: this.lastEvent,
      activeMarks: this.feedback?.activeMarks ?? 0,
    };
  }

  // Remove + dispose all feedback and forget targets (idempotent). Called at the top of load().
  clear() {
    this.feedback?.dispose();
    this.feedback = null;
    this.targets.clear();
    this.lastEvent = null;
    this._scene = null;
  }

  dispose() {
    this.clear();
    this.equipRuntime = null;
    this.placedRuntime = null;
    this.cameraController = null;
    this.input = null;
  }
}

function isFiniteVector(v) {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}
