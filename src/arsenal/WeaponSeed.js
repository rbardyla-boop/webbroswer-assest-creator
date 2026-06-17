// Seeded randomness for the Arsenal Lab. A weapon is a deterministic function of
// its seed string: the same seed always yields the same recipe. Reuses the engine's
// mulberry32 (utils/random.js) — there is NO Math.random anywhere in the generator.

import { mulberry32 } from "../utils/random.js";
import { lerp } from "../utils/math.js";

// FNV-1a string → 32-bit seed (stable across runs; same primitive the world
// generators use, kept local so the Arsenal Lab stays a self-contained tool).
export function hashSeed(value) {
  const s = String(value ?? "");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A seeded RNG bundle. All draws are deterministic for a given seed.
 * @param {string|number} seed
 * @returns {{ next:()=>number, float:(a?:number,b?:number)=>number, int:(a:number,b:number)=>number,
 *            chance:(p:number)=>boolean, pick:<T>(arr:T[])=>T, jitter:(amount:number)=>number }}
 */
export function createRng(seed) {
  const next = mulberry32(hashSeed(seed));
  return {
    next,
    float: (a = 0, b = 1) => lerp(a, b, next()),
    // Inclusive integer in [a, b]. next() < 1 so the result never reaches b+1.
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.min(arr.length - 1, Math.floor(next() * arr.length))],
    // Symmetric bounded jitter in [-amount, amount] — organic but never unbounded.
    jitter: (amount) => (next() - 0.5) * 2 * amount,
  };
}
