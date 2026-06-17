// Wildlife CONFIG block — the lightweight authoring intent stored in the world
// document. Per-animal state is NEVER persisted: the spawn set re-derives
// deterministically from (seed, region, active TerrainProfile), so only the seed +
// toggles + streaming distances live here. Pure data, Node-safe.

export const DEFAULT_WILDLIFE = {
  enabled: true,
  seed: 7411,
  density: 1.0, // 0..3 multiplier on each species' herdsPerRegion
  regionSize: 64, // world-units per wildlife region cell (coarser than vegetation)
  visibleDistance: 140, // render regions within this distance of the viewer
  keepDistance: 180, // retain regions out to here (hysteresis vs visibleDistance)
  simulateDistance: 90, // run the per-animal FSM only within this distance (LOD)
  species: {
    alpine_hare: { enabled: true },
    ibex: { enabled: true },
    snow_finch: { enabled: false }, // staged → Wildlife-1
  },
};

/** Defaults for the world document's `wildlife` block (overrides shallow-merged). */
export function createWildlifeConfig(overrides = {}) {
  const out = { ...DEFAULT_WILDLIFE, ...overrides };
  out.species = { ...DEFAULT_WILDLIFE.species, ...(overrides.species ?? {}) };
  return out;
}
