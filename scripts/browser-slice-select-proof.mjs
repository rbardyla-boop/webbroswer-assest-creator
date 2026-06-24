// test:slice-select-proof — Slice Select-1: the Playable Slice Catalog drives a real player loop in a live
// (SwiftShader) browser. From the catalog page a player chooses a slice, plays it, returns to the catalog, and
// launches another — with completion/reward state ISOLATED per slice (no cross-contamination) and the global
// editor save left untouched.
//
// The run, in one browser profile (localStorage persists across navigations):
//   open /catalog.html → THREE slice cards render (titles + play hrefs) →
//   launch The Relic Overlook (?play=1&world=visual-benchmark-1) → its OWN identity resolves, fresh (not done) →
//   return to the catalog → launch The Ice Chapel → its identity, fresh →
//   return → launch The Frost Causeway → its identity → smoke-drive to completion (equip relic → cache → deposit)
//     → completed + completion card + the "⌂ Slice Catalog" return action present →
//   relaunch The Ice Chapel → completed === false (NOT contaminated by the Causeway's completion) →
//   relaunch The Frost Causeway → completed === true (its OWN completion persisted per slice) →
//   the global save key was never written (catalog play uses per-slice slots) → 0 console errors throughout.
// Skips without Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5272;
const CDP_PORT = 9407;
const BASE = `http://127.0.0.1:${PORT}`;
const SETTLE_MS = 1400;
const GLOBAL_KEY = "grass-world-builder-save";

const RELIC_OVERLOOK = { id: "visual-benchmark-1", title: "The Relic Overlook" };
const ICE_CHAPEL = { id: "ice-chapel-1", title: "The Ice Chapel" };
const FROST_CAUSEWAY = { id: "frost-causeway-1", title: "The Frost Causeway" };

const playUrl = (id) => `${BASE}/?play=1&world=${id}`;

async function waitForCatalog(cdp, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ready = await evalValue(cdp, `typeof window.__SLICE_CATALOG__ === "function" && window.__SLICE_CATALOG__().count >= 1`);
    if (ready) return;
    await sleep(200);
  }
  throw new Error("timed out waiting for the catalog to render");
}

// --- the catalog page renders the three cards (and optionally clears storage for a clean slate) --------------
async function openCatalog({ clear = false } = {}) {
  const page = await openPage(CDP_PORT, `${BASE}/catalog.html`);
  try {
    await waitForCatalog(page.cdp);
    if (clear) await evalValue(page.cdp, `localStorage.clear(); true`);
    const cat = await evalValue(page.cdp, `window.__SLICE_CATALOG__()`);
    assert.equal(cat.count, 3, `catalog renders three cards (got ${cat.count})`);
    const byId = Object.fromEntries(cat.cards.map((c) => [c.id, c]));
    for (const slice of [RELIC_OVERLOOK, ICE_CHAPEL, FROST_CAUSEWAY]) {
      assert.ok(byId[slice.id], `catalog has a card for ${slice.id}`);
      assert.equal(byId[slice.id].title, slice.title, `${slice.id} card titled "${slice.title}"`);
      assert.ok(byId[slice.id].href.includes(`world=${slice.id}`), `${slice.id} card launches its play URL`);
    }
    assert.deepEqual(page.consoleErrors, [], `catalog: 0 console errors\n${page.consoleErrors.join("\n")}`);
  } finally {
    await page.close();
  }
}

