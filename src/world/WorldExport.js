import { validateWorldDocument } from "./WorldValidation.js";

export function exportWorldDocument(document, filename = null) {
  const { document: safe } = validateWorldDocument(document);
  if (safe.assets?.localIndexedDB && safe.assets?.warning) console.warn(safe.assets.warning);
  const name = filename ?? `${slug(safe.metadata.name)}.world.json`;
  const blob = new Blob([JSON.stringify(safe, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = documentElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return safe;
}

export function importWorldDocumentFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      try {
        resolve(validateWorldDocument(JSON.parse(String(reader.result))));
      } catch (error) {
        reject(error);
      }
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsText(file);
  });
}

function documentElement(tag) {
  return globalThis.document.createElement(tag);
}

function slug(value) {
  return String(value || "untitled-world")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "untitled-world";
}
