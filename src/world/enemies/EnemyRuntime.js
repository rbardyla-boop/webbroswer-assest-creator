// Enemy-0 runtime — spawns reactive combat-target actors from the document's `enemies` block and
// CONSUMES the Combat-0 seam: each actor registers an EnemyTargetAdapter into the injected
// combatRuntime, so combat's existing raycast + registerHit dispatch drives it (no new hit
// detection; combat stays the authority). On a hit the actor applies a pure, finite health/state
// transition (idle → hit-react → defeated). One stationary type, no patrol/chase/AI.
//
// combatRuntime is INJECTED (constructor), never imported, so this layer depends on combat's runtime
// API — not its code. Imports only THREE + the enemy-internal modules.

import * as THREE from "three";
import { ENEMY_STATE, HIT_DAMAGE, HIT_REACT_TIME, createEnemyState } from "./EnemyTypes.js";
import { applyDamage, advanceState, isDefeated } from "./EnemyValidation.js";
import { EnemyTargetAdapter } from "./EnemyTargetAdapter.js";
import { EnemyFeedback } from "./EnemyFeedback.js";

const BODY_COLOR = 0x86b2d6; // glacial ice blue
const BASE_EMISSIVE_INTENSITY = 0.25;
const IDLE_BOB_AMP = 0.06; // metres the body bobs at rest (visual only)
const IDLE_BOB_SPEED = 1.4;
const HIT_RECOIL = 0.16; // metres the body dips on a fresh strike
const DEFEAT_SINK = 0.55; // metres the body slumps when defeated
const DEFEAT_TIP = 0.5; // radians the body tips over when defeated

export class EnemyRuntime {
  constructor({ scene = null, combatRuntime = null } = {}) {
    this.scene = scene;
    this.combatRuntime = combatRuntime;
    this.feedback = new EnemyFeedback();
    this.enemies = new Map(); // id -> actor
    this._document = null;
    this._persistDirty = false;
  }

  // (Re)spawn enemies from the loaded world. Idempotent: clears prior actors (+ unregisters their
  // combat targets) first. Called AFTER combatRuntime.load() (which clears the target set), so each
  // actor re-registers into the fresh set. `groundHeight(x,z)` grounds the body onto the support
  // surface when provided. Returns the spawned count.
  load({ scene, document, groundHeight = null }) {
    this.clear();
    if (scene) this.scene = scene;
    this._document = document ?? null;
    const items = document?.enemies?.items;
    if (!Array.isArray(items) || !this.scene) return 0;
    let count = 0;
    for (const desc of items) if (this._spawn(desc, groundHeight)) count++;
    return count;
  }

  _spawn(desc, groundHeight) {
    if (!desc) return null;
    const { x, z } = desc.position;
    let y = desc.position.y;
    if (typeof groundHeight === "function") {
      const h = groundHeight(x, z);
      if (Number.isFinite(h)) y = h;
    }
    // Never add a NaN-posed mesh to the scene (the data path is validated, but ground sampling is not).
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;

    const group = buildSentinelMesh();
    group.position.set(x, y, z);
    group.userData.objectId = desc.id; // so combat _ownerId resolves to the registration key
    this.scene.add(group);

    const handle = { materials: collectMaterials(group), baseEmissiveIntensity: BASE_EMISSIVE_INTENSITY, defeatedApplied: false };
    const state = createEnemyState({ health: desc.defeated ? 0 : desc.maxHealth, maxHealth: desc.maxHealth });
    const actor = {
      id: desc.id,
      type: desc.type,
      descriptor: desc,
      group,
      handle,
      state,
      home: { x, y, z },
      baseY: y,
      bobPhase: 0,
      hitFresh: false,
    };
    this.enemies.set(desc.id, actor);

    // Consume the combat seam: combat raycasts `group`; on a hit it calls adapter.registerHit, which
    // applies damage to THIS actor. The enemy never raycasts or creates a StrikeEvent itself.
    this.combatRuntime?.registerTarget(desc.id, new EnemyTargetAdapter(desc.id, group, () => this._onHit(actor)));

    // Restore a persisted-defeated enemy's look + pose immediately on load.
    this.feedback.sync(handle, state);
    if (isDefeated(state)) this._applyDefeatPose(actor);
    return actor;
  }

  // Encounter Editor-0 hook (additive): project a TRANSIENT enemy that is NOT a document item. The
  // descriptor is owned by the caller (an encounter), never persisted to `enemies.items` — so a reload
  // re-derives it from the encounter and never bakes a pre-dead enemy. Identical to a doc-authored spawn
  // (registers a combat target, drives the same FSM) except the actor is flagged `ephemeral`, so
  // snapshot() omits it (the encounter reports it) and removeEphemeral can tear down just it. Returns the
  // actor (for the encounter's defeat polling) or null when the position is non-finite.
  spawnEphemeral(descriptor, groundHeight = null) {
    const actor = this._spawn(descriptor, groundHeight);
    if (actor) actor.ephemeral = true;
    return actor;
  }

