// Runtime interaction engine (runtime mode only — the editor never runs it, so
// authoring never triggers gameplay). Data-driven and deterministic: given the
// player position and dt, it tests trigger/pickup volumes, routes named events
// through the EventBus to door responders, animates doors, shows the nearest
// sign's text, and teleports the player to named spawn points.
//
// No world/mod data is executed: behaviors are this class's fixed methods, keyed
// by `role`; the data only supplies strings/numbers/booleans/vec3s. THREE math
// only — no DOM (the sign overlay is a separate, injected onMessage consumer).

import * as THREE from "three";
import { EventBus } from "./EventBus.js";
import { sphereContains, volumeContains } from "./triggerVolume.js";

export class InteractionRuntime {
  constructor({ player = null, onMessage = null, onEvent = null } = {}) {
    this.player = player;
    this.onMessage = onMessage;
    this.onEvent = onEvent;
    this.bus = new EventBus();
    this._scratch = new THREE.Vector3();
    this._deltaQuat = new THREE.Quaternion();
    this._euler = new THREE.Euler();
    this.clear();
  }

  get count() {
    return this.triggers.length + this.doors.length + this.pickups.length + this.signs.length + this.spawns.size;
  }

  // Scan a loaded WorldObjectManager and index every object that carries
  // interaction metadata. Wires door responders to their listened events.
  load(objectManager) {
    this.clear();
    const objects = objectManager?.objects ? [...objectManager.objects.values()] : [];
    for (const object of objects) {
      const it = object.userData?.interaction;
      if (!it) continue;
      // Isolate each object: a single malformed interaction must never abort the
      // load and drop every remaining object. (Sanitization already guarantees
      // well-formed shapes; this is defense in depth for any non-sanitized path.)
      try {
        this._index(object, it);
      } catch (error) {
        console.warn(`Interaction load skipped object ${object.userData?.objectId ?? "(unknown)"}`, error);
      }
    }
    return this;
  }

  _index(object, it) {
    switch (it.role) {
      case "trigger":
        this.triggers.push({
          object,
          channel: it.channel,
          shape: it.shape,
          radius: it.radius,
          emitOnEnter: it.emitOnEnter ?? [],
          emitOnExit: it.emitOnExit ?? [],
          once: it.once,
          teleportTo: it.teleportTo ?? null,
          inside: false,
          spent: false,
          objectId: object.userData?.objectId ?? null,
        });
        break;
      case "pickup":
        this.pickups.push({
          object,
          channel: it.channel,
          radius: it.radius,
          emitOnCollect: it.emitOnCollect ?? [],
          respawn: it.respawn,
          collected: false,
          objectId: object.userData?.objectId ?? null,
        });
        break;
      case "sign":
        this.signs.push({ object, text: it.text, showRadius: it.showRadius });
        break;
      case "spawn":
        this.spawns.set(it.name, object.getWorldPosition(new THREE.Vector3()));
        break;
      case "door":
        this._addDoor(object, it);
        break;
      default:
        break;
    }
  }

  _addDoor(object, it) {
    const rotate = it.rotate ?? { x: 0, y: 0, z: 0 };
    const move = it.move ?? { x: 0, y: 0, z: 0 };
    this._euler.set(rotate.x, rotate.y, rotate.z);
    this._deltaQuat.setFromEuler(this._euler);
    const door = {
      object,
      closedPos: object.position.clone(),
      openPos: object.position.clone().add(new THREE.Vector3(move.x, move.y, move.z)),
      closedQuat: object.quaternion.clone(),
      openQuat: object.quaternion.clone().multiply(this._deltaQuat),
      duration: it.duration,
      t: it.startOpen ? 1 : 0,
      target: it.startOpen ? 1 : 0,
      objectId: object.userData?.objectId ?? null,
    };
    this.doors.push(door);
    for (const name of it.listenOpen ?? []) this.bus.subscribe(it.channel, name, () => { door.target = 1; });
    for (const name of it.listenClose ?? []) this.bus.subscribe(it.channel, name, () => { door.target = 0; });
    if (it.startOpen) this._applyDoor(door);
  }

  update(dt) {
    if (!this.player) return;
    const point = this.player.position;
    this._updateSigns(point);
    this._updatePickups(point);
    this._updateTriggers(point);
    this._updateDoors(dt > 0 ? dt : 0);
  }

