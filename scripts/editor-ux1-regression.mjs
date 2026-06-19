// test:editor-ux1-unit — pure-Node unit regression for the Editor UX-1 view-layer modules.
//
// These three modules are deliberately THREE-free so they can be proved here with no browser:
//   - SnapSettings   — grid/rotation/scale snap math + how it drives a TransformControls.
//   - EditorAutosave — debounced save state machine (idle→dirty→saving→saved|error).
//   - LayerModel     — editor-session visibility/lock state (never persisted to the document).
//
// The browser proof (test:editor-ux1) covers the live wiring; this file pins the logic.

import assert from "node:assert/strict";
import {
  GRID_SIZE,
  ROT_SNAP_DEG,
  SCALE_SNAP,
  SnapSettings,
  snapToGrid,
  snapVec3,
} from "../src/editor/SnapSettings.js";
import { AUTOSAVE_DEBOUNCE_MS, EditorAutosave } from "../src/editor/EditorAutosave.js";
import { EDITOR_LAYERS, LayerModel, layerOfObject } from "../src/editor/LayerModel.js";

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

// A deterministic fake clock so the debounce is provable without real timers.
function makeClock() {
  let seq = 1;
  const timers = new Map();
  return {
    setTimer: (fn) => {
      const id = seq++;
      timers.set(id, fn);
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id);
    },
    pendingCount: () => timers.size,
    fire: () => {
      const fns = [...timers.values()];
      timers.clear();
      for (const fn of fns) fn();
    },
  };
}

// --- 1. SnapSettings ----------------------------------------------------------
{
  assert.equal(GRID_SIZE > 0, true, "GRID_SIZE is a positive constant");
  assert.equal(ROT_SNAP_DEG > 0 && SCALE_SNAP > 0, true, "rot/scale snap constants positive");

  // Rounds an off-grid value to the nearest grid multiple.
  assert.equal(snapToGrid(1.2, 0.5), 1.0, "1.2 snaps to 1.0 on a 0.5 grid");
  assert.equal(snapToGrid(1.3, 0.5), 1.5, "1.3 snaps to 1.5 on a 0.5 grid");
  assert.equal(snapToGrid(-0.3, 0.5), -0.5, "negative values snap toward the nearest grid line");
  // Already-on-grid values are unchanged (idempotent).
  assert.equal(snapToGrid(1.0, 0.5), 1.0, "on-grid value unchanged");
  assert.equal(snapToGrid(snapToGrid(2.34, 0.5), 0.5), snapToGrid(2.34, 0.5), "snapToGrid is idempotent");
  // Defensive: non-finite or non-positive grid is a pass-through, never NaN.
  assert.equal(snapToGrid(Number.NaN, 0.5), Number.NaN.valueOf?.() ?? snapToGrid(Number.NaN, 0.5), "NaN passes through");
  assert.equal(Number.isNaN(snapToGrid(Number.NaN, 0.5)), true, "NaN in → NaN out (not 0)");
  assert.equal(snapToGrid(3.7, 0), 3.7, "grid size 0 is a pass-through");
  assert.equal(snapToGrid(3.7, -1), 3.7, "negative grid size is a pass-through");

  const v = snapVec3({ x: 1.2, y: 0.1, z: -0.3 }, 0.5);
  assert.deepEqual(v, { x: 1.0, y: 0.0, z: -0.5 }, "snapVec3 snaps each axis independently");
  ok("SnapSettings: snapToGrid / snapVec3 math");

  // applyTo drives a TransformControls-shaped object: snap values when enabled, null when off.
  const calls = [];
  const fakeTransform = {
    setTranslationSnap: (v2) => calls.push(["t", v2]),
    setRotationSnap: (v2) => calls.push(["r", v2]),
    setScaleSnap: (v2) => calls.push(["s", v2]),
  };
  const snap = new SnapSettings({ enabled: true, gridSize: 0.5, rotDeg: 15, scaleStep: 0.25 });
  snap.applyTo(fakeTransform, (deg) => deg); // identity deg→rad so we can assert the raw angle
  assert.deepEqual(calls, [["t", 0.5], ["r", 15], ["s", 0.25]], "enabled snap pushes grid/rot/scale steps");
  calls.length = 0;
  snap.setEnabled(false).applyTo(fakeTransform, (deg) => deg);
  assert.deepEqual(calls, [["t", null], ["r", null], ["s", null]], "disabled snap clears all three");
  ok("SnapSettings: applyTo wires a TransformControls");

  // snapPlacement only snaps when enabled; otherwise returns the raw point.
  const on = new SnapSettings({ enabled: true, gridSize: 1 });
  assert.deepEqual(on.snapPlacement({ x: 2.4, y: 5, z: -1.6 }), { x: 2, y: 5, z: -2 }, "enabled placement snaps");
  const off = new SnapSettings({ enabled: false, gridSize: 1 });
  assert.deepEqual(off.snapPlacement({ x: 2.4, y: 5, z: -1.6 }), { x: 2.4, y: 5, z: -1.6 }, "disabled placement passes through");
  ok("SnapSettings: snapPlacement gates on enabled");
}

