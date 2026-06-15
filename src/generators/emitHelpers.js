// Shared emit helpers for procedural generators (Stage 18). Every generator turns
// its deterministic layout into NORMAL WorldDocument object descriptors using these
// — so the city / camp / ruin / forest emitters share one canonical primitive
// builder, one terrain-fit prefab scale, and one capped, atomic emitter buffer
// instead of each re-deriving them. Pure data in, pure data out; Node-safe.

import { worldObjectsFromPrefab } from "../prefabs/PrefabSerializer.js";

// Base dimensions of the host primitives (PlacedObject.createPrimitiveMesh). A
// generated descriptor's scale is (target / base), so a unit target reproduces the
// primitive at its authored size.
export const PRIMITIVE_BASE = Object.freeze({
  cube: 1.8, // BoxGeometry(1.8^3)
  plane: 2.4, // PlaneGeometry(2.4 x 2.4), laid flat
  cylRadius: 0.8, // CylinderGeometry radius
  cylHeight: 1.6, // CylinderGeometry height
  sphere: 1.0, // SphereGeometry radius
});

/**
 * Build a normal WorldDocument primitive descriptor (exactly the shape
 * WorldObjectManager.addWorldObjects expects). `t` carries placement + flags:
 *   pos:[x,y,z], rot:[x,y,z], scale:[x,y,z],
 *   collider: collider type string ("none" → non-colliding),
 *   castShadow, receiveShadow, excludeGrass, excludeTrees, visible (default true),
 *   interaction (data-only role block | null), particles ({kind,...} | null).
 */
export function primitiveDescriptor(kind, name, color, generatorId, t) {
  return {
    type: "primitive",
    primitive: kind,
    assetRef: null,
    name,
    color,
    generatorId,
    transform: {
      position: { x: t.pos[0], y: t.pos[1], z: t.pos[2] },
      rotation: { x: t.rot[0], y: t.rot[1], z: t.rot[2] },
      scale: { x: t.scale[0], y: t.scale[1], z: t.scale[2] },
    },
    collider: { type: t.collider, dimensions: {}, enabled: t.collider !== "none" },
    exclusion: { grass: !!t.excludeGrass, trees: !!t.excludeTrees, radius: 0, bounds: null },
    runtime: {
      visible: t.visible !== false,
      static: true,
      castShadow: !!t.castShadow,
      receiveShadow: !!t.receiveShadow,
    },
    // Optional data-only attachments (Stage 12 interaction / Stage 13B particles).
    // Sanitized again by the manager on build, so a malformed value degrades to
    // null rather than ever being executed.
    interaction: t.interaction ?? null,
    particles: t.particles ?? null,
  };
}

// Uniform scale that fits a prefab's horizontal footprint to a target size.
export function prefabFitScale(prefab, targetW, targetD) {
  const bounds = prefab?.metadata?.bounds;
  if (!bounds?.min || !bounds?.max) return 1;
  const ext = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z);
  if (!(ext > 0.01)) return 1;
  return Math.min(6, Math.max(0.3, Math.min(targetW, targetD) / ext));
}

/**
 * A capped emitter buffer. `push(desc)` adds a single descriptor (dropped past the
 * cap). `pushPrefab(...)` expands a resolved prefab atomically — never a partial
 * prefab past the cap — tagging every child with the generator id. `out` is the
 * growing descriptor array. Caps keep an untrusted config from emitting unbounded
 * geometry; the per-layout caps are the first line, this is the backstop.
 */
export function createEmitter(generatorId, cap) {
  const out = [];
  const push = (desc) => {
    if (out.length < cap) out.push(desc);
  };
  const pushPrefab = (prefab, position, yaw, scale) => {
    const children = worldObjectsFromPrefab(prefab, { position, yaw, scale });
    if (!children.length || out.length + children.length > cap) return false;
    for (const child of children) {
      child.generatorId = generatorId;
      out.push(child);
    }
    return true;
  };
  return { out, push, pushPrefab };
}
