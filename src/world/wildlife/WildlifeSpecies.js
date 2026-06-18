// Ambient wildlife species — PURE DATA (Node-safe, no THREE). Each row defines a
// species' habitat envelope (the masks it respects), its herd grouping, its simple
// behaviour numbers, and a primitive render silhouette. The placement/runtime read
// these to gate spawns + clamp movement against the active TerrainProfile; the system
// builds one InstancedMesh per species from the `geometry` spec.
//
// Wildlife-0 shipped two GROUNDED grazers. Wildlife-1 promotes `snow_finch` into a LIVE
// flying flock (groundContract "aloft"): the row carries flock-tuning numbers consumed by
// FlockPlacement/FlockRuntime/AloftWildlife. The grounded path skips any non-"support"
// species, so grounded placement/streaming is unchanged.

export const WILDLIFE_SPECIES = [
  {
    id: "alpine_hare",
    enabled: true,
    groundContract: "support", // grounded — y tracks getHeight (the terrain single source)
    geometry: { shape: "capsule", radius: 0.16, length: 0.34 },
    color: 0xc9bfa6, // pale tan
    scale: [1, 1, 1],
    yOffset: 0.16, // body half-thickness (capsule lies horizontal) → rests on the ground
    // habitat gates
    slopeLimit: 0.35, // gentle meadow only
    minY: -8,
    maxY: 38, // well below the snowline
    waterClearance: 1.5, // stay this far (world-Y) above the water table
    snowMargin: 4, // stop this far below the snowline
    grazeGrassFloor: 0.35, // prefers real meadow
    // behaviour
    idleRadius: 6,
    panicDistance: 12, // skittish — flees early
    speed: { idle: 0, graze: 0.15, wander: 0.7, flee: 2.2 },
    // grouping
    herdsPerRegion: 2, // up to N herds per region (seeded count 0..N)
    members: [3, 6], // members per herd (min..max)
    regionMemberCap: 16,
    rngSalt: 0xa17e01,
  },
  {
    id: "ibex",
    enabled: true,
    groundContract: "support",
    geometry: { shape: "capsule", radius: 0.32, length: 0.85 },
    color: 0x7a6a55, // brown-grey
    scale: [1, 1, 1],
    yOffset: 0.32,
    slopeLimit: 0.6, // climbs steeper ground than the hare
    minY: -8,
    maxY: 40,
    waterClearance: 1.0,
    snowMargin: 2,
    grazeGrassFloor: 0.2,
    idleRadius: 14,
    panicDistance: 18,
    speed: { idle: 0, graze: 0.2, wander: 0.8, flee: 1.8 },
    herdsPerRegion: 1,
    members: [3, 6],
    regionMemberCap: 12,
    rngSalt: 0x1be201,
  },
  {
    id: "snow_finch",
    enabled: true, // Wildlife-1: live aloft flock
    groundContract: "aloft", // flies — y is solved by flockAltitudeAt (NOT getHeight)
    geometry: { shape: "vwing", span: 1.4, chord: 0.6 }, // shallow gull-V silhouette (sized to read at altitude)
    color: 0xe8eef2, // pale grey-white
    scale: [1, 1, 1],
    yOffset: 0, // aloft: render Y is the solved flight altitude, no ground offset
    // habitat / altitude envelope (consumed by flockAltitudeAt)
    slopeLimit: 0.7, // (unused by the aloft gate — birds fly over cliffs)
    minClearance: 12, // HARD floor above terrain/water (inviolable; ≤ altitude[0])
    altitude: [14, 26], // preferred per-bird offset band above terrain
    minY: 30, // soft absolute floor (ridge-hugging high band)
    maxY: 70, // soft absolute ceiling (terrain+clearance overrides it over high crests)
    snowMargin: -20, // negative → the band reaches ABOVE the snowline (high-altitude flock)
    waterClearance: 0, // (grounded-only field; aloft uses minClearance)
    grazeGrassFloor: 0, // (grounded-only field)
    // flock behaviour
    idleRadius: 40, // circle/drift orbit radius around home
    panicDistance: 22, // scatter when the viewer is within this of the flock centre
    maxSpread: 9, // members stay within this of the flock centre (cohesion bound)
    maxSpeed: 5.0, // hard ceiling on centre speed (units/s)
    maxTurnRate: 2.2, // hard ceiling on heading change (rad/s)
    circleAngularSpeed: 0.55, // orbit angular velocity when circling (rad/s)
    scatterFactor: 1.8, // spread multiplier on scatter (product still clamped ≤ maxSpread)
    maxTetherRadius: 55, // hard leash: centre never strays past this from home
    calmTime: 3.0, // seconds un-panicked before a scattered flock regroups
    speed: { idle: 0, graze: 0, wander: 3.0, flee: 5.0 }, // drift / scatter cruise speeds
    // grouping
    herdsPerRegion: 1,
    members: [8, 14],
    regionMemberCap: 16,
    rngSalt: 0x5f10c3,
  },
];

export function speciesById(id) {
  return WILDLIFE_SPECIES.find((s) => s.id === id) ?? null;
}
