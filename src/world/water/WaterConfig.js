// Glacial water RENDER config — colors + surface look ONLY. The water LEVEL and the
// submerged mask are terrain authority (TerrainProfile.waterLevelAt via terrainSampling
// .getWaterLevel); they are NEVER stored here, so this block can't fork a second truth.
// Pure data, Node-safe. Mirrors the glacialLighting() factory / sanitizeWater() split.

export const DEFAULT_WATER = {
  enabled: true,
  shallowColor: "#8fc3d6", // pale glacial teal at the shoreline
  deepColor: "#1f4d63", // deep blue-green in the channel
  foamColor: "#e6f1f4", // cold white foam + fresnel rim
  opacity: 0.82, // alpha at full depth (the shoreline stays more transparent)
  flowSpeed: 0.35, // uTime scroll speed for the procedural surface shimmer
  depthRange: 6.0, // world-units of depth that map to the full shallow→deep tint
  foamBand: 0.7, // world-units of depth over which the edge foam fades out
  fresnel: 0.28, // grazing-angle rim brightness
};

/** Defaults for the world document's `water` block (overrides shallow-merged). */
export function createWaterConfig(overrides = {}) {
  return { ...DEFAULT_WATER, ...overrides };
}
