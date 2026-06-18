// Ambient wildlife system — region streaming + instanced render + simulate LOD.
// Mirrors the BushSystem streaming model (region Map keyed "rx,rz", enqueue within
// visibleDistance, dispose beyond keepDistance) so the active set is bounded. Each
// enabled species renders through ONE THREE.InstancedMesh (capacity-capped); the
// per-animal FSM runs only within simulateDistance (far-but-active regions render a
// frozen pose). Deterministic spawn set (WildlifePlacement); seeded motion (WildlifeRuntime).

import * as THREE from "three";
import { createWildlifeConfig } from "./WildlifeConfig.js";
import { WILDLIFE_SPECIES } from "./WildlifeSpecies.js";
import { placeRegion } from "./WildlifePlacement.js";
import { spawnAnimal, updateAnimal } from "./WildlifeRuntime.js";
import { AloftWildlife } from "./AloftWildlife.js";
import { getHeight, getWaterLevel, getActiveTerrainProfile } from "../../terrain/terrainSampling.js";

const MAX_INSTANCES_PER_SPECIES = 2048; // InstancedMesh capacity; excess active instances are clipped at render (mesh.count guard)
const MAX_ACTIVE_WILDLIFE = 1500; // hard ceiling on total live animals (defense in depth)

export class WildlifeSystem {
  constructor(scene) {
    this.scene = scene;
    this.cfg = null;
    this.seed = 0;
    this.enabled = false;
    this.regions = new Map(); // "rx,rz" -> { animals: [], center: {x,z} }
    this._meshes = new Map(); // speciesId -> THREE.InstancedMesh
    this._activeSpecies = []; // GROUNDED species rows enabled by BOTH the row and the document
    this._activeAloftSpecies = []; // aloft species rows (delegated to the internal flock system)
    this._aloft = null; // AloftWildlife — owned internally so the world's single wildlife handle is enough

    this._camPos = new THREE.Vector3();
    this._mat = new THREE.Matrix4();
    this._pos = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._euler = new THREE.Euler();
    this._scl = new THREE.Vector3();

    this.stats = emptyStats();
  }

  // Build the per-species instanced meshes from the document's wildlife block. A
  // disabled/empty config is a pure no-op — never touches the scene.
  load(document, scene = this.scene) {
    this.dispose();
    this.scene = scene;
    const cfg = createWildlifeConfig(document?.wildlife ?? {});
    this.cfg = cfg;
    this.enabled = cfg.enabled !== false;
    // Combine the document terrain seed with the wildlife seed so different worlds
    // (and different wildlife seeds) get distinct, deterministic herds.
    this.seed = (Math.floor(numOr(document?.terrain?.seed, 0)) ^ Math.floor(numOr(cfg.seed, 0))) | 0;
    // GROUNDED species go through this system; ALOFT species (snow_finch) are delegated to
    // the internal AloftWildlife so the grounded streaming/render path is unchanged.
    this._activeSpecies = WILDLIFE_SPECIES.filter(
      (s) => s.enabled && s.groundContract === "support" && cfg.species?.[s.id]?.enabled !== false
    );
    this._activeAloftSpecies = WILDLIFE_SPECIES.filter(
      (s) => s.enabled && s.groundContract === "aloft" && cfg.species?.[s.id]?.enabled !== false
    );
    // Return only when the whole block is dead — an aloft-only world still builds flocks.
    if (!this.enabled || (this._activeSpecies.length === 0 && this._activeAloftSpecies.length === 0)) return;

    for (const species of this._activeSpecies) {
      const geo = buildSpeciesGeometry(species);
      const mat = new THREE.MeshStandardMaterial({ color: species.color, roughness: 0.85, metalness: 0 });
      const mesh = new THREE.InstancedMesh(geo, mat, MAX_INSTANCES_PER_SPECIES);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false; // culled by region distance instead
      mesh.castShadow = false; // ambient life — receive terrain shadow, don't cast (cheap)
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.name = `Wildlife_${species.id}`;
      this._meshes.set(species.id, mesh);
      this.scene.add(mesh);
    }

    // Aloft flocks (Wildlife-1) — same config + combined seed, separate streaming/render.
    this._aloft = this._activeAloftSpecies.length ? new AloftWildlife(this.scene) : null;
    this._aloft?.load(cfg, this.seed, this._activeAloftSpecies);
  }

  update(dt, camera) {
    if (!this.enabled || !camera) return;
    camera.getWorldPosition(this._camPos);
    const camX = this._camPos.x;
    const camZ = this._camPos.z;
    if (this._activeSpecies.length > 0) {
      this._streamRegions(camX, camZ);
      this._simulate(dt, camX, camZ);
      this._render(camX, camZ);
    }
    this._aloft?.update(dt, camX, camZ);
  }

