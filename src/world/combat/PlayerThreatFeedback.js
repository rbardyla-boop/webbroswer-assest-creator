// Combat-1 enemy threat feasibility — the PLAYER-side feedback for one threat event. Non-lethal by
// construction: no health, no death, no fail-state. A fire edge produces (1) a small, capped,
// terrain-clamped KNOCKBACK away from the enemy, (2) a bounded decaying CAMERA SHAKE, (3) a one-shot AUDIO
// cue, and (4) a transient WARNING overlay (its own element, distinct from the milestone toast).
//
// The knockback is the only player-state mutation, and it is fail-safe: it moves the player only if the
// destination is walkable (grounded, dry, not too steep) — otherwise it is skipped, so a threat can never
// push the player through a cliff or into water (no soft-lock). PlayerController / PlayerCameraController are
// untouched (byte-stable): the shake is an additive offset applied AFTER the camera controller positioned
// the camera each frame, and the knockback just sets player.position (the controller continues from there).

import { THREAT_KNOCKBACK, THREAT_SHAKE } from "./ThreatLogic.js";
import { AUDIO_CUES } from "../audio/AudioCues.js";

const SHAKE_AMP = 0.14; // metres — peak camera-shake offset (bounded; decays to 0 over THREAT_SHAKE)
const SHAKE_FREQ = 38; // rad/s — deterministic jitter frequency (sin-based, no RNG)
const WARNING_LABEL = "Warding pulse — fall back";
const WARNING_MS = 1500; // how long the warning overlay stays before fading

export class PlayerThreatFeedback {
  constructor({ camera = null, audio = null, safePlace = null, getGroundHeight = null, parent = null } = {}) {
    this.camera = camera;
    this.audio = audio;
    this.safePlace = typeof safePlace === "function" ? safePlace : null;
    this.getGroundHeight = typeof getGroundHeight === "function" ? getGroundHeight : null;

    this._shake = 0; // remaining shake time (s)
    this._shakePhase = 0;
    this._events = 0;
    this._lastFrom = null;
    this._lastKnockback = null; // { from:[x,z], to:[x,z], dist, applied }

    // Own a dedicated warning element (NOT the milestone CueOverlay — per-hit warnings must not flood it).
    this._warnEl = null;
    this._warnTimer = null;
    if (typeof document !== "undefined") {
      const host = parent ?? document.body;
      this._warnEl = document.createElement("div");
      this._warnEl.className = "threat-warning";
      this._warnEl.setAttribute("role", "status");
      this._warnEl.setAttribute("aria-live", "polite");
      host?.appendChild(this._warnEl);
    }
  }

  trigger({ fromX, fromZ, player } = {}) {
    this._events++;
    this._lastFrom = [fromX, fromZ];
    this._applyKnockback(fromX, fromZ, player);
    this._shake = THREAT_SHAKE; // (re)start the shake from full
    this.audio?.cue?.(AUDIO_CUES.THREAT);
    this._showWarning(WARNING_LABEL);
  }

  _applyKnockback(fromX, fromZ, player) {
    const px = player?.position?.x;
    const pz = player?.position?.z;
    if (!Number.isFinite(px) || !Number.isFinite(pz) || !Number.isFinite(fromX) || !Number.isFinite(fromZ)) {
      this._lastKnockback = null;
      return;
    }
    let dx = px - fromX; // away from the enemy
    let dz = pz - fromZ;
    let d = Math.hypot(dx, dz);
    if (!Number.isFinite(d) || d < 1e-6) {
      dx = 0;
      dz = 1;
      d = 1;
    } // coincident → a fixed, deterministic safe direction
    const tx = px + (dx / d) * THREAT_KNOCKBACK;
    const tz = pz + (dz / d) * THREAT_KNOCKBACK;
    const from = [px, pz];

    // Fail-safe: only move onto walkable ground. Unsafe target → skip (the event still fired, no push).
    if (this.safePlace && !this.safePlace(tx, tz)) {
      this._lastKnockback = { from, to: from, dist: 0, applied: false };
      return;
    }
    player.position.x = tx;
    player.position.z = tz;
    const gy = this.getGroundHeight ? this.getGroundHeight(tx, tz) : null;
    if (Number.isFinite(gy)) player.position.y = gy + 0.1; // re-ground (mirrors __COMBAT_DO__.teleportTo)
    if ("velocityY" in player) player.velocityY = 0;
    player.syncMesh?.();
    this._lastKnockback = { from, to: [tx, tz], dist: Math.hypot(tx - px, tz - pz), applied: true };
  }

  // Additive camera shake, applied AFTER the camera controller positioned the camera this frame (so the
  // controller stays byte-stable — next frame it repositions cleanly and this re-applies the decayed offset).
  update(dt) {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (this._shake <= 0 || !this.camera) return;
    this._shake = Math.max(0, this._shake - step);
    this._shakePhase += step * SHAKE_FREQ;
    const k = THREAT_SHAKE > 0 ? this._shake / THREAT_SHAKE : 0; // 1 → 0 decay
    const amp = SHAKE_AMP * k;
    if (!Number.isFinite(amp)) return;
    this.camera.position.x += Math.sin(this._shakePhase) * amp;
    this.camera.position.y += Math.sin(this._shakePhase * 1.7 + 1.3) * amp * 0.6;
  }

  _showWarning(label) {
    if (!this._warnEl || !label) return;
    this._warnEl.textContent = label; // XSS-safe: internal constant, textContent
    this._warnEl.classList.add("visible");
    if (this._warnTimer != null) clearTimeout(this._warnTimer);
    this._warnTimer = setTimeout(() => {
      this._warnEl?.classList.remove("visible");
      this._warnTimer = null;
    }, WARNING_MS);
  }

  snapshot() {
    return {
      events: this._events,
      shaking: this._shake > 0,
      lastFrom: this._lastFrom,
      lastKnockback: this._lastKnockback,
      warningVisible: !!this._warnEl?.classList.contains("visible"),
    };
  }

  clear() {
    this._shake = 0;
    this._shakePhase = 0;
    this._events = 0;
    this._lastFrom = null;
    this._lastKnockback = null;
    if (this._warnTimer != null) clearTimeout(this._warnTimer);
    this._warnTimer = null;
    this._warnEl?.classList.remove("visible");
  }

  dispose() {
    this.clear();
    this._warnEl?.remove();
    this._warnEl = null;
  }
}
