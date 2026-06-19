// test:arsenal-v6 — multiple carried weapons + holster/draw in a real (SwiftShader) WebGL runtime.
// Places two generated weapons and carries BOTH at once on different slots (each parented to the
// Player, oriented), proves rightHand is the only active/drawn slot, exercises draw (swap), holster
// then re-draw, and cycle — all as slot movement that never orphans a weapon — then persist-equips
// both and proves the full multi-carry state survives a page reload. Player + wildlife + ambient stay
// unaffected; zero console errors. Skips cleanly without Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5230;
const CDP_PORT = 9364;
const BASE = `http://127.0.0.1:${PORT}`;

const AUTHOR_WORLD = `(async () => {
  const { createWorldDocument } = await import('/src/world/WorldDocument.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  localStorage.removeItem('arsenal-export-queue');
  new WorldSerializer().save(createWorldDocument({ metadata: { name: 'Arsenal v6 Proof' } }));
  return true;
})()`;

// One action sequence in the runtime page: place two weapons → carry both (rightHand + back) →
// draw the back one (swap) → holster → re-draw → cycle → persist-equip both + save.
const SEQUENCE = `(() => {
  const C = window.__ARSENAL_CARRY_DO__;
  if (!C) return { missing: true };
  C.setPersist(true);
  const id1 = C.place({ x: 6, z: 6 });
  const id2 = C.place({ x: -5, z: 7 });
  C.equip(id1, 'rightHand');
  C.equip(id2, 'back');           // A NOT dropped — both carried
  const carried = C.snapshot();
  C.drawSlot('back');             // draw id2 to hand; id1 swaps into back
  const drawn = C.snapshot();
  C.holsterOrDraw();              // holster the drawn weapon to a free slot (hand empties)
  const holstered = C.snapshot();
  C.holsterOrDraw();              // hand empty → draw the first holstered weapon back
  const redrawn = C.snapshot();
  C.cycle();                      // rotate occupants
  const cycled = C.snapshot();
  C.save();
  const wildlife = window.__WILDLIFE_DEBUG__ ? window.__WILDLIFE_DEBUG__().present : false;
  const ambient = window.__AMBIENT_DEBUG__ ? window.__AMBIENT_DEBUG__().present : false;
  const v0 = window.__VISUAL0_DEBUG__ ? window.__VISUAL0_DEBUG__() : null;
  return { id1, id2, carried, drawn, holstered, redrawn, cycled, wildlife, ambient, v0 };
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "arsenal-v6-profile") },
  async () => {
    const editor = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(editor.cdp, "editor", 45000);
      assert.equal(await evalValue(editor.cdp, AUTHOR_WORLD), true);
    } finally {
      await editor.close();
    }

    // --- session 1: carry two weapons, exercise the verbs, persist + save --------------------
    let id1 = null;
    let id2 = null;
    const rt = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(rt.cdp, "runtime", 75000);
      await sleep(1000);
      const r = await evalValue(rt.cdp, SEQUENCE);
      assert.ok(r && !r.missing, "arsenal v6 carry DEV hooks present");
      assert.ok(r.id1 && r.id2, "placed two weapons");
      id1 = r.id1;
      id2 = r.id2;

      // both weapons carried at once, on distinct slots, each parented to the player
      assert.equal(r.carried.carriedCount, 2, "two weapons carried simultaneously");
      assert.equal(r.carried.activeId, r.id1, "rightHand weapon is the active/drawn one");
      assert.equal(r.carried.bySlot.rightHand, r.id1, "id1 on rightHand");
      assert.equal(r.carried.bySlot.back, r.id2, "id2 on back");
      assert.equal(r.carried.equippedParentsBySlot.rightHand, true, "rightHand weapon on the player");
      assert.equal(r.carried.equippedParentsBySlot.back, true, "back weapon on the player");

      // draw the back weapon: it becomes active, the old hand weapon swaps to back (still carried)
      assert.equal(r.drawn.activeId, r.id2, "drawn the back weapon to hand");
      assert.equal(r.drawn.bySlot.back, r.id1, "previous hand weapon swapped into back");
      assert.equal(r.drawn.carriedCount, 2, "swap kept both carried — nothing orphaned");

      // holster: hand empties, weapon stays attached + visible on a holster slot
      assert.equal(r.holstered.activeId, null, "nothing drawn after holstering");
      assert.equal(r.holstered.carriedCount, 2, "holstered weapon still carried");

      // re-draw from holster
      assert.ok(r.redrawn.activeId, "a weapon drawn back into the hand");
      assert.equal(r.redrawn.carriedCount, 2, "still two carried after re-draw");

      // cycle keeps both carried, each on the player
      assert.equal(r.cycled.carriedCount, 2, "two carried after cycle");
      for (const slot of r.cycled.occupiedSlots) {
        assert.equal(r.cycled.equippedParentsBySlot[slot], true, `cycled ${slot} weapon on the player`);
      }

      // the world stayed alive and the player unaffected
      assert.equal(r.wildlife, true, "wildlife still present");
      assert.equal(r.ambient, true, "ambient still present");
      assert.ok(r.v0 && r.v0.groundDelta <= 2.0, `player unaffected (groundDelta ${r.v0?.groundDelta?.toFixed?.(3)})`);

      if (rt.consoleErrors.length) throw new Error(`console errors (session 1):\n${rt.consoleErrors.join("\n")}`);
    } finally {
      await rt.close();
    }

    // --- session 2: reload — BOTH carried weapons re-attach to their persisted slots ----------
    const rt2 = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(rt2.cdp, "runtime", 75000);
      await sleep(1000);
      const e = await evalValue(rt2.cdp, `window.__ARSENAL_CARRY_DO__.snapshot()`);
      assert.equal(e.carriedCount, 2, "both carried weapons survive a full reload");
      assert.notEqual(e.bySlot.rightHand && e.bySlot.back && e.bySlot.hip ? "all" : null, "all", "not all three occupied (only two were carried)");
      // both originally-carried ids are present on the player
      const slots = ["rightHand", "back", "hip"];
      const carriedIds = slots.map((s) => e.bySlot[s]).filter(Boolean);
      assert.ok(carriedIds.includes(id1) && carriedIds.includes(id2), "both id1 and id2 re-attached after reload");
      for (const slot of e.occupiedSlots) {
        assert.equal(e.equippedParentsBySlot[slot], true, `reloaded ${slot} weapon on the player`);
      }
      if (rt2.consoleErrors.length) throw new Error(`console errors (session 2):\n${rt2.consoleErrors.join("\n")}`);
    } finally {
      await rt2.close();
    }
  }
);

if (run.skipped) console.log("browser arsenal-v6 proof skipped (no browser)");
else console.log("browser arsenal-v6 proof passed");
