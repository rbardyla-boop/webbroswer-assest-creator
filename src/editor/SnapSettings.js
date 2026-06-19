// Grid snapping for the World Builder (Editor UX-1).
//
// Pure math + a thin driver for THREE's TransformControls — no THREE import, so it
// is unit-testable in Node. Snapping is an EDITOR view/authoring aid: it changes
// where the gizmo lands and where new objects are placed, never the serialized
// document schema. Default OFF (opt-in toggle in the sidebar).

/** Default translation grid (metres). */
export const GRID_SIZE = 0.5;
/** Default rotation snap (degrees). */
export const ROT_SNAP_DEG = 15;
/** Default scale snap step. */
export const SCALE_SNAP = 0.25;

/**
 * Round a scalar to the nearest multiple of `size`. Non-finite inputs and a
 * non-positive grid pass straight through (never returns NaN-for-a-number or 0).
 * @param {number} value
 * @param {number} [size]
 * @returns {number}
 */
export function snapToGrid(value, size = GRID_SIZE) {
  const s = Number(size);
  if (!Number.isFinite(value) || !Number.isFinite(s) || s <= 0) return value;
  return Math.round(value / s) * s;
}

/**
 * Snap each axis of a {x,y,z}-shaped point to the grid.
 * @param {{x:number,y:number,z:number}} vec
 * @param {number} [size]
 * @returns {{x:number,y:number,z:number}}
 */
export function snapVec3(vec, size = GRID_SIZE) {
  return {
    x: snapToGrid(vec?.x ?? 0, size),
    y: snapToGrid(vec?.y ?? 0, size),
    z: snapToGrid(vec?.z ?? 0, size),
  };
}

const DEG_TO_RAD = (deg) => (deg * Math.PI) / 180;

export class SnapSettings {
  constructor({ enabled = false, gridSize = GRID_SIZE, rotDeg = ROT_SNAP_DEG, scaleStep = SCALE_SNAP } = {}) {
    this.enabled = !!enabled;
    this.gridSize = gridSize > 0 ? gridSize : GRID_SIZE;
    this.rotDeg = rotDeg > 0 ? rotDeg : ROT_SNAP_DEG;
    this.scaleStep = scaleStep > 0 ? scaleStep : SCALE_SNAP;
  }

  setEnabled(on) {
    this.enabled = !!on;
    return this;
  }

  /**
   * Push the current snap into a THREE.TransformControls-shaped object (or clear
   * it when disabled). `degToRad` is injectable so the math is testable without THREE.
   * @param {{setTranslationSnap:Function,setRotationSnap:Function,setScaleSnap:Function}|null} transform
   * @param {(deg:number)=>number} [degToRad]
   */
  applyTo(transform, degToRad = DEG_TO_RAD) {
    if (!transform) return;
    const on = this.enabled;
    transform.setTranslationSnap?.(on ? this.gridSize : null);
    transform.setRotationSnap?.(on ? degToRad(this.rotDeg) : null);
    transform.setScaleSnap?.(on ? this.scaleStep : null);
  }

  /**
   * Snap a placement point to the grid when enabled; otherwise return its
   * coordinates unchanged (always a plain {x,y,z}).
   * @param {{x:number,y:number,z:number}} point
   * @returns {{x:number,y:number,z:number}}
   */
  snapPlacement(point) {
    if (this.enabled) return snapVec3(point, this.gridSize);
    return { x: point?.x ?? 0, y: point?.y ?? 0, z: point?.z ?? 0 };
  }
}
