// Ambient micro-actor species — PURE DATA (Node-safe, no THREE). Ambient-0 ships one
// streamed environmental class: `alpine_motes`, tiny firefly-like glowing specks that
// drift over the wet meadow + waterside of the glacial valley. The placement/runtime read
// these to derive deterministic, biome-aware density (wetness + meadow, thinning to the
// snowline) and bounded drift; AmbientSystem builds one InstancedMesh from `geometry`.
//
// This is the THIRD streamed actor class (after grounded wildlife + aloft flocks) and the
// first runtime consumer of getWetness — proving the shared RegionStreamer generalizes.

export const AMBIENT_SPECIES = [
  {
    id: "alpine_motes",
    enabled: true,
    geometry: { shape: "octahedron", radius: 0.06 }, // tiny view-independent speck
    color: 0xffe8a8, // warm amber glow — pops against the cold blue valley (additive blend)
    scale: [1, 1, 1],
    // --- hover band (the floor-after-band altitude solver lifts motes off the ground/water)
    minClearance: 0.5, // HARD floor above terrain AND water (inviolable)
    hoverBand: [0.4, 2.5], // preferred per-mote offset above terrain (seeded)
    slopeLimit: 0.9, // lax — motes avoid only sheer cliffs (meadow density already excludes rock)
    // --- biome density weights (density = clamp01(wetWeight*wetness + meadowWeight*meadow) * snowFactor)
    wetWeight: 0.8, // concentrate along the shoreline / wet meadow (the getWetness signal)
    meadowWeight: 0.5, // present across the valley-floor meadow
    snowFalloff: 12, // thin from full density to 0 across this many world-units below the snowline
    // --- grouping / bounds
    motesPerRegion: 60, // candidate budget per region (scaled by config.density)
    regionMemberCap: 40, // hard per-region accepted cap (bounds one region's emission)
    // --- drift / motion
    tetherRadius: 6, // motes stay within this of their home anchor (the field stays put)
    maxSpeed: 0.6, // hard ceiling on total drift speed (units/s)
    drift: { wanderRate: 0.6, wanderAmp: 0.35 }, // seeded wander: angle evolution rate + velocity magnitude
    twinkle: { amp: 0.5, speed: 2.5 }, // scale pulse (amp < 1 → factor stays in (0,2), never collapses)
    panicDistance: 5, // gentle visual scatter when the viewer is within this
    scatterPush: 0.5, // extra drift speed away from the viewer while scattering
    rngSalt: 0x70e5b1,
  },
];

export function speciesById(id) {
  return AMBIENT_SPECIES.find((s) => s.id === id) ?? null;
}
