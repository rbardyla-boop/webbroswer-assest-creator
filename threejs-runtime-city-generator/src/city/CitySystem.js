import * as THREE from "three";
import { createCityConfig, getZoneStyle } from "./CityConfig.js";
import { generateCityDocument, getZoneAt } from "./CityGenerator.js";
import { normalizeCityDocument, saveCityDocument, loadCityDocument } from "./CityDocument.js";
import { CityChunk, disposeSharedCityResources } from "./CityChunk.js";
import { createZoneLabelSprite } from "./CityLabels.js";

export class CitySystem {
  constructor(scene, config = {}) {
    this.scene = scene;
    this.cfg = createCityConfig(config);
    this.document = null;
    this.chunks = new Map();
    this.labels = [];
    this.group = new THREE.Group();
    this.group.name = "RuntimeCityGenerator";
    scene.add(this.group);

    this._projScreen = new THREE.Matrix4();
    this._frustum = new THREE.Frustum();
    this._camPos = new THREE.Vector3();
    this._playerPos = new THREE.Vector3();

    this.stats = {
      seed: this.cfg.seed,
      style: this.cfg.style,
      styleLabel: "",
      zones: 0,
      visibleChunks: 0,
      activeChunks: 0,
      buildings: 0,
      props: 0,
      roads: 0,
      sidewalks: 0,
      nearestZone: "Wilderness",
      drawCallsEstimate: 0,
      savedBytes: 0,
      loaded: false,
    };

    this.regenerate({ seed: this.cfg.seed, style: this.cfg.style });
  }

  regenerate({ seed = this.cfg.seed, style = this.cfg.style } = {}) {
    this.cfg.seed = String(seed || "showcase-001");
    this.cfg.style = style || "showcase";
    const doc = generateCityDocument(this.cfg);
    this.loadDocument(doc);
    return doc;
  }

  loadDocument(doc) {
    const normalized = normalizeCityDocument(doc);
    this._clear();
    this.document = normalized;
    this.cfg.seed = normalized.seed;
    this.cfg.style = normalized.style;

    for (const chunkData of normalized.layout.chunks) {
      const chunk = new CityChunk(chunkData, this.cfg);
      this.chunks.set(chunkData.id, chunk);
      this.group.add(chunk.group);
    }

    for (const zone of normalized.layout.zones) {
      const label = createZoneLabelSprite(zone);
      this.labels.push(label);
      this.group.add(label);
    }

    this._syncStatsBase();
    this.stats.loaded = true;
  }

  save(storage = globalThis.localStorage) {
    const bytes = saveCityDocument(this.document, storage, this.cfg.storageKey);
    this.stats.savedBytes = bytes;
    return bytes;
  }

  loadSaved(storage = globalThis.localStorage) {
    const doc = loadCityDocument(storage, this.cfg.storageKey);
    if (!doc) return false;
    this.loadDocument(doc);
    return true;
  }

  update(camera, playerPosition, elapsed = 0) {
    if (!this.document) return;
    camera.getWorldPosition(this._camPos);
    this._playerPos.copy(playerPosition || this._camPos);
    this._frustum.setFromProjectionMatrix(
      this._projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    );

    let visibleChunks = 0;
    let estimatedDraws = 0;
    const visSq = this.cfg.visibleDistance * this.cfg.visibleDistance;
    const [l0, l1] = this.cfg.lodDistances;

    for (const chunk of this.chunks.values()) {
      const dx = chunk.center.x - this._camPos.x;
      const dz = chunk.center.z - this._camPos.z;
      const distSq = dx * dx + dz * dz;
      const visible = distSq <= visSq && this._frustum.intersectsSphere(chunk.boundingSphere);
      chunk.setVisible(visible);
      if (!visible) continue;

      const dist = Math.sqrt(distSq);
      const lod = dist < l0 ? 0 : dist < l1 ? 1 : 2;
      chunk.setLOD(lod);
      visibleChunks++;
      // One draw per visible non-empty category mesh; props/zones hidden at far LOD.
      // Avoid Array.filter here; this runs every frame.
      estimatedDraws += chunk.visibleDrawCount;
    }

    for (const label of this.labels) {
      const dx = label.position.x - this._camPos.x;
      const dz = label.position.z - this._camPos.z;
      const distSq = dx * dx + dz * dz;
      label.visible = distSq < this.cfg.labelDistance * this.cfg.labelDistance;
      if (label.visible && this.cfg.animateZonePulse) {
        const s = 1 + Math.sin(elapsed * 1.6 + label.position.x * 0.03) * 0.035;
        label.scale.set(26 * s, 8.125 * s, 1);
      }
    }

    const zone = getZoneAt(this.document.layout, this._playerPos.x, this._playerPos.z);
    this.stats.visibleChunks = visibleChunks;
    this.stats.activeChunks = this.chunks.size;
    this.stats.nearestZone = zone ? `${getZoneStyle(zone.type).label}: ${zone.label}` : "Wilderness / Grassland";
    this.stats.drawCallsEstimate = estimatedDraws;
  }

  _syncStatsBase() {
    const layout = this.document.layout;
    this.stats.seed = this.document.seed;
    this.stats.style = this.document.style;
    this.stats.styleLabel = layout.presetLabel;
    this.stats.zones = layout.stats.zones;
    this.stats.roads = layout.stats.roads;
    this.stats.sidewalks = layout.stats.sidewalks;
    this.stats.buildings = layout.stats.buildings;
    this.stats.props = layout.stats.props;
    this.stats.activeChunks = layout.stats.chunks;
  }

  _clear() {
    for (const chunk of this.chunks.values()) {
      this.group.remove(chunk.group);
      chunk.dispose();
    }
    this.chunks.clear();
    for (const label of this.labels) {
      this.group.remove(label);
      label.userData.dispose?.();
    }
    this.labels.length = 0;
  }

  dispose() {
    this._clear();
    this.scene.remove(this.group);
    disposeSharedCityResources();
  }
}
