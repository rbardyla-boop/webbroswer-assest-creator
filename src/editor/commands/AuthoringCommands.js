// Undo/redo commands for Procedural Authoring-1. Unlike WorldObjectCommands (which
// detach/attach live THREE objects), authoring edits are PURE-DATA mutations of the
// document's `authoring` block — the modifier visuals are re-derived from that block by
// the AuthoringRuntime, so each command just edits the data and asks the runtime to
// rebuild. They park no GPU objects, so dispose() is a no-op (the CommandStack can
// evict them at any time). The block is cleared/rebuilt on world reload, and history is
// cleared with it, so a command never outlives the runtime it captured.

function list(doc, kind) {
  const a = doc?.authoring;
  if (!a) return null;
  if (!Array.isArray(a[kind])) a[kind] = [];
  return a[kind];
}

// Add one spline/mask/modifier descriptor.
export class AddAuthoringItemCommand {
  constructor({ doc, runtime }, kind, descriptor) {
    this.doc = doc;
    this.runtime = runtime;
    this.kind = kind;
    this.descriptor = descriptor;
  }

  do() {
    const arr = list(this.doc, this.kind);
    if (arr) arr.push(this.descriptor);
    this.runtime?.rebuild();
  }

  undo() {
    const arr = list(this.doc, this.kind);
    if (arr) {
      const i = arr.findIndex((it) => it.id === this.descriptor.id);
      if (i >= 0) arr.splice(i, 1);
    }
    this.runtime?.rebuild();
  }

  dispose() {}
}

// Remove one descriptor, restoring it at its original index on undo.
export class RemoveAuthoringItemCommand {
  constructor({ doc, runtime }, kind, descriptor) {
    this.doc = doc;
    this.runtime = runtime;
    this.kind = kind;
    this.descriptor = descriptor;
    this._index = -1;
  }

  do() {
    const arr = list(this.doc, this.kind);
    if (arr) {
      this._index = arr.findIndex((it) => it.id === this.descriptor.id);
      if (this._index >= 0) arr.splice(this._index, 1);
    }
    this.runtime?.rebuild();
  }

  undo() {
    const arr = list(this.doc, this.kind);
    if (arr && this._index >= 0) arr.splice(Math.min(this._index, arr.length), 0, this.descriptor);
    this.runtime?.rebuild();
  }

  dispose() {}
}

// Patch fields on one descriptor (a point move, a radius edit, a config tweak, a fresh
// seed). `before`/`after` are partial field maps over the SAME keys.
export class UpdateAuthoringItemCommand {
  constructor({ doc, runtime }, kind, id, before, after) {
    this.doc = doc;
    this.runtime = runtime;
    this.kind = kind;
    this.id = id;
    this.before = before;
    this.after = after;
  }

  do() {
    this._apply(this.after);
  }

  undo() {
    this._apply(this.before);
  }

  _apply(patch) {
    const arr = list(this.doc, this.kind);
    const item = arr?.find((it) => it.id === this.id);
    if (item) Object.assign(item, patch);
    this.runtime?.rebuild();
  }

  dispose() {}
}
