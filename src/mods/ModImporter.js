// Parse + validate an untrusted mod package file into a normalized object,
// ready for ModRegistry.install. Supports .modpack.json and .modpack.zip (the
// zip simply wraps the canonical mod.modpack.json). No code is ever executed —
// the file is parsed as JSON only.
//
// Node-safe core: parseModPackage(stringOrBytes). Browser: importModFile(File).

import { readZip } from "../export/BuildZip.js";
import { validateModPackage } from "./ModValidation.js";

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const CANONICAL_ENTRY = "mod.modpack.json";

/**
 * Parse a mod package from a JSON string or a zip byte array, then validate it.
 * @param {string|Uint8Array} input
 * @returns {{ modpack: object|null, validation: object }}
 */
export function parseModPackage(input) {
  let raw;
  try {
    raw = input instanceof Uint8Array ? parseZip(input) : JSON.parse(String(input));
  } catch (error) {
    return { modpack: null, validation: failValidation(`Could not parse mod package: ${error.message}`) };
  }
  const validation = validateModPackage(raw);
  return { modpack: validation.ok ? raw : null, validation };
}

function parseZip(bytes) {
  const entries = readZip(bytes);
  const entry = entries.find((e) => e.path === CANONICAL_ENTRY) ?? entries.find((e) => e.path.endsWith(".modpack.json"));
  if (!entry) throw new Error(`zip is missing ${CANONICAL_ENTRY}`);
  return JSON.parse(new TextDecoder().decode(entry.bytes));
}

function looksLikeZip(bytes) {
  return bytes.length >= 4 && ZIP_MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * Browser entry: read a File and parse+validate it.
 * @param {File} file
 * @returns {Promise<{ modpack: object|null, validation: object, fileName: string }>}
 */
export async function importModFile(file) {
  const isZipName = /\.zip$/i.test(file.name);
  if (isZipName) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!looksLikeZip(bytes)) return { ...parseModPackage(new TextDecoder().decode(bytes)), fileName: file.name };
    return { ...parseModPackage(bytes), fileName: file.name };
  }
  const text = await file.text();
  return { ...parseModPackage(text), fileName: file.name };
}

function failValidation(message) {
  return { ok: false, errors: [message], warnings: [], report: { ok: false, criteria: [], contentCounts: {} } };
}
