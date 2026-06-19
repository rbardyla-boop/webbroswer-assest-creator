// test:editor-ux1 — Editor UX-1 authoring surface in a real (SwiftShader) WebGL session.
//
// Drives the editor end to end through window.__WORLD_EDITOR__ and proves the whole
// authoring loop a non-coder needs:
//   - place objects → the Hierarchy lists them with names; selecting a row drives the
//     viewport selection (two-way),
//   - grid snap wires the gizmo AND lands new placements / nudges on the grid,
//   - layers hide a category (objects → manager root) and lock makes objects un-pickable,
//   - autosave goes dirty on an edit and a flush persists to localStorage,
//   - the world survives a full reload (autosave persistence),
//   - Play and Back-to-Editor buttons round-trip between the two modes.
// Zero console errors. Skips cleanly without Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { evalValue, openPage, sleep, withBrowserProof } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5241;
const CDP_PORT = 9375;
const BASE = `http://127.0.0.1:${PORT}`;
const STORAGE_KEY = "grass-world-builder-save";

// A readiness wait that tolerates an in-tab navigation (the execution context is
// briefly destroyed while the next page boots).
async function waitReady(cdp, mode, timeout = 75000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const ok = await evalValue(cdp, `window.__WORLD_READY__ === true && window.__WORLD_MODE__ === "${mode}"`);
      if (ok) return;
    } catch {
      /* context swapped mid-navigation — retry */
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${mode} readiness`);
}

const onGrid = (v, g = 0.5) => Math.abs(v / g - Math.round(v / g)) < 1e-6;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "editor-ux1-profile") },
  async () => {
    const page = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitReady(page.cdp, "editor", 60000);

      // Start from a clean empty world so counts are unambiguous.
      await evalValue(page.cdp, `localStorage.removeItem("${STORAGE_KEY}"); window.__WORLD_EDITOR__.open(); true`);

      // --- author two objects → the Hierarchy lists them -----------------------
      const placed = await evalValue(page.cdp, `(async () => {
        const e = window.__WORLD_EDITOR__;
        const a = await e.placeSelectedAssetAt(4.2, -3.1);
        const b = await e.placeSelectedAssetAt(-2.0, 6.0);
        const h = e.getHierarchy();
        return { a, b, objectCount: h.objects.length, names: h.objects.map((o) => o.name), status: e.autosaveStatus() };
      })()`);
      assert.equal(placed.objectCount, 2, "Hierarchy lists the two placed objects");
      assert.ok(placed.names.every((n) => typeof n === "string" && n.length), "every object row has a stable name");
      assert.equal(placed.status, "dirty", "an edit marks autosave dirty");

      // --- Hierarchy → viewport selection is two-way ---------------------------
      const selected = await evalValue(page.cdp, `(() => {
        const e = window.__WORLD_EDITOR__;
        e.selectFromHierarchy(${JSON.stringify(placed.a)});
        return { selectedIds: e.getHierarchy().selectedIds, primary: e.selection.primary?.userData.objectId ?? null };
      })()`);
      assert.deepEqual(selected.selectedIds, [placed.a], "selecting a hierarchy row selects exactly that object");
      assert.equal(selected.primary, placed.a, "the viewport selection primary matches the row");

      // --- grid snap: wires the gizmo, snaps a nudge AND a new placement --------
      const snap = await evalValue(page.cdp, `(async () => {
        const e = window.__WORLD_EDITOR__;
        e.setSnapEnabled(true);
        const gizmoSnap = e.transform.translationSnap;
        e.selectFromHierarchy(${JSON.stringify(placed.a)});
        const nudged = e.nudgeSelected(0.13, 0, 0.13); // off-grid delta → must land on grid
        const c = await e.placeSelectedAssetAt(3.27, 1.61); // off-grid placement → must snap
        const obj = e.manager.objects.get(c);
        return { gizmoSnap, nudged, placedPos: obj.position.toArray(), count: e.getHierarchy().objects.length };
      })()`);
      assert.equal(snap.gizmoSnap, 0.5, "enabling snap sets the gizmo translation snap to the grid size");
      assert.ok(onGrid(snap.nudged[0]) && onGrid(snap.nudged[2]), `nudged object lands on grid (${snap.nudged})`);
      assert.ok(onGrid(snap.placedPos[0]) && onGrid(snap.placedPos[2]), `snapped placement lands on grid (${snap.placedPos})`);
      assert.equal(snap.count, 3, "the snapped placement added a third object");

      // --- layers: hide objects (manager root) + a system layer (terrain) -------
      const layers = await evalValue(page.cdp, `(() => {
        const e = window.__WORLD_EDITOR__;
        const objHidden = e.toggleLayerVisible("objects");      // → false
        const rootVisible = e.manager.root.visible;
        const terrHidden = e.toggleLayerVisible("terrain");     // → false
        const terrainVisible = e.terrain.mesh.visible;
        e.toggleLayerVisible("objects"); e.toggleLayerVisible("terrain"); // restore
        return { objHidden, rootVisible, terrHidden, terrainVisible, rootRestored: e.manager.root.visible };
      })()`);
      assert.equal(layers.objHidden, false, "toggling the objects layer reports it hidden");
      assert.equal(layers.rootVisible, false, "hiding the objects layer hides the manager root (no per-object .visible change → no persistence leak)");
      assert.equal(layers.terrainVisible, false, "hiding the terrain layer hides the terrain mesh");
      assert.equal(layers.rootRestored, true, "re-showing the layer restores the root");

      // --- lock: locked objects are not pickable by the selection raycast -------
      const lock = await evalValue(page.cdp, `(() => {
        const e = window.__WORLD_EDITOR__;
        const before = e.pickableObjectCount();
        e.setLayerLocked("objects", true);
        const locked = e.pickableObjectCount();
        e.setLayerLocked("objects", false);
        return { total: e.manager.objects.size, before, locked, unlocked: e.pickableObjectCount() };
      })()`);
      assert.equal(lock.before, lock.total, "all objects are pickable when unlocked");
      assert.equal(lock.locked, 0, "locking the objects layer makes them un-pickable");
      assert.equal(lock.unlocked, lock.total, "unlocking restores pickability");

      // --- autosave: flush persists the 3-object world to localStorage ----------
      const saved = await evalValue(page.cdp, `(() => {
        const e = window.__WORLD_EDITOR__;
        e.flushAutosave();
        const raw = localStorage.getItem("${STORAGE_KEY}");
        const doc = raw ? JSON.parse(raw) : null;
        return { status: e.autosaveStatus(), objectCount: doc?.objects?.length ?? -1,
                 allChildVisible: [...e.manager.objects.values()].every((o) => o.visible) };
      })()`);
      assert.equal(saved.status, "saved", "flush ends in the saved status");
      assert.equal(saved.objectCount, 3, "autosave wrote all three objects to localStorage");
      assert.equal(saved.allChildVisible, true, "no child object was left .visible=false by a layer toggle (persistence-safe)");

      // --- persistence: a full reload restores the authored world ---------------
      await evalValue(page.cdp, `location.reload()`);
      await waitReady(page.cdp, "editor", 60000);
      const reloaded = await evalValue(page.cdp, `(() => {
        const e = window.__WORLD_EDITOR__;
        e.open();
        return { objectCount: e.getHierarchy().objects.length };
      })()`);
      assert.equal(reloaded.objectCount, 3, "the authored world survives a full reload (autosave persistence)");

      // --- play round-trip: Play button → runtime, Back-to-Editor → editor ------
      const playBtn = await evalValue(page.cdp, `(() => {
        const p = document.getElementById("enter-play");
        return { present: !!p, primary: p?.classList.contains("btn-primary") ?? false };
      })()`);
      assert.equal(playBtn.present && playBtn.primary, true, "editor shows a primary Play button");
      await evalValue(page.cdp, `document.getElementById("enter-play").click(); true`);
      await waitReady(page.cdp, "runtime", 75000);
      const inPlay = await evalValue(page.cdp, `(() => {
        const ex = document.getElementById("exit-play");
        return { mode: window.__WORLD_MODE__, search: location.search,
                 exitVisible: ex ? getComputedStyle(ex).display !== "none" : false };
      })()`);
      assert.equal(inPlay.mode, "runtime", "the Play button entered runtime/play mode");
      assert.match(inPlay.search, /play/, "Play navigated to ?play=1");
      assert.equal(inPlay.exitVisible, true, "play mode shows the Back-to-Editor button");

      await evalValue(page.cdp, `document.getElementById("exit-play").click(); true`);
      await waitReady(page.cdp, "editor", 60000);
      const back = await evalValue(page.cdp, `({ mode: window.__WORLD_MODE__ })`);
      assert.equal(back.mode, "editor", "Back-to-Editor returned to the editor");

      if (page.consoleErrors.length) throw new Error(`console errors:\n${page.consoleErrors.join("\n")}`);
      console.log(`  objects: ${reloaded.objectCount}; snap gizmo: ${snap.gizmoSnap}; round-trip: editor↔play OK`);
    } finally {
      await page.close();
    }
  }
);

if (run.skipped) console.log("browser editor-ux1 proof skipped (no browser)");
else console.log("browser editor-ux1 proof passed");
