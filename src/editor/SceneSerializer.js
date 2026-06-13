const STORAGE_KEY = "grass-world-builder-save";

export class SceneSerializer {
  constructor(manager) {
    this.manager = manager;
  }

  save() {
    const document = this.manager.serialize();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
    return document;
  }

  load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const document = JSON.parse(raw);
    this.manager.load(document);
    return document;
  }
}
