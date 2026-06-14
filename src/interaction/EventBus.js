// Declarative event bus for interaction wiring. Pure and Node-safe.
//
// Events are (channel, name) string pairs. Handlers are the InteractionRuntime's
// OWN fixed functions, bound to (channel, name) at load time by matching the
// declarative event-name lists in the world data. No handler is ever supplied by
// world/mod data — the data only chooses WHICH named events connect to which
// responders. This is the "controlled, manifest-based, no-eval" wiring model.

// A separator byte that can never appear in a sanitized [A-Za-z0-9_.-] token, so
// (channel, name) pairs can never collide into the same key.
const SEP = String.fromCharCode(0);

function keyOf(channel, name) {
  return `${channel}${SEP}${name}`;
}

export class EventBus {
  constructor() {
    this.handlers = new Map(); // "channel\0name" -> Set<fn>
  }

  subscribe(channel, name, handler) {
    const key = keyOf(channel, name);
    if (!this.handlers.has(key)) this.handlers.set(key, new Set());
    this.handlers.get(key).add(handler);
    return () => this.handlers.get(key)?.delete(handler);
  }

  // Deliver an event synchronously to its subscribers. Returns how many handlers
  // ran. A throwing handler is isolated (logged) so one bad responder can't break
  // the rest of the frame.
  publish(channel, name) {
    const set = this.handlers.get(keyOf(channel, name));
    if (!set) return 0;
    let delivered = 0;
    for (const handler of [...set]) {
      try {
        handler({ channel, name });
        delivered++;
      } catch (error) {
        console.warn(`Interaction event handler for ${channel}/${name} failed`, error);
      }
    }
    return delivered;
  }

  clear() {
    this.handlers.clear();
  }
}
