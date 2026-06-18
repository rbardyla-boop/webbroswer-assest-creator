// Aloft-flock streaming + instanced render — the sky-life analog of WildlifeSystem, owned
// INTERNALLY by it (so the world's single `wildlife` handle and main.js stay untouched).
//
// The region-streaming skeleton (Map keyed "rx,rz", halfDiag nearest-corner keep/drop
// hysteresis, simulate-LOD, mesh.count draw-gate) is COPIED from WildlifeSystem rather than
// extracted: the grounded streaming is proven and must not be perturbed, and the payloads
// differ (flocks vs animals, per-flock vs per-animal FSM). TODO(Wildlife-2): extract a
// shared RegionStreamer if a third streamed species type ever appears.

import * as THREE from "three";
import { WILDLIFE_SPECIES } from "./WildlifeSpecies.js";
import { placeFlockRegion } from "./FlockPlacement.js";
import { spawnFlock, updateFlock } from "./FlockRuntime.js";
import { getHeight, getWaterLevel } from "../../terrain/terrainSampling.js";

const MAX_INSTANCES_PER_FLOCK_SPECIES = 2048; // InstancedMesh capacity per aloft species
const MAX_ACTIVE_FLOCK_BIRDS = 1500; // hard ceiling on live birds (separate from the grounded budget)
const HALF_PI = Math.PI / 2;

export class AloftWildlife {
  constructor(scene) {
    this.scene = scene;
    this.cfg = null;
    this.seed = 0;
    this.species = []; // active aloft species rows
    this.regions = new Map(); // "rx,rz" -> { flocks: [], center: {x,z} }
    this._meshes = new Map(); // speciesId -> THREE.InstancedMesh

    this._mat = new THREE.Matrix4();
    this._pos = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._euler = new THREE.Euler();
    this._scl = new THREE.Vector3();

    this.stats = emptyStats();
  }

  // Build one instanced mesh per active aloft species. Receives the already-resolved
  // cfg/seed/species from the owner (one config read). No-op (no scene touch) when empty.
  load(cfg, seed, activeAloftSpecies) {
    this.dispose();
    this.cfg = cfg;
    this.seed = seed | 0;
    this.species = activeAloftSpecies ?? [];
    if (!cfg || this.species.length === 0) return;

    for (const species of this.species) {
      const geo = buildVWingGeometry(species);
      const mat = new THREE.MeshStandardMaterial({
        color: species.color,
        roughness: 0.7,
        metalness: 0,
        side: THREE.DoubleSide, // thin chevron — visible from above and below
      });
      const mesh = new THREE.InstancedMesh(geo, mat, MAX_INSTANCES_PER_FLOCK_SPECIES);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false; // culled by region distance instead
      mesh.castShadow = false;
      mesh.receiveShadow = false; // aloft — no shadow exchange
      mesh.count = 0;
      mesh.name = `Flock_${species.id}`;
      this._meshes.set(species.id, mesh);
      this.scene.add(mesh);
    }
  }

  update(dt, camX, camZ) {
    if (this.species.length === 0) return;
    this._streamRegions(camX, camZ);
    this._simulate(dt, camX, camZ);
    this._render(camX, camZ);
  }

  prewarm(camX, camZ) {
    if (this.species.length === 0) return;
    this._streamRegions(camX, camZ);
    this._render(camX, camZ);
  }

