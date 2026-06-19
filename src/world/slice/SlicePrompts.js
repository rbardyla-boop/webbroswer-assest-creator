const VALID_KEYS = new Set(["F", "R", "H", "G"]);

export class SlicePrompts {
  constructor({ storage = globalThis.localStorage, storageKey = "frozen-cache-tutorial-v1" } = {}) {
    this.storage = storage;
    this.storageKey = storageKey;
    this.learned = this._read();
  }

  markUsed(key) {
    if (!VALID_KEYS.has(key) || this.learned[key]) return;
    this.learned[key] = true;
    try {
      this.storage?.setItem(this.storageKey, JSON.stringify(this.learned));
    } catch {
      // Storage can be unavailable in privacy modes; prompts still work for this session.
    }
  }

  prompt({ completed = false, inZone = false, relicCarried = false, nearestId = null, relicId = null, carriedCount = 0, activeId = null } = {}) {
    if (completed) return null;
    if (relicCarried && inZone) return { key: "G", text: "Deposit the relic in the cache" };
    if (nearestId && nearestId === relicId) return { key: "F", text: "Pick up the relic" };
    if (nearestId && !this.learned.F) return { key: "F", text: "Pick up the field weapon" };
    if (carriedCount > 0 && activeId && !this.learned.H) return { key: "H", text: "Holster the drawn weapon" };
    if (carriedCount > 0 && !activeId && !this.learned.H) return { key: "H", text: "Draw a holstered weapon" };
    if (carriedCount > 1 && !this.learned.R) return { key: "R", text: "Cycle your carried weapons" };
    return null;
  }

  _read() {
    try {
      const value = JSON.parse(this.storage?.getItem(this.storageKey) ?? "{}");
      return Object.fromEntries([...VALID_KEYS].map((key) => [key, value?.[key] === true]));
    } catch {
      return Object.fromEntries([...VALID_KEYS].map((key) => [key, false]));
    }
  }
}
