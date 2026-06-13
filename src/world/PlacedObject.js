import * as THREE from "three";
import { defaultColliderForAsset, normalizeCollider } from "../physics/ColliderProxy.js";

export const PRIMITIVE_ASSETS = {
  cube: { label: "Cube", color: 0x8fc7ff },
  sphere: { label: "Sphere", color: 0xffc36e },
  cylinder: { label: "Cylinder", color: 0x90dda1 },
  plane: { label: "Plane", color: 0xd8e0ee },
  ramp: { label: "Ramp", color: 0xc69cff },
};

export function createPrimitiveMesh(kind) {
  const info = PRIMITIVE_ASSETS[kind] ?? PRIMITIVE_ASSETS.cube;
  let geometry;

  if (kind === "sphere") geometry = new THREE.SphereGeometry(1, 28, 18);
  else if (kind === "cylinder") geometry = new THREE.CylinderGeometry(0.8, 0.8, 1.6, 28);
  else if (kind === "plane") {
    geometry = new THREE.PlaneGeometry(2.4, 2.4);
    geometry.rotateX(-Math.PI / 2);
  } else if (kind === "ramp") geometry = createRampGeometry();
  else geometry = new THREE.BoxGeometry(1.8, 1.8, 1.8);

  const material = new THREE.MeshStandardMaterial({
    color: info.color,
    roughness: 0.82,
    metalness: 0.02,
    side: kind === "plane" ? THREE.DoubleSide : THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = info.label;
  return mesh;
}

export function createImageMesh(texture) {
  const geometry = new THREE.PlaneGeometry(4, 3);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.78,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "Image";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createMissingAssetMesh(label = "Missing Asset") {
  const group = new THREE.Group();
  group.name = label;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 1.8, 1.8),
    new THREE.MeshStandardMaterial({ color: 0xff4f6d, roughness: 0.8 })
  );
  mesh.position.y = 0.9;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

export function createPlacedObject({ id, asset, object3D, position, rotation, scale }) {
  const root = new THREE.Group();
  root.name = asset.name ?? "Placed Object";
  root.userData.editorObject = true;
  root.userData.objectId = id;
  root.userData.asset = asset;
  root.userData.collider = normalizeCollider(asset.collider ?? defaultColliderForAsset(asset));

  root.add(object3D);
  root.position.fromArray(position ?? [0, 0, 0]);
  root.rotation.fromArray(rotation ?? [0, 0, 0]);
  root.scale.fromArray(scale ?? [1, 1, 1]);

  return root;
}

function createRampGeometry() {
  const vertices = new Float32Array([
    -1, 0, -1, 1, 0, -1, -1, 0, 1, 1, 0, 1,
    -1, 1.2, 1, 1, 1.2, 1,
  ]);
  const indices = [
    0, 2, 1, 1, 2, 3,
    2, 4, 3, 3, 4, 5,
    0, 1, 4, 1, 5, 4,
    0, 4, 2,
    1, 3, 5,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
