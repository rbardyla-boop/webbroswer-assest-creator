// Build a mod package from the current world + libraries, and download it.
//
// Node-safe core (buildWorldMod, buildModFiles); DOM download helpers are
// guarded. Reuses the Stage 8 worldpack as the self-contained world carrier so
// assets are embedded once, never duplicated across mod content kinds.

import { buildWorldPack } from "../export/PlayableBuildExport.js";
import { createZip } from "../export/BuildZip.js";
import { assembleModPackage } from "./ModPackage.js";
import { summarizeModContents } from "./ModManifest.js";
import { safePathSegment } from "./ModTypes.js";

/**
 * Assemble a validated mod package wrapping one world.
 *
 * @param {object} document       WorldDocument v2 (current world)
 * @param {object} assetLibrary   AssetLibrary (for worldpack asset embedding)
 * @param {object} prefabLibrary  PrefabLibrary (to resolve user prefab defs / kits)
 * @param {object} meta           { name, description, author, license }
 */
export async function buildWorldMod(document, assetLibrary, prefabLibrary, meta = {}) {
  const worldpack = await buildWorldPack(document, assetLibrary, { exportedAt: meta.exportedAt });
  const { prefabs, kits } = gatherPrefabsAndKits(worldpack.world, prefabLibrary);
  return assembleModPackage({
    name: meta.name || worldpack.world?.metadata?.name || "World Mod",
    description: meta.description ?? "",
    author: meta.author ?? "",
    license: meta.license ?? "",
    worldpacks: [worldpack],
    prefabs,
    kits,
  });
}

// Split the world's prefabRefs into user prefab definitions (embedded) and
// built-in kit references (metadata only — kits regenerate locally).
function gatherPrefabsAndKits(world, prefabLibrary) {
  const refs = new Set();
  for (const object of world?.objects ?? []) {
    if (typeof object?.prefabRef === "string" && object.prefabRef) refs.add(object.prefabRef);
  }
  const prefabs = [];
  const kits = [];
  for (const ref of refs) {
    const isBuiltin = prefabLibrary ? prefabLibrary.isBuiltin?.(ref) : ref.startsWith("builtin-");
    if (isBuiltin) {
      const def = prefabLibrary?.get?.(ref);
      kits.push({ id: ref, name: def?.name ?? ref });
      continue;
    }
    const def = prefabLibrary?.get?.(ref);
    if (def) prefabs.push(structuredCloneSafe(def));
  }
  return { prefabs, kits };
}

/**
 * Expand a mod package into the conceptual .modpack.zip file layout. The
 * canonical, importable artifact is `mod.modpack.json`; the rest is for human
 * inspection. Node-safe (returns { path, text } records).
 */
export function buildModFiles(modpack) {
  const counts = summarizeModContents(modpack);
  const files = [
    { path: "mod.modpack.json", text: JSON.stringify(modpack, null, 2) },
    { path: "manifest.json", text: JSON.stringify(manifestOnly(modpack), null, 2) },
    { path: "docs/README.txt", text: buildModReadme(modpack, counts) },
    { path: "docs/validation-report.json", text: JSON.stringify(modpack.report ?? {}, null, 2) },
  ];
  const worldDocs = [
    ...(modpack.contents?.worlds ?? []),
    ...(modpack.contents?.worldpacks ?? []).map((p) => p?.world).filter(Boolean),
  ];
  worldDocs.forEach((world, i) => {
    files.push({ path: `worlds/${safePathSegment(world?.metadata?.name ?? `world-${i}`)}.world.json`, text: JSON.stringify(world, null, 2) });
  });
  return files;
}

function manifestOnly(modpack) {
  const { contents, ...rest } = modpack;
  return { ...rest, contentCounts: summarizeModContents(modpack) };
}

function buildModReadme(modpack, counts) {
  return [
    `${modpack.name} — Grass World Mod Package`,
    `Author: ${modpack.author || "(unknown)"}    License: ${modpack.license || "(unspecified)"}`,
    `Format ${modpack.format} v${modpack.version} · id ${modpack.id}`,
    `Created ${modpack.createdAt}`,
    "",
    modpack.description || "(no description)",
    "",
    "CONTENTS",
    `  Worlds:     ${counts.worlds}`,
    `  Assets:     ${counts.assets}`,
    `  Prefabs:    ${counts.prefabs}`,
    `  Kits (ref): ${counts.kits}`,
    `  Thumbnails: ${counts.thumbnails}`,
    "",
    "HOW TO USE",
    "  This is a DATA-ONLY mod package (no code). Import mod.modpack.json in the",
    "  World Builder via the Mods panel → Import Mod Package. The imported world",
    "  can then be loaded in the editor, or in the runtime with ?mod=<id>.",
    "",
    ...(modpack.warnings?.length ? ["WARNINGS", ...modpack.warnings.map((w) => `  • ${w}`), ""] : []),
  ].join("\n");
}

// --- browser downloads (guarded) --------------------------------------------

export async function downloadModPackage(document, assetLibrary, prefabLibrary, meta = {}) {
  const modpack = await buildWorldMod(document, assetLibrary, prefabLibrary, meta);
  triggerDownload(new Blob([JSON.stringify(modpack, null, 2)], { type: "application/json" }), `${fileBase(modpack)}.modpack.json`);
  return modpack;
}

export async function downloadModPackageZip(document, assetLibrary, prefabLibrary, meta = {}) {
  const modpack = await buildWorldMod(document, assetLibrary, prefabLibrary, meta);
  const zip = createZip(buildModFiles(modpack));
  triggerDownload(new Blob([zip], { type: "application/zip" }), `${fileBase(modpack)}.modpack.zip`);
  return modpack;
}

function fileBase(modpack) {
  return safePathSegment(modpack?.name ?? "mod", "mod").toLowerCase();
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

function structuredCloneSafe(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
