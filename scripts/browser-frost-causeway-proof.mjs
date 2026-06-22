// test:slice-2-proof — Slice-2 "The Frost Causeway" runs + completes + is reload-stable in a real (SwiftShader)
// WebGL runtime, driven by the UNCHANGED shared slice-proof helper from Slice Authoring Kit-1. The causeway is a
// NEW descriptor combination the helper has not driven before — 3 beats AND no GLB (the chapel = 2 beats/no GLB;
// the benchmark = 3 beats + GLB) — so a clean pass proves the helper generalizes with NO per-slice branching
// (the explicit "did shared proof require branching?" measurement → NO; this file only supplies a descriptor).
//
// From that one descriptor: load ?world=frost-causeway-1 → the live wrapper resolves THIS slice's identity (not
// "The Frozen Cache") → the orientation sign reads → all THREE beats are defeated by ONE equipped weapon (incl.
// the STATIONARY cache sentinel, via the helper's encounter-centre fallback) → a threat fires + is recoverable →
// depositing the relic completes with the causeway's OWN completion card → reload preserves completion +
// identity + trophy + every beat-clear + the reward; perf within the contract; 0 console errors. The prior slice
// proofs are untouched (non-invasive); the frozen slices' default identity is guarded by the Node regression +
// the frozen-cache/first-playable/slice0a sweep. Skips without Chromium.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";
import { sliceDescriptor, seedSliceExpr, driveSlicePlay, driveSliceReplay } from "./lib/slice-proof.mjs";
import { assertWithinBudget, extractMetrics } from "../src/perf/PerformanceContract.js";

const ROOT = process.cwd();
const PORT = 5270;
const CDP_PORT = 9405;
const BASE = `http://127.0.0.1:${PORT}`;
const SETTLE_MS = 1400;

// The Frost Causeway descriptor: 3 beats (a moving causeway sentinel + a stationary cache sentinel + a hovering
// seal wisp — the same [patrol, sentinel, hover] kind-pattern as the benchmark) and NO GLB (a self-contained
// primitive seal, like the chapel). One descriptor; the shared helper does the rest.
const CAUSEWAY = sliceDescriptor({
  label: "frost-causeway-1",
  buildModulePath: "/src/world/samples/frostCausewayV1.js",
  buildFnName: "buildFrostCausewayV1",
  identityTitle: "The Frost Causeway",
  arrivalTagline: "Bear the relic across the causeway to the basin seal",
  signId: "fc-orientation-sign",
  beats: [
    { id: "fc-causeway-sentinel", kind: "patrol" },
    { id: "fc-cache-sentinel", kind: "sentinel" },
    { id: "fc-cache-wisp", kind: "hover" },
  ],
  rewardId: "fc-reliquary-relic-weapon",
  glb: null,
});