// --- 2. EditorAutosave --------------------------------------------------------
{
  // markDirty schedules; the debounce coalesces a burst into ONE save.
  {
    const clock = makeClock();
    let saves = 0;
    const statuses = [];
    const a = new EditorAutosave({
      save: () => { saves++; },
      onStatus: (s) => statuses.push(s),
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    assert.equal(a.status(), "idle", "starts idle");
    a.markDirty();
    a.markDirty();
    a.markDirty();
    assert.equal(a.status(), "dirty", "burst of edits leaves it dirty");
    assert.equal(clock.pendingCount(), 1, "burst coalesces to a single pending timer");
    assert.equal(saves, 0, "nothing saved until the debounce fires");
    clock.fire();
    assert.equal(saves, 1, "debounce fires exactly one save for the burst");
    assert.equal(a.status(), "saved", "ends in saved");
    assert.deepEqual(statuses, ["dirty", "saving", "saved"], "status transitions are observable");
    ok("EditorAutosave: debounce coalesces a burst into one save");
  }

  // flush() saves immediately and cancels the pending debounce.
  {
    const clock = makeClock();
    let saves = 0;
    const a = new EditorAutosave({ save: () => { saves++; }, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    a.markDirty();
    a.flush();
    assert.equal(saves, 1, "flush saves now");
    assert.equal(clock.pendingCount(), 0, "flush cancels the pending debounce");
    assert.equal(a.status(), "saved", "flush ends saved");
    clock.fire(); // no pending timer → no extra save
    assert.equal(saves, 1, "the cancelled debounce does not double-save");
    ok("EditorAutosave: flush saves immediately and cancels the debounce");
  }

  // A throwing save surfaces as the error status and does not count as a save.
  {
    const clock = makeClock();
    const a = new EditorAutosave({
      save: () => { throw new Error("disk full"); },
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    a.markDirty();
    clock.fire();
    assert.equal(a.status(), "error", "a failed save is reported as error");
    assert.equal(a.saveCount, 0, "a failed save is not counted");
    ok("EditorAutosave: a failing save becomes the error status");
  }

  // reset() cancels pending work and returns to idle (used on world reload).
  {
    const clock = makeClock();
    let saves = 0;
    const a = new EditorAutosave({ save: () => { saves++; }, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    a.markDirty();
    a.reset();
    assert.equal(a.status(), "idle", "reset returns to idle");
    assert.equal(clock.pendingCount(), 0, "reset cancels the pending debounce");
    clock.fire();
    assert.equal(saves, 0, "reset prevents the pending save from firing");
    ok("EditorAutosave: reset cancels pending work and idles");
  }

  assert.equal(typeof AUTOSAVE_DEBOUNCE_MS, "number", "exposes a default debounce constant");
}

// --- 3. LayerModel ------------------------------------------------------------
{
  assert.ok(Array.isArray(EDITOR_LAYERS) && EDITOR_LAYERS.length >= 6, "ships the editor layer set");
  for (const id of ["terrain", "water", "wildlife", "ambient", "arsenal", "objects"]) {
    assert.ok(EDITOR_LAYERS.some((l) => l.id === id), `layer set includes ${id}`);
  }

  // All editable world objects classify into the 'objects' layer (lock target).
  assert.equal(layerOfObject({ userData: { generatorId: null } }), "objects", "hand-placed → objects layer");
  assert.equal(layerOfObject({ userData: { generatorId: "gen-city" } }), "objects", "generated → objects layer");

  // Visibility fires the injected callback (the editor does the THREE toggle).
  {
    const fired = [];
    const m = new LayerModel({ onVisibility: (id, visible) => fired.push([id, visible]) });
    assert.equal(m.isVisible("water"), true, "layers start visible");
    assert.equal(m.setVisible("water", false), true, "setVisible accepts a known layer");
    assert.equal(m.isVisible("water"), false, "water now hidden");
    assert.deepEqual(fired, [["water", false]], "hiding fires onVisibility once");
    m.toggleVisible("water");
    assert.equal(m.isVisible("water"), true, "toggle restores visibility");
    assert.deepEqual(fired[fired.length - 1], ["water", true], "showing fires onVisibility");
    // Setting to the same value does not re-fire.
    const n = fired.length;
    m.setVisible("water", true);
    assert.equal(fired.length, n, "no-op setVisible does not re-fire");
    ok("LayerModel: visibility state + callback");
  }

  // Unknown ids are a safe no-op, never a throw.
  {
    const m = new LayerModel({ onVisibility: () => { throw new Error("should not fire"); } });
    assert.equal(m.setVisible("bogus-layer", false), false, "unknown layer rejected");
    assert.equal(m.setLocked("bogus-layer", true), false, "unknown lock rejected");
    ok("LayerModel: unknown layer id is a no-op");
  }

  // Lock is pure editor state; the predicate gates the selection raycast.
  {
    const m = new LayerModel();
    const obj = { userData: { generatorId: null } };
    assert.equal(m.isObjectInLockedLayer(obj), false, "nothing locked initially");
    m.setLocked("objects", true);
    assert.equal(m.isLocked("objects"), true, "objects layer locked");
    assert.equal(m.isObjectInLockedLayer(obj), true, "a world object is in the locked layer");
    assert.equal(m.isObjectInLockedLayer({ userData: { generatorId: "gen" } }), true, "generated objects too");
    m.toggleLocked("objects");
    assert.equal(m.isObjectInLockedLayer(obj), false, "unlocking re-enables selection");
    ok("LayerModel: lock predicate gates selection");
  }

  // reset() restores all visibility (firing callbacks) and clears locks — used on world reload.
  {
    const fired = [];
    const m = new LayerModel({ onVisibility: (id, visible) => fired.push([id, visible]) });
    m.setVisible("terrain", false);
    m.setVisible("arsenal", false);
    m.setLocked("objects", true);
    fired.length = 0;
    m.reset();
    assert.equal(m.isVisible("terrain"), true, "reset shows terrain");
    assert.equal(m.isVisible("arsenal"), true, "reset shows arsenal");
    assert.equal(m.isLocked("objects"), false, "reset clears locks");
    // Both hidden layers are restored (callback fires so the THREE roots re-show).
    assert.ok(fired.some((f) => f[0] === "terrain" && f[1] === true), "reset re-shows terrain via callback");
    assert.ok(fired.some((f) => f[0] === "arsenal" && f[1] === true), "reset re-shows arsenal via callback");
    ok("LayerModel: reset restores visibility + clears locks");
  }

  // layers() snapshots the current state for the panel UI.
  {
    const m = new LayerModel();
    m.setVisible("water", false);
    m.setLocked("objects", true);
    const rows = m.layers();
    const water = rows.find((r) => r.id === "water");
    const objects = rows.find((r) => r.id === "objects");
    assert.equal(water.visible, false, "snapshot reflects hidden water");
    assert.equal(objects.locked, true, "snapshot reflects locked objects");
    assert.equal(objects.lockable, true, "objects layer is lockable");
    assert.equal(water.lockable, false, "system layers are not lockable (no selectable content)");
    ok("LayerModel: layers() snapshot for the panel");
  }
}

console.log(`\neditor-ux1 unit regression: ${passed} checks passed`);
