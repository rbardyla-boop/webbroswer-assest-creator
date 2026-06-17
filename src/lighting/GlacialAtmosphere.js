// Glacial atmosphere preset — the cool counterpart to defaultLighting(), tuned for
// the alpine valley: a low pale sun for long raking shadows down the trough, a
// blue-grey sky/ground hemisphere, and denser blue fog reaching further so the
// ridge walls read as a vista rather than a wall of haze. Same SHAPE as
// defaultLighting() so it flows through LightingRig.applyLighting unchanged — this
// is just the default `lighting` block for new worlds, not a new application path.

export function glacialLighting() {
  return {
    sun: { color: "#eaf1f8", intensity: 2.3, azimuth: 42, elevation: 32, castShadow: true },
    hemisphere: { skyColor: "#cfe2f2", groundColor: "#586458", intensity: 0.9 },
    fog: { color: "#bcd2e0", near: 90, far: 320, enabled: true },
  };
}
