// Ambient wildlife species — PURE DATA (Node-safe, no THREE). Each row defines a
// species' habitat envelope (the masks it respects), its herd grouping, its simple
// behaviour numbers, and a primitive render silhouette. The placement/runtime read
// these to gate spawns + clamp movement against the active TerrainProfile; the system
// builds one InstancedMesh per species from the `geometry` spec.
//
// Wildlife-0 ships two GROUNDED grazers. `snow_finch` (a flying flock) is present but
// DISABLED — its aloft contract is promoted in Wildlife-1; the row keeps the data +
// code path warm without adding a second grounding contract to this stage's proof.

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
    enabled: false, // STAGED for Wildlife-1 (flying/aloft contract) — never placed here
    groundContract: "aloft",
    geometry: { shape: "cone", radius: 0.12, length: 0.3 },
    color: 0xe8eef2,
    scale: [1, 1, 1],
    yOffset: 0,
    slopeLimit: 0.7,
    minY: 30,
    maxY: 70,
    waterClearance: 0,
    snowMargin: -20, // may sit above the snowline (high-altitude flock)
    grazeGrassFloor: 0,
    altitude: [14, 26], // aloft offset above terrain (Wildlife-1)
    idleRadius: 40,
    panicDistance: 22,
    speed: { idle: 0, graze: 0, wander: 3.0, flee: 5.0 },
    herdsPerRegion: 1,
    members: [8, 14],
    regionMemberCap: 16,
    rngSalt: 0x5f10c3,
  },
];

export function speciesById(id) {
  return WILDLIFE_SPECIES.find((s) => s.id === id) ?? null;
}
