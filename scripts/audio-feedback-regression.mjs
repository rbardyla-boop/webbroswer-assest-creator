// test:audio-feedback — pure-Node regression for Audio/Feedback-1 (slice sensory polish).
//
// Audio/Feedback-1 adds differentiated cues + a visual mirror to the authored slice by OBSERVING the
// existing seams (encounters, sign interactions, authored runtime-asset weapons, the relic objective)
// and playing cues through the EXISTING ProceduralAudio engine. This gate proves the PURE core:
//   - the new cue kinds are registered with valid notes (the original four are unchanged),
//   - the slice activates only when a document carries authored sensory content (else dormant),
//   - the benchmark's shrine sign + exotic reward are extracted, and
//   - reduceSensory edge-detects each cue ONCE on its transition, seeds a silent baseline on bind
//     (so a reload never replays a completed one-shot), and stays silent on a dormant slice.
// The live slice (audible, visible, reload-safe) is test:audio-feedback-proof.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { AUDIO_CUES, CUE_NOTES } from "../src/world/audio/AudioCues.js";
import { ENEMY_STATE } from "../src/world/enemies/EnemyTypes.js";
import { createWorldDocument } from "../src/world/WorldDocument.js";
import { buildVisualBenchmarkV1 } from "../src/world/samples/visualBenchmarkV1.js";
import {
  sliceHasSensoryContent,
  extractSensoryContent,
  createSensoryState,
  reduceSensory,
  CUE_LABELS,
  MILESTONE_KINDS,
} from "../src/world/feedback/SliceSensoryLogic.js";

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

const REWARD_ID = "vb-shrine-relic-weapon";
const SHRINE_SIGN_ID = "vb-shrine-idol";
// The runtime-placed system weapons (relic objective + frozen-cache tutorial) — placed into
// runtimeAssets in every world, so they must be excluded from reward cues. Literals (importing them
// would pull THREE/DOM-bound modules into this pure-Node gate).
const SYSTEM_IDS = ["relic-weapon-fp1", "frozen-cache-field-weapon"];

// A small observation builder (mirrors what the owner feeds the reducer each frame).
const obs = (over = {}) => ({
  active: true,
  encounters: [],
  rewardsCarried: [],
  signsInRange: [],
  objectiveCompleted: false,
  ...over,
});

// Run a sequence of observations from a fresh state; return the flat list of cue kinds emitted (the
// first observation seeds the baseline silently).
function runCues(observations) {
  let state = createSensoryState();
  const kinds = [];
  for (const o of observations) {
    const res = reduceSensory(state, o);
    state = res.state;
    for (const c of res.cues) kinds.push(c.kind);
  }
  return kinds;
}

// --- 1. the new audio cues are registered (originals unchanged) --------------
{
  for (const kind of ["HIT", "DEFEAT", "DISCOVERY", "REWARD"]) {
    const name = AUDIO_CUES[kind];
    assert.ok(typeof name === "string" && name.length > 0, `${kind} has a cue name`);
    const notes = CUE_NOTES[name];
    assert.ok(Array.isArray(notes) && notes.length > 0, `${kind} has notes`);
    assert.ok(notes.every((f) => Number.isFinite(f) && f > 0), `${kind} notes are finite positive Hz`);
  }
  // The four pre-existing cues are byte-stable (FrozenCacheSlice / RuntimeFeedback unaffected).
  assert.deepEqual(CUE_NOTES[AUDIO_CUES.PICKUP], [440, 660], "PICKUP notes unchanged");
  assert.deepEqual(CUE_NOTES[AUDIO_CUES.EQUIP], [180, 240], "EQUIP notes unchanged");
  assert.deepEqual(CUE_NOTES[AUDIO_CUES.CACHE], [220, 330], "CACHE notes unchanged");
  assert.deepEqual(CUE_NOTES[AUDIO_CUES.COMPLETE], [261.63, 329.63, 392, 523.25], "COMPLETE notes unchanged");
  // Every milestone kind has a human label (the visual mirror copy).
  for (const kind of MILESTONE_KINDS) assert.ok(CUE_LABELS[kind], `milestone '${kind}' has a label`);
  ok("audio cues: HIT/DEFEAT/DISCOVERY/REWARD registered with valid notes; the original four unchanged");
}

