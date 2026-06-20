// Encounter store (Encounter Editor-0) — owns the WorldDocument's `encounters.items` list (the persisted
// authored beat descriptors). list/get/add/remove, in-place mutation (the editor writes a descriptor; the
// runtime mutates a live entry's `completed` flag, which reaches disk when the document is re-validated on
// save). Self-heals a missing block like ObjectiveStore. PURE data — no THREE, no scene.

import { normalizeEncounterDescriptor, MAX_ENCOUNTERS } from "./EncounterTypes.js";

export class EncounterStore {
  constructor(document) {
    this.document = document;
    if (!this.document.encounters || typeof this.document.encounters !== "object") {
      this.document.encounters = { version: 1, items: [] };
    }
    if (!Array.isArray(this.document.encounters.items)) this.document.encounters.items = [];
  }

  list() {
    return this.document.encounters.items;
  }

  get(id) {
    return this.list().find((e) => e.id === id) ?? null;
  }

  /** Add (or replace by id) a descriptor; returns the normalized item or null if invalid/full. */
  add(descriptor) {
    const item = normalizeEncounterDescriptor(descriptor);
    if (!item) return null;
    const items = this.list();
    const i = items.findIndex((x) => x.id === item.id);
    if (i >= 0) {
      items[i] = item; // replace in place
      return item;
    }
    if (items.length >= MAX_ENCOUNTERS) return null;
    items.push(item);
    return item;
  }

  /** Remove an encounter by id; returns true when one was removed. */
  remove(id) {
    const items = this.list();
    const i = items.findIndex((x) => x.id === id);
    if (i < 0) return false;
    items.splice(i, 1);
    return true;
  }
}
