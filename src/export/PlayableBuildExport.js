// Playable Build Export v1 — orchestration.
//
// Pure, Node-safe core (testable without a DOM):
//   buildWorldPack(document, assetLibrary)        -> self-contained worldpack object
//   buildPlayableBuildPackage(worldpack)          -> [{ path, text|bytes }] for a zip
//   createAssetLibraryFromWorldPack(worldpack)    -> { document, assetLibrary } for the runtime
//
// DOM helpers (guarded; no-op outside the browser):
//   downloadWorldPack(...)        -> triggers a .worldpack.json download
//   downloadPlayableBuildZip(...) -> triggers a .zip download (folder structure)

import { validateWorldDocument } from "../world/WorldValidation.js";
import { AssetLibrary } from "../assets/AssetLibrary.js";
import { normalizeAssetMetadata } from "../assets/AssetValidation.js";
import { createBuildManifest, WORLDPACK_FORMAT, WORLDPACK_VERSION } from "./BuildManifest.js";
import { collectBuildAssets, base64ToUint8Array } from "./BuildAssetCollector.js";
import { validateBuild } from "./BuildValidation.js";
import { buildValidationReport, buildReadme, buildLauncherHtml } from "./BuildReport.js";
import { createZip } from "./BuildZip.js";

/**
 * Assemble a self-contained worldpack: sanitized world document, embedded asset
 * blobs, build manifest, and validation report. Pure data — no DOM, no I/O.
 */
export async function buildWorldPack(document, assetLibrary, { exportedAt } = {}) {
  const sanitized = validateWorldDocument(document).document;
  const { embedded, missing } = await collectBuildAssets(sanitized, assetLibrary);
  const validation = validateBuild(sanitized, { embedded, missing });
  const manifest = createBuildManifest({
    document: sanitized,
    embedded,
    missing,
    warnings: validation.warnings,
    exportedAt,
  });
  return {
    format: WORLDPACK_FORMAT,
    version: WORLDPACK_VERSION,
    manifest,
    world: sanitized,
    assets: embedded,
    report: buildValidationReport(manifest, validation),
  };
}

/**
 * Expand a worldpack into the conceptual playable-build folder structure as a
 * flat list of files (paths use "/" — the zip writer creates the folders).
 */
export function buildPlayableBuildPackage(worldpack) {
  const manifest = worldpack.manifest;
  const validation = {
    ok: worldpack.report.ok,
    errors: worldpack.report.errors ?? [],
    warnings: worldpack.report.warnings ?? [],
    report: { criteria: worldpack.report.criteria ?? [] },
  };

  const files = [
    { path: "index.html", text: buildLauncherHtml(manifest, validation) },
    { path: "world.worldpack.json", text: JSON.stringify(worldpack, null, 2) },
    { path: "world/world.json", text: JSON.stringify(worldpack.world, null, 2) },
    { path: "world/manifest.json", text: JSON.stringify(manifest, null, 2) },
    { path: "docs/README.txt", text: buildReadme(manifest, validation) },
    { path: "docs/validation-report.json", text: JSON.stringify(worldpack.report, null, 2) },
  ];
  for (const asset of worldpack.assets ?? []) {
    files.push({ path: `assets/${assetFileName(asset)}`, bytes: base64ToUint8Array(asset.dataBase64) });
  }
  return files;
}

/**
 * Rebuild an AssetLibrary from a worldpack's embedded blobs so the runtime can
 * consume the export with no IndexedDB. Reuses AssetLibrary's own parsing
 * (relief/image/gltf) via an in-memory store — the runtime path is unchanged.
 */
export async function createAssetLibraryFromWorldPack(worldpack) {
  const store = new InMemoryAssetStore();
  for (const asset of worldpack?.assets ?? []) {
    const bytes = base64ToUint8Array(asset.dataBase64);
    const blob = new Blob([bytes], { type: asset.mimeType || "application/octet-stream" });
    const metadata = normalizeAssetMetadata({ ...asset, sizeBytes: asset.sizeBytes ?? bytes.length });
    await store.putAsset(metadata, blob);
  }
  const assetLibrary = await new AssetLibrary({ store }).init();
  return { document: worldpack?.world ?? null, assetLibrary };
}

// --- browser download helpers (guarded) -------------------------------------

export async function downloadWorldPack(document, assetLibrary, opts = {}) {
  const worldpack = await buildWorldPack(document, assetLibrary, opts);
  triggerDownload(
    new Blob([JSON.stringify(worldpack, null, 2)], { type: "application/json" }),
    `${fileBase(worldpack)}.worldpack.json`
  );
  return worldpack;
}

export async function downloadPlayableBuildZip(document, assetLibrary, opts = {}) {
  const worldpack = await buildWorldPack(document, assetLibrary, opts);
  const zip = createZip(buildPlayableBuildPackage(worldpack));
  triggerDownload(new Blob([zip], { type: "application/zip" }), `${fileBase(worldpack)}-playable-build.zip`);
  return worldpack;
}

// --- helpers -----------------------------------------------------------------

function assetFileName(asset) {
  // Sanitize the id into a single safe path segment so an untrusted assetRef
  // (e.g. "../../evil") cannot introduce zip path traversal on extraction.
  const safeId = String(asset.id ?? "asset").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/\.\.+/g, "_") || "asset";
  return `${safeId}${extensionFor(asset)}`;
}

function extensionFor(asset) {
  if (asset.type === "relief") return ".json";
  if (asset.type === "gltf") return asset.mimeType === "model/gltf+json" ? ".gltf" : ".glb";
  if (asset.type === "image") {
    if (/png/.test(asset.mimeType ?? "")) return ".png";
    if (/jpe?g/.test(asset.mimeType ?? "")) return ".jpg";
    if (/webp/.test(asset.mimeType ?? "")) return ".webp";
    return ".img";
  }
  return ".bin";
}

function fileBase(worldpack) {
  return slug(worldpack?.manifest?.worldName ?? "untitled-world");
}

function slug(value) {
  return (
    String(value || "untitled-world")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "untitled-world"
  );
}

function triggerDownload(blob, filename) {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// In-memory AssetStore mirroring the IndexedDB AssetStore surface AssetLibrary
// relies on (listMetadata / putAsset / updateMetadata / getBlob / deleteAsset).
class InMemoryAssetStore {
  constructor() {
    this.metadata = new Map();
    this.blobs = new Map();
  }

  async listMetadata() {
    return [...this.metadata.values()];
  }

  async putAsset(metadata, blob = null) {
    this.metadata.set(metadata.id, metadata);
    if (blob) this.blobs.set(metadata.id, blob);
    return metadata;
  }

  async updateMetadata(metadata) {
    this.metadata.set(metadata.id, metadata);
    return metadata;
  }

  async getBlob(id) {
    return this.blobs.get(id) ?? null;
  }

  async deleteAsset(id) {
    this.metadata.delete(id);
    this.blobs.delete(id);
  }
}
