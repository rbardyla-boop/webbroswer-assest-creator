// Leaf module for persistence key constants — deliberately import-free (no THREE, no DOM, no config modules) so
// it can be imported by lightweight entries (e.g. the Slice Select-1 catalog page) WITHOUT dragging the whole
// engine into their bundle via the ESM import closure. WorldDocument.js re-exports WORLD_STORAGE_KEY from here so
// every existing `import { WORLD_STORAGE_KEY } from "./WorldDocument.js"` keeps working and the value stays
// single-source.

export const WORLD_STORAGE_KEY = "grass-world-builder-save";
