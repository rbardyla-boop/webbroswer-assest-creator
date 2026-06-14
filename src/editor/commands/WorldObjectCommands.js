// Undo/redo commands for the World Builder's spatial authoring actions.
//
// These operate on live THREE objects through the WorldObjectManager's
// detach()/attach()/disposeObject() pair (object retention), so undo/redo is
// synchronous and restores the exact same instance — same id, geometry, asset,
// collider and animation state — with no async asset rebuild.
//
// Each command tracks `_parked`: the objects it currently holds DETACHED and is
// therefore responsible for disposing. dispose() frees only those, so the
// CommandStack can call it whenever a command leaves history without ever
// disposing an object that is still live in the scene.

// Add one or more freshly-created (already attached) placed objects.
//   - constructed in the "done" state: the caller already placed the objects,
//     so they are live and nothing is parked.
//   - undo() detaches (parks) them; do()/redo() re-attaches.
export class AddObjectsCommand {
  constructor(manager, objects) {
    this.manager = manager;
    this.objects = (objects ?? []).filter(Boolean);
    this._parked = [];
  }

  do() {
    for (const object of this.objects) this.manager.attach(object);
    this._parked = [];
  }

  undo() {
    for (const object of this.objects) this.manager.detach(object);
    this._parked = [...this.objects];
  }

  dispose() {
    for (const object of this._parked) this.manager.disposeObject(object);
    this._parked = [];
  }
}

// Remove one or more placed objects.
//   - run via CommandStack.execute(): do() detaches (parks) them immediately.
//   - undo() re-attaches; redo() detaches again.
export class RemoveObjectsCommand {
  constructor(manager, objects) {
    this.manager = manager;
    this.objects = (objects ?? []).filter(Boolean);
    this._parked = [];
  }

  do() {
    for (const object of this.objects) this.manager.detach(object);
    this._parked = [...this.objects];
  }

  undo() {
    for (const object of this.objects) this.manager.attach(object);
    this._parked = [];
  }

  dispose() {
    for (const object of this._parked) this.manager.disposeObject(object);
    this._parked = [];
  }
}

// Restore a set of object transforms. `before` and `after` are arrays of
// { id, position:[3], rotation:[3], scale:[3] }. The caller has already applied
// `after` (the finished gizmo drag), so this is recorded via push().
export class TransformObjectsCommand {
  constructor(manager, before, after) {
    this.manager = manager;
    this.before = before ?? [];
    this.after = after ?? [];
  }

  do() {
    this._apply(this.after);
  }

  undo() {
    this._apply(this.before);
  }

  // Pure value command — it parks no objects, so there is nothing to free.
  dispose() {}

  _apply(states) {
    const boxes = [];
    for (const state of states) {
      const object = this.manager.objects.get(state.id);
      if (!object) {
        // Defensive: a normal undo/redo ordering keeps every transformed object
        // alive. Surface a miss rather than partially applying in silence.
        console.warn(`TransformObjectsCommand: object ${state.id} not present; skipping transform restore.`);
        continue;
      }
      boxes.push(this.manager.getWorldBox(object)); // box before the move
      object.position.fromArray(state.position);
      object.rotation.set(state.rotation[0], state.rotation[1], state.rotation[2]);
      object.scale.fromArray(state.scale);
      object.updateMatrixWorld(true);
      boxes.push(this.manager.getWorldBox(object)); // box after the move
    }
    // Rebuild grass/trees + collider debug around both old and new footprints.
    this.manager._changed({ boxes });
  }
}
