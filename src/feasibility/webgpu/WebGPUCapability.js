// WebGPU Feasibility Gate-0 — capability probe (PURE: no THREE, no platform RNG, no wall-clock).
//
// A single, honest answer to "is WebGPU actually available here?" given a navigator-like
// object. It NEVER throws and NEVER guesses: it reports apiPresent (the WebGPU JS surface is
// exposed) and available (an adapter was actually granted) separately, with a human reason.
//
// This is deliberately injectable (probeWebGPU(nav)) so it is Node-testable with mock
// navigators — the same code path runs against the real navigator in the lab entry. In our
// SwiftShader headless harness WebGPU is expected to be UNAVAILABLE; that is a valid, honestly
// reported outcome of this probe, not a failure.

// The adapter limits worth recording for a feasibility judgement — the ones that bound how big
// a buffer / texture / compute dispatch a WebGPU backend could drive. Whitelisted so an exotic
// adapter can't smuggle arbitrary keys into the report.
const REPORTED_LIMITS = [
  "maxBufferSize",
  "maxStorageBufferBindingSize",
  "maxTextureDimension2D",
  "maxComputeWorkgroupStorageSize",
  "maxComputeInvocationsPerWorkgroup",
  "maxComputeWorkgroupSizeX",
];

// Pull only the whitelisted, finite numeric limits off an adapter.limits-like object.
export function summarizeLimits(limitsLike) {
  const out = {};
  if (!limitsLike || typeof limitsLike !== "object") return out;
  for (const key of REPORTED_LIMITS) {
    const value = limitsLike[key];
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

/**
 * Probe WebGPU availability against a navigator-like object.
 * @param {object|null} nav - a navigator (real or mock) exposing an optional `gpu`.
 * @returns {Promise<{apiPresent:boolean, available:boolean, reason:string,
 *   isFallbackAdapter:boolean|null, limits:object}>}
 */
export async function probeWebGPU(nav) {
  if (!nav || typeof nav !== "object") {
    return { apiPresent: false, available: false, reason: "no navigator object", isFallbackAdapter: null, limits: {} };
  }
  const gpu = nav.gpu;
  if (!gpu || typeof gpu.requestAdapter !== "function") {
    return {
      apiPresent: false,
      available: false,
      reason: "navigator.gpu absent — the WebGPU API is not exposed in this browser/flags",
      isFallbackAdapter: null,
      limits: {},
    };
  }

  let adapter = null;
  try {
    adapter = await gpu.requestAdapter();
  } catch (error) {
    return {
      apiPresent: true,
      available: false,
      reason: "requestAdapter() threw: " + (error?.message ?? String(error)),
      isFallbackAdapter: null,
      limits: {},
    };
  }

  if (!adapter) {
    return {
      apiPresent: true,
      available: false,
      reason: "WebGPU API present but no adapter was granted (no GPU/driver path available)",
      isFallbackAdapter: null,
      limits: {},
    };
  }

  return {
    apiPresent: true,
    available: true,
    reason: adapter.isFallbackAdapter === true
      ? "WebGPU adapter granted (software FALLBACK adapter)"
      : "WebGPU adapter granted (hardware-backed)",
    isFallbackAdapter: adapter.isFallbackAdapter === true,
    limits: summarizeLimits(adapter.limits),
  };
}
