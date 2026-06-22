// Registry of built-in sample worlds. Each entry builds a fresh WorldDocument v2
// on demand (so terrain sampling is re-applied), keyed by a stable id used by
// both the editor "Load Sample World" action and the runtime `?world=` param.

import { buildVerticalSliceV1, VERTICAL_SLICE_ID } from "./verticalSliceV1.js";
import { buildVisualBenchmarkV1, VISUAL_BENCHMARK_ID } from "./visualBenchmarkV1.js";
import { buildEnemyArchetypeLab, ENEMY_ARCHETYPE_LAB_ID } from "./enemyArchetypeLab.js";
import { buildIceChapelV1, ICE_CHAPEL_ID } from "./iceChapelV1.js";
import { buildFrostCausewayV1, FROST_CAUSEWAY_ID } from "./frostCausewayV1.js";

const SAMPLE_BUILDERS = {
  [VERTICAL_SLICE_ID]: buildVerticalSliceV1,
  [VISUAL_BENCHMARK_ID]: buildVisualBenchmarkV1,
  [ENEMY_ARCHETYPE_LAB_ID]: buildEnemyArchetypeLab,
  [ICE_CHAPEL_ID]: buildIceChapelV1,
  [FROST_CAUSEWAY_ID]: buildFrostCausewayV1,
};

const SAMPLE_LABELS = {
  [VERTICAL_SLICE_ID]: "Vertical Slice v1",
  [VISUAL_BENCHMARK_ID]: "Visual Benchmark 1",
  [ENEMY_ARCHETYPE_LAB_ID]: "Enemy Archetype Lab",
  [ICE_CHAPEL_ID]: "The Ice Chapel",
  [FROST_CAUSEWAY_ID]: "The Frost Causeway",
};

export function getSampleWorld(id) {
  const build = SAMPLE_BUILDERS[id];
  return build ? build() : null;
}

export function listSampleWorlds() {
  return Object.keys(SAMPLE_BUILDERS).map((id) => ({ id, label: SAMPLE_LABELS[id] ?? id }));
}

export { VERTICAL_SLICE_ID };
