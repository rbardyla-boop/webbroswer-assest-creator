// Procedural Build System (Stage 17C / 18) — generator types + config. A generator
// is a deterministic function of (seed, config) that produces a LAYOUT of plain
// descriptors; a separate emitter turns that layout into normal WorldDocument
// objects. The generator holds NO runtime/scene authority — its output flows
// through WorldObjectManager like any other placed object (the boundary the
// Stage 17B audit required: "generator output → WorldDocument objects → systems").
//
// Stage 18 (Generator Library v1) adds camp / ruin / forest beside the original
// city. Config creation dispatches on type here; each per-type layout + emitter
// lives in its own module, wired together by GeneratorRegistry.
//
// Every field is clamped so an untrusted world document can't request a degenerate
// or unbounded generation. The total emitted-object count is hard-capped.

export const GENERATOR_TYPES = Object.freeze(["city", "camp", "ruin", "forest"]);
export const CITY_STYLES = Object.freeze(["town", "grid", "village"]);
export const CAMP_STYLES = Object.freeze(["outpost", "camp", "watch"]);
export const RUIN_STYLES = Object.freeze(["temple", "fort", "hamlet"]);
export const FOREST_STYLES = Object.freeze(["grove", "dense", "sparse"]);

export const GENERATOR_LIMITS = Object.freeze({
  MIN_BLOCKS: 1,
  MAX_BLOCKS: 8, // blocks per side → at most 8×8 city blocks
  MAX_BUILDINGS: 400,
  MAX_PROPS: 300,
  MAX_ROADS: 200,
  // Stage 18 generator-library caps. Each layout also caps its own loops; the
  // emitter caps the grand total at MAX_TOTAL_OBJECTS regardless of these.
  MIN_SIZE: 1,
  MAX_SIZE: 8, // generic "size"/extent dial for camp / ruin / forest
  MAX_TENTS: 60,
  MAX_CRATES: 120,
  MAX_COLUMNS: 120,
  MAX_RUBBLE: 400,
  MAX_TREES: 600,
  MAX_ROCKS: 120,
  MAX_INTERACTIONS: 64, // pickup objects from one camp (sign/spawn/trigger are singletons)
  MAX_TOTAL_OBJECTS: 1500, // hard ceiling on objects a single generate can emit
});