// --- 2. activation predicate (dormant unless AUTHORED content: encounters or signs) -----
{
  assert.equal(sliceHasSensoryContent(buildVisualBenchmarkV1()), true, "the benchmark is an active slice (encounters + a sign)");
  assert.equal(sliceHasSensoryContent(createWorldDocument()), false, "an empty world is dormant (byte-stable)");
  assert.equal(sliceHasSensoryContent(null), false, "a null document is dormant");
  const signOnly = { objects: [{ id: "s", transform: { position: { x: 0, y: 0, z: 0 } }, interaction: { role: "sign", showRadius: 5 } }] };
  const encOnly = { encounters: { items: [{ id: "e" }] } };
  assert.equal(sliceHasSensoryContent(signOnly), true, "a sign alone activates");
  assert.equal(sliceHasSensoryContent(encOnly), true, "an encounter alone activates");
  // THE DORMANCY INVARIANT: the runtime places system weapons (relic, tutorial) into runtimeAssets in
  // EVERY world. A world with ONLY runtime-placed weapons and no authored encounters/signs — the
  // frozen-cache / first-playable case — must stay DORMANT (else it would fire reward/complete cues there
  // and double the COMPLETE chord, breaking those shipped slices' byte-stability).
  const systemWeaponsOnly = { runtimeAssets: { items: [
    { kind: "generated.weapon", id: SYSTEM_IDS[0] },
    { kind: "generated.weapon", id: SYSTEM_IDS[1] },
  ] } };
  assert.equal(sliceHasSensoryContent(systemWeaponsOnly), false, "runtime-placed weapons alone do NOT activate (frozen-cache / first-playable stay dormant)");
  ok("activation: active only for AUTHORED encounters / signs; runtime-placed weapons never activate (dormancy invariant)");
}

// --- 3. the shrine sign + ONLY the authored exotic reward are extracted (system weapons excluded) -
{
  // Simulate the runtime pollution: the relic + tutorial weapons are pushed into runtimeAssets at load,
  // BEFORE the sensory layer binds. The owner passes them as excludeRewardIds so they are NOT loot.
  const doc = buildVisualBenchmarkV1();
  const proto = doc.runtimeAssets.items[0];
  doc.runtimeAssets.items.push(
    { kind: "generated.weapon", id: SYSTEM_IDS[0], recipe: proto.recipe, transform: proto.transform, runtime: proto.runtime },
    { kind: "generated.weapon", id: SYSTEM_IDS[1], recipe: proto.recipe, transform: proto.transform, runtime: proto.runtime },
  );
  const content = extractSensoryContent(doc, SYSTEM_IDS);
  assert.equal(content.hasEncounters, true, "the benchmark has encounters");
  const shrine = content.signs.find((s) => s.id === SHRINE_SIGN_ID);
  assert.ok(shrine, "the shrine idol sign is extracted");
  assert.equal(shrine.radius, 7, "the shrine sign's show radius is 7m");
  assert.ok(Number.isFinite(shrine.x) && Number.isFinite(shrine.z), "the shrine sign has a finite position");
  assert.deepEqual(content.rewardIds, [REWARD_ID], "ONLY the authored exotic reward is a reward (the relic + tutorial are excluded)");
  ok("extraction: the shrine sign (r=7) + ONLY the authored exotic reward are watched (system weapons excluded)");
}

// --- 4a. seed-then-silence: the first observation never fires a cue ----------
{
  // A first frame that is ALREADY mid-combat / pre-completed must emit nothing (reload safety).
  const kinds = runCues([
    obs({
      encounters: [{ id: "b", enemyState: ENEMY_STATE.HIT_REACT, completed: false }],
      rewardsCarried: [REWARD_ID],
      signsInRange: [SHRINE_SIGN_ID],
      objectiveCompleted: true,
    }),
  ]);
  assert.deepEqual(kinds, [], "the seeding observation emits no cue even mid-hit-react / pre-carried / completed");
  ok("seed: the first observation after a bind seeds a silent baseline (no replay on reload)");
}

// --- 4b. combat cue order: HIT(s) < DEFEAT < CLEAR ---------------------------
{
  const idle = { id: "b", enemyState: ENEMY_STATE.IDLE, completed: false };
  const kinds = runCues([
    obs({ encounters: [idle] }), // seed (idle)
    obs({ encounters: [{ id: "b", enemyState: ENEMY_STATE.HIT_REACT, completed: false }] }), // hit
    obs({ encounters: [idle] }), // back to idle (re-arm)
    obs({ encounters: [{ id: "b", enemyState: ENEMY_STATE.HIT_REACT, completed: false }] }), // hit again
    obs({ encounters: [{ id: "b", enemyState: ENEMY_STATE.DEFEATED, completed: true }] }), // defeat + clear
    obs({ encounters: [{ id: "b", enemyState: ENEMY_STATE.DEFEATED, completed: true }] }), // no replay
  ]);
  // deepEqual pins both content AND order (a reorder fails here first), so explicit indexOf checks are
  // redundant in the unit test; the ordering gate that carries real weight is in the browser proof, where
  // the accumulated log has no deepEqual oracle.
  assert.deepEqual(kinds, ["hit", "hit", "defeat", "clear"], "two re-armed hits, then one defeat, then one clear (order pinned)");
  ok("combat: HIT re-arms per strike; DEFEAT once; CLEAR once; order hit < defeat < clear");
}

