// Encounter Editor-0 block sanitizer. PURE (imports only the encounter value types).
//
// The world calls this on an UNTRUSTED `encounters` block (from a save file): it normalizes each
// descriptor (whitelist + finite/allow-list reject) and caps the list. Produces ZERO warnings on an
// empty/default block (the existing zero-warning assertions depend on this). Mirrors sanitizeEnemiesBlock.

import { normalizeEncounterDescriptor, MAX_ENCOUNTERS } from "./EncounterTypes.js";

export function sanitizeEncountersBlock(block, warnings = null) {
  const src = block && typeof block === "object" ? block : {};
  const items = Array.isArray(src.items) ? src.items : [];
  if (items.length > MAX_ENCOUNTERS && warnings) {
    warnings.push(`Encounters had ${items.length} items; only the first ${MAX_ENCOUNTERS} were kept.`);
  }
  const version = Number(src.version);
  const safe = items.slice(0, MAX_ENCOUNTERS).map(normalizeEncounterDescriptor).filter(Boolean);
  return { version: Math.max(1, Math.floor(Number.isFinite(version) ? version : 1)), items: safe };
}
