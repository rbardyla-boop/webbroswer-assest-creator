// Enemy-0 runtime — spawns reactive combat-target actors from the document's `enemies` block and
// CONSUMES the Combat-0 seam: each actor registers an EnemyTargetAdapter into the injected
// combatRuntime, so combat's existing raycast + registerHit dispatch drives it (no new hit
// detection; combat stays the authority). On a hit the actor applies a pure, finite health/state
// transition (idle → hit-react → defeated). One stationary type, no patrol/chase/AI.
//
// combatRuntime is INJECTED (constructor), never imported, so this layer depends on combat's runtime
// API — not its code. Imports only THREE + the enemy-internal modules.

import * as THREE from "three";
import { ENEMY_STATE, HIT_DAMAGE, HIT_REACT_TIME, createEnemyState, archetypeFor, MOVEMENT_HOVER } from "./EnemyTypes.js";
import { applyDamage, advanceState, isDefeated } from "./EnemyValidation.js";
import { createPatrolMotion, advancePatrol } from "./PatrolMotion.js";
import { EnemyTargetAdapter } from "./EnemyTargetAdapter.js";
import { EnemyFeedback } from "./EnemyFeedback.js";

const BODY_COLOR = 0x86b2d6; // glacial ice blue (sentinel)
const WISP_COLOR = 0xbfe9ff; // pale shard-light (frost wisp)
const BASE_EMISSIVE_INTENSITY = 0.25; // sentinel idle emissive (== sentinel archetype feedback.baseEmissive)
const IDLE_BOB_AMP = 0.06; // metres the body bobs at rest (visual only)
const IDLE_BOB_SPEED = 1.4;
const HIT_RECOIL = 0.16; // metres the body dips on a fresh strike
const DEFEAT_SINK = 0.55; // metres the body slumps when defeated
const DEFEAT_TIP = 0.5; // radians the body tips over when defeated
const WISP_DEFEAT_DROP = 0.15; // metres above ground a defeated wisp settles (it falls out of the air)

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

    // Enemy-2: the archetype (sentinel | wisp) decides the silhouette + feedback + movement. Unknown
    // types fall back to the sentinel (defense in depth — the validator already gates the allow-list).
    const archetype = archetypeFor(desc.type);
    const group = buildArchetypeMesh(archetype);
    group.position.set(x, y, z);
    group.userData.objectId = desc.id; // so combat _ownerId resolves to the registration key
    this.scene.add(group);

    const handle = {
      materials: collectMaterials(group),
      baseEmissiveIntensity: archetype.feedback.baseEmissive, // sentinel 0.25 (== legacy), wisp 0.9
      feedback: archetype.feedback, // archetype-driven flash/defeat/flicker (EnemyFeedback reads this)
      defeatedApplied: false,
    };
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
      animPhase: 0, // monotonic anim clock (drives the wisp idle flicker; accumulated in update())
      hitFresh: false,
    };
    // Enemy-2: a hover archetype (the wisp) floats above its grounded spawn and drifts in a bounded
    // volume — an archetype-intrinsic motion overlay (NOT authored per-encounter, so it ignores any
    // patrol). The hover REST height sits `hover.height` above the ground; _hover keeps the body inside
    // its zone (if threaded). A ground archetype takes the Enemy-1 patrol path below instead.
    if (archetype.movement === MOVEMENT_HOVER && archetype.hover) {
      actor.hover = archetype.hover;
      actor.zone = desc.zone ?? null;
      const restY = y + (Number.isFinite(archetype.hover.height) ? archetype.hover.height : 0);
      actor._hoverRestY = restY;
      if (Number.isFinite(restY)) group.position.y = restY; // float on spawn (frame 0 doesn't snap up)
      actor.hoverMode = "hover";
    } else if (desc.patrol && Array.isArray(desc.patrol.points) && desc.patrol.points.length >= 2) {
      // Enemy-1 (encounter-owned): if a resolved patrol rode in on the descriptor, arm the motion overlay
      // and START the body on the route's first point (so frame 0 doesn't snap it from the centre). A null
      // patrol leaves every field unset → the actor is a stationary Enemy-0 (byte-stable). Doc-authored
      // enemies never reach here with a patrol (their validator whitelist drops it) — patrol is encounter-only.
      actor.patrol = desc.patrol;
      actor.zone = desc.zone ?? null;
      actor.motion = createPatrolMotion();
      actor.patrolMode = "patrol";
      const p0 = desc.patrol.points[0];
      if (Number.isFinite(p0.x) && Number.isFinite(p0.y) && Number.isFinite(p0.z)) {
        group.position.set(p0.x, p0.y, p0.z);
        actor.home = { x: p0.x, y: p0.y, z: p0.z };
        actor.baseY = p0.y;
        actor._patrolY = p0.y;
      }
    }

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
      // A single monotonic anim clock, accumulated BEFORE feedback so the wisp's idle flicker reads the
      // current phase. The sentinel's flickerAmp is 0 → phase is ignored → emissive is byte-identical.
      actor.animPhase = (Number.isFinite(actor.animPhase) ? actor.animPhase : 0) + step;
      this.feedback.sync(actor.handle, actor.state, actor.animPhase);
      this._animate(actor, step, player);
      actor.hitFresh = false;
    }
  }

  // Visual only (logical state/health/home are untouched, so the snapshot stays deterministic):
  // idle bob, a recoil dip while hit-reacting, and a one-shot turn toward the player on a fresh hit.
  // Defeated actors hold the slump pose set on the defeat edge (no per-frame motion).
  _animate(actor, dt, player) {
    if (isDefeated(actor.state)) return; // defeated → frozen; movement stops permanently (all archetypes)

    // Enemy-2 motion overlay: a hover archetype (the wisp) drifts in its bounded volume instead of
    // idle-bobbing in place. Combat FSM untouched — hit-react/defeated still win inside _hover.
    if (actor.hover) {
      this._hover(actor, dt, player);
      return;
    }

    // Enemy-1 motion overlay: a patroller walks its authored route instead of idle-bobbing in place. The
    // combat FSM is untouched — hit-react/defeated still win inside _patrol (no patrol = the path below).
    if (actor.patrol) {
      this._patrol(actor, dt, player);
      return;
    }

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

  // True when the player is inside this patroller's encounter zone (planar disk). Used to gate the alert
  // reaction. No zone or no player → false (treated as outside).
  _playerInZone(actor, player) {
    const z = actor.zone;
    if (!z || !player?.position) return false;
    const dx = player.position.x - z.x;
    const dz = player.position.z - z.z;
    return dx * dx + dz * dz <= z.radius * z.radius;
  }

  // Enemy-1: advance one patroller. hit-react FREEZES travel (the existing recoil dip + a one-shot
  // turn-to-face play, exactly like the stationary path) so combat feedback always wins; defeat is handled
  // by _animate's early return (frozen forever). Otherwise the alert mode decides: "halt" stops + faces the
  // player while in-zone; "track" keeps walking but faces the player; "none" / out-of-zone just patrols.
  // Movement comes only from the resolved (radius-bounded, terrain-safe) points, so the body never leaves
  // the zone or chases. Every transform write is finite-guarded.
  _patrol(actor, dt, player) {
    const g = actor.group;
    const reacting = actor.state.state === ENEMY_STATE.HIT_REACT;
    const inZone = this._playerInZone(actor, player);
    const alert = actor.patrol.alert;
    const halt = !reacting && inZone && alert === "halt";
    const track = !reacting && inZone && alert === "track";
    const travel = !reacting && !halt; // patrol + track travel; halt + hit-react freeze in place
    const facePlayer = reacting ? actor.hitFresh : halt || track;
    let mode = reacting ? "hit-react" : inZone && alert !== "none" ? "alert" : "patrol";

    if (travel) {
      const r = advancePatrol(actor.motion, actor.patrol, dt);
      actor.motion = r.motion;
      const pos = r.position;
      if (Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z)) {
        if (!facePlayer) {
          const dx = pos.x - g.position.x;
          const dz = pos.z - g.position.z;
          if (Math.abs(dx) > 1e-5 || Math.abs(dz) > 1e-5) {
            const yaw = Math.atan2(dx, dz);
            if (Number.isFinite(yaw)) g.rotation.y = yaw; // face travel direction
          }
        }
        g.position.set(pos.x, pos.y, pos.z);
        actor._patrolY = pos.y;
      }
      if (mode === "patrol" && actor.motion.pauseLeft > 0) mode = "paused";
    }

    if (facePlayer && player?.position) {
      const yaw = Math.atan2(player.position.x - g.position.x, player.position.z - g.position.z);
      if (Number.isFinite(yaw)) g.rotation.y = yaw; // telegraph: face the player (no approach)
    }

    if (reacting) {
      // Recoil dip on Y, measured from the FROZEN route height (don't accumulate into the route).
      const baseY = Number.isFinite(actor._patrolY) ? actor._patrolY : g.position.y;
      const y = baseY - HIT_RECOIL * (actor.state.reactTimer / HIT_REACT_TIME);
      if (Number.isFinite(y)) g.position.y = y;
    } else if (halt && Number.isFinite(actor._patrolY)) {
      g.position.y = actor._patrolY; // standing telegraph: hold the route height (clear any recoil dip)
    }

    actor.patrolMode = mode;
  }

  // Enemy-2: advance one hover archetype (the wisp). Deterministic bounded drift around `home` driven by
  // the monotonic anim clock — no RNG, no wall-clock. The planar offset rides a sub-radius ellipse (semi
  // axes 0.7·radius), so |offset| ≤ 0.7·radius·√2 ≈ 0.99·radius < radius — provably BOUNDED to the hover
  // envelope; a zone clamp (home == zone centre, drift ≪ radius) makes the encounter bound airtight too.
  // hit-react dips Y + faces the player (the existing feedback wins); defeat is handled by _animate's
  // early return (frozen forever). Every transform write is finite-guarded.
  _hover(actor, dt, player) {
    const g = actor.group;
    const h = actor.hover;
    const reacting = actor.state.state === ENEMY_STATE.HIT_REACT;
    const phase = Number.isFinite(actor.animPhase) ? actor.animPhase : 0;

    const a = h.radius * 0.7; // ellipse semi-axis (keeps the planar offset strictly under the radius)
    const bob = Math.sin(phase * h.driftSpeed * 2.0) * h.bobAmp;
    let x = actor.home.x + Math.cos(phase * h.driftSpeed) * a;
    let z = actor.home.z + Math.sin(phase * h.driftSpeed * 1.3) * a;
    // Recoil dip from the FROZEN rest height on a react (don't accumulate into the rest); else float + bob.
    let y = reacting
      ? actor._hoverRestY - HIT_RECOIL * (actor.state.reactTimer / HIT_REACT_TIME)
      : actor._hoverRestY + bob;

    // Defense in depth: never leave the encounter zone (home is the zone centre, so this never actually
    // triggers — but it makes the "bounded to radius" guarantee hold for any future home/radius).
    if (actor.zone) {
      const ox = x - actor.zone.x;
      const oz = z - actor.zone.z;
      const d = Math.hypot(ox, oz);
      const maxR = Math.max(0, actor.zone.radius - 0.5);
      if (d > maxR && d > 1e-6) {
        x = actor.zone.x + (ox / d) * maxR;
        z = actor.zone.z + (oz / d) * maxR;
      }
    }

    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) g.position.set(x, y, z);

    if (reacting && player?.position) {
      const yaw = Math.atan2(player.position.x - g.position.x, player.position.z - g.position.z);
      if (Number.isFinite(yaw)) g.rotation.y = yaw; // telegraph: face the player (no approach)
    } else {
      const yaw = phase * 0.5; // gentle ambient spin (a drifting spirit-light)
      if (Number.isFinite(yaw)) g.rotation.y = yaw;
    }

    actor.hoverMode = reacting ? "hit-react" : "hover";
  }

  // DEV-only liveness reader (the proof reads it): the LIVE transform + mode of every patrolling actor.
  // Deliberately separate from snapshot() — snapshot stays the logical, deterministic view (and still
  // filters ephemerals), so this never pollutes it with an animated transform.
  patrolView() {
    const out = [];
    for (const a of this.enemies.values()) {
      if (!a.patrol) continue;
      const p = a.group.position;
      out.push({ id: a.id, position: [p.x, p.y, p.z], mode: a.patrolMode ?? "patrol", defeated: isDefeated(a.state) });
    }
    return out;
  }

  // Enemy-2 DEV-only liveness reader: the LIVE transform + kind/mode of EVERY moving actor (patrol AND
  // hover). The archetype proof reads this to assert the wisp drifts, stays bounded + finite, and freezes
  // on defeat. Separate from snapshot() for the same determinism reason as patrolView().
  liveView() {
    const out = [];
    for (const a of this.enemies.values()) {
      if (!a.patrol && !a.hover) continue;
      const p = a.group.position;
      out.push({
        id: a.id,
        type: a.type,
        position: [p.x, p.y, p.z],
        kind: a.hover ? "hover" : "patrol",
        mode: a.hover ? a.hoverMode ?? "hover" : a.patrolMode ?? "patrol",
        defeated: isDefeated(a.state),
      });
    }
    return out;
  }

  _applyDefeatPose(actor) {
    // A defeated wisp falls OUT of the air to just above the ground (the archetype's dim emissive does the
    // rest of the "extinguished" read); a grounded sentinel slumps DOWN into the ground (byte-identical).
    const y = actor.hover ? actor.baseY + WISP_DEFEAT_DROP : actor.baseY - DEFEAT_SINK;
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

// Build the mesh for an archetype's silhouette. Dispatches on the archetype's `silhouette` key; an
// unknown silhouette falls back to the sentinel (matches archetypeFor's fallback).
function buildArchetypeMesh(archetype) {
  return archetype?.silhouette === "wisp" ? buildWispMesh(archetype) : buildSentinelMesh();
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

// A small floating frost-wisp silhouette: a glowing octahedron core ringed by three shard slivers. The
// group origin floats at the hover REST height (EnemyRuntime sets group.position.y); the whole group
// spins. ONE shared emissive material (so the hit "burst" reads uniformly and EnemyFeedback modulates a
// single emissiveIntensity); tiny triangle count. Much smaller than the sentinel — the readable contrast.
function buildWispMesh(archetype) {
  const group = new THREE.Group();
  group.name = "FrostWisp";
  const mat = wispMat(archetype?.feedback?.baseEmissive ?? 0.9);
  group.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.34), mat));
  const shardGeo = new THREE.TetrahedronGeometry(0.16);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const shard = new THREE.Mesh(shardGeo, mat);
    shard.position.set(Math.cos(a) * 0.42, Math.sin(a * 1.5) * 0.18, Math.sin(a) * 0.42);
    group.add(shard);
  }
  return group;
}

function wispMat(baseEmissive) {
  return new THREE.MeshStandardMaterial({
    color: WISP_COLOR,
    emissive: WISP_COLOR,
    emissiveIntensity: Number.isFinite(baseEmissive) ? baseEmissive : 0.9,
    roughness: 0.3,
    metalness: 0.0,
    transparent: true,
    opacity: 0.85,
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