// FNV-1a string → 32-bit seed (deterministic; stable across runs).
export function stringToSeed(value) {
  const s = String(value ?? "");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createCityConfig(overrides = {}) {
  const src = overrides && typeof overrides === "object" ? overrides : {};
  return {
    seed: sanitizeSeed(src.seed),
    style: CITY_STYLES.includes(src.style) ? src.style : "town",
    blocks: clampInt(src.blocks, GENERATOR_LIMITS.MIN_BLOCKS, GENERATOR_LIMITS.MAX_BLOCKS, 4),
    blockSize: clamp(num(src.blockSize, 34), 14, 80),
    density: clamp(num(src.density, 0.6), 0, 1),
    origin: {
      x: clamp(num(src.origin?.x, 0), -5000, 5000),
      z: clamp(num(src.origin?.z, 0), -5000, 5000),
    },
    // Optional prefab/asset backing per category (Stage 19): a prefab id to expand
    // for each building/prop, or null to emit a primitive (the default + fallback).
    buildingPrefab: sanitizePrefabRef(src.buildingPrefab),
    propPrefab: sanitizePrefabRef(src.propPrefab),
  };
}

// Camp / outpost: tents (buildingPrefab) ringed around a fire pit, crates
// (propPrefab), plus data-only gameplay objects (sign / spawn / trigger / pickups).
export function createCampConfig(overrides = {}) {
  const src = overrides && typeof overrides === "object" ? overrides : {};
  return {
    seed: sanitizeSeed(src.seed),
    style: CAMP_STYLES.includes(src.style) ? src.style : "outpost",
    size: clampInt(src.size, GENERATOR_LIMITS.MIN_SIZE, GENERATOR_LIMITS.MAX_SIZE, 4),
    density: clamp(num(src.density, 0.6), 0, 1),
    origin: { x: clamp(num(src.origin?.x, 0), -5000, 5000), z: clamp(num(src.origin?.z, 0), -5000, 5000) },
    buildingPrefab: sanitizePrefabRef(src.buildingPrefab), // tents / huts
    propPrefab: sanitizePrefabRef(src.propPrefab), // crates
  };
}

// Ruin cluster: toppled walls, a broken colonnade (columns → propPrefab), rubble,
// and a central platform fragment. An exploration landmark.
export function createRuinConfig(overrides = {}) {
  const src = overrides && typeof overrides === "object" ? overrides : {};
  return {
    seed: sanitizeSeed(src.seed),
    style: RUIN_STYLES.includes(src.style) ? src.style : "temple",
    size: clampInt(src.size, GENERATOR_LIMITS.MIN_SIZE, GENERATOR_LIMITS.MAX_SIZE, 4),
    density: clamp(num(src.density, 0.6), 0, 1),
    origin: { x: clamp(num(src.origin?.x, 0), -5000, 5000), z: clamp(num(src.origin?.z, 0), -5000, 5000) },
    propPrefab: sanitizePrefabRef(src.propPrefab), // columns
  };
}

// Forest grove: trees (propPrefab) scattered in an annulus around a kept clearing,
// with scattered rocks. Natural cover.
export function createForestConfig(overrides = {}) {
  const src = overrides && typeof overrides === "object" ? overrides : {};
  return {
    seed: sanitizeSeed(src.seed),
    style: FOREST_STYLES.includes(src.style) ? src.style : "grove",
    size: clampInt(src.size, GENERATOR_LIMITS.MIN_SIZE, GENERATOR_LIMITS.MAX_SIZE, 4),
    density: clamp(num(src.density, 0.6), 0, 1),
    origin: { x: clamp(num(src.origin?.x, 0), -5000, 5000), z: clamp(num(src.origin?.z, 0), -5000, 5000) },
    propPrefab: sanitizePrefabRef(src.propPrefab), // trees
  };
}

// Sanitize a prefab reference id. The result is ONLY ever used as a key into the
// PrefabLibrary's Map (prefabLibrary.get(id)) — never as a filesystem path, URL, or
// object property access — so the allowlist residue (e.g. dots from "../x", or a
// literal "__proto__") is inert: Map.get is isolated from the prototype chain and a
// missing key resolves to null → primitive fallback.
export function sanitizePrefabRef(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64);
  return cleaned.length ? cleaned : null;
}

// Per-type config creators. Dispatch lives here (not in GeneratorRegistry) so the
// WorldDocument validator can normalize any generator instance by calling
// createGeneratorInstance without importing the THREE-touching layout/emitters.
const CONFIG_CREATORS = Object.freeze({
  city: createCityConfig,
  camp: createCampConfig,
  ruin: createRuinConfig,
  forest: createForestConfig,
});

// A generator instance as stored in the WorldDocument `generators` block.
export function createGeneratorInstance(overrides = {}) {
  const src = overrides && typeof overrides === "object" ? overrides : {};
  const type = GENERATOR_TYPES.includes(src.type) ? src.type : "city";
  const makeConfig = CONFIG_CREATORS[type] ?? createCityConfig;
  return {
    id: sanitizeId(src.id) ?? `gen-${type}`,
    type,
    config: makeConfig(src.config),
  };
}

export function sanitizeSeed(value) {
  const s = String(value ?? "town-1").slice(0, 64);
  // Allowlist — keep seeds to a safe, stable character set.
  const cleaned = s.replace(/[^A-Za-z0-9_.\- ]/g, "");
  return cleaned.length ? cleaned : "town-1";
}

function sanitizeId(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 48);
  return cleaned.length ? cleaned : null;
}

export function clampInt(value, lo, hi, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}
