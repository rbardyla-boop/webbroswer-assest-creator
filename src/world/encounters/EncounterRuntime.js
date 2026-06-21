// Encounter Editor-0 runtime — ORCHESTRATES the Enemy-0 + Combat-0 seams; it rewrites neither. From the
// document's `encounters` block it draws each beat's zone ring and PROJECTS exactly one transient enemy
// through the injected EnemyRuntime (`spawnEphemeral`) — never a document item, so a reload re-derives it
// from the encounter and never bakes a pre-dead enemy. Combat stays the hit authority (the ephemeral
// registers as a combat target inside EnemyRuntime); this layer only POLLS the enemy's state for defeat
// and marks the beat complete. It is NOT an encounter system: one beat, one enemy, no waves/loot/AI.
//
// enemyRuntime is INJECTED (constructor), never imported — this layer depends on the enemy runtime's API,
// not its code (mirrors how EnemyRuntime injects combatRuntime). Imports only THREE + the pure enemy
// value modules + encounter-internal modules.

import { DEFAULT_MAX_HEALTH } from "../enemies/EnemyTypes.js";
import { resolvePatrol } from "../enemies/PatrolTypes.js";
import { allDefeated } from "./EncounterCompletion.js";
import { buildZoneRing, paintZoneRing, disposeZoneRing, RING_Y_OFFSET } from "./EncounterMarkers.js";

export class EncounterRuntime {
  constructor({ scene = null, enemyRuntime = null } = {}) {
    this.scene = scene;
    this.enemyRuntime = enemyRuntime;
    this.encounters = new Map(); // id -> entry
    this._document = null;
    this._persistDirty = false;
  }

  // (Re)build encounters from the loaded world. Idempotent: clears prior rings + ephemerals first.
  // MUST run AFTER loadEnemies() (which clears + respawns the doc-authored enemies) so the ephemerals
  // this projects join a fresh enemy set. `groundHeight(x,z)` grounds the ring + enemy onto the
  // support surface when provided. Returns the spawned count.
  load({ scene, document, groundHeight = null, terrain = null }) {
    this.clear();
    if (scene) this.scene = scene;
    this._document = document ?? null;
    this._terrain = terrain ?? null;
    const items = document?.encounters?.items;
    if (!Array.isArray(items) || !this.scene) return 0;
    let count = 0;
    for (const desc of items) if (this._spawnEncounter(desc, groundHeight)) count++;
    return count;
  }

  _spawnEncounter(desc, groundHeight) {
    if (!desc) return null;
    const { x, z } = desc.position;
    let y = desc.position.y;
    if (typeof groundHeight === "function") {
      const h = groundHeight(x, z);
      if (Number.isFinite(h)) y = h;
    }
    // Never add a NaN-posed marker/enemy (the data path is validated, but ground sampling is not).
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;

    const ring = buildZoneRing(desc.radius);
    ring.position.set(x, y + RING_Y_OFFSET, z);
    this.scene.add(ring);

    const entry = {
      id: desc.id,
      descriptor: desc,
      ring,
      ground: { x, y, z },
      completed: desc.completed === true,
      actors: [],
    };
    this.encounters.set(desc.id, entry);

    // A persisted-completed encounter is already cleared → DON'T project its enemy (never resurrect a
    // baked, pre-dead enemy). Otherwise project exactly one ephemeral enemy at the encounter centre.
    if (!entry.completed) {
      // Enemy-1: resolve the authored patrol against THIS zone (centre + radius) and the terrain. The
      // resolve grounds + bounds + safety-checks each point; a failing patrol resolves to null → the
      // sentinel stays stationary (Enemy-0 behaviour). The zone is threaded so the enemy can compute its
      // alert reaction without importing the encounter.
      const patrol = resolvePatrol(desc.patrol, {
        center: { x, z },
        radius: desc.radius,
        terrain: this._terrain,
      });
      const actor = this.enemyRuntime?.spawnEphemeral(
        {
          type: desc.enemyType,
          id: ephemeralEnemyId(desc.id, 0),
          position: { x, y, z },
          maxHealth: DEFAULT_MAX_HEALTH,
          defeated: false,
          patrol,
          zone: { x, z, radius: desc.radius },
        },
        groundHeight
      );
      if (actor) entry.actors.push(actor);
    }
    paintZoneRing(ring, entry.completed);
    return entry;
  }

  // Poll each unresolved beat's projected enemy for defeat (combat + the enemy FSM already ran this
  // frame), and mark it complete when every enemy is down. Persistence is gated on persistCompletion.
  update(_dt, _player) {
    for (const entry of this.encounters.values()) {
      if (entry.completed || entry.actors.length === 0) continue;
      if (!allDefeated(entry.actors.map((a) => a.state))) continue;
      entry.completed = true;
      paintZoneRing(entry.ring, true);
      // Persist completion only when configured (default true). A replayable beat
      // (persistCompletion:false) leaves the descriptor uncompleted → it respawns its enemy on reload.
      if (entry.descriptor?.persistCompletion !== false) {
        entry.descriptor.completed = true;
        this._persistDirty = true;
      }
    }
  }

  /** One-shot: true when a beat completed (with persistence on) since the last call (main saves). */
  takePersistRequest() {
    if (!this._persistDirty) return false;
    this._persistDirty = false;
    return true;
  }

  // Logical (deterministic) summary — beat identity + completion + the projected enemy's id/state. The
  // enemy id lets a proof teleport/aim/fire at the ephemeral target combat raycasts.
  snapshot() {
    return {
      encounters: [...this.encounters.values()].map((e) => ({
        id: e.id,
        type: e.descriptor.type,
        position: [e.ground.x, e.ground.y, e.ground.z],
        radius: e.descriptor.radius,
        enemyType: e.descriptor.enemyType,
        completed: e.completed,
        persistCompletion: e.descriptor.persistCompletion !== false,
        // Content-1: the authored banner location label (presentation reads it to name the beat).
        label: e.descriptor.label ?? null,
        // Enemy-1: the AUTHORED patrol descriptor (logical intent — never the live transform, which the
        // determinism rule keeps out of the snapshot). null when the beat's sentinel is stationary.
        patrol: e.descriptor.patrol ?? null,
        enemyId: e.actors[0]?.id ?? null,
        enemyState: e.actors[0]?.state?.state ?? null,
      })),
    };
  }

  // Dispose every ring + tear down each projected ephemeral enemy (idempotent). Called at the top of
  // load(), so a world reload never leaks a ring or an ephemeral enemy. removeEphemeral is a no-op when
  // EnemyRuntime already cleared the actor (loadEnemies runs first), so order is safe either way.
  clear() {
    for (const entry of this.encounters.values()) {
      for (const actor of entry.actors) this.enemyRuntime?.removeEphemeral(actor.id);
      entry.ring.removeFromParent();
      disposeZoneRing(entry.ring);
    }
    this.encounters.clear();
    this._persistDirty = false;
    this._document = null;
    this._terrain = null;
  }

  dispose() {
    this.clear();
    this.scene = null;
    this.enemyRuntime = null;
  }
}

/** Deterministic, namespaced id for an encounter's projected enemy (debuggable in proofs/snapshots). */
export function ephemeralEnemyId(encounterId, index) {
  return `enc:${encounterId}:${index}`;
}
