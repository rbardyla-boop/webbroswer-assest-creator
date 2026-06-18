// Ambient micro-actor system (Ambient-0) — the THIRD streamed runtime consumer of the
// shared RegionStreamer (after grounded WildlifeSystem + aloft AloftWildlife). It owns its
// OWN RegionStreamer instance with its OWN budget (MAX_ACTIVE_MOTES); the per-mote drift +
// instanced render are local. The streamer is REUSED, never copied or mutated — this file
// re-implements none of the region keep/drop/build math of its own.

import * as THREE from "three";
import { createAmbientConfig } from "./AmbientConfig.js";
import { AMBIENT_SPECIES } from "./AmbientSpecies.js";
import { placeRegion } from "./AmbientPlacement.js";
import { spawnMote, updateMote } from "./AmbientRuntime.js";
import { buildMoteGeometry, buildMoteMaterial } from "./AmbientMaterial.js";
import { RegionStreamer } from "../streaming/RegionStreamer.js";
import { getHeight, getWaterLevel, getActiveTerrainProfile } from "../../terrain/terrainSampling.js";

const MAX_INSTANCES_PER_SPECIES = 4096; // InstancedMesh capacity per mote species
const MAX_ACTIVE_MOTES = 2000; // hard ceiling on live motes (separate from the wildlife budgets)

export class AmbientSystem {
  constructor(scene) {
    this.scene = scene;
    this.cfg = null;
    this.seed = 0;
    this.enabled = false;
    this.regions = new Map(); // "rx,rz" -> { motes: [], center: {x,z} } (repointed to the streamer's Map in load)
    this._streamer = null;
    this._meshes = new Map(); // speciesId -> THREE.InstancedMesh
    this._activeSpecies = [];
    this._wind = { x: 0, z: 0 };

    this._camPos = new THREE.Vector3();
    this._mat = new THREE.Matrix4();
    this._pos = new THREE.Vector3();
    this._quat = new THREE.Quaternion(); // identity — motes are view-independent
    this._scl = new THREE.Vector3();

    this.stats = emptyStats();
  }

  // Build the per-species instanced meshes + the region streamer from the document's
  // ambient block. A disabled/empty config is a pure no-op — never touches the scene.
  load(document, scene = this.scene) {
    this.dispose();
    this.scene = scene;
    const cfg = createAmbientConfig(document?.ambient ?? {});
    this.cfg = cfg;
    this.enabled = cfg.enabled !== false;
    this.seed = (Math.floor(numOr(document?.terrain?.seed, 0)) ^ Math.floor(numOr(cfg.seed, 0))) | 0;
    this._activeSpecies = AMBIENT_SPECIES.filter((s) => s.enabled && cfg.species?.[s.id]?.enabled !== false);
    if (!this.enabled || this._activeSpecies.length === 0) return;

    this._wind = { x: Math.cos(cfg.wind.angle) * cfg.wind.strength, z: Math.sin(cfg.wind.angle) * cfg.wind.strength };

    for (const species of this._activeSpecies) {
      const geo = buildMoteGeometry(species);
      const mat = buildMoteMaterial(species);
      const mesh = new THREE.InstancedMesh(geo, mat, MAX_INSTANCES_PER_SPECIES);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false; // culled by region distance instead
      mesh.castShadow = false;
      mesh.receiveShadow = false; // self-lit specks
      mesh.count = 0;
      mesh.name = `Ambient_${species.id}`;
      this._meshes.set(species.id, mesh);
      this.scene.add(mesh);
    }

    // Region streaming + active-mote budget via the SHARED streamer (own instance + budget).
    this._streamer = new RegionStreamer({
      getRegionSize: () => this.cfg.regionSize,
      getVisibleDistance: () => this.cfg.visibleDistance,
      getKeepDistance: () => this.cfg.keepDistance,
      maxItems: MAX_ACTIVE_MOTES,
      buildRegion: (rx, rz, cx, cz) => ({
        motes: placeRegion(rx, rz, this.cfg, this.seed).map(spawnMote).filter(Boolean),
        center: { x: cx, z: cz },
      }),
      countItems: (region) => region.motes.length,
    });
    this.regions = this._streamer.regions;
  }

