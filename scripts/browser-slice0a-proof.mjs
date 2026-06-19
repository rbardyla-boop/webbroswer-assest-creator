// test:slice0a — Slice-0A human-UX hardening + instrumentation, in a real (SwiftShader) WebGL play
// session. This does NOT claim to prove human comprehension (a fresh human walk is the open gate it
// HANDS OFF to); it proves the instrumentation a tester relies on actually works:
//   - the arrival controls hint teaches movement and DISMISSES on the player's first movement,
//   - the friction trace records the journey (load → beats → actions → completion),
//   - the "follow the beacon" stuck nudge + a `stuck` trace event fire after a long dwell, and
//   - the slice still completes end to end with the trace capturing it; zero console errors.
// Skips cleanly without Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { evalValue, openPage, sleep, waitForReady, withBrowserProof } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5240;
const CDP_PORT = 9374;
const BASE = `http://127.0.0.1:${PORT}`;

const AUTHOR_WORLD = `(async () => {
  const { createWorldDocument } = await import('/src/world/WorldDocument.js');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
  localStorage.clear();
  new WorldSerializer().save(createWorldDocument({ metadata: { name: 'Slice-0A Instrumentation Proof' } }));
  return true;
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "slice0a-profile") },
  async () => {
    const editor = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(editor.cdp, "editor", 45000);
      assert.equal(await evalValue(editor.cdp, AUTHOR_WORLD), true);
    } finally {
      await editor.close();
    }

    const rt = await openPage(CDP_PORT, `${BASE}/?play=1`);
    try {
      await waitForReady(rt.cdp, "runtime", 75000);
      await sleep(500);

      // --- arrival: the controls hint teaches movement first ---------------------------------
      const arrival = await evalValue(rt.cdp, `window.__FROZEN_CACHE_DEBUG__()`);
      assert.equal(arrival.present, true, "slice present in play mode");
      assert.equal(arrival.controlsHintVisible, true, "arrival controls hint visible (teaches movement first)");
      assert.equal(arrival.controlsHintDismissed, false, "controls hint not yet dismissed");
      assert.ok(arrival.trace && arrival.trace.total > 0, "friction trace is recording");

      // --- the full editor controls bar must NOT leak into play mode (one clean controls teacher) --
      const hint = await evalValue(rt.cdp, `(() => {
        const el = document.getElementById('hint');
        return { playModeClass: document.body.classList.contains('play-mode'),
                 hintDisplay: el ? getComputedStyle(el).display : 'missing' };
      })()`);
      assert.equal(hint.playModeClass, true, "body marked play-mode");
      assert.equal(hint.hintDisplay, "none", "editor #hint is hidden in play mode (no leak)");

      // --- the hint DISMISSES on the player's first movement, logging firstMove ----------------
      const afterMove = await evalValue(rt.cdp, `(() => {
        window.__FROZEN_CACHE_DO__.nudgePlayer(1.5, 0);
        return { dbg: window.__FROZEN_CACHE_DEBUG__(), trace: window.__SLICE_TRACE__() };
      })()`);
      assert.equal(afterMove.dbg.controlsHintDismissed, true, "controls hint dismissed once the player moves");
      assert.equal(afterMove.dbg.controlsHintVisible, false, "dismissed hint is no longer shown");
      assert.ok(afterMove.dbg.firstMoveAt != null, "first-movement time captured for the tester");
      assert.ok(afterMove.trace.entries.some((e) => e.type === "firstMove"), "trace logs firstMove");

      // --- stuck nudge: carry the field weapon, then dwell far from the relic ------------------
      const stuck = await evalValue(rt.cdp, `(() => {
        const A = window.__FROZEN_CACHE_DO__;
        A.teleportTo(A.tutorialWeaponId());
        A.pickUp();          // learns F
        A.holster();         // learns H — now carrying, no contextual prompt, en route to the relic
        A.advance(26);       // long unproductive dwell in the navigation beat
        return { dbg: window.__FROZEN_CACHE_DEBUG__(), trace: window.__SLICE_TRACE__() };
      })()`);
      assert.equal(stuck.dbg.nudgeActive, true, `stuck nudge active after a long dwell (beat=${stuck.dbg.beat})`);
      assert.match(stuck.dbg.nudge?.text ?? "", /Follow the beacon/, "nudge points the player at the beacon");
      assert.ok(stuck.dbg.trace.stuckCount >= 1, "trace records the stuck signal for the tester");
      assert.ok(stuck.trace.entries.some((e) => e.type === "stuck"), "a stuck event is in the log");

      // --- the slice still completes end to end, and the trace captures the journey ------------
      const done = await evalValue(rt.cdp, `(() => {
        const A = window.__FROZEN_CACHE_DO__;
        A.teleportTo(A.relicId());
        A.pickUp();          // pick up the relic (now carrying two)
        A.cycle();
        A.teleportToCache();
        A.deposit();
        return { dbg: window.__FROZEN_CACHE_DEBUG__(), trace: window.__SLICE_TRACE__() };
      })()`);
      assert.equal(done.dbg.completed, true, "slice completes");
      assert.equal(done.dbg.completionCardVisible, true, "completion card shows");
      assert.equal(done.dbg.trace.completed, true, "trace records completion");
      const types = new Set(done.trace.entries.map((e) => e.type));
      for (const t of ["load", "beat", "action", "stuck", "complete"]) {
        assert.ok(types.has(t), `trace captured a '${t}' event (the tester's session record)`);
      }
      const actions = done.trace.entries.filter((e) => e.type === "action").map((e) => e.detail);
      assert.ok(actions.includes("F") && actions.includes("G"), "trace logs the essential F (pick up) and G (deposit) actions");

      // --- replay must be the OBVIOUS action on the completion card (a fresh tester wanted to replay)
      const card = await evalValue(rt.cdp, `(() => {
        const c = document.querySelector('.completion-card.visible');
        if (!c) return { visible: false };
        const primary = c.querySelector('.completion-actions button.primary');
        const secondary = c.querySelector('.completion-actions button.secondary');
        return { visible: true, primaryText: primary?.textContent ?? null,
                 primaryAction: primary?.dataset.action ?? null, secondaryAction: secondary?.dataset.action ?? null,
                 hasHint: !!c.querySelector('.completion-hint') };
      })()`);
      assert.equal(card.visible, true, "completion card visible");
      assert.equal(card.primaryAction, "restart", "the PRIMARY action restarts/replays the slice");
      assert.match(card.primaryText ?? "", /Play Again/, "primary button reads 'Play Again'");
      assert.equal(card.secondaryAction, "explore", "Keep Exploring is the secondary action");
      assert.equal(card.hasHint, true, "the card explains what each choice does");

      if (rt.consoleErrors.length) throw new Error(`console errors:\n${rt.consoleErrors.join("\n")}`);
      console.log(`  trace events: ${done.trace.entries.length}; actions: ${actions.join(",")}; stuck: ${done.dbg.trace.stuckCount}`);
    } finally {
      await rt.close();
    }
  }
);

if (run.skipped) console.log("browser slice0a proof skipped (no browser)");
else console.log("browser slice0a proof passed");
