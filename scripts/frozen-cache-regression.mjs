import assert from "node:assert/strict";
import * as THREE from "three";

import { deriveSliceBeat, sliceBanner, SLICE_BEATS } from "../src/world/slice/SliceBeats.js";
import { SlicePrompts } from "../src/world/slice/SlicePrompts.js";
import { buildSliceLandmarks, disposeSliceLandmarks } from "../src/world/slice/SliceLandmarks.js";
import { SliceCompletion } from "../src/world/slice/SliceCompletion.js";

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
}

assert.equal(deriveSliceBeat({ phase: "find", elapsed: 0 }), SLICE_BEATS.ARRIVAL);
assert.equal(deriveSliceBeat({ phase: "find", elapsed: 8, distanceToRelic: 30 }), SLICE_BEATS.JOURNEY);
assert.equal(deriveSliceBeat({ phase: "find", elapsed: 8, distanceToRelic: 5 }), SLICE_BEATS.DISCOVERY);
assert.equal(deriveSliceBeat({ phase: "carry" }), SLICE_BEATS.RETURN);
assert.equal(deriveSliceBeat({ phase: "atCache" }), SLICE_BEATS.DEPOSIT);
assert.equal(deriveSliceBeat({ phase: "complete" }), SLICE_BEATS.COMPLETE);
assert.match(sliceBanner(SLICE_BEATS.ARRIVAL, "fallback"), /FROZEN CACHE/);
assert.equal(sliceBanner(SLICE_BEATS.JOURNEY, "Find the relic"), "Find the relic");

const storage = new MemoryStorage();
const prompts = new SlicePrompts({ storage });
const nearField = { nearestId: "field", relicId: "relic" };
assert.deepEqual(prompts.prompt(nearField), { key: "F", text: "Pick up the field weapon" });
prompts.markUsed("F");
assert.equal(prompts.prompt(nearField), null, "optional F tutorial retires after successful use");
assert.deepEqual(prompts.prompt({ nearestId: "relic", relicId: "relic" }), { key: "F", text: "Pick up the relic" }, "critical relic prompt remains contextual");
assert.deepEqual(prompts.prompt({ carriedCount: 1, activeId: "field" }), { key: "H", text: "Holster the drawn weapon" });
prompts.markUsed("H");
assert.deepEqual(prompts.prompt({ carriedCount: 2, activeId: "relic" }), { key: "R", text: "Cycle your carried weapons" });
prompts.markUsed("R");
assert.deepEqual(prompts.prompt({ relicCarried: true, inZone: true }), { key: "G", text: "Deposit the relic in the cache" });
assert.equal(new SlicePrompts({ storage }).learned.H, true, "tutorial learning survives reload");

const scene = new THREE.Scene();
const landmarks = buildSliceLandmarks({ spawn: { x: 0, z: 0 }, relic: { x: 14, z: 0 }, cache: { x: -26, z: 0 } });
scene.add(landmarks);
assert.deepEqual(landmarks.children.map((child) => child.name), ["SliceLandmarkOverlook", "SliceLandmarkRuin", "SliceLandmarkPass"]);
let meshes = 0;
landmarks.traverse((node) => { if (node.isMesh) meshes++; });
assert.ok(meshes >= 10, "authored route contains composed landmark geometry");
disposeSliceLandmarks(landmarks);
assert.equal(scene.getObjectByName("FrozenCacheLandmarks"), undefined, "landmarks dispose cleanly");

const card = { shown: 0, hidden: 0, show() { this.shown++; }, hide() { this.hidden++; } };
const audio = { cues: [], cue(name) { this.cues.push(name); } };
const completion = new SliceCompletion(card, audio);
completion.load(false);
assert.equal(completion.update(false), false);
assert.equal(completion.update(true), true);
assert.equal(completion.update(true), false, "completion feedback is one-shot");
assert.equal(card.shown, 1);
assert.equal(audio.cues.length, 1);

console.log("frozen-cache regression passed (beats, contextual tutorial retirement, landmarks, one-shot completion)");
