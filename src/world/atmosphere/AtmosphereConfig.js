// Valley atmosphere config — how the global glacial fog is MODULATED by where the
// camera sits in the valley. The base fog itself comes from the lighting block
// (glacialLighting().fog); this only biases it (thicker in the basin, cold mist near
// water/snowline) and eases the change. Pure data, Node-safe.

export const DEFAULT_ATMOSPHERE = {
  enabled: true,
  basinFogBoost: 0.45, // 0..1 — fraction the fog `near` is pulled in when deep in the basin
  mistStrength: 0.4, // 0..1 — how far the fog color shifts toward mistColor near water/snow
  mistColor: "#cfe0e8", // cold pale-blue mist tint
  easeRate: 1.5, // per-second ease toward the target fog (higher = snappier, frame-independent)
  ridgeSpan: 40, // world-units above the valley floor that count as "out of the basin"
  mistBand: 12, // world-units around the waterline / above the snowline where mist gathers
};

/** Defaults for the world document's `atmosphere` block (overrides shallow-merged). */
export function createAtmosphereConfig(overrides = {}) {
  return { ...DEFAULT_ATMOSPHERE, ...overrides };
}
