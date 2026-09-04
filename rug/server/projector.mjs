import { DEFAULT_HEALTH, EVENT_TYPES } from './dna.mjs';
import { evaluateMissions } from './rules.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function changeHealth(state, delta = {}) {
  for (const [key, amount] of Object.entries(delta)) {
    if (key in state.health) state.health[key] = Math.max(0, Math.min(100, state.health[key] + Number(amount || 0)));
  }
}

function physiology(state, event) {
  switch (event.type) {
    case EVENT_TYPES.WORK_BLOCKED:
      changeHealth(state, { energy: -1, coherence: -0.5 });
      break;
    case EVENT_TYPES.WORK_COMPLETED:
      changeHealth(state, { mission_progress: 3, integrity: 0.5 });
      break;
    case EVENT_TYPES.EVIDENCE_ATTACHED:
      changeHealth(state, { knowledge_quality: 0.5, trust: 0.25 });
      break;
    case EVENT_TYPES.ARTIFACT_COMMITTED:
      changeHealth(state, { integrity: 1, mission_progress: 1 });
      break;
    case EVENT_TYPES.KNOWLEDGE_PROMOTED:
      changeHealth(state, { knowledge_quality: 2, trust: 1, coherence: 0.5 });
      break;
    case EVENT_TYPES.KNOWLEDGE_RETRACTED:
      changeHealth(state, { knowledge_quality: -1, trust: -1 });
      break;
    case EVENT_TYPES.BRANCH_MERGED:
      changeHealth(state, { coherence: 1 });
      break;
    default:
      break;
  }
}

export function blankState(branch = 'main') {
  return {
    branch,
    head: 'GENESIS',
    organization: null,
    actors: {},
    missions: {},
    work: {},
    observations: {},
    decisions: {},
    artifacts: {},
    knowledge: {},
    constraints: {},
    agents: {},
    health: clone(DEFAULT_HEALTH),
    victory: {},
    timeline: []
  };
}