async function runSlice(d) {
  // --- SEED (editor) -----------------------------------------------------------------------------
  const seeder = await openPage(CDP_PORT, `${BASE}/`);
  try {
    await waitForReady(seeder.cdp, "editor", 45000);
    await sleep(SETTLE_MS);
    const s = await evalValue(seeder.cdp, seedSliceExpr(d));
    assert.ok(s && !s.missing && s.saved, `${d.label}: the shared seed helper saved the slice`);
    assert.deepEqual(seeder.consoleErrors, [], `${d.label} seed: 0 console errors\n${seeder.consoleErrors.join("\n")}`);
  } finally {
    await seeder.close();
  }

  // --- PLAY (runtime) ----------------------------------------------------------------------------
  const play = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
  try {
    await waitForReady(play.cdp, "runtime", 75000);
    await sleep(SETTLE_MS);
    const r = await driveSlicePlay(play.cdp, evalValue, d);

    // opening: the live wrapper resolves THIS slice's identity (not the default frozen cache).
    assert.equal(r.opening.present, true, `${d.label}: the playable-slice wrapper is active`);
    assert.equal(r.opening.identity.title, d.identityTitle, `${d.label}: the slice resolves its own title (${JSON.stringify(r.opening.identity.title)})`);
    assert.notEqual(r.opening.identity.title, "The Frozen Cache", `${d.label}: does not inherit the frozen-cache name`);
    assert.equal(r.opening.identity.arrivalTagline, d.arrivalTagline, `${d.label}: the arrival tagline names the goal`);

    // sign: the orientation sign loaded + surfaces framing.
    assert.ok(r.sign.signs >= 1, `${d.label}: the orientation sign is loaded (${r.sign.signs} signs)`);
    assert.ok(typeof r.sign.message === "string" && r.sign.message.length > 0, `${d.label}: the orientation sign reads (${JSON.stringify(r.sign.message)})`);

    // perf: within the Performance Contract (no RED metric).
    const m = extractMetrics({ perf: r.capture.perf, budget: r.capture.budget });
    console.log(`  ${d.label}  draws ${m.drawCalls}  tris ${m.triangles}  objs ${m.objects}  batches ${m.instancedBatches}`);
    assertWithinBudget(d.label, m, {});

    // staged: every beat present + a combat target; the reward instantiated.
    assert.equal(r.staged.count, d.beats.length, `${d.label}: stages ${d.beats.length} beats`);
    assert.ok(r.staged.beats.every((b) => typeof b.enemyId === "string"), `${d.label}: every beat projects an enemy`);
    assert.equal(r.staged.allTargeted, true, `${d.label}: every beat enemy is a combat target`);
    assert.equal(r.staged.rewardPresent, true, `${d.label}: the optional reliquary reward instantiated`);

    // recover: a threat fires once + names the moment + the shove is recoverable.
    assert.ok(r.recover, `${d.label}: a 3-beat slice runs the recover check`);
    assert.equal(r.recover.fired, 1, `${d.label}: crossing the first beat's window fires the threat once`);
    assert.ok(typeof r.recover.warning === "string" && /fall back/i.test(r.recover.warning), `${d.label}: the warning names the recovery (${JSON.stringify(r.recover.warning)})`);
    assert.equal(r.recover.posFinite, true, `${d.label}: the shove leaves the player on finite ground (recoverable)`);

    // strike: ONE equipped weapon defeats EVERY beat (independent, same weaponId).
    assert.ok(r.strike.results.every((b) => b.defeated && b.completed), `${d.label}: every beat defeated + completed (${JSON.stringify(r.strike.results.map((b) => b.id + ":" + b.defeated))})`);
    assert.equal(r.strike.allSameWeapon, true, `${d.label}: the SAME equipped weapon defeated every beat`);

    // completion: deposit completes the run; the card shows THIS slice's identity.
    assert.equal(r.complete.before, false, `${d.label}: the run was incomplete before deposit (non-vacuous)`);
    assert.equal(r.complete.completed, true, `${d.label}: depositing the relic completes the run`);
    assert.equal(r.complete.cardVisible, true, `${d.label}: the completion card shows`);
    assert.equal(r.complete.cardTitle, d.identityTitle, `${d.label}: the completion card names THIS slice (${JSON.stringify(r.complete.cardTitle)})`);
    assert.ok(typeof r.complete.cardBody === "string" && r.complete.cardBody.length > 0, `${d.label}: the completion card shows an ending`);
    assert.equal(r.complete.trophyPresent, true, `${d.label}: the trophy frames the deposited relic`);
    assert.ok(r.complete.completeCues >= 1, `${d.label}: the completion cue fired (${r.complete.completeCues})`);

    assert.deepEqual(play.consoleErrors, [], `${d.label} play: 0 console errors\n${play.consoleErrors.join("\n")}`);
    console.log(`  ${d.label}: identity "${r.opening.identity.title}" · sign reads · ${d.beats.length} beats defeated (one weapon) · threat recoverable · completion card "${r.complete.cardTitle}"`);
  } finally {
    await play.close();
  }

  // --- REPLAY: reload — completion + identity + trophy + every beat-clear + reward persist ---------
  const replay = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
  try {
    await waitForReady(replay.cdp, "runtime", 75000);
    await sleep(SETTLE_MS);
    const r = await driveSliceReplay(replay.cdp, evalValue, d);
    assert.equal(r.objectiveCompleted, true, `${d.label}: completion persisted across reload`);
    assert.equal(r.identityTitle, d.identityTitle, `${d.label}: the identity persisted across reload`);
    assert.equal(r.cardTitle, d.identityTitle, `${d.label}: the reloaded card shows THIS slice's name`);
    assert.equal(r.trophyPresent, true, `${d.label}: the trophy persisted`);
    assert.ok(r.beatsCleared.every((b) => b.completed === true && b.enemyId === null), `${d.label}: every beat completion persisted (no enemy re-projected)`);
    assert.equal(r.liveCount, 0, `${d.label}: no live enemies after reload (all beats cleared)`);
    assert.equal(r.rewardPresent, true, `${d.label}: the reward persisted across reload`);
    assert.equal(r.threatEvents, 0, `${d.label}: the transient threat does not replay`);
    assert.deepEqual(replay.consoleErrors, [], `${d.label} reload: 0 console errors\n${replay.consoleErrors.join("\n")}`);
    console.log(`  ${d.label}: reload preserves completion + identity + trophy + ${d.beats.length} beat-clears + reward; 0 errors`);
  } finally {
    await replay.close();
  }
}

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "frost-causeway-profile") },
  async () => {
    await runSlice(CAUSEWAY);
    console.log("\n  The Frost Causeway: the UNCHANGED shared slice-proof helper drives a 3-beat no-GLB slice to completion (own identity · beats defeated · recoverable · reload-safe); 0 console errors");
  }
);

if (run.skipped) console.log("browser frost-causeway proof skipped (no browser)");
else console.log("browser frost-causeway proof passed");
