import * as THREE from "three";
import { getHeight } from "../../terrain/terrainSampling.js";

const STONE = new THREE.MeshStandardMaterial({ color: 0x63717a, roughness: 0.94, metalness: 0.02 });
const ICE = new THREE.MeshStandardMaterial({ color: 0x89c8d8, emissive: 0x214b59, emissiveIntensity: 0.32, roughness: 0.35, transparent: true, opacity: 0.88 });

export function buildSliceLandmarks({ spawn, relic, cache }) {
  const root = new THREE.Group();
  root.name = "FrozenCacheLandmarks";

  const route = [
    pointBetween(spawn, relic, 0.18, 5),
    pointBetween(spawn, relic, 0.58, -4),
    pointBetween(relic, cache, 0.58, 5),
  ];
  root.add(buildOverlook(route[0]));
  root.add(buildRuin(route[1]));
  root.add(buildPass(route[2]));
  return root;
}

function pointBetween(a, b, t, side = 0) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: a.x + dx * t + (-dz / len) * side, z: a.z + dz * t + (dx / len) * side };
}

function buildOverlook(p) {
  const g = landmark("SliceLandmarkOverlook", p);
  for (const x of [-1.8, 1.8]) {
    const pillar = mesh(new THREE.BoxGeometry(0.65, 3.4, 0.65), STONE);
    pillar.position.set(x, 1.7, 0);
    pillar.rotation.z = x < 0 ? -0.08 : 0.08;
    g.add(pillar);
  }
  const lintel = mesh(new THREE.BoxGeometry(4.4, 0.55, 0.7), STONE);
  lintel.position.y = 3.35;
  g.add(lintel);
  return g;
}

function buildRuin(p) {
  const g = landmark("SliceLandmarkRuin", p);
  for (let i = 0; i < 5; i++) {
    const stone = mesh(new THREE.DodecahedronGeometry(0.55 + i * 0.08, 0), STONE);
    stone.position.set(Math.cos(i * 2.1) * 1.7, 0.45 + (i % 2) * 0.25, Math.sin(i * 2.1) * 1.7);
    stone.rotation.set(i * 0.31, i * 0.73, 0);
    g.add(stone);
  }
  const shard = mesh(new THREE.OctahedronGeometry(0.48), ICE);
  shard.position.y = 1.2;
  shard.scale.y = 2.4;
  g.add(shard);
  return g;
}

function buildPass(p) {
  const g = landmark("SliceLandmarkPass", p);
  for (const x of [-2.2, 2.2]) {
    const shard = mesh(new THREE.ConeGeometry(1.15, 4.8, 5), ICE);
    shard.position.set(x, 2.2, 0);
    shard.rotation.z = x < 0 ? -0.18 : 0.18;
    g.add(shard);
  }
  return g;
}

function landmark(name, p) {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(p.x, getHeight(p.x, p.z), p.z);
  return g;
}

function mesh(geometry, material) {
  const object = new THREE.Mesh(geometry, material.clone());
  object.castShadow = true;
  object.receiveShadow = true;
  return object;
}

export function disposeSliceLandmarks(root) {
  if (!root) return;
  root.removeFromParent();
  root.traverse((node) => {
    node.geometry?.dispose?.();
    node.material?.dispose?.();
  });
}
