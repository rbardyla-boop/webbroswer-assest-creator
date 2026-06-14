// Pure volume containment tests for interaction triggers/pickups. Node-safe
// (operates on plain {x,y,z} or THREE.Vector3 — only reads .x/.y/.z).

export function sphereContains(center, radius, point) {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const dz = point.z - center.z;
  return dx * dx + dy * dy + dz * dz <= radius * radius;
}

// Axis-aligned box centered at `center` with per-axis half-extent `radius`.
export function boxContains(center, radius, point) {
  return (
    Math.abs(point.x - center.x) <= radius &&
    Math.abs(point.y - center.y) <= radius &&
    Math.abs(point.z - center.z) <= radius
  );
}

// Dispatch by shape ("sphere" | "box"); unknown shapes fall back to sphere.
export function volumeContains(shape, center, radius, point) {
  return shape === "box" ? boxContains(center, radius, point) : sphereContains(center, radius, point);
}
