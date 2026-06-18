// Region grid keying — the canonical "rx,rz" cell identity shared by the streamed
// wildlife systems. Pure + Node-safe (no THREE). Kept byte-identical to the inline
// expressions the streamers used before extraction so the region SET never shifts.

// Stable string key for a region cell. MUST match the prior inline `rx + "," + rz`
// exactly (signed ints, comma separator) — a different encoding would change Map
// identity and could alter which regions are deduped.
export function keyOf(rx, rz) {
  return rx + "," + rz;
}

// The region cell the camera currently sits in (floor-divided by the region size).
export function cellOf(camX, camZ, size) {
  return { cx: Math.floor(camX / size), cz: Math.floor(camZ / size) };
}
