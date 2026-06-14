// Pure assembly of a mod package from its content pieces. De-duplicates by id,
// derives kit dependencies, and attaches a validation report. Node-safe.

import { createModPackage } from "./ModManifest.js";
import { validateModPackage } from "./ModValidation.js";

/**
 * Assemble a validated mod package.
 *
 * @param {object} params
 * @param {object[]} params.worldpacks  Stage 8 worldpack objects (self-contained)
 * @param {object[]} params.worlds      raw WorldDocument v2 objects
 * @param {object[]} params.assets      standalone embedded asset records
 * @param {object[]} params.prefabs     user prefab documents
 * @param {object[]} params.kits        built-in kit references ({ id, name })
 * @param {object[]} params.thumbnails  thumbnail records ({ id, dataUrl })
 */
export function assembleModPackage({
  name,
  description = "",
  author = "",
  license = "",
  id = null,
  worldpacks = [],
  worlds = [],
  assets = [],
  prefabs = [],
  kits = [],
  thumbnails = [],
} = {}) {
  const contents = {
    worlds: [...worlds],
    worldpacks: [...worldpacks],
    assets: dedupeById(assets),
    prefabs: dedupeById(prefabs),
    kits: dedupeById(kits),
    thumbnails: dedupeById(thumbnails),
  };

  // Dependencies are the built-in kits the worlds rely on — recorded as metadata
  // so a consumer can confirm it has them (they regenerate locally, never embed).
  const dependencies = contents.kits.map((kit) => ({ type: "kit", id: kit.id, name: kit.name ?? kit.id }));

  const modpack = createModPackage({ id, name, description, author, license, contents, dependencies });
  const validation = validateModPackage(modpack);
  modpack.warnings = [...validation.warnings];
  modpack.report = validation.report;
  return modpack;
}

function dedupeById(items) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const key = item?.id ?? null;
    if (key != null) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(item);
  }
  return out;
}