  update(dt, camera) {
    if (!this.enabled || this._activeSpecies.length === 0 || !camera) return;
    camera.getWorldPosition(this._camPos);
    const camX = this._camPos.x;
    const camZ = this._camPos.z;
    this._streamer?.update(camX, camZ);
    this._simulate(dt, camX, camZ);
    this._render(camX, camZ);
  }

  prewarm(camera) {
    if (!this.enabled || this._activeSpecies.length === 0 || !camera) return;
    camera.getWorldPosition(this._camPos);
    this._streamer?.update(this._camPos.x, this._camPos.z);
    this._render(this._camPos.x, this._camPos.z);
  }

  // Run the drift only for regions within simulateDistance (LOD); far-but-active regions
  // hold their last pose. Raw-centre distance gate (same as the wildlife systems).
  _simulate(dt, camX, camZ) {
    const simSq = this.cfg.simulateDistance * this.cfg.simulateDistance;
    for (const region of this.regions.values()) {
      const dx = region.center.x - camX;
      const dz = region.center.z - camZ;
      if (dx * dx + dz * dz > simSq) continue;
      for (const mote of region.motes) updateMote(mote, dt, this._wind, camX, camZ);
    }
  }

  // Write instance matrices for motes within visibleDistance. Any mote with a non-finite
  // position OR scale is SKIPPED (a NaN matrix would log a console error and red the proof).
  _render(camX, camZ) {
    const counts = new Map();
    for (const species of this._activeSpecies) counts.set(species.id, 0);
    const visSq = this.cfg.visibleDistance * this.cfg.visibleDistance;

    for (const region of this.regions.values()) {
      const dx = region.center.x - camX;
      const dz = region.center.z - camZ;
      if (dx * dx + dz * dz > visSq) continue;
      for (const mote of region.motes) {
        const mesh = this._meshes.get(mote.speciesId);
        if (!mesh) continue;
        let i = counts.get(mote.speciesId);
        if (i >= MAX_INSTANCES_PER_SPECIES) continue;
        if (!Number.isFinite(mote.x) || !Number.isFinite(mote.y) || !Number.isFinite(mote.z) || !(mote.scale > 0)) continue;
        this._pos.set(mote.x, mote.y, mote.z);
        this._scl.set(mote.scale, mote.scale, mote.scale);
        this._mat.compose(this._pos, this._quat, this._scl);
        mesh.setMatrixAt(i, this._mat);
        counts.set(mote.speciesId, i + 1);
      }
    }

    let rendered = 0;
    for (const [id, mesh] of this._meshes) {
      const n = counts.get(id) ?? 0;
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      rendered += n;
    }

    this.stats.activeRegions = this.regions.size;
    this.stats.activeMotes = this._countMotes();
    this.stats.renderedInstances = rendered;
  }

  _countMotes() {
    return this._streamer ? this._streamer.itemCount() : 0;
  }

  // Dev/test observability — samples hover-contract violations (expected 0 everywhere).
  debugSnapshot() {
    let motesBelowGround = 0;
    let motesInWater = 0;
    let motesAboveSnowline = 0;
    const profile = getActiveTerrainProfile();
    for (const region of this.regions.values()) {
      for (const mote of region.motes) {
        if (mote.y < getHeight(mote.x, mote.z) - 1e-6) motesBelowGround++;
        if (mote.y <= getWaterLevel(mote.x, mote.z)) motesInWater++;
        if (getHeight(mote.x, mote.z) > profile.snowlineAt(mote.x, mote.z)) motesAboveSnowline++;
      }
    }
    return {
      present: true,
      enabled: this.enabled,
      seed: this.seed,
      activeRegions: this.regions.size,
      activeMotes: this.stats.activeMotes,
      renderedInstances: this.stats.renderedInstances,
      instancedMeshes: this._meshes.size,
      species: this._activeSpecies.map((s) => s.id),
      motesBelowGround,
      motesInWater,
      motesAboveSnowline,
    };
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
    this.regions = new Map();
    this._activeSpecies = [];
    this.enabled = false;
    this.stats = emptyStats();
  }
}

function emptyStats() {
  return { activeRegions: 0, activeMotes: 0, renderedInstances: 0 };
}

function numOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}