// --- launch a slice and read its live identity + completion ---------------------------------------------------
async function launchSlice(slice, assertFresh) {
  const page = await openPage(CDP_PORT, playUrl(slice.id));
  try {
    await waitForReady(page.cdp, "runtime", 75000);
    await sleep(SETTLE_MS);
    const d = await evalValue(page.cdp, `(() => { const s = window.__FROZEN_CACHE_DEBUG__(); return { title: s.identity.title, completed: s.completed }; })()`);
    assert.equal(d.title, slice.title, `${slice.id}: the catalog launched the right slice ("${d.title}")`);
    if (assertFresh) assert.equal(d.completed, false, `${slice.id}: launched fresh (not pre-completed)`);
    assert.deepEqual(page.consoleErrors, [], `${slice.id} play: 0 console errors\n${page.consoleErrors.join("\n")}`);
    return { page, completed: d.completed };
  } catch (err) {
    await page.close();
    throw err;
  }
}

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "slice-select-profile") },
  async () => {
    // 1. Open the catalog (clean slate) — three cards render.
    await openCatalog({ clear: true });
    console.log("  catalog: three slice cards render");

    // 2. Launch each slice from the catalog; each resolves its OWN identity, fresh; return to the catalog between.
    for (const slice of [RELIC_OVERLOOK, ICE_CHAPEL]) {
      const { page } = await launchSlice(slice, true);
      await page.close();
      console.log(`  launched ${slice.id} → identity "${slice.title}", fresh`);
      await openCatalog();
    }

    // 3. Launch The Frost Causeway and smoke-drive it to completion (equip the relic → cache → deposit).
    {
      const { page } = await launchSlice(FROST_CAUSEWAY, true);
      try {
        const r = await evalValue(page.cdp, `(() => {
          const O = window.__OBJECTIVE_DO__, FC = window.__FROZEN_CACHE_DO__;
          O.equipRelic('back');
          O.teleportToCache();
          const before = window.__OBJECTIVE_DEBUG__().completed;
          const deposited = FC.deposit();
          const s = window.__FROZEN_CACHE_DEBUG__();
          return { before, deposited, completed: s.completed, cardVisible: s.completionCardVisible, catalogBtn: !!document.querySelector('[data-action="catalog"]') };
        })()`);
        assert.equal(r.before, false, "frost-causeway: incomplete before deposit (non-vacuous)");
        assert.equal(r.completed, true, "frost-causeway: depositing the relic completes the run");
        assert.equal(r.cardVisible, true, "frost-causeway: the completion card shows");
        assert.equal(r.catalogBtn, true, 'frost-causeway: the completion card offers a "⌂ Slice Catalog" return action');
        assert.deepEqual(page.consoleErrors, [], `frost-causeway complete: 0 console errors\n${page.consoleErrors.join("\n")}`);
      } finally {
        await page.close();
      }
      console.log("  frost-causeway: completed + completion card + catalog return action");
      await openCatalog();
    }

    // 4. No cross-slice contamination: The Ice Chapel relaunches FRESH (not showing the Causeway's completion).
    {
      const { page, completed } = await launchSlice(ICE_CHAPEL, false);
      assert.equal(completed, false, "ice-chapel: relaunched NOT completed (no cross-slice contamination from the Causeway)");
      await page.close();
      console.log("  ice-chapel relaunch: completed === false (isolated — not contaminated)");
    }

    // 5. Per-slice persistence: The Frost Causeway relaunches COMPLETED (its own completion persisted) — and the
    //    global editor save key was NEVER written by catalog play (per-slice slots only).
    {
      const page = await openPage(CDP_PORT, playUrl(FROST_CAUSEWAY.id));
      try {
        await waitForReady(page.cdp, "runtime", 75000);
        await sleep(SETTLE_MS);
        const r = await evalValue(page.cdp, `(() => {
          const s = window.__FROZEN_CACHE_DEBUG__();
          return {
            title: s.identity.title,
            completed: s.completed,
            globalKey: localStorage.getItem(${JSON.stringify(GLOBAL_KEY)}),
            sliceKey: localStorage.getItem(${JSON.stringify(GLOBAL_KEY + ":slice:" + FROST_CAUSEWAY.id)}),
          };
        })()`);
        assert.equal(r.title, FROST_CAUSEWAY.title, "frost-causeway relaunch: same slice");
        assert.equal(r.completed, true, "frost-causeway relaunch: its OWN completion persisted per slice");
        assert.equal(r.globalKey, null, "the global editor save key was never written by catalog play (isolated)");
        assert.ok(typeof r.sliceKey === "string" && r.sliceKey.length > 0, "the Causeway's completion lives in its own per-slice slot");
        assert.deepEqual(page.consoleErrors, [], `frost-causeway relaunch: 0 console errors\n${page.consoleErrors.join("\n")}`);
      } finally {
        await page.close();
      }
      console.log("  frost-causeway relaunch: completed === true (persisted) · global key untouched");
    }

    console.log("\n  Slice Select-1: catalog → choose → play → complete → return → choose another; per-slice isolated; 0 console errors");
  }
);

if (run.skipped) console.log("browser slice-select proof skipped (no browser)");
else console.log("browser slice-select proof passed");
