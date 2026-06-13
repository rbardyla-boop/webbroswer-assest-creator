import { validateWorldDocument } from "./WorldValidation.js";
import { WORLD_STORAGE_KEY } from "./WorldDocument.js";

export class WorldSerializer {
  constructor({ storageKey = WORLD_STORAGE_KEY } = {}) {
    this.storageKey = storageKey;
  }

  save(document) {
    const { document: safe, warnings } = validateWorldDocument({
      ...document,
      metadata: {
        ...document.metadata,
        updatedAt: new Date().toISOString(),
      },
    });
    localStorage.setItem(this.storageKey, JSON.stringify(safe));
    return { document: safe, warnings };
  }

  load() {
    const raw = localStorage.getItem(this.storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return validateWorldDocument(parsed);
  }

  saveRaw(document) {
    localStorage.setItem(this.storageKey, JSON.stringify(document));
  }
}
