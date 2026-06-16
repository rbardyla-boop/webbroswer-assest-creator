// Deterministic randomness + value-noise. Pure and seedable so that terrain,
// grass placement, and the player can all agree on the same world.

// --- Seeded PRNG (mulberry32) -------------------------------------------------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash two integers into a stable 32-bit-ish seed.
export function hash2i(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}

// --- Value noise --------------------------------------------------------------

function hashToUnit(x, y) {
  // Deterministic [0,1) hash for integer lattice points.
  let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return h - Math.floor(h);
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// Smooth value noise in roughly [-1, 1].
export function valueNoise2D(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;

  const v00 = hashToUnit(xi, yi);
  const v10 = hashToUnit(xi + 1, yi);
  const v01 = hashToUnit(xi, yi + 1);
  const v11 = hashToUnit(xi + 1, yi + 1);

  const u = fade(xf);
  const v = fade(yf);

  const a = v00 + (v10 - v00) * u;
  const b = v01 + (v11 - v01) * u;
  return (a + (b - a) * v) * 2 - 1;
}

// Fractal Brownian motion — layered value noise.
export function fbm2D(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let amp = 0.5;
  let freq = 1.0;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2D(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm; // ~[-1, 1]
}
