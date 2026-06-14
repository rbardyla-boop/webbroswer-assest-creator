// Registry of built-in sample worlds. Each entry builds a fresh WorldDocument v2
// on demand (so terrain sampling is re-applied), keyed by a stable id used by
// both the editor "Load Sample World" action and the runtime `?world=` param.

import { buildVerticalSliceV1, VERTICAL_SLICE_ID } from "./verticalSliceV1.js";

const SAMPLE_BUILDERS = {
  [VERTICAL_SLICE_ID]: buildVerticalSliceV1,
};

const SAMPLE_LABELS = {
  [VERTICAL_SLICE_ID]: "Vertical Slice v1",
};

export function getSampleWorld(id) {
  const build = SAMPLE_BUILDERS[id];
  return build ? build() : null;
}

export function listSampleWorlds() {
  return Object.keys(SAMPLE_BUILDERS).map((id) => ({ id, label: SAMPLE_LABELS[id] ?? id }));
}

export { VERTICAL_SLICE_ID };
