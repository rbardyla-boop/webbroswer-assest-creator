import * as THREE from "three";
import { GuardBandFrustum } from "./GuardBandFrustum.js";
import { createVisibilityConfig } from "./VisibilityConfig.js";

// The Visibility + Streaming Kernel: a reusable engine service that classifies
// registered agents into tiers (visible / warm / sleeping / unloaded) each frame
// using a guard-banded frustum + distance, with time hysteresis so fast camera
// turns never thrash or pop. Per-system adapters (animation here; particles,
// lights, procedural, voxel later) ask `isAwake(object)` to decide whether to run
// their per-frame UPDATE work.
//
// CRITICAL INVARIANT — the kernel NEVER changes `object3D.visible` and never
// removes anything from the scene. Three.js already frustum-culls draw calls, so
// an in-frustum object is always rendered the same frame; the kernel only gates
// expensive UPDATES. That is what makes it shadow-safe (offscreen shadow casters
// still render into shadow maps), light-safe, and pop-free (nothing to "appear").

const TIER_RANK = { unloaded: 0, sleeping: 1, warm: 2, visible: 3 };
const AWAKE_RANK = TIER_RANK.warm; // warm and visible are "awake"

export class VisibilityKernel {
  constructor(config = {}) {
    this.config = createVisibilityConfig(config);
    this.gbf = new GuardBandFrustum();
    this.agents = new Map(); // id -> agent
    this._clock = 0;
    this._box = new THREE.Box3();
    this._sphere = new THREE.Sphere();
    this.stats = emptyStats();
  }

  setConfig(config) {
    this.config = createVisibilityConfig(config);
  }

  /**
   * Register an agent. `object3D` provides the world bounds each frame; `kind` is
   * a free label for the overlay. Idempotent per id.
   */
  register({ id, object3D, kind = "object" }) {
    if (id == null || !object3D) return;
    // Start cold: the first update() classifies purely from the frustum, and
    // hysteresis only ever holds agents that were genuinely awake and then left
    // (not a free warm window at registration).
    this.agents.set(id, { id, object3D, kind, tier: "unloaded", awake: false, lastAwakeT: -Infinity });
  }

  unregister(id) {
    this.agents.delete(id);
  }

  clear() {
    this.agents.clear();
    this.stats = emptyStats();
  }

  isAwake(objectOrId) {
    const id = objectOrId?.userData?.objectId ?? objectOrId;
    const agent = this.agents.get(id);
    // Unknown agents default to awake — never silently freeze something untracked.
    return agent ? agent.awake : true;
  }

  tierOf(objectOrId) {
    const id = objectOrId?.userData?.objectId ?? objectOrId;
    return this.agents.get(id)?.tier ?? "visible";
  }

  update(camera, dt = 0) {
    const stats = emptyStats();
    stats.total = this.agents.size;

    if (!this.config.enabled) {
      // Disabled → everything is awake (no culling), but still reported.
      for (const agent of this.agents.values()) {
        agent.tier = "visible";
        agent.awake = true;
      }
      stats.visible = this.agents.size;
      stats.enabled = false;
      this.stats = stats;
      return;
    }

    this._clock += Math.max(0, dt);
    this.gbf.setFromCamera(camera);

    for (const agent of this.agents.values()) {
      const sphere = this._worldSphere(agent.object3D);
      const raw = this.gbf.classify(sphere, this.config);

      let tier = raw;
      if (TIER_RANK[raw] >= AWAKE_RANK) {
        agent.lastAwakeT = this._clock; // visible/warm refreshes the keep-alive timer
      } else if (this._clock - agent.lastAwakeT < this.config.minKeepSeconds) {
        tier = "warm"; // hysteresis: hold recently-awake agents warm a bit longer
      }

      const nowAwake = TIER_RANK[tier] >= AWAKE_RANK;
      if (nowAwake && !agent.awake) stats.wakes++;
      else if (!nowAwake && agent.awake) stats.sleeps++;
      agent.tier = tier;
      agent.awake = nowAwake;
      stats[tier]++;
    }

    this.stats = stats;
  }

  _worldSphere(object3D) {
    this._box.setFromObject(object3D);
    if (this._box.isEmpty()) {
      // Empty group / no geometry: fall back to the object's world position.
      object3D.getWorldPosition(this._sphere.center);
      this._sphere.radius = 0.5;
      return this._sphere;
    }
    return this._box.getBoundingSphere(this._sphere);
  }

  debugSnapshot() {
    const agents = [];
    for (const agent of this.agents.values()) {
      // `visible` lets a proof confirm the no-hide invariant on the live object.
      agents.push({ id: agent.id, kind: agent.kind, tier: agent.tier, awake: agent.awake, visible: agent.object3D.visible !== false });
    }
    return { ...this.stats, agents };
  }
}

function emptyStats() {
  return { enabled: true, total: 0, visible: 0, warm: 0, sleeping: 0, unloaded: 0, wakes: 0, sleeps: 0 };
}
