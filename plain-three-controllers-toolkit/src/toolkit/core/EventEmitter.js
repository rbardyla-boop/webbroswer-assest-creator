export class EventEmitter {
  constructor() {
    this.listeners = new Map();
  }

  on(type, fn) {
    const set = this.listeners.get(type) || new Set();
    set.add(fn);
    this.listeners.set(type, set);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const fn of set) fn(payload);
  }
}
