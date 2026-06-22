// Combat-1 enemy threat feasibility — the runtime that turns the pure ThreatLogic into bounded, readable,
// reload-safe PRESSURE on the player. A SEPARATE seam from CombatRuntime (which owns player→enemy weapon
// strikes): ThreatRuntime only OBSERVES enemies (through EnemyRuntime.threatView(), a read-only reader) and
// the player, and on a fresh danger-window crossing fires ONE non-lethal feedback event via PlayerThreatFeedback.
//
// It never mutates enemy / combat / encounter logical state, never registers combat targets, and never
// persists (takePersistRequest is always false → reload drops every cooldown + the event ledger). It is
// dormant wherever there are no zoned enemies (a doc-authored enemy or a world with no encounters has no
// zone → no threat), so the Frozen Cache + first-playable slices stay byte-stable. The danger-ring telegraph
// is a transient mesh owned here (like CombatFeedback's impact marks), created HIDDEN so the far-player
// benchmark capture is unchanged → no Performance Contract re-lock.

import * as THREE from "three";

import { threatDangerRadius, inDangerWindow, createThreatState, stepThreat } from "./ThreatLogic.js";

const RING_COLOR = 0xff6b5a; // a warm danger hue, distinct from the cool encounter telegraph
const RING_SEGMENTS = 48;
const RING_BAND = 0.14; // metres — the ring band width (drawn just inside the danger radius)
const RING_BASE_OPACITY = 0.22; // resting telegraph opacity while the player is in the outer zone
const RING_FLASH_OPACITY = 0.72; // peak opacity on a fire edge
const RING_FLASH_DECAY = 2.4; // per second — how fast the flash fades back to the resting opacity

export class ThreatRuntime {
  constructor({ scene = null, enemyRuntime = null, feedback = null } = {}) {
    this.scene = scene;
    this.enemyRuntime = enemyRuntime;
    this.feedback = feedback;
    this._threats = new Map(); // enemyId → { state, ring, flash, dangerRadius }
    this._events = 0;
    this._lastEvent = null;
    this._lastPlayer = null;
  }

  // Transient seam — load just clears prior state (rings + cooldowns + the ledger). Idempotent across reloads.
  load() {
    this.clear();
  }

  update(dt, player) {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    this._lastPlayer = player ?? this._lastPlayer ?? null;
    const view = this.enemyRuntime?.threatView?.() ?? [];

    const px = player?.position?.x;
    const pz = player?.position?.z;
    const hasPlayer = Number.isFinite(px) && Number.isFinite(pz);

    const seen = new Set();
    for (const e of view) {
      if (!e?.zone) continue; // only zone-bearing (encounter-projected) enemies can threaten
      seen.add(e.id);
      let t = this._threats.get(e.id);
      if (!t) {
        t = { state: createThreatState(), ring: null, flash: 0, dangerRadius: 0, fires: 0 };
        this._threats.set(e.id, t);
      }

      const dangerRadius = threatDangerRadius(e.zone.radius);
      t.dangerRadius = dangerRadius;

      const ex = e.position[0];
      const ez = e.position[2];
      const dist = hasPlayer ? Math.hypot(px - ex, pz - ez) : Infinity;
      const zoneDist = hasPlayer ? Math.hypot(px - e.zone.x, pz - e.zone.z) : Infinity;
      const inWindow = !e.defeated && hasPlayer && inDangerWindow(dist, dangerRadius);
      const inOuterZone = hasPlayer && Number.isFinite(zoneDist) && zoneDist <= e.zone.radius;

      const r = stepThreat(t.state, { inWindow, defeated: e.defeated, dt: step });
      t.state = r.next;
      if (r.fired) {
        t.fires++;
        this._events++;
        this._lastEvent = { id: e.id, type: e.type, at: [ex, ez] };
        t.flash = 1;
        this.feedback?.trigger({ fromX: ex, fromZ: ez, player });
      }

      // Telegraph ring: visible while the player is in the OUTER zone and the enemy is alive; flashes on fire.
      this._updateRing(t, e, dangerRadius, inOuterZone && !e.defeated, step);
    }

    // Defensive: drop rings for enemies that disappeared (e.g. a reload between updates).
    for (const [id, t] of this._threats) {
      if (!seen.has(id)) {
        this._disposeRing(t);
        this._threats.delete(id);
      }
    }

    this.feedback?.update?.(step); // decay the camera shake (applied after the camera controller positioned it)
  }

  _updateRing(t, e, dangerRadius, visible, dt) {
    if (!this.scene || dangerRadius <= 0) return;
    if (!t.ring) {
      const inner = Math.max(0.02, dangerRadius - RING_BAND);
      const geo = new THREE.RingGeometry(inner, dangerRadius, RING_SEGMENTS);
      geo.rotateX(-Math.PI / 2); // lay flat on the ground (XZ plane)
      const mat = new THREE.MeshBasicMaterial({
        color: RING_COLOR,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      t.ring = new THREE.Mesh(geo, mat);
      t.ring.renderOrder = 3;
      t.ring.visible = false; // created HIDDEN → benchmark capture (player far) is unchanged
      this.scene.add(t.ring);
    }

    t.ring.visible = !!visible;
    if (!visible) {
      t.flash = 0;
      return;
    }
    const ex = e.position[0];
    const ey = e.position[1];
    const ez = e.position[2];
    if (Number.isFinite(ex) && Number.isFinite(ey) && Number.isFinite(ez)) {
      t.ring.position.set(ex, ey + 0.05, ez); // hug the ground at the enemy
    }
    t.flash = Math.max(0, t.flash - RING_FLASH_DECAY * dt);
    t.ring.material.opacity = Math.min(1, RING_BASE_OPACITY + t.flash * (RING_FLASH_OPACITY - RING_BASE_OPACITY));
  }

  _disposeRing(t) {
    if (!t?.ring) return;
    t.ring.removeFromParent();
    t.ring.geometry?.dispose?.();
    t.ring.material?.dispose?.();
    t.ring = null;
  }

  // DEV/test reader: the transient threat ledger + per-enemy window/cooldown state + the feedback summary.
  // Logical only (never persisted); the proof asserts events/knockback/dormancy against it.
  snapshot() {
    const threats = [];
    for (const [id, t] of this._threats) {
      threats.push({
        id,
        dangerRadius: t.dangerRadius,
        cooldownLeft: t.state.cooldownLeft,
        inWindow: t.state.inWindowPrev,
        fires: t.fires,
        ringVisible: !!t.ring?.visible,
      });
    }
    return {
      events: this._events,
      lastEvent: this._lastEvent,
      threats,
      feedback: this.feedback?.snapshot?.() ?? null,
    };
  }

  // Threat state is transient — it is NEVER written to the WorldDocument. (Mirrors the runtime persist API
  // shape so main.js can treat every runtime system uniformly, but the answer is always false.)
  takePersistRequest() {
    return false;
  }

  clear() {
    for (const t of this._threats.values()) this._disposeRing(t);
    this._threats.clear();
    this._events = 0;
    this._lastEvent = null;
    this._lastPlayer = null;
    this.feedback?.clear?.();
  }

  dispose() {
    this.clear();
  }
}
