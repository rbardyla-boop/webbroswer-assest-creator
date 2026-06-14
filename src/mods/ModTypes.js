// Shared constants and helpers for the data-only mod package system.
//
// HARD RULE: a mod package is DATA ONLY. No code, no scripts, no eval. The
// prohibited-key scan below is a safety gate, not a feature — any package that
// carries an executable-looking field is rejected outright.
//
// Pure and Node-safe (no DOM).

import { WORLD_DOCUMENT_VERSION } from "../world/WorldDocument.js";

export const MOD_FORMAT = "grass-world-mod-v1";
export const MOD_VERSION = 1;

// The engine build this validator belongs to. Used for engine.minVersion checks.
export const ENGINE_VERSION = "1.0.0";
export const ENGINE_WORLD_DOCUMENT_VERSION = WORLD_DOCUMENT_VERSION;

// Single inline blob size ceiling. Above the warn line we flag; above the hard
// line we reject (a defense against decompression/memory abuse via base64).
export const MAX_INLINE_WARN_BYTES = 16 * 1024 * 1024; // 16 MB
export const MAX_INLINE_FAIL_BYTES = 64 * 1024 * 1024; // 64 MB

export const MOD_CONTENT_KINDS = ["worlds", "worldpacks", "assets", "prefabs", "kits", "thumbnails"];

// Hard ceiling on the number of top-level content records. A package above this
// is rejected before any deep scan, bounding memory/CPU on untrusted input.
export const MAX_CONTENT_RECORDS = 5000;

// MIME types that imply executable/markup content. Any asset claiming one of
// these is rejected — a defense-in-depth blocklist on top of the data-only rule.
export const BLOCKED_MIME_PREFIXES = [
  "text/html",
  "text/javascript",
  "application/javascript",
  "application/ecmascript",
  "text/ecmascript",
  "application/x-javascript",
  "text/xml",
  "application/xml",
  "application/xhtml",
  "application/java",
  "application/x-shockwave-flash",
];

// Keys that imply executable content. If any appears (with a truthy value)
// anywhere in a mod package, the package is rejected. Lower-cased for matching.
export const PROHIBITED_KEYS = new Set([
  // Prototype-pollution vectors.
  "__proto__",
  "constructor",
  "prototype",
  // Executable-content vectors.
  "script",
  "scripts",
  "code",
  "hooks",
  "hook",
  "eval",
  "fn",
  "func",
  "function",
  "functions",
  "plugin",
  "plugins",
  "exec",
  "command",
  "commands",
  "onload",
  "oninit",
  "onimport",
  "onstart",
  "module",
  "require",
  "import",
  "wasm",
]);

export function createModId(name = "") {
  return `mod-${slug(name) || "package"}-${shortRandom()}`;
}

export function slug(value) {
  return (
    String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 48) || ""
  );
}

export function shortRandom() {
  return (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)).slice(0, 8);
}

// Reduce an arbitrary string to a single safe path segment (no separators, no
// "..", no leading dots). Used for any file-name-like field a mod may carry.
export function safePathSegment(value, fallback = "item") {
  const cleaned = String(value ?? "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/\.\.+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 96);
  return cleaned || fallback;
}

// True when a string looks like a path-traversal / absolute / remote reference.
export function looksLikeUnsafePath(value) {
  const s = String(value ?? "");
  if (!s) return false;
  return /(^|[/\\])\.\.([/\\]|$)/.test(s) || /^([a-zA-Z]:)?[/\\]/.test(s) || /^[a-z]+:\/\//i.test(s);
}

export function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