// --- 4c. defeat/clear audio split (RuntimeFeedback owns the clear chord) ------
{
  let state = createSensoryState();
  state = reduceSensory(state, obs({ encounters: [{ id: "b", enemyState: ENEMY_STATE.IDLE, completed: false }] })).state;
  const res = reduceSensory(state, obs({ encounters: [{ id: "b", enemyState: ENEMY_STATE.DEFEATED, completed: true }] }));
  const defeat = res.cues.find((c) => c.kind === "defeat");
  const clear = res.cues.find((c) => c.kind === "clear");
  assert.equal(defeat.audible, true, "DEFEAT plays a sound");
  assert.equal(defeat.audioName, AUDIO_CUES.DEFEAT, "DEFEAT maps to the DEFEAT cue");
  assert.equal(clear.audible, false, "CLEAR plays NO sound (RuntimeFeedback owns the COMPLETE chord)");
  assert.equal(clear.audioName, null, "CLEAR has no audio name");
  ok("split: DEFEAT is audible; CLEAR is log/visual only so the clear chord is never double-fired");
}

// --- 4d. discovery + reward are one-shot per id ------------------------------
{
  const discovery = runCues([
    obs({ signsInRange: [] }), // seed (not in range)
    obs({ signsInRange: [SHRINE_SIGN_ID] }), // enter -> discovery
    obs({ signsInRange: [SHRINE_SIGN_ID] }), // still inside -> nothing
    obs({ signsInRange: [] }), // leave
    obs({ signsInRange: [SHRINE_SIGN_ID] }), // re-enter -> still nothing (once per load)
  ]);
  assert.deepEqual(discovery, ["discovery"], "discovery fires once on entry, never again this load");

  const reward = runCues([
    obs({ rewardsCarried: [] }), // seed
    obs({ rewardsCarried: [REWARD_ID] }), // pick up -> reward
    obs({ rewardsCarried: [REWARD_ID] }), // still carried -> nothing
    obs({ rewardsCarried: [] }), // drop
    obs({ rewardsCarried: [REWARD_ID] }), // regrab -> still nothing (once per load)
  ]);
  assert.deepEqual(reward, ["reward"], "reward fires once per id, even after drop + regrab");
  ok("one-shot: discovery fires once on entry; reward fires once per id (no replay on re-enter / regrab)");
}

// --- 4e. objective completion payoff fires once ------------------------------
{
  const kinds = runCues([
    obs({ objectiveCompleted: false }), // seed
    obs({ objectiveCompleted: false }), // still going
    obs({ objectiveCompleted: true }), // deposit completes -> payoff
    obs({ objectiveCompleted: true }), // stays complete -> nothing
  ]);
  assert.deepEqual(kinds, ["complete"], "the cache payoff fires once on the objective false->true edge");
  ok("payoff: the deposit/completion COMPLETE cue fires exactly once on the objective completion edge");
}

// --- 4f. a dormant slice emits nothing regardless of observation -------------
{
  let state = createSensoryState();
  const res = reduceSensory(
    state,
    obs({
      active: false,
      encounters: [{ id: "b", enemyState: ENEMY_STATE.DEFEATED, completed: true }],
      rewardsCarried: [REWARD_ID],
      signsInRange: [SHRINE_SIGN_ID],
      objectiveCompleted: true,
    }),
  );
  assert.deepEqual(res.cues, [], "a dormant (inactive) slice emits no cues");
  assert.equal(res.state, state, "a dormant slice does not advance state");
  ok("dormant: an inactive slice (frozen-cache / first-playable) never emits a cue (byte-stable)");
}

// --- 5. static scans: the pure module stays pure -----------------------------
{
  const src = readFileSync(fileURLToPath(new URL("../src/world/feedback/SliceSensoryLogic.js", import.meta.url)), "utf8");
  assert.doesNotMatch(src, /from\s+["']three["']/, "the pure logic imports no THREE");
  assert.doesNotMatch(src, /\bdocument\.(createElement|body)\b|window\.|globalThis\./, "the pure logic touches no DOM/global");
  assert.doesNotMatch(src, /Math\.random|Date\.now|new Date\b|performance\.now/, "the pure logic is deterministic (no RNG/clock)");
  const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  assert.deepEqual(
    imports.sort(),
    ["../audio/AudioCues.js", "../enemies/EnemyTypes.js"],
    "the pure logic imports ONLY the AudioCues + EnemyTypes value modules",
  );
  ok("scans: SliceSensoryLogic is pure — imports only value modules; no THREE/DOM/RNG/clock");
}

console.log(`\naudio-feedback regression: ${passed} checks passed`);
