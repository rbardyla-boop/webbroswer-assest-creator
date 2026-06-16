import * as THREE from "three";
import { getHeight } from "../terrain/terrainSampling.js";
import { getZoneStyle } from "./CityConfig.js";

const matrix = new THREE.Matrix4();
const pos = new THREE.Vector3();
const quat = new THREE.Quaternion();
const scl = new THREE.Vector3();
const euler = new THREE.Euler(0, 0, 0, "YXZ");
const color = new THREE.Color();

function makeMaterial(colorHex, options = {}) {
  return new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: options.roughness ?? 0.92,
    metalness: options.metalness ?? 0.02,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
  });
}

const shared = {
  box: null,
  zoneMaterial: null,
  roadMaterial: null,
  sidewalkMaterial: null,
  runwayMaterial: null,
  buildingMaterial: null,
  propMaterial: null,
};

function ensureShared() {
  if (shared.box) return shared;
  shared.box = new THREE.BoxGeometry(1, 1, 1);
  shared.zoneMaterial = makeMaterial(0xffffff, { transparent: true, opacity: 0.48, roughness: 1 });
  shared.roadMaterial = makeMaterial(0x2c3034, { roughness: 0.98 });
  shared.sidewalkMaterial = makeMaterial(0xb8b0a3, { roughness: 0.98 });
  shared.runwayMaterial = makeMaterial(0x273038, { roughness: 0.98 });
  shared.buildingMaterial = makeMaterial(0xffffff, { roughness: 0.72, metalness: 0.04 });
  shared.propMaterial = makeMaterial(0xffffff, { roughness: 0.82 });
  return shared;
}

export function disposeSharedCityResources() {
  if (!shared.box) return;
  shared.box.dispose();
  shared.zoneMaterial.dispose();
  shared.roadMaterial.dispose();
  shared.sidewalkMaterial.dispose();
  shared.runwayMaterial.dispose();
  shared.buildingMaterial.dispose();
  shared.propMaterial.dispose();
  shared.box = null;
}

export class CityChunk {
  constructor(chunkData, cfg) {
    this.data = chunkData;
    this.cfg = cfg;
    this.visible = true;
    this.lod = 0;
    this.center = new THREE.Vector3(chunkData.center.x, getHeight(chunkData.center.x, chunkData.center.z) + 8, chunkData.center.z);
    this.boundingSphere = new THREE.Sphere(this.center.clone(), cfg.chunkSize * 0.88);
    this.group = new THREE.Group();
    this.group.name = `CityChunk_${chunkData.id}`;
    this.meshes = [];
    this._build();
  }

  _build() {
    const s = ensureShared();
    const chunk = this.data;
    this._zones = this._buildZones(s, chunk.zones);
    this._roads = this._buildFlat(s.box, s.roadMaterial, chunk.roads.filter((r) => r.kind !== "runway"), 0.08, 0x2c3034, "roads");
    this._runways = this._buildFlat(s.box, s.runwayMaterial, chunk.roads.filter((r) => r.kind === "runway"), 0.1, 0x273038, "runways");
    this._sidewalks = this._buildFlat(s.box, s.sidewalkMaterial, chunk.sidewalks, 0.12, 0xb8b0a3, "sidewalks");
    this._buildings = this._buildBuildings(s, chunk.buildings);
    this._props = this._buildProps(s, chunk.props);
  }

  _addMesh(mesh, { castShadow = true, receiveShadow = true } = {}) {
    if (!mesh) return null;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.frustumCulled = false; // chunk-level sphere culling owns visibility
    this.group.add(mesh);
    this.meshes.push(mesh);
    return mesh;
  }

  _buildZones(s, zones) {
    if (!zones.length) return null;
    const mesh = new THREE.InstancedMesh(s.box, s.zoneMaterial, zones.length);
    mesh.name = `${this.group.name}_zones`;
    zones.forEach((zone, i) => {
      const h = getHeight(zone.x, zone.z) + 0.015;
      setBoxMatrix(mesh, i, zone.x, h, zone.z, zone.w, 0.03, zone.d, zone.yaw || 0);
      color.setHex(getZoneStyle(zone.type).color);
      mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return this._addMesh(mesh, { castShadow: false, receiveShadow: false });
  }

  _buildFlat(geo, material, items, ySize, fallbackColor, name) {
    if (!items.length) return null;
    const mesh = new THREE.InstancedMesh(geo, material, items.length);
    mesh.name = `${this.group.name}_${name}`;
    items.forEach((item, i) => {
      const h = getHeight(item.x, item.z) + ySize * 0.5 + 0.02;
      setBoxMatrix(mesh, i, item.x, h, item.z, item.w, ySize, item.d, item.yaw || 0);
      mesh.setColorAt(i, color.setHex(fallbackColor));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return this._addMesh(mesh, { castShadow: false, receiveShadow: true });
  }

  _buildBuildings(s, buildings) {
    if (!buildings.length) return null;
    const mesh = new THREE.InstancedMesh(s.box, s.buildingMaterial, buildings.length);
    mesh.name = `${this.group.name}_buildings`;
    buildings.forEach((b, i) => {
      const ground = getHeight(b.x, b.z);
      setBoxMatrix(mesh, i, b.x, ground + b.h * 0.5, b.z, b.w, b.h, b.d, b.yaw || 0);
      const style = getZoneStyle(b.type);
      color.setHex(style.buildingColor).lerp(new THREE.Color(0xffffff), 0.08 + b.tint * 0.14);
      mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return this._addMesh(mesh);
  }

  _buildProps(s, props) {
    if (!props.length) return null;
    const mesh = new THREE.InstancedMesh(s.box, s.propMaterial, props.length);
    mesh.name = `${this.group.name}_props`;
    props.forEach((p, i) => {
      const ground = getHeight(p.x, p.z);
      setBoxMatrix(mesh, i, p.x, ground + p.h * 0.5, p.z, p.w, p.h, p.d, p.yaw || 0);
      mesh.setColorAt(i, propColor(p.type));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return this._addMesh(mesh);
  }

  setVisible(v) {
    if (v === this.visible) return;
    this.visible = v;
    this.group.visible = v;
  }

  setLOD(level) {
    if (level === this.lod) return;
    this.lod = level;
    // LOD is deliberately cheap: far chunks hide detail props and translucent zones.
    if (this._props) this._props.visible = level < 2;
    if (this._zones) this._zones.visible = level < 2;
  }

  get visibleDrawCount() {
    let count = 0;
    for (const mesh of this.meshes) {
      if (mesh.visible !== false) count++;
    }
    return count;
  }

  dispose() {
    for (const mesh of this.meshes) mesh.dispose?.();
    this.group.clear();
    this.meshes.length = 0;
  }
}

function setBoxMatrix(mesh, i, x, y, z, w, h, d, yaw = 0) {
  pos.set(x, y, z);
  euler.set(0, yaw, 0);
  quat.setFromEuler(euler);
  scl.set(w, h, d);
  matrix.compose(pos, quat, scl);
  mesh.setMatrixAt(i, matrix);
}

function propColor(type) {
  switch (type) {
    case "tree": return color.setHex(0x4c8a3c);
    case "barrier": return color.setHex(0x5b6158);
    case "tower": return color.setHex(0x798178);
    case "dish": return color.setHex(0xaec8d3);
    case "derrick": return color.setHex(0xb47a32);
    case "tank": return color.setHex(0x786553);
    case "hangar": return color.setHex(0x8e9699);
    case "beacon": return color.setHex(0xe2b84c);
    default: return color.setHex(0x7f8d72);
  }
}