  // Build regions entering visibleDistance, drop regions leaving keepDistance
  // (hysteresis). Regions are sparse + cheap to build, so this is synchronous.
  _streamRegions(camX, camZ) {
    const size = this.cfg.regionSize;
    const halfDiag = size * 0.7072;
    const visSq = this.cfg.visibleDistance * this.cfg.visibleDistance;

    // Drop regions whose NEAREST corner is past keepDistance — the SAME halfDiag-
    // adjusted metric the add test below uses, so [visibleDistance, keepDistance] is a
    // clean hysteresis gap. (A raw center-distance keep with a large regionSize would
    // build-and-drop the same border region every frame.)
    for (const [key, region] of this.regions) {
      const near = Math.hypot(region.center.x - camX, region.center.z - camZ) - halfDiag;
      if (near > this.cfg.keepDistance) this.regions.delete(key);
    }

    const cx = Math.floor(camX / size);
    const cz = Math.floor(camZ / size);
    const r = Math.ceil(this.cfg.visibleDistance / size) + 1;
    let activeCount = this._countAnimals();

    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const rx = cx + dx;
        const rz = cz + dz;
        const key = rx + "," + rz;
        if (this.regions.has(key)) continue;

        const centerX = (rx + 0.5) * size;
        const centerZ = (rz + 0.5) * size;
        const dist = Math.hypot(centerX - camX, centerZ - camZ) - halfDiag;
        if (dist * dist > visSq && dist > 0) continue;
        if (activeCount >= MAX_ACTIVE_WILDLIFE) continue; // hard cap reached

        const animals = placeRegion(rx, rz, this.cfg, this.seed).map(spawnAnimal).filter(Boolean);
        this.regions.set(key, { animals, center: { x: centerX, z: centerZ } });
        activeCount += animals.length;
      }
    }
  }

  // Run the FSM only for regions within simulateDistance (LOD); far-but-active
  // regions keep their last pose.
  _simulate(dt, camX, camZ) {
    const simSq = this.cfg.simulateDistance * this.cfg.simulateDistance;
    for (const region of this.regions.values()) {
      const dx = region.center.x - camX;
      const dz = region.center.z - camZ;
      if (dx * dx + dz * dz > simSq) continue;
      for (const animal of region.animals) updateAnimal(animal, dt, camX, camZ);
    }
  }

  // Write instance matrices for animals within visibleDistance.
  _render(camX, camZ) {
    const counts = new Map();
    for (const species of this._activeSpecies) counts.set(species.id, 0);
    const visSq = this.cfg.visibleDistance * this.cfg.visibleDistance;

    for (const region of this.regions.values()) {
      const dx = region.center.x - camX;
      const dz = region.center.z - camZ;
      if (dx * dx + dz * dz > visSq) continue;
      for (const animal of region.animals) {
        const mesh = this._meshes.get(animal.speciesId);
        if (!mesh) continue;
        const i = counts.get(animal.speciesId);
        if (i >= MAX_INSTANCES_PER_SPECIES) continue;
        const s = animal.species;
        this._pos.set(animal.x, animal.y + s.yOffset, animal.z);
        this._euler.set(0, animal.heading, 0);
        this._quat.setFromEuler(this._euler);
        this._scl.set(s.scale[0], s.scale[1], s.scale[2]);
        this._mat.compose(this._pos, this._quat, this._scl);
        mesh.setMatrixAt(i, this._mat);
        counts.set(animal.speciesId, i + 1);
      }
    }

    let rendered = 0;
    for (const [id, mesh] of this._meshes) {
      const n = counts.get(id) ?? 0;
      mesh.count = n; // only the first n instances draw
      mesh.instanceMatrix.needsUpdate = true;
      rendered += n;
    }

    this.stats.activeRegions = this.regions.size;
    this.stats.activeAnimals = this._countAnimals();
    this.stats.renderedInstances = rendered;
  }

  _countAnimals() {
    let n = 0;
    for (const region of this.regions.values()) n += region.animals.length;
    return n;
  }

  // Synchronously fill + render the nearby regions once (used at load/reveal).
  prewarm(camera) {
    if (!this.enabled || !camera) return;
    camera.getWorldPosition(this._camPos);
    const camX = this._camPos.x;
    const camZ = this._camPos.z;
    if (this._activeSpecies.length > 0) {
      this._streamRegions(camX, camZ);
      this._render(camX, camZ);
    }
    this._aloft?.prewarm(camX, camZ);
  }

  // Dev/test observability — samples grounded-contract violations for the proof.
  debugSnapshot() {
    let groundedFloating = 0;
    let groundedSubmerged = 0;
    let aboveSnowline = 0;
    const profile = getActiveTerrainProfile();
    for (const region of this.regions.values()) {
      for (const animal of region.animals) {
        if (animal.species.groundContract !== "support") continue;
        const gh = getHeight(animal.x, animal.z);
        if (Math.abs(animal.y - gh) > 0.05) groundedFloating++;
        if (gh < getWaterLevel(animal.x, animal.z)) groundedSubmerged++;
        if (gh > profile.snowlineAt(animal.x, animal.z)) aboveSnowline++;
      }
    }
    return {
      present: true,
      enabled: this.enabled,
      seed: this.seed,
      activeRegions: this.regions.size,
      activeAnimals: this.stats.activeAnimals,
      renderedInstances: this.stats.renderedInstances,
      instancedMeshes: this._meshes.size,
      species: this._activeSpecies.map((s) => s.id),
      groundedFloating,
      groundedSubmerged,
      aboveSnowline,
      flocks: this._aloft?.flockSnapshot() ?? { present: false },
    };
  }

  dispose() {
    this._aloft?.dispose();
    this._aloft = null;
    for (const mesh of this._meshes.values()) {
      this.scene?.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this._meshes.clear();
    this.regions.clear();
    this._activeSpecies = [];
    this._activeAloftSpecies = [];
    this.enabled = false;
    this.stats = emptyStats();
  }
}

function emptyStats() {
  return { activeRegions: 0, activeAnimals: 0, renderedInstances: 0 };
}

function numOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

// One primitive silhouette per species, laid horizontal (length along Z = forward)
// so the per-instance yaw orients the body in its heading; yOffset rests it on ground.
function buildSpeciesGeometry(species) {
  const g = species.geometry;
  let geo;
  if (g.shape === "cone") {
    geo = new THREE.ConeGeometry(g.radius, g.length, 6);
  } else {
    geo = new THREE.CapsuleGeometry(g.radius, g.length, 3, 8);
  }
  geo.rotateX(Math.PI / 2); // stand the length axis along Z (forward)
  return geo;
}
