// Objective store (FP-1) — owns the WorldDocument's `objectives.items` list (the persisted
// objective descriptors). list/get/add, in-place mutation (the runtime mutates a live entry's
// `completed` flag, which reaches disk when the document is re-validated on save). Self-heals a
// missing block like PlacedAssetStore. Pure data; no THREE, no scene.

import { normalizeObjectiveDescriptor, MAX_OBJECTIVES } from "./ObjectiveTypes.js";

export class ObjectiveStore {
  constructor(document) {
    this.document = document;
    if (!this.document.objectives || typeof this.document.objectives !== "object") {
      this.document.objectives = { version: 1, items: [] };
    }
    if (!Array.isArray(this.document.objectives.items)) this.document.objectives.items = [];
  }

  list() {
    return this.document.objectives.items;
  }

  /** The live descriptor for an objective kind (FP-1 has at most one of each kind). */
  getByKind(kind) {
    return this.list().find((o) => o.kind === kind) ?? null;
  }

  get(id) {
    return this.list().find((o) => o.id === id) ?? null;
  }

  /** Add (or replace by id) a descriptor; returns the normalized item or null if invalid/full. */
  add(descriptor) {
    const item = normalizeObjectiveDescriptor(descriptor);
    if (!item) return null;
    const items = this.list();
    const i = items.findIndex((x) => x.id === item.id);
    if (i >= 0) {
      items[i] = item; // replace in place
      return item;
    }
    if (items.length >= MAX_OBJECTIVES) return null;
    items.push(item);
    return item;
  }
}
