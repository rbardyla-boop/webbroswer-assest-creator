import { CITY_DOCUMENT_VERSION, createCityConfig } from "./CityConfig.js";

export function createCityDocument({ seed = "showcase-001", style = "showcase", layout = null } = {}) {
  return {
    version: CITY_DOCUMENT_VERSION,
    seed: String(seed || "showcase-001"),
    style,
    createdAt: new Date().toISOString(),
    layout,
  };
}

export function normalizeCityDocument(input) {
  if (!input || typeof input !== "object") throw new Error("City document must be an object.");
  if (input.version !== CITY_DOCUMENT_VERSION) {
    throw new Error(`Unsupported city document version: ${input.version}`);
  }
  if (!input.seed || typeof input.seed !== "string") throw new Error("City document requires a string seed.");
  if (!input.style || typeof input.style !== "string") throw new Error("City document requires a style.");
  if (!input.layout || typeof input.layout !== "object") throw new Error("City document requires a generated layout.");
  return {
    version: CITY_DOCUMENT_VERSION,
    seed: input.seed,
    style: input.style,
    createdAt: input.createdAt || new Date().toISOString(),
    layout: input.layout,
  };
}

export function serializeCityDocument(doc) {
  return JSON.stringify(normalizeCityDocument(doc));
}

export function deserializeCityDocument(json) {
  return normalizeCityDocument(JSON.parse(json));
}

export function saveCityDocument(doc, storage = globalThis.localStorage, key = createCityConfig().storageKey) {
  const serialized = serializeCityDocument(doc);
  storage.setItem(key, serialized);
  return serialized.length;
}

export function loadCityDocument(storage = globalThis.localStorage, key = createCityConfig().storageKey) {
  const raw = storage.getItem(key);
  return raw ? deserializeCityDocument(raw) : null;
}

export function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}
