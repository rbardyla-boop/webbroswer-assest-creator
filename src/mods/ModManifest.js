// Factory + helpers for the mod package shape. Pure, Node-safe.
//
// The package is the on-disk artifact: manifest metadata + a `contents` bag of
// data (worlds, worldpacks, assets, prefabs, kits, thumbnails). No executable
// fields are ever produced here, and `signature` stays null in v1 (no signing).

import {
  MOD_FORMAT,
  MOD_VERSION,
  ENGINE_VERSION,
  ENGINE_WORLD_DOCUMENT_VERSION,
  createModId,
} from "./ModTypes.js";

export function emptyContents() {
  return { worlds: [], worldpacks: [], assets: [], prefabs: [], kits: [], thumbnails: [] };
}

/**
 * Build a mod package object. `contents` is merged over an empty bag so callers
 * may pass only the kinds they have.
 */
export function createModPackage({
  id = null,
  name = "Untitled Mod",
  description = "",
  author = "",
  license = "",
  createdAt = null,
  updatedAt = null,
  contents = {},
  dependencies = [],
  warnings = [],
  report = null,
} = {}) {
  const now = new Date().toISOString();
  const safeName = String(name || "Untitled Mod").trim() || "Untitled Mod";
  return {
    format: MOD_FORMAT,
    version: MOD_VERSION,
    id: id || createModId(safeName),
    name: safeName,
    description: String(description ?? ""),
    author: String(author ?? ""),
    createdAt: createdAt || now,
    updatedAt: updatedAt || now,
    license: String(license ?? ""),
    engine: {
      minVersion: ENGINE_VERSION,
      worldDocumentVersion: ENGINE_WORLD_DOCUMENT_VERSION,
    },
    contents: { ...emptyContents(), ...sanitizeContentsShape(contents) },
    dependencies: Array.isArray(dependencies) ? [...dependencies] : [],
    warnings: Array.isArray(warnings) ? [...warnings] : [],
    report,
    // Reserved for a future signing phase; always null (and ignored) in v1.
    signature: null,
  };
}

function sanitizeContentsShape(contents = {}) {
  const out = {};
  for (const key of Object.keys(emptyContents())) {
    if (Array.isArray(contents[key])) out[key] = contents[key];
  }
  return out;
}

/**
 * Lightweight registry-facing summary of a package (no heavy inline data).
 */
export function summarizeModContents(modpack) {
  const c = modpack?.contents ?? {};
  return {
    worlds: (c.worlds?.length ?? 0) + (c.worldpacks?.length ?? 0),
    assets: c.assets?.length ?? 0,
    prefabs: c.prefabs?.length ?? 0,
    kits: c.kits?.length ?? 0,
    thumbnails: c.thumbnails?.length ?? 0,
  };
}
