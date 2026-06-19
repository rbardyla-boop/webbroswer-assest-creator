// Editor layer visibility + lock (Editor UX-1).
//
// Layers let an author focus by hiding whole categories and lock the placed
// objects so a stray click can't move them. CRITICAL boundary: this is
// EDITOR-SESSION-ONLY view state. It is NEVER written to the WorldDocument, so a
// layer hidden or locked here can never hide content for a player. It resets when
// a new world loads (the editor calls reset()), exactly like the undo history.
//
// This module is pure (no THREE): it owns the visible/locked Sets and fires an
// injected `onVisibility(id, visible)` callback so the editor performs the actual
// scene toggle (terrain.mesh.visible, manager.root.visible, system setVisible…).
// That keeps the state machine unit-testable in Node.

/**
 * The layers surfaced in the editor. Only categories that have real content in
 * EDITOR mode are listed (objective markers are runtime-only, so the objective
 * is shown in the Hierarchy instead, read from the document). `lockable` is true
 * only where the layer's content is selectable by the viewport raycast — i.e. the
 * editable world objects — so no dead lock toggles are shown.
 */
export const EDITOR_LAYERS = [
  { id: "objects", label: "World Objects", lockable: true },
  { id: "terrain", label: "Terrain", lockable: false },
  { id: "water", label: "Water", lockable: false },
  { id: "wildlife", label: "Wildlife", lockable: false },
  { id: "ambient", label: "Ambient", lockable: false },
  { id: "arsenal", label: "Weapons", lockable: false },
];

const LAYER_IDS = new Set(EDITOR_LAYERS.map((l) => l.id));
const LOCKABLE = new Set(EDITOR_LAYERS.filter((l) => l.lockable).map((l) => l.id));

/**
 * Which layer a placed world object belongs to for lock purposes. Every object
 * owned by the WorldObjectManager (hand-placed or generator-emitted) is in the
 * single selectable "objects" layer.
 * @param {{userData?: object}} _object
 * @returns {string}
 */
export function layerOfObject(_object) {
  return "objects";
}

export class LayerModel {
  /**
   * @param {object} [opts]
   * @param {(id: string, visible: boolean) => void} [opts.onVisibility] performs the scene toggle
   */
  constructor({ onVisibility = null } = {}) {
    this._onVisibility = onVisibility;
    this._hidden = new Set();
    this._locked = new Set();
  }

  /** Snapshot for the panel UI. */
  layers() {
    return EDITOR_LAYERS.map((l) => ({
      id: l.id,
      label: l.label,
      lockable: l.lockable,
      visible: !this._hidden.has(l.id),
      locked: this._locked.has(l.id),
    }));
  }

  isVisible(id) {
    return !this._hidden.has(id);
  }

  isLocked(id) {
    return this._locked.has(id);
  }

  /**
   * Show/hide a layer. Fires onVisibility only on a real change. Unknown ids are a
   * no-op returning false (never throws).
   * @returns {boolean} whether the id was a known layer
   */
  setVisible(id, visible) {
    if (!LAYER_IDS.has(id)) return false;
    const want = !!visible;
    if (this.isVisible(id) === want) return true; // no change → no re-fire
    if (want) this._hidden.delete(id);
    else this._hidden.add(id);
    this._onVisibility?.(id, want);
    return true;
  }

  toggleVisible(id) {
    return this.setVisible(id, !this.isVisible(id));
  }

  /**
   * Lock/unlock a layer. Lock is pure editor state checked by the selection
   * raycast. Unknown ids are a no-op returning false.
   * @returns {boolean}
   */
  setLocked(id, locked) {
    if (!LAYER_IDS.has(id)) return false;
    if (locked) this._locked.add(id);
    else this._locked.delete(id);
    return true;
  }

  toggleLocked(id) {
    return this.setLocked(id, !this.isLocked(id));
  }

  /** Does this object belong to a layer the author has locked? (gates selection) */
  isObjectInLockedLayer(object) {
    return this._locked.has(layerOfObject(object));
  }

  /** Restore all layers visible + unlocked — called when a fresh world loads. */
  reset() {
    for (const id of [...this._hidden]) {
      this._hidden.delete(id);
      this._onVisibility?.(id, true);
    }
    this._locked.clear();
  }
}
