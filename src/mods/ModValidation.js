// Security-first validation for untrusted mod packages. Pure, Node-safe.
//
// Produces an enumerated PASS/WARN/FAIL report. `ok === false` means the package
// MUST be rejected (wrong format, executable fields, traversal, oversized data,
// incompatible world version). Recoverable issues (missing optional content,
// duplicate ids, odd MIME) are warnings — import proceeds with placeholders.

import {
  MOD_FORMAT,
  MOD_VERSION,
  ENGINE_WORLD_DOCUMENT_VERSION,
  MAX_INLINE_WARN_BYTES,
  MAX_INLINE_FAIL_BYTES,
  MAX_CONTENT_RECORDS,
  BLOCKED_MIME_PREFIXES,
  PROHIBITED_KEYS,
  looksLikeUnsafePath,
} from "./ModTypes.js";

const SCAN_MAX_NODES = 200000;
const SCAN_MAX_DEPTH = 16;

export function validateModPackage(input) {
  const criteria = [];
  const errors = [];
  const warnings = [];

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return fail("Mod package was empty or not an object.");
  }

  // 1. Format string.
  if (input.format !== MOD_FORMAT) {
    criteria.push(crit("format", "Recognized mod format", "FAIL", `expected ${MOD_FORMAT}, got ${input.format ?? "(none)"}`));
    errors.push(`Unsupported mod format "${input.format ?? "(none)"}".`);
  } else {
    criteria.push(crit("format", "Recognized mod format", "PASS", MOD_FORMAT));
  }

  // 2. Version.
  const version = Number(input.version);
  if (!Number.isFinite(version) || version < 1) {
    criteria.push(crit("version", "Mod version present", "FAIL", String(input.version)));
    errors.push("Mod package version is missing or invalid.");
  } else if (version > MOD_VERSION) {
    criteria.push(crit("version", "Mod version supported", "WARN", `package v${version} > supported v${MOD_VERSION}`));
    warnings.push(`Mod package is version ${version}; this build supports up to ${MOD_VERSION}. Some content may be ignored.`);
  } else {
    criteria.push(crit("version", "Mod version supported", "PASS", `v${version}`));
  }

  // 3. Identity.
  const hasId = typeof input.id === "string" && input.id.trim().length > 0;
  const hasName = typeof input.name === "string" && input.name.trim().length > 0;
  criteria.push(hasId && hasName
    ? crit("identity", "Mod id and name present", "PASS", `${input.name}`)
    : crit("identity", "Mod id and name present", "FAIL", "missing id or name"));
  if (!hasId) errors.push("Mod package is missing a stable id.");
  if (!hasName) errors.push("Mod package is missing a name.");

  // 4. Content record-count ceiling (bounds memory/CPU before any deep work).
  const contents = input.contents && typeof input.contents === "object" ? input.contents : {};
  const worlds = arr(contents.worlds);
  const worldpacks = arr(contents.worldpacks);
  const assets = arr(contents.assets);
  const prefabs = arr(contents.prefabs);
  const totalRecords =
    worlds.length + worldpacks.length + assets.length + prefabs.length + arr(contents.kits).length + arr(contents.thumbnails).length;
  const overSized = totalRecords > MAX_CONTENT_RECORDS;
  if (overSized) {
    criteria.push(crit("record-count", "Content record count within limit", "FAIL", `${totalRecords} > ${MAX_CONTENT_RECORDS}`));
    errors.push(`Mod package has ${totalRecords} content records; the limit is ${MAX_CONTENT_RECORDS}. Refusing to import.`);
  } else {
    criteria.push(crit("record-count", "Content record count within limit", "PASS", `${totalRecords}`));
  }

  // 5. No executable / prohibited fields (the core safety gate). Skipped only
  //    when already rejected for size (the scan is the costliest pass). A scan
  //    that cannot complete within bounds is treated as a FAIL, never a pass.
  if (!overSized) {
    const scan = scanForProhibitedKeys(input);
    if (scan.truncated) {
      criteria.push(crit("no-code", "No executable fields", "FAIL", "package too large/deep to verify"));
      errors.push("Mod package is too large or deeply nested to verify as code-free. Refusing to import.");
    } else if (scan.found.length) {
      criteria.push(crit("no-code", "No executable fields", "FAIL", scan.found.slice(0, 5).join(", ")));
      errors.push(`Mod package contains prohibited executable field(s): ${scan.found.slice(0, 8).join(", ")}. Refusing to import.`);
    } else {
      criteria.push(crit("no-code", "No executable fields", "PASS", "data only"));
    }
  }

  // 6. Engine / world-document compatibility.
  const docVersion = Number(input.engine?.worldDocumentVersion ?? ENGINE_WORLD_DOCUMENT_VERSION);
  if (docVersion !== ENGINE_WORLD_DOCUMENT_VERSION) {
    criteria.push(crit("engine", "Compatible WorldDocument version", "WARN", `package doc v${docVersion}`));
    warnings.push(`Mod targets WorldDocument v${docVersion}; this build uses v${ENGINE_WORLD_DOCUMENT_VERSION}. Worlds will be migrated/sanitized on load.`);
  } else {
    criteria.push(crit("engine", "Compatible WorldDocument version", "PASS", `v${docVersion}`));
  }

  // 7. Embedded world document versions.
  const worldDocs = [...worlds, ...worldpacks.map((p) => p?.world).filter(Boolean)];
  const badWorlds = worldDocs.filter((w) => w && Number(w.version) !== ENGINE_WORLD_DOCUMENT_VERSION).length;
  criteria.push(badWorlds
    ? crit("world-versions", "World documents are v" + ENGINE_WORLD_DOCUMENT_VERSION, "WARN", `${badWorlds} will be migrated`)
    : crit("world-versions", "World documents are v" + ENGINE_WORLD_DOCUMENT_VERSION, "PASS", `${worldDocs.length} world(s)`));
  if (badWorlds) warnings.push(`${badWorlds} embedded world(s) are not v${ENGINE_WORLD_DOCUMENT_VERSION}; they will be migrated on load.`);

  // 8. Duplicate ids (assets / prefabs) within the package.
  const dupAssets = duplicates(assets.map((a) => a?.id));
  const dupPrefabs = duplicates(prefabs.map((p) => p?.id));
  if (dupAssets.length || dupPrefabs.length) {
    criteria.push(crit("unique-ids", "Content ids are unique", "WARN", `dups: ${[...dupAssets, ...dupPrefabs].slice(0, 5).join(", ")}`));
    warnings.push(`Duplicate content id(s) found and will be de-duplicated: ${[...dupAssets, ...dupPrefabs].slice(0, 8).join(", ")}.`);
  } else {
    criteria.push(crit("unique-ids", "Content ids are unique", "PASS", "no duplicates"));
  }

  // 9. Asset records: missing blobs, MIME sanity, path/id safety.
  const allEmbeddedAssets = [...assets, ...worldpacks.flatMap((p) => arr(p?.assets))];
  let missingBlobs = 0;
  let oddMime = 0;
  let unsafe = 0;
  let blockedMime = 0;
  for (const asset of allEmbeddedAssets) {
    if (!asset || typeof asset !== "object") continue;
    if (!asset.dataBase64 && !asset.embedded) missingBlobs++;
    const mime = String(asset.mimeType ?? "").toLowerCase();
    if (asset.mimeType && !/^[\w.+-]+\/[\w.+-]+$/.test(String(asset.mimeType))) oddMime++;
    if (mime && BLOCKED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) blockedMime++;
    if (looksLikeUnsafePath(asset.id) || looksLikeUnsafePath(asset.name) || looksLikeUnsafePath(asset.sourceName)) unsafe++;
  }
  for (const thumb of arr(contents.thumbnails)) {
    if (looksLikeUnsafePath(thumb?.id) || looksLikeUnsafePath(thumb?.path)) unsafe++;
  }
  if (missingBlobs) warnings.push(`${missingBlobs} asset(s) ship without blob data and will render as placeholders.`);
  if (oddMime) warnings.push(`${oddMime} asset(s) have an unusual MIME type.`);
  criteria.push(missingBlobs || oddMime
    ? crit("assets", "Asset records resolve", "WARN", `${missingBlobs} missing, ${oddMime} odd MIME`)
    : crit("assets", "Asset records resolve", "PASS", `${allEmbeddedAssets.length} asset(s)`));

  // 10. Path-traversal / unsafe references → reject.
  if (unsafe) {
    criteria.push(crit("safe-paths", "No traversal / remote paths", "FAIL", `${unsafe} unsafe reference(s)`));
    errors.push(`${unsafe} content item(s) use traversal, absolute, or remote paths. Refusing to import.`);
  } else {
    criteria.push(crit("safe-paths", "No traversal / remote paths", "PASS", "all references local + relative"));
  }

  // 10b. Executable/markup MIME types → reject (defense in depth).
  if (blockedMime) {
    criteria.push(crit("no-exec-mime", "No executable MIME types", "FAIL", `${blockedMime} blocked`));
    errors.push(`${blockedMime} asset(s) declare an executable or markup MIME type. Refusing to import.`);
  } else {
    criteria.push(crit("no-exec-mime", "No executable MIME types", "PASS", "ok"));
  }

  // 11. Inline data size threshold.
  let warnSized = 0;
  let failSized = 0;
  for (const asset of allEmbeddedAssets) {
    const bytes = base64ByteLength(asset?.dataBase64);
    if (bytes > MAX_INLINE_FAIL_BYTES) failSized++;
    else if (bytes > MAX_INLINE_WARN_BYTES) warnSized++;
  }
  if (failSized) {
    criteria.push(crit("inline-size", "Inline blobs within size limit", "FAIL", `${failSized} over ${mb(MAX_INLINE_FAIL_BYTES)}`));
    errors.push(`${failSized} inline asset(s) exceed the ${mb(MAX_INLINE_FAIL_BYTES)} hard limit. Refusing to import.`);
  } else if (warnSized) {
    criteria.push(crit("inline-size", "Inline blobs within size limit", "WARN", `${warnSized} over ${mb(MAX_INLINE_WARN_BYTES)}`));
    warnings.push(`${warnSized} inline asset(s) exceed ${mb(MAX_INLINE_WARN_BYTES)}; import may be slow.`);
  } else {
    criteria.push(crit("inline-size", "Inline blobs within size limit", "PASS", "ok"));
  }

  const ok = errors.length === 0;
  return {
    ok,
    errors,
    warnings,
    report: { ok, criteria, contentCounts: { worlds: worldDocs.length, assets: allEmbeddedAssets.length, prefabs: prefabs.length } },
  };
}

