// Stage 11 browser proof: editor undo/redo works end to end through the real
// keyboard wiring. Loads the editor, populates a world, then deletes an object
// and drives Ctrl+Z / Ctrl+Shift+Z via dispatched KeyboardEvents — proving the
// keydown handler, command stack, and manager attach/detach all connect.
//
// Uses the shared harness (direct vite spawn + SwiftShader WebGL + guaranteed
// teardown — no orphaned dev server). Skips cleanly when no Chromium is present.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5202;
const CDP_PORT = 9336;
const BASE = `http://127.0.0.1:${PORT}`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "undo-profile") },
  async () => {
    const page = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(page.cdp, "editor");

      // Open the editor and load the sample world so there are objects to edit.
      const loaded = await evalValue(page.cdp, `(async () => {
        const editor = window.__WORLD_EDITOR__;
        if (!editor) throw new Error("editor debug hook missing");
        editor.open();
        await editor._loadSample();
        return editor.manager.objects.size;
      })()`);
      assert.ok(loaded >= 2, `expected a populated sample world, got ${loaded} objects`);

      // Select the first object and record the baseline.
      const before = await evalValue(page.cdp, `(() => {
        const editor = window.__WORLD_EDITOR__;
        const first = [...editor.manager.objects.values()][0];
        editor._select(first);
        window.__UNDO_PROOF__ = { id: first.userData.objectId, before: editor.manager.objects.size };
        return window.__UNDO_PROOF__.before;
      })()`);

      // Delete via the real keyboard handler.
      const afterDelete = await evalValue(page.cdp, `(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "Delete", bubbles: true }));
        const editor = window.__WORLD_EDITOR__;
        const id = window.__UNDO_PROOF__.id;
        return { size: editor.manager.objects.size, present: editor.manager.objects.has(id), canUndo: editor.history.canUndo };
      })()`);
      assert.equal(afterDelete.size, before - 1, "Delete key should remove the selected object");
      assert.equal(afterDelete.present, false, "deleted object should be gone");
      assert.equal(afterDelete.canUndo, true, "history should have an undoable delete");

      // Ctrl+Z restores the exact same object id.
      const afterUndo = await evalValue(page.cdp, `(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyZ", ctrlKey: true, bubbles: true }));
        const editor = window.__WORLD_EDITOR__;
        const id = window.__UNDO_PROOF__.id;
        return { size: editor.manager.objects.size, present: editor.manager.objects.has(id), canRedo: editor.history.canRedo };
      })()`);
      assert.equal(afterUndo.size, before, "Ctrl+Z should restore the deleted object");
      assert.equal(afterUndo.present, true, "the same object id should be back after undo");
      assert.equal(afterUndo.canRedo, true, "history should have a redoable delete");

      // Ctrl+Shift+Z removes it again.
      const afterRedo = await evalValue(page.cdp, `(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyZ", ctrlKey: true, shiftKey: true, bubbles: true }));
        const editor = window.__WORLD_EDITOR__;
        const id = window.__UNDO_PROOF__.id;
        return { size: editor.manager.objects.size, present: editor.manager.objects.has(id) };
      })()`);
      assert.equal(afterRedo.size, before - 1, "Ctrl+Shift+Z should re-remove the object");
      assert.equal(afterRedo.present, false, "redo should detach the object again");

      if (page.consoleErrors.length) {
        throw new Error(`console errors during undo proof:\n${page.consoleErrors.join("\n")}`);
      }
    } finally {
      await page.close();
    }
  }
);

if (run.skipped) console.log("browser undo proof skipped (no browser)");
else console.log("browser undo proof passed");
