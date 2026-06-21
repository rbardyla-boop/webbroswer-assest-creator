// Enemy Archetype Lab — a small, focused arena that stages BOTH enemy archetypes side by side so the
// Enemy-2 contract is demonstrable in isolation: one grounded `glacial_sentinel` and one floating
// `frost_wisp`, each authored as its own Encounter Editor-0 combat beat, on the default glacial floor.
//
// It is a DEDICATED sample (NOT the visual benchmark): the benchmark's gates pin a two-sentinel
// composition (`content-combat-beats` / `visual-benchmark` assert every beat is `glacial_sentinel`),
// so the wisp gets its own scene and the benchmark stays byte-stable. No patrol here — Enemy-1 already
// proves authored patrol; this scene proves the second archetype (health/scale/movement/feedback) and
// that the SAME weapon defeats both, independently, persisting across reload.
//
// Pure + deterministic: the composition is a function of the terrain only (no RNG, no wall-clock). The
// relic find→carry→cache loop is the runtime's automatic objective (as in every runtime world) — it is
// incidental here and the archetype proof ignores it.

import { createWorldDocument } from "../WorldDocument.js";
import { getHeight, findGoodSpawn, setTerrainProfile } from "../../terrain/terrainSampling.js";
import { createTerrainProfile } from "../../terrain/profiles/index.js";
import { ENCOUNTER_TYPE } from "../encounters/EncounterTypes.js";
import { SENTINEL_TYPE, WISP_TYPE } from "../enemies/EnemyTypes.js";

export const ENEMY_ARCHETYPE_LAB_ID = "enemy-archetype-lab";

// Activate the document's terrain profile (default alpine) before authoring so getHeight() grounds the
// landmarks + encounters on the SAME field the runtime loader will apply on load.
function activateProfile(doc) {
  setTerrainProfile(createTerrainProfile(doc.terrain));
}

// A terrain-grounded primitive marker (a small pedestal the encounter sits on, so each beat reads as a
// staged spot rather than an empty patch of grass).
function pedestal(id, name, p, scale, rotationY = 0) {
  return {
    id,
    name,
    type: "primitive",
    primitive: "cylinder",
    assetRef: null,
    asset: null,
    transform: {
      position: { x: p.x, y: getHeight(p.x, p.z) + scale.y / 2, z: p.z },
      rotation: { x: 0, y: rotationY, z: 0 },
      scale: { ...scale },
    },
    collider: { type: "cylinder", enabled: true },
    exclusion: { grass: true, trees: true },
    particles: null,
    interaction: null,
  };
}

export function buildEnemyArchetypeLab() {
  const doc = createWorldDocument({ metadata: { name: "Enemy Archetype Lab" } });
  activateProfile(doc);

  const base = findGoodSpawn(); // flat, dry, walkable ground — the arena floor
  // Two staged spots a few metres ahead of the spawn, one to each side, far enough apart that defeating
  // one never touches the other (and the camera frames both from the overlook).
  const sentinelSpot = { x: base.x - 6, z: base.z + 13 };
  const wispSpot = { x: base.x + 6, z: base.z + 13 };

  const objects = [
    pedestal("eal-sentinel-pad", "Sentinel Pad", sentinelSpot, { x: 2.0, y: 0.5, z: 2.0 }),
    pedestal("eal-wisp-pad", "Wisp Pad", wispSpot, { x: 2.0, y: 0.5, z: 2.0 }),
    // Two framing posts at the arena mouth so the space reads as an intentional stage.
    pedestal("eal-post-l", "Arena Post L", { x: base.x - 9, z: base.z + 6 }, { x: 0.6, y: 3.2, z: 0.6 }),
    pedestal("eal-post-r", "Arena Post R", { x: base.x + 9, z: base.z + 6 }, { x: 0.6, y: 3.2, z: 0.6 }),
  ];
  doc.objects = objects;

  // Two authored combat beats — one per archetype. Same systems (Encounter Editor-0 orchestration,
  // Combat-0 strike, Enemy lifecycle), different enemyType. No patrol on either (this scene isolates the
  // archetype, not movement authoring). They complete + persist INDEPENDENTLY.
  doc.encounters = {
    version: 1,
    items: [
      {
        type: ENCOUNTER_TYPE,
        id: "eal-sentinel-beat",
        position: { x: sentinelSpot.x, y: getHeight(sentinelSpot.x, sentinelSpot.z), z: sentinelSpot.z },
        radius: 6,
        enemyType: SENTINEL_TYPE,
        enemyCount: 1,
        completed: false,
        persistCompletion: true,
        label: "the sentinel",
      },
      {
        type: ENCOUNTER_TYPE,
        id: "eal-wisp-beat",
        position: { x: wispSpot.x, y: getHeight(wispSpot.x, wispSpot.z), z: wispSpot.z },
        radius: 6,
        enemyType: WISP_TYPE,
        enemyCount: 1,
        completed: false,
        persistCompletion: true,
        label: "the wisp",
      },
    ],
  };

  // Spawn at the arena mouth facing the two beats; third-person so the staged composition reads.
  doc.player.spawn = { x: base.x, y: getHeight(base.x, base.z), z: base.z };
  doc.player.cameraMode = "third";

  return doc;
}