  // Build regions entering visibleDistance, drop regions leaving keepDistance — the SAME
  // halfDiag nearest-corner metric WildlifeSystem uses, so [visible, keep] is a clean gap.
  _streamRegions(camX, camZ) {
    const size = this.cfg.regionSize;
    const halfDiag = size * 0.7072;
    const visSq = this.cfg.visibleDistance * this.cfg.visibleDistance;

    for (const [key, region] of this.regions) {
      const near = Math.hypot(region.center.x - camX, region.center.z - camZ) - halfDiag;
      if (near > this.cfg.keepDistance) this.regions.delete(key);
    }

    const cx = Math.floor(camX / size);
    const cz = Math.floor(camZ / size);
    const r = Math.ceil(this.cfg.visibleDistance / size) + 1;
    let activeBirds = this._countBirds();

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
        if (activeBirds >= MAX_ACTIVE_FLOCK_BIRDS) continue;

        const flocks = placeFlockRegion(rx, rz, this.cfg, this.seed).map(spawnFlock).filter(Boolean);
        this.regions.set(key, { flocks, center: { x: centerX, z: centerZ } });
        for (const f of flocks) activeBirds += f.members.length;
      }
    }
  }

  // Run the flock FSM only within simulateDistance (LOD); far-but-active flocks hold pose.
  _simulate(dt, camX, camZ) {
    const simSq = this.cfg.simulateDistance * this.cfg.simulateDistance;
    for (const region of this.regions.values()) {
      const dx = region.center.x - camX;
      const dz = region.center.z - camZ;
      if (dx * dx + dz * dz > simSq) continue;
      for (const flock of region.flocks) updateFlock(flock, dt, camX, camZ);
    }
  }

  // Write instance matrices for flock members within visibleDistance. Any member with a
  // non-finite position is SKIPPED (a NaN matrix would log a console error that reds the
  // whole proof suite) — the structural finite-guards make this defence-in-depth.
  _render(camX, camZ) {
    const counts = new Map();
    for (const species of this.species) counts.set(species.id, 0);
    const visSq = this.cfg.visibleDistance * this.cfg.visibleDistance;

    for (const region of this.regions.values()) {
      const dx = region.center.x - camX;
      const dz = region.center.z - camZ;
      if (dx * dx + dz * dz > visSq) continue;
      for (const flock of region.flocks) {
        const mesh = this._meshes.get(flock.speciesId);
        if (!mesh) continue;
        const s = flock.species;
        this._euler.set(0, HALF_PI - flock.heading, 0); // nose along travel; shared per flock
        this._quat.setFromEuler(this._euler);
        this._scl.set(s.scale[0], s.scale[1], s.scale[2]);
        for (const m of flock.members) {
          let i = counts.get(flock.speciesId);
          if (i >= MAX_INSTANCES_PER_FLOCK_SPECIES) break;
          if (!Number.isFinite(m.x) || !Number.isFinite(m.y) || !Number.isFinite(m.z)) continue;
          this._pos.set(m.x, m.y, m.z);
          this._mat.compose(this._pos, this._quat, this._scl);
          mesh.setMatrixAt(i, this._mat);
          counts.set(flock.speciesId, i + 1);
        }
      }
    }

    let rendered = 0;
    for (const [id, mesh] of this._meshes) {
      const n = counts.get(id) ?? 0;
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      rendered += n;
    }

    this.stats.activeFlocks = this._countFlocks();
    this.stats.renderedInstances = rendered;
  }

  _countBirds() {
    let n = 0;
    for (const region of this.regions.values()) for (const f of region.flocks) n += f.members.length;
    return n;
  }

  _countFlocks() {
    let n = 0;
    for (const region of this.regions.values()) n += region.flocks.length;
    return n;
  }

  // Dev/test observability — samples aloft-contract violations (expected 0 everywhere).
  flockSnapshot() {
    let birdsBelowTerrain = 0;
    let birdsInWater = 0;
    let birds = 0;
    for (const region of this.regions.values()) {
      for (const flock of region.flocks) {
        for (const m of flock.members) {
          birds++;
          if (m.y < getHeight(m.x, m.z) - 1e-6) birdsBelowTerrain++;
          if (m.y <= getWaterLevel(m.x, m.z)) birdsInWater++;
        }
      }
    }
    return {
      present: true,
      activeFlocks: this._countFlocks(),
      activeBirds: birds,
      renderedInstances: this.stats.renderedInstances,
      instancedMeshes: this._meshes.size,
      species: this.species.map((s) => s.id),
      birdsBelowTerrain,
      birdsInWater,
    };
  }

  dispose() {
    for (const mesh of this._meshes.values()) {
      this.scene?.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this._meshes.clear();
    this.regions.clear();
    this.species = [];
    this.stats = emptyStats();
  }
}

function emptyStats() {
  return { activeFlocks: 0, renderedInstances: 0 };
}

// A shallow gull-V chevron: two triangles sharing the body→tail spine, nose at +Z
// (forward), wingtips swept back with a slight upward dihedral. DoubleSide so winding is
// irrelevant. Reads as a "bird" silhouette at altitude far better than a cone.
function buildVWingGeometry(species) {
  const g = species.geometry;
  const sx = (g.span ?? 1.2) * 0.5;
  const cz = (g.chord ?? 0.5) * 0.5;
  const ty = (g.span ?? 1.2) * 0.12; // dihedral lift at the wingtips
  // B = body/nose (+Z), M = tail notch (-Z), L/R = wingtips (swept back + up)
  const B = [0, 0, cz];
  const M = [0, 0, -cz * 0.35];
  const L = [-sx, ty, -cz];
  const R = [sx, ty, -cz];
  const verts = new Float32Array([
    ...L, ...B, ...M, // left wing
    ...B, ...R, ...M, // right wing
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  return geo;
}
