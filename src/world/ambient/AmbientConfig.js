// Ambient CONFIG block — the lightweight authoring intent stored in the world document.
// Per-mote state is NEVER persisted: the spawn set re-derives deterministically from
// (seed, region, active TerrainProfile), so only the seed + toggles + streaming distances
// + wind live here. Pure data, Node-safe. Mirrors WildlifeConfig.

export const DEFAULT_AMBIENT = {
  enabled: true,
  seed: 9137,
  density: 1.0, // 0..3 multiplier on each species' candidate budget
  regionSize: 64, // world-units per region cell (same grid family as wildlife)
  visibleDistance: 90, // render regions within this distance (motes are small → seen up close)
  keepDistance: 120, // retain regions out to here (hysteresis vs visibleDistance)
  simulateDistance: 70, // run per-mote drift only within this distance (LOD)
  // Gentle down-valley breeze (+Z = glacial flow). angle is in the XZ plane:
  // windX = cos(angle)*strength, windZ = sin(angle)*strength.
  wind: { angle: Math.PI / 2, strength: 0.15 },
  species: {
    alpine_motes: { enabled: true },
  },
};

/** Defaults for the world document's `ambient` block (overrides shallow-merged). */
export function createAmbientConfig(overrides = {}) {
  const out = { ...DEFAULT_AMBIENT, ...overrides };
  out.wind = { ...DEFAULT_AMBIENT.wind, ...(overrides.wind ?? {}) };
  out.species = { ...DEFAULT_AMBIENT.species, ...(overrides.species ?? {}) };
  return out;
}
