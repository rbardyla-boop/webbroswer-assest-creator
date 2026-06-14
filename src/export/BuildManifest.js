// Build manifest format for Playable Build Export v1.
//
// A manifest is pure metadata describing an exported world package: what it is,
// how big it is, what the runtime needs, and which external asset blobs travel
// with it. It carries no binary data itself — embedded blobs live alongside it
// in the worldpack. This module is dependency-free and Node-safe (no DOM).

export const PLAYABLE_BUILD_FORMAT = "world-builder-playable-build";
export const PLAYABLE_BUILD_VERSION = 1;

export const WORLDPACK_FORMAT = "world-builder-worldpack";
export const WORLDPACK_VERSION = 1;

/**
 * Required runtime capabilities for a world. Intentionally conservative for
 * this phase: WebGL2 always; "gltf" when any external asset is a GLB/GLTF.
 * No WebGPU / ray-tracing capabilities are emitted here.
 */
export function requiredCapabilities(assetReferences = []) {
  const caps = ["webgl2"];
  if (assetReferences.some((ref) => ref.type === "gltf")) caps.push("gltf");
  return caps;
}

/**
 * Build the manifest object from a sanitized world document plus the asset
 * collection result.
 *
 * @param {object}   params
 * @param {object}   params.document       sanitized WorldDocument v2
 * @param {object[]} params.embedded       embedded asset records (id,type,name,sizeBytes,...)
 * @param {object[]} params.missing        missing asset reports ({ id, type, reason })
 * @param {string[]} params.warnings       human-readable build warnings
 * @param {string}   params.exportedAt     ISO timestamp (caller supplies; keeps this pure)
 */
export function createBuildManifest({ document, embedded = [], missing = [], warnings = [], exportedAt } = {}) {
  const objects = Array.isArray(document?.objects) ? document.objects : [];
  const prefabItems = Array.isArray(document?.prefabs?.items) ? document.prefabs.items : [];

  const assetReferences = [
    ...embedded.map((asset) => ({
      id: asset.id,
      type: asset.type,
      name: asset.name ?? asset.id,
      embedded: true,
      missing: false,
      sizeBytes: numberOr(asset.sizeBytes, 0),
    })),
    ...missing.map((entry) => ({
      id: entry.id,
      type: entry.type ?? null,
      name: entry.name ?? entry.id,
      embedded: false,
      missing: true,
      sizeBytes: 0,
      reason: entry.reason ?? "asset blob unavailable",
    })),
  ];

  return {
    format: PLAYABLE_BUILD_FORMAT,
    buildVersion: PLAYABLE_BUILD_VERSION,
    worldDocumentVersion: numberOr(document?.version, 2),
    exportedAt: typeof exportedAt === "string" && exportedAt ? exportedAt : new Date().toISOString(),
    worldName: document?.metadata?.name ?? "Untitled World",
    objectCount: objects.length,
    assetCount: embedded.length,
    missingAssetCount: missing.length,
    prefabCount: prefabItems.length,
    warnings: [...warnings],
    requiredCapabilities: requiredCapabilities(assetReferences),
    assetReferences,
  };
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
