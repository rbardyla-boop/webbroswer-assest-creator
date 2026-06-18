// Region distance metrics — the nearest-corner hysteresis math the streamed wildlife
// systems use to decide which region cells to build and keep. Pure + Node-safe.
//
// This is the canonical home for the half-diagonal factor that EVERY Family-A streamer
// must agree on. The keep/drop AND build tests both use the nearest-corner distance so
// `[visibleDistance, keepDistance]` is a clean hysteresis gap (a raw-centre keep with a
// large regionSize would build-and-drop the same border region every frame — the thrash
// the wildlife streaming was designed to avoid).

// Half the diagonal of a square region cell, as a fraction of its edge length. This is
// the LITERAL the wildlife/aloft streamers shipped with — NOT `Math.SQRT1_2`
// (0.70710678…). The two differ by ~9.3e-5; at regionSize 64 that is a ~6mm shift in the
// build/keep threshold, enough to flip a boundary region in or out and change rendered
// instance counts. Keep it EXACT to preserve parity.
export const HALF_DIAG_FACTOR = 0.7072;

export function halfDiag(size) {
  return size * HALF_DIAG_FACTOR;
}

// Distance from the camera to a region cell's NEAREST point (centre distance minus the
// cell's half-diagonal). `Math.hypot` matches the source call exactly.
export function nearestCornerDistance(centerX, centerZ, camX, camZ, halfDiagonal) {
  return Math.hypot(centerX - camX, centerZ - camZ) - halfDiagonal;
}