export function applyEvent(state, event) {
  const p = event.payload || {};
  const now = event.timestamp;

  switch (event.type) {
    case EVENT_TYPES.ORG_CREATED:
      state.organization = { ...p, created_at: now, created_by: event.actor };
      break;
    case EVENT_TYPES.ACTOR_REGISTERED:
      state.actors[p.actor_id] = {
        id: p.actor_id,
        name: p.name || p.actor_id,
        kind: p.kind || 'human',
        roles: [...new Set(p.roles || [])],
        registered_at: now
      };
      break;
    case EVENT_TYPES.ROLE_GRANTED: {
      const actor = state.actors[p.actor_id];
      if (actor) actor.roles = [...new Set([...(actor.roles || []), p.role])];
      break;
    }
    case EVENT_TYPES.MISSION_CREATED:
      state.missions[p.mission_id] = {
        id: p.mission_id,
        title: p.title,
        description: p.description || '',
        status: 'active',
        goals: p.goals || [],
        success_conditions: p.success_conditions || [],
        created_by: event.actor,
        created_at: now,
        updated_at: now
      };
      break;
    case EVENT_TYPES.MISSION_UPDATED: {
      const mission = state.missions[p.mission_id];
      if (mission) Object.assign(mission, p.patch || {}, { updated_at: now });
      break;
    }
    case EVENT_TYPES.WORK_CREATED:
      state.work[p.work_id] = {
        id: p.work_id,
        mission_id: p.mission_id || null,
        title: p.title,
        description: p.description || '',
        exclusive: p.exclusive !== false,
        status: 'open',
        owner: null,
        lease_expires_at: null,
        dependencies: p.dependencies || [],
        evidence: [],
        artifacts: [],
        created_by: event.actor,
        created_at: now,
        updated_at: now
      };
      break;
    case EVENT_TYPES.WORK_CLAIMED: {
      const work = state.work[p.work_id];
      if (work) {
        work.owner = p.owner || event.actor;
        work.status = 'claimed';
        work.lease_expires_at = p.lease_expires_at || null;
        work.updated_at = now;
      }
      break;
    }
    case EVENT_TYPES.WORK_RELEASED: {
      const work = state.work[p.work_id];
      if (work) {
        work.owner = null;
        work.status = 'open';
        work.lease_expires_at = null;
        work.updated_at = now;
      }
      break;
    }
    case EVENT_TYPES.WORK_BLOCKED: {
      const work = state.work[p.work_id];
      if (work) {
        work.status = 'blocked';
        work.blocked_by = p.blocked_by || p.reason || 'unknown';
        work.updated_at = now;
      }
      break;
    }
    case EVENT_TYPES.WORK_COMPLETED: {
      const work = state.work[p.work_id];
      if (work) {
        work.status = 'complete';
        work.completed_by = event.actor;
        work.completed_at = now;
        work.lease_expires_at = null;
        work.updated_at = now;
      }
      break;
    }
    case EVENT_TYPES.OBSERVATION_RECORDED:
      state.observations[p.observation_id] = {
        id: p.observation_id,
        claim: p.claim,
        source: p.source || null,
        confidence: p.confidence ?? null,
        actor: event.actor,
        created_at: now
      };
      break;
    case EVENT_TYPES.EVIDENCE_ATTACHED: {
      const item = { ref: p.ref, digest: p.digest || null, note: p.note || '', actor: event.actor, at: now };
      if (p.work_id && state.work[p.work_id]) state.work[p.work_id].evidence.push(item);
      if (p.decision_id && state.decisions[p.decision_id]) {
        state.decisions[p.decision_id].evidence = state.decisions[p.decision_id].evidence || [];
        state.decisions[p.decision_id].evidence.push(item);
      }
      break;
    }
    case EVENT_TYPES.DECISION_PROPOSED:
      state.decisions[p.decision_id] = {
        id: p.decision_id,
        title: p.title,
        proposal: p.proposal,
        proposer: event.actor,
        status: 'proposed',
        evidence: p.evidence || [],
        created_at: now
      };
      break;
    case EVENT_TYPES.DECISION_APPROVED: {
      const d = state.decisions[p.decision_id];
      if (d) Object.assign(d, { status: 'approved', approved_by: event.actor, resolved_at: now });
      break;
    }
    case EVENT_TYPES.DECISION_REJECTED: {
      const d = state.decisions[p.decision_id];
      if (d) Object.assign(d, { status: 'rejected', rejected_by: event.actor, reason: p.reason || '', resolved_at: now });
      break;
    }
    case EVENT_TYPES.ARTIFACT_COMMITTED:
      state.artifacts[p.artifact_id] = {
        id: p.artifact_id,
        name: p.name || p.artifact_id,
        uri: p.uri,
        digest: p.digest,
        size: p.size ?? null,
        media_type: p.media_type || 'application/octet-stream',
        committed_by: event.actor,
        committed_at: now
      };
      if (p.work_id && state.work[p.work_id]) state.work[p.work_id].artifacts.push(p.artifact_id);
      break;
    case EVENT_TYPES.KNOWLEDGE_PROPOSED:
      state.knowledge[p.knowledge_id] = {
        id: p.knowledge_id,
        title: p.title,
        body: p.body,
        provenance: p.provenance || [],
        status: 'candidate',
        proposed_by: event.actor,
        proposed_at: now
      };
      break;
    case EVENT_TYPES.KNOWLEDGE_PROMOTED: {
      const k = state.knowledge[p.knowledge_id];
      if (k) Object.assign(k, { status: 'accepted', promoted_by: event.actor, promoted_at: now });
      break;
    }
    case EVENT_TYPES.KNOWLEDGE_RETRACTED: {
      const k = state.knowledge[p.knowledge_id];
      if (k) Object.assign(k, { status: 'retracted', retracted_by: event.actor, reason: p.reason || '', retracted_at: now });
      break;
    }
    case EVENT_TYPES.CONSTRAINT_SET:
      state.constraints[p.constraint_id] = { ...p, active: true, set_by: event.actor, set_at: now };
      break;
    case EVENT_TYPES.CONSTRAINT_CLEARED:
      if (state.constraints[p.constraint_id]) {
        state.constraints[p.constraint_id].active = false;
        state.constraints[p.constraint_id].cleared_by = event.actor;
        state.constraints[p.constraint_id].cleared_at = now;
      }
      break;
    case EVENT_TYPES.AGENT_STATUS_SET:
      state.agents[p.agent_id || event.actor] = {
        ...(state.agents[p.agent_id || event.actor] || {}),
        id: p.agent_id || event.actor,
        status: p.status,
        claim: p.claim || null,
        confidence: p.confidence ?? null,
        blocked_by: p.blocked_by || null,
        attention_request: p.attention_request || null,
        updated_at: now
      };
      break;
    case EVENT_TYPES.LEASE_EXPIRED: {
      const work = state.work[p.work_id];
      if (work && work.owner === p.owner) {
        work.owner = null;
        work.status = 'open';
        work.lease_expires_at = null;
        work.updated_at = now;
      }
      break;
    }
    case EVENT_TYPES.HEALTH_CHANGED:
      changeHealth(state, p.delta || {});
      break;
    case EVENT_TYPES.BRANCH_CREATED:
    case EVENT_TYPES.BRANCH_MERGED:
      break;
    default:
      throw new Error(`Projector cannot apply ${event.type}`);
  }

  physiology(state, event);
  state.head = event.event_hash;
  state.timeline.push({ seq: event.seq, type: event.type, actor: event.actor, at: now, hash: event.event_hash });
  return state;
}

export function project(events, branch = 'main') {
  const state = blankState(branch);
  for (const event of events) applyEvent(state, event);
  state.victory = evaluateMissions(state);
  return state;
}