  // Tear down one ephemeral actor (encounter teardown). Guards on the ephemeral flag, so a baked,
  // doc-authored enemy can never be removed through this path. Idempotent — a missing or non-ephemeral
  // id is a no-op (returns false).
  removeEphemeral(id) {
    const actor = this.enemies.get(id);
    if (!actor?.ephemeral) return false;
    this.combatRuntime?.unregisterTarget(id);
    actor.group.removeFromParent();
    disposeGroup(actor.group);
    this.enemies.delete(id);
    return true;
  }

  // Combat dispatched a strike to this actor. Apply one hit of damage (latched once defeated) and,
  // on the defeat edge, persist the terminal state by mutating the live document descriptor in place
  // (mirrors objective completion) + raise a one-shot persist request main consumes.
  _onHit(actor) {
    if (isDefeated(actor.state)) return;
    actor.state = applyDamage(actor.state, HIT_DAMAGE);
    actor.hitFresh = true;
    if (isDefeated(actor.state)) {
      if (actor.descriptor) actor.descriptor.defeated = true;
      this._applyDefeatPose(actor);
      this._persistDirty = true;
    }
  }

  update(dt, player) {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    for (const actor of this.enemies.values()) {
      actor.state = advanceState(actor.state, step);
      this.feedback.sync(actor.handle, actor.state);
      this._animate(actor, step, player);
      actor.hitFresh = false;
    }
  }

  // Visual only (logical state/health/home are untouched, so the snapshot stays deterministic):
  // idle bob, a recoil dip while hit-reacting, and a one-shot turn toward the player on a fresh hit.
  // Defeated actors hold the slump pose set on the defeat edge (no per-frame motion).
  _animate(actor, dt, player) {
    if (isDefeated(actor.state)) return;
    const g = actor.group;

    if (actor.hitFresh && player?.position) {
      const yaw = Math.atan2(player.position.x - g.position.x, player.position.z - g.position.z);
      if (Number.isFinite(yaw)) g.rotation.y = yaw; // turn-to-face only; no movement, no chase
    }

    actor.bobPhase += dt;
    const bob = Math.sin(actor.bobPhase * IDLE_BOB_SPEED) * IDLE_BOB_AMP;
    const recoil = actor.state.state === ENEMY_STATE.HIT_REACT ? HIT_RECOIL * (actor.state.reactTimer / HIT_REACT_TIME) : 0;
    const y = actor.baseY + bob - recoil;
    if (Number.isFinite(y)) g.position.y = y;
  }

  _applyDefeatPose(actor) {
    const y = actor.baseY - DEFEAT_SINK;
    if (Number.isFinite(y)) actor.group.position.y = y; // guard at the site, like every other transform write
    actor.group.rotation.z = DEFEAT_TIP; // a finite constant
  }

  /** One-shot: true when an enemy was defeated since the last call (main persists the document). */
  takePersistRequest() {
    if (!this._persistDirty) return false;
    this._persistDirty = false;
    return true;
  }

  // Logical (deterministic) summary — discrete state + health + the authored HOME position, never
  // the animated transform.
  snapshot() {
    return {
      // Ephemeral (encounter-projected) actors are reported by EncounterRuntime, not here, so the
      // doc-authored enemy view stays byte-stable for the existing Enemy-0 tests/worlds.
      enemies: [...this.enemies.values()].filter((a) => !a.ephemeral).map((a) => ({
        id: a.id,
        type: a.type,
        state: a.state.state,
        health: a.state.health,
        maxHealth: a.state.maxHealth,
        defeated: isDefeated(a.state),
        position: [a.home.x, a.home.y, a.home.z],
      })),
    };
  }

  // Remove + dispose every actor mesh and unregister its combat target (idempotent). Called at the
  // top of load(), so a world reload never leaks a mesh or a stale combat target.
  clear() {
    for (const actor of this.enemies.values()) {
      this.combatRuntime?.unregisterTarget(actor.id);
      actor.group.removeFromParent();
      disposeGroup(actor.group);
    }
    this.enemies.clear();
    this._persistDirty = false;
    this._document = null;
  }

  dispose() {
    this.clear();
    this.feedback?.dispose?.();
    this.scene = null;
    this.combatRuntime = null;
  }
}

// A cheap, visible glacial-sentinel silhouette: a tapered body + a crystal head. Fresh geometry +
// materials per enemy (so a per-enemy flash doesn't bleed across actors, and disposal is simple).
function buildSentinelMesh() {
  const group = new THREE.Group();
  group.name = "GlacialSentinel";
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.5, 1.8, 8), sentinelMat());
  body.position.y = 0.9; // base sits at the group origin
  const head = new THREE.Mesh(new THREE.OctahedronGeometry(0.42), sentinelMat());
  head.position.y = 2.05;
  group.add(body, head);
  return group;
}

function sentinelMat() {
  return new THREE.MeshStandardMaterial({
    color: BODY_COLOR,
    emissive: BODY_COLOR,
    emissiveIntensity: BASE_EMISSIVE_INTENSITY,
    roughness: 0.5,
    metalness: 0.1,
  });
}

function collectMaterials(group) {
  const mats = [];
  group.traverse((o) => {
    if (o.isMesh && o.material && !mats.includes(o.material)) mats.push(o.material);
  });
  return mats;
}

function disposeGroup(group) {
  group.traverse((o) => {
    if (o.isMesh) {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    }
  });
}
