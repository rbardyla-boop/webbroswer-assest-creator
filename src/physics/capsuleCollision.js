export function resolveCapsuleAABB(position, previous, box, radius) {
  const insideX = position.x > box.min.x - radius && position.x < box.max.x + radius;
  const insideZ = position.z > box.min.z - radius && position.z < box.max.z + radius;
  if (!insideX || !insideZ) return;

  const fromLeft = Math.abs(position.x - (box.min.x - radius));
  const fromRight = Math.abs((box.max.x + radius) - position.x);
  const fromBack = Math.abs(position.z - (box.min.z - radius));
  const fromFront = Math.abs((box.max.z + radius) - position.z);
  const min = Math.min(fromLeft, fromRight, fromBack, fromFront);

  if (min === fromLeft) position.x = box.min.x - radius;
  else if (min === fromRight) position.x = box.max.x + radius;
  else if (min === fromBack) position.z = box.min.z - radius;
  else position.z = box.max.z + radius;

  if (Math.abs(position.x - previous.x) < 1e-4) position.z = previous.z;
  if (Math.abs(position.z - previous.z) < 1e-4) position.x = previous.x;
}

export function resolveCapsuleCylinder(position, previous, box, radius) {
  const cx = (box.min.x + box.max.x) * 0.5;
  const cz = (box.min.z + box.max.z) * 0.5;
  const r = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.5 + radius;
  let dx = position.x - cx;
  let dz = position.z - cz;
  const d = Math.hypot(dx, dz);
  if (d >= r) return;
  if (d < 1e-5) {
    dx = position.x - previous.x || 1;
    dz = position.z - previous.z || 0;
  }
  const inv = 1 / (Math.hypot(dx, dz) || 1);
  position.x = cx + dx * inv * r;
  position.z = cz + dz * inv * r;
}
