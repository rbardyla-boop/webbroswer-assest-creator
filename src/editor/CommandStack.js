// Bounded undo/redo stack for the World Builder.
//
// A command is any object with do() / undo() and (optionally) dispose(). The
// stack never inspects what a command touches; it only orders them and frees
// resources a command is holding once that command leaves history:
//   - execute(command): run do() now, then record it (a fresh action clears redo).
//   - push(command):    record a command the caller has ALREADY applied
//                       (interactive place/transform), without re-running do().
//   - undo()/redo():    move a command between the undo and redo stacks.
//
// dispose() is called when a command is evicted past the size limit or when the
// redo branch is discarded by a new action. Commands that park detached scene
// objects use dispose() to release their GPU memory; pure value commands (a
// transform tweak) implement it as a no-op. dispose() must only free objects the
// command is currently holding detached, so it is always safe to call.

const DEFAULT_LIMIT = 100;

export class CommandStack {
  constructor({ limit = DEFAULT_LIMIT, onChange = null } = {}) {
    this.limit = Math.max(1, limit | 0 || DEFAULT_LIMIT);
    this.onChange = onChange;
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  get depth() {
    return this.undoStack.length;
  }

  get redoDepth() {
    return this.redoStack.length;
  }

  // Run a command, then record it. Used for actions the stack performs itself
  // (e.g. delete), so do() applies the change.
  execute(command) {
    command.do();
    this._record(command);
    return command;
  }

  // Record a command whose effect the caller already applied (e.g. an
  // interactive placement or a finished gizmo drag), without re-running do().
  push(command) {
    this._record(command);
    return command;
  }

  undo() {
    const command = this.undoStack.pop();
    if (!command) return false;
    command.undo();
    this.redoStack.push(command);
    this._notify();
    return true;
  }

  redo() {
    const command = this.redoStack.pop();
    if (!command) return false;
    command.do();
    this.undoStack.push(command);
    this._notify();
    return true;
  }

  // Drop all history. Disposes whatever each command is currently parking
  // (detached objects); live objects are never held, so they are untouched.
  clear() {
    for (const command of this.undoStack) command.dispose?.();
    for (const command of this.redoStack) command.dispose?.();
    this.undoStack = [];
    this.redoStack = [];
    this._notify();
  }

  _record(command) {
    this.undoStack.push(command);
    // A new action makes the redo branch unreachable — discard it and free any
    // objects those undone commands were parking.
    for (const discarded of this.redoStack) discarded.dispose?.();
    this.redoStack = [];
    while (this.undoStack.length > this.limit) {
      this.undoStack.shift().dispose?.();
    }
    this._notify();
  }

  _notify() {
    this.onChange?.({
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      depth: this.depth,
      redoDepth: this.redoDepth,
    });
  }
}