// Look for executable-looking keys anywhere in the package. Bounded in depth and
// node count; if those bounds are hit the scan reports `truncated`, which the
// caller treats as a FAIL — a package too big to fully verify is never passed.
// Array children are pushed in reverse so index 0 is examined FIRST: a hostile
// "evil object at index 0, then thousands of fillers" layout cannot starve the
// budget before the evil object is seen.
function scanForProhibitedKeys(root) {
  const found = new Set();
  let nodes = 0;
  let truncated = false;
  const stack = [{ value: root, depth: 0 }];
  while (stack.length) {
    if (nodes++ > SCAN_MAX_NODES) {
      truncated = true;
      break;
    }
    const { value, depth } = stack.pop();
    if (!value || typeof value !== "object" || depth > SCAN_MAX_DEPTH) continue;
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) {
        if (value[i] && typeof value[i] === "object") stack.push({ value: value[i], depth: depth + 1 });
      }
      continue;
    }
    for (const [key, val] of Object.entries(value)) {
      if (PROHIBITED_KEYS.has(key.toLowerCase()) && val != null && val !== false && val !== "") found.add(key);
      if (val && typeof val === "object") stack.push({ value: val, depth: depth + 1 });
    }
  }
  return { found: [...found], truncated };
}

function base64ByteLength(value) {
  if (typeof value !== "string" || !value) return 0;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

function duplicates(ids) {
  const seen = new Set();
  const dup = new Set();
  for (const id of ids) {
    if (id == null) continue;
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  return [...dup];
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function crit(id, label, status, detail) {
  return { id, label, status, detail };
}

function mb(bytes) {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function fail(message) {
  return {
    ok: false,
    errors: [message],
    warnings: [],
    report: { ok: false, criteria: [crit("format", "Recognized mod format", "FAIL", message)], contentCounts: {} },
  };
}
