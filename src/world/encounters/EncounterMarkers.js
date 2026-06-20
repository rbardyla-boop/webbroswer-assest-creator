// Encounter Editor-0 zone-ring marker (shared). Imports THREE only — no scene authority, no gameplay
// state. A flat translucent ring drawn at an encounter's centre to PREVIEW its radius. The SAME builder
// is used by EncounterRuntime (the play-mode zone) and the editor preview (authoring feedback), so the
// ring geometry/material/colour is defined once (DRY). These rings are session/render projections only —
// they are NEVER written into document.objects.

import * as THREE from "three";

export const ACTIVE_COLOR = 0xffb347; // amber — an unresolved beat
export const CLEARED_COLOR = 0x7fdca0; // green — a cleared beat
export const RING_Y_OFFSET = 0.08; // metres lifted off the ground to avoid z-fighting

const RING_SEGMENTS = 48;
const RING_THICKNESS = 0.6; // metres between the inner and outer radius

/** Build a flat zone ring of the given outer radius, lying on the XZ plane, coloured ACTIVE by default. */
export function buildZoneRing(radius, color = ACTIVE_COLOR) {
  const r = Number.isFinite(radius) && radius > 0 ? radius : 6;
  const geometry = new THREE.RingGeometry(Math.max(0.1, r - RING_THICKNESS), r, RING_SEGMENTS);
  geometry.rotateX(-Math.PI / 2); // lay flat on the ground plane
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "EncounterZone";
  mesh.renderOrder = 2;
  mesh.userData.isEncounterMarker = true; // never picked/serialized as a world object
  return mesh;
}

/** Recolour an existing ring (active ↔ cleared) without rebuilding it. */
export function paintZoneRing(ring, cleared) {
  ring?.material?.color?.setHex(cleared ? CLEARED_COLOR : ACTIVE_COLOR);
}

export function disposeZoneRing(ring) {
  ring?.geometry?.dispose?.();
  ring?.material?.dispose?.();
}
