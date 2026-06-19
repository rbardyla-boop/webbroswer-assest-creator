// Aloft-flock streaming + instanced render — the sky-life analog of WildlifeSystem, owned
// INTERNALLY by it (so the world's single `wildlife` handle and main.js stay untouched).
//
// Region keep/drop/build + the active-bird budget come from the shared `RegionStreamer`
// (Wildlife-2 extraction); the budget UNIT here is BIRDS (Σ flock.members), not flocks. The
// per-flock simulate/render bodies (FSM, mesh.count draw-gate, finite-guards) stay local
// because they differ from the grounded per-animal path.

import * as THREE from "three";
import { WILDLIFE_SPECIES } from "./WildlifeSpecies.js";
import { placeFlockRegion } from "./FlockPlacement.js";
import { spawnFlock, updateFlock } from "./FlockRuntime.js";
import { RegionStreamer } from "../streaming/RegionStreamer.js";
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
    this.regions = new Map(); // "rx,rz" -> { flocks: [], center: {x,z} } (repointed to the streamer's Map in load)
    this._streamer = null; // RegionStreamer — owns region keep/drop/build + the active-bird budget
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

    // Region streaming + active-bird budget (shared mechanics; per-flock sim/render below).
    // Same nearest-corner metric as the grounded system; the budget unit here is BIRDS
    // (Σ flock.members), not flocks.
    this._streamer = new RegionStreamer({
      getRegionSize: () => this.cfg.regionSize,
      getVisibleDistance: () => this.cfg.visibleDistance,
      getKeepDistance: () => this.cfg.keepDistance,
      maxItems: MAX_ACTIVE_FLOCK_BIRDS,
      buildRegion: (rx, rz, cx, cz) => ({
        flocks: placeFlockRegion(rx, rz, this.cfg, this.seed).map(spawnFlock).filter(Boolean),
        center: { x: cx, z: cz },
      }),
      countItems: (region) => {
        let n = 0;
        for (const f of region.flocks) n += f.members.length;
        return n;
      },
    });
    this.regions = this._streamer.regions; // same Map instance → sim/render/debug reads unchanged
  }

  update(dt, camX, camZ) {
    if (this.species.length === 0) return;
    this._streamer?.update(camX, camZ);
    this._simulate(dt, camX, camZ);
    this._render(camX, camZ);
  }

  prewarm(camX, camZ) {
    if (this.species.length === 0) return;
    this._streamer?.update(camX, camZ);
    this._render(camX, camZ);
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
    return this._streamer ? this._streamer.itemCount() : 0;
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

  // Editor view toggle (Editor UX-1): show/hide the flock meshes. Pure render flag.
  setVisible(visible) {
    for (const mesh of this._meshes.values()) mesh.visible = visible;
  }

  dispose() {
    for (const mesh of this._meshes.values()) {
      this.scene?.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this._meshes.clear();
    this._streamer?.clear();
    this._streamer = null;
    this.regions = new Map(); // fresh empty Map (don't dangle a reference to the disposed streamer's)
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
