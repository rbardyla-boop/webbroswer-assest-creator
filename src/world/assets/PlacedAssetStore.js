// Placed asset store — owns the WorldDocument's `runtimeAssets.items` list (the
// persisted descriptors). Add/remove/list, plus draining the cross-entry handoff queue
// the Arsenal Lab writes. Pure data + localStorage (guarded); no THREE, no scene.

import { normalizeRuntimeAssetDescriptor, MAX_RUNTIME_ASSETS } from "./RuntimeAssetTypes.js";

const HANDOFF_KEY = "arsenal-export-queue";

export class PlacedAssetStore {
  constructor(document) {
    this.document = document;
    if (!this.document.runtimeAssets || typeof this.document.runtimeAssets !== "object") {
      this.document.runtimeAssets = { version: 1, items: [] };
    }
    if (!Array.isArray(this.document.runtimeAssets.items)) this.document.runtimeAssets.items = [];
  }

  list() {
    return this.document.runtimeAssets.items;
  }

  /** Add (or replace by id) a descriptor; returns the normalized item or null if invalid/full. */
  add(descriptor) {
    const item = normalizeRuntimeAssetDescriptor(descriptor);
    if (!item) return null;
    const items = this.list();
    const i = items.findIndex((x) => x.id === item.id);
    if (i >= 0) {
      items[i] = item; // replace in place (re-placing the same weapon)
      return item;
    }
    if (items.length >= MAX_RUNTIME_ASSETS) return null;
    items.push(item);
    return item;
  }

  remove(id) {
    const items = this.list();
    const i = items.findIndex((x) => x.id === id);
    if (i < 0) return false;
    items.splice(i, 1);
    return true;
  }

  /**
   * Drain the Arsenal Lab handoff queue: for each queued world-asset, call `place(asset)`
   * (which grounds + adds it). The queue is always cleared. Returns the number placed.
   */
  drainHandoffQueue(place) {
    let raw = null;
    try {
      raw = globalThis.localStorage?.getItem(HANDOFF_KEY) ?? null;
    } catch {
      return 0;
    }
    if (!raw) return 0;
    let queue = null;
    try {
      queue = JSON.parse(raw);
    } catch {
      queue = null;
    }
    let placed = 0;
    if (Array.isArray(queue)) {
      for (const asset of queue) {
        // Guard each item so one bad asset (or a placement throw) drops just that
        // entry rather than aborting the drain or leaving the queue half-processed.
        try {
          if (place(asset)) placed++;
        } catch {
          /* skip a bad queued asset */
        }
      }
    }
    this._clearQueue();
    return placed;
  }

  _clearQueue() {
    try {
      globalThis.localStorage?.removeItem(HANDOFF_KEY);
    } catch {
      /* storage unavailable — nothing to clear */
    }
  }
}