  _updateSigns(point) {
    let best = null;
    let bestDist = Infinity;
    for (const sign of this.signs) {
      const center = sign.object.getWorldPosition(this._scratch);
      const dist = center.distanceToSquared(point);
      if (dist <= sign.showRadius * sign.showRadius && dist < bestDist) {
        bestDist = dist;
        best = sign;
      }
    }
    const message = best ? best.text : null;
    if (message !== this.message) {
      this.message = message;
      this.onMessage?.(message);
    }
  }

  _updatePickups(point) {
    for (const pickup of this.pickups) {
      const center = pickup.object.getWorldPosition(this._scratch);
      const inside = sphereContains(center, pickup.radius, point);
      if (inside && !pickup.collected) {
        pickup.collected = true;
        pickup.object.visible = false;
        for (const name of pickup.emitOnCollect) this._fire(pickup.channel, name);
      } else if (!inside && pickup.collected && pickup.respawn) {
        pickup.collected = false;
        pickup.object.visible = true;
      }
    }
  }

  _updateTriggers(point) {
    for (const trigger of this.triggers) {
      const center = trigger.object.getWorldPosition(this._scratch);
      const inside = volumeContains(trigger.shape, center, trigger.radius, point);
      if (inside === trigger.inside) continue;
      trigger.inside = inside;
      if (trigger.spent) continue;
      if (inside) {
        for (const name of trigger.emitOnEnter) this._fire(trigger.channel, name);
        if (trigger.teleportTo) this.teleport(trigger.teleportTo);
        if (trigger.once) trigger.spent = true;
      } else {
        for (const name of trigger.emitOnExit) this._fire(trigger.channel, name);
      }
    }
  }

  _updateDoors(dt) {
    for (const door of this.doors) {
      if (door.t === door.target) continue;
      if (door.duration <= 0) {
        door.t = door.target;
      } else {
        const step = dt / door.duration;
        door.t = door.target > door.t ? Math.min(door.target, door.t + step) : Math.max(door.target, door.t - step);
      }
      this._applyDoor(door);
    }
  }

  _applyDoor(door) {
    door.object.position.lerpVectors(door.closedPos, door.openPos, door.t);
    door.object.quaternion.slerpQuaternions(door.closedQuat, door.openQuat, door.t);
    door.object.updateMatrixWorld(true);
  }

  // Publish a named event on a channel (delivered synchronously to door
  // responders) and record it for observability.
  _fire(channel, name) {
    this.bus.publish(channel, name);
    this.eventLog.push({ channel, name });
    if (this.eventLog.length > 64) this.eventLog.shift();
    this.onEvent?.({ channel, name });
  }

  teleport(name) {
    const position = this.spawns.get(name);
    if (!position) {
      console.warn(`Interaction teleport: unknown spawn "${name}"`);
      return false;
    }
    // Guard against extreme finite coordinates (e.g. a hostile world placing a
    // spawn at 1e308) that would push the player into a NaN cascade.
    const MAX_COORD = 1e5;
    if (![position.x, position.y, position.z].every((c) => Number.isFinite(c) && Math.abs(c) <= MAX_COORD)) {
      console.warn(`Interaction teleport: spawn "${name}" is out of bounds; ignored.`);
      return false;
    }
    this.player.position.copy(position);
    if ("velocityY" in this.player) this.player.velocityY = 0;
    this.player.syncMesh?.();
    return true;
  }

  clear() {
    this.triggers = [];
    this.doors = [];
    this.pickups = [];
    this.signs = [];
    this.spawns = new Map();
    this.eventLog = [];
    this.message = null;
    this.bus.clear();
  }

  // --- observability (debug-safe; no UI) --------------------------------------

  debugSnapshot() {
    return {
      counts: { triggers: this.triggers.length, doors: this.doors.length, pickups: this.pickups.length, signs: this.signs.length, spawns: this.spawns.size },
      doors: this.doors.map((d) => ({ id: d.objectId, t: Number(d.t.toFixed(4)), target: d.target, open: d.t > 0.999 })),
      pickups: this.pickups.map((pk) => ({ id: pk.objectId, collected: pk.collected, visible: pk.object.visible })),
      spawns: [...this.spawns.keys()],
      message: this.message,
      events: [...this.eventLog],
    };
  }
}
