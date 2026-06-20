// Encounter-1 — the encounter PRESENTATION owner (THREE). An additive layer over the existing combat
// beat: it OBSERVES Encounter Editor-0 (the runtime + the projected Enemy-0 actor) and the player, and
// drives readability — a sentinel idle→alert emissive telegraph, a gate-light beacon at the crossing, an
// encounter banner, and a one-shot clear pulse. It mutates only ITS OWN beacon meshes and the sentinel's
// (fresh, per-enemy) MATERIAL; it never changes encounter or enemy STATE. Worlds with no encounters get
// nothing built → no behaviour change (the frozen-cache / first-playable slices stay byte-stable).
//
// It runs AFTER EnemyRuntime.update each frame, so its idle telegraph is the last writer that frame; the
// instant the enemy is no longer idle it backs off and EnemyFeedback owns the material (flash / defeat).

import * as THREE from "three";
import {
  ENCOUNTER_PHASE,
  CLEARED_BANNER_SECONDS,
  deriveEncounterPhase,
  telegraphActive,
  telegraphEmissive,
  encounterBannerText,
  beaconColor,
  beaconOpacity,
} from "./EncounterPresentationLogic.js";

const CLEAR_PULSE_SECONDS = 0.6; // the one-shot expand on the clear edge

// A dedicated gate-light beacon for one encounter: a flat ground ring + a vertical light beam, additive
// MeshBasic so it reads as light. Runtime-built from the encounter (never authored/serialized), exactly
// like the Encounter Editor-0 zone ring.
function buildBeacon() {
  const group = new THREE.Group();
  group.name = "EncounterGateLight";
  group.userData.isEncounterMarker = true; // never picked / serialized

  const beamGeo = new THREE.CylinderGeometry(0.16, 0.44, 5.0, 12, 1, true);
  beamGeo.translate(0, 2.5, 0);
  const beamMat = new THREE.MeshBasicMaterial({ color: 0x6b7a86, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const beam = new THREE.Mesh(beamGeo, beamMat);

  const ringGeo = new THREE.RingGeometry(0.95, 1.3, 36);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x6b7a86, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = 0.06;

  group.add(beam, ring);
  group.renderOrder = 3;
  return { group, mats: [beamMat, ringMat] };
}

export class EncounterPresentation {
  constructor({ scene = null, player = null } = {}) {
    this.scene = scene;
    this.player = player;
    this._runtime = null;
    this._states = new Map(); // encounter id -> presentation state (beacon + derived phase + timers)
    this._elapsed = 0;
    this._banner = null;
  }

  load({ encounterRuntime } = {}) {
    this._disposeAll();
    this._runtime = encounterRuntime ?? null;
    this._elapsed = 0;
    this._banner = null;
    if (!this._runtime || !this.scene) return this;
    for (const entry of this._runtime.encounters.values()) {
      const beacon = buildBeacon();
      beacon.group.position.set(entry.ground.x, entry.ground.y, entry.ground.z);
      this.scene.add(beacon.group);
      this._states.set(entry.id, {
        id: entry.id,
        beacon,
        radius: entry.descriptor?.radius ?? 6,
        phase: entry.completed ? ENCOUNTER_PHASE.CLEARED : ENCOUNTER_PHASE.DORMANT,
        // An already-cleared beat on load gets no fresh pulse/banner (clearedAt far in the past).
        clearedAt: entry.completed ? -CLEARED_BANNER_SECONDS - 1 : null,
        clearPulses: 0,
        wasCompleted: entry.completed === true,
        distance: null,
        inZone: false,
        telegraph: false,
      });
    }
    // Paint the initial frame so a beat that loads already-cleared shows green immediately.
    this._paintAll();
    return this;
  }

  update(encounterRuntime, player, dt) {
    const runtime = encounterRuntime ?? this._runtime;
    const who = player ?? this.player;
    if (!runtime || !who?.position) return;
    this._elapsed += Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
    this._banner = null;
    let bannerPriority = -1;

    const snap = runtime.snapshot();
    for (const enc of snap.encounters) {
      const st = this._states.get(enc.id);
      if (!st) continue;

      const dx = who.position.x - enc.position[0];
      const dz = who.position.z - enc.position[2];
      const distance = Math.hypot(dx, dz);
      const phase = deriveEncounterPhase({ distance, radius: enc.radius, enemyState: enc.enemyState, completed: enc.completed });

      // Clear edge: just transitioned to cleared → one-shot pulse + open the banner linger window.
      if (enc.completed === true && st.wasCompleted !== true) {
        st.clearedAt = this._elapsed;
        st.clearPulses += 1;
      }
      st.wasCompleted = enc.completed === true;
      st.phase = phase;
      st.distance = distance;
      st.inZone = distance <= enc.radius;
      st.telegraph = telegraphActive(phase, enc.enemyState);

      // Telegraph: pulse the idle sentinel's own emissive. Runs after EnemyFeedback (last writer this
      // frame); backs off the instant the enemy is not idle so it never fights the flash/defeat recolor.
      st.telegraphIntensity = null;
      if (st.telegraph) {
        const actor = runtime.encounters.get(enc.id)?.actors?.[0];
        if (actor?.group) {
          const intensity = telegraphEmissive(actor.handle?.baseEmissiveIntensity ?? 0.25, this._elapsed, phase);
          let wrote = false;
          actor.group.traverse((node) => {
            if (node.isMesh && node.material && node.material.emissive) {
              node.material.emissiveIntensity = intensity;
              wrote = true;
            }
          });
          // Record the value actually written to the sentinel material (so the proof is non-vacuous).
          if (wrote) st.telegraphIntensity = intensity;
        }
      }

      const clearedRecently = st.clearedAt != null && this._elapsed - st.clearedAt <= CLEARED_BANNER_SECONDS;
      this._paintBeacon(st, phase, clearedRecently);

      // Banner precedence: engaged > alert > recently-cleared; dormant yields to the objective banner.
      const text = encounterBannerText(phase, { clearedRecently });
      const prio = phase === ENCOUNTER_PHASE.ENGAGED ? 3 : phase === ENCOUNTER_PHASE.ALERT ? 2 : phase === ENCOUNTER_PHASE.CLEARED && clearedRecently ? 1 : -1;
      if (text && prio > bannerPriority) {
        this._banner = text;
        bannerPriority = prio;
      }
    }
  }

  _paintAll() {
    for (const st of this._states.values()) this._paintBeacon(st, st.phase, false);
  }

  _paintBeacon(st, phase, clearedRecently) {
    const color = beaconColor(phase);
    let opacity = beaconOpacity(phase);
    // Hostile breathing pulse while the beat is live.
    if (phase === ENCOUNTER_PHASE.ALERT || phase === ENCOUNTER_PHASE.ENGAGED) {
      opacity *= 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(this._elapsed * 5));
    }
    // One-shot expand-and-settle on the clear edge.
    let scale = 1;
    if (phase === ENCOUNTER_PHASE.CLEARED && st.clearedAt != null) {
      const k = Math.min(1, Math.max(0, (this._elapsed - st.clearedAt) / CLEAR_PULSE_SECONDS));
      scale = 1 + (1 - k) * 0.8;
      if (clearedRecently) opacity = Math.max(opacity, 0.9 * (1 - k) + beaconOpacity(phase) * k);
    }
    st.beacon.group.scale.setScalar(scale);
    for (const m of st.beacon.mats) {
      m.color.setHex(color);
      m.opacity = opacity;
    }
  }

  /** The current encounter banner line, or null to yield to the slice / objective banner. */
  bannerText() {
    return this._banner;
  }

  snapshot() {
    return {
      banner: this._banner,
      encounters: [...this._states.values()].map((s) => ({
        id: s.id,
        phase: s.phase,
        distance: s.distance,
        inZone: s.inZone,
        telegraph: s.telegraph,
        telegraphIntensity: s.telegraphIntensity ?? null, // the emissive actually written to the sentinel
        clearPulses: s.clearPulses,
      })),
    };
  }

  _disposeAll() {
    for (const st of this._states.values()) {
      st.beacon.group.removeFromParent();
      st.beacon.group.traverse((node) => {
        if (node.isMesh) node.geometry?.dispose?.();
      });
      for (const m of st.beacon.mats) m.dispose?.();
    }
    this._states.clear();
  }

  dispose() {
    this._disposeAll();
    this._runtime = null;
    this._banner = null;
  }
}
