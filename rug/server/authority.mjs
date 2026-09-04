import {
  EVENT_PERMISSION,
  EVENT_TYPES,
  PERMISSIONS,
  ROLES,
  permissionsForRoles
} from './dna.mjs';
import { project } from './projector.mjs';

export class IntentRejected extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'IntentRejected';
    this.code = code;
    this.details = details;
  }
}

const isAdmin = state => actor => {
  if (actor === 'system:bootstrap') return true;
  return (state.actors[actor]?.roles || []).includes(ROLES.ADMIN);
};

function requireFields(payload, names) {
  for (const name of names) {
    if (payload?.[name] === undefined || payload?.[name] === null || payload?.[name] === '') {
      throw new IntentRejected('BAD_PAYLOAD', `Missing required field: ${name}`);
    }
  }
}

export class Authority {
  constructor(ledger, { onAccepted = null } = {}) {
    this.ledger = ledger;
    this.onAccepted = onAccepted;
  }

  state(branch = 'main') {
    return project(this.ledger.eventsForBranch(branch), branch);
  }

  actorPermissions(state, actor) {
    if (actor === 'system:bootstrap') return new Set(Object.values(PERMISSIONS));
    return permissionsForRoles(state.actors[actor]?.roles || []);
  }

  validate(intent, state) {
    const { type, actor, payload = {} } = intent;
    if (!type || !actor) throw new IntentRejected('BAD_INTENT', 'type and actor are required');

    const requiredPermission = EVENT_PERMISSION[type];
    if (!requiredPermission) throw new IntentRejected('UNKNOWN_EVENT', `Unsupported event type: ${type}`);
    const permissions = this.actorPermissions(state, actor);
    if (!permissions.has(requiredPermission)) {
      throw new IntentRejected('FORBIDDEN', `${actor} lacks ${requiredPermission}`);
    }

    const admin = isAdmin(state)(actor);

    switch (type) {
      case EVENT_TYPES.ORG_CREATED:
        requireFields(payload, ['name']);
        if (state.organization) throw new IntentRejected('ALREADY_EXISTS', 'Organization already exists');
        break;
      case EVENT_TYPES.ACTOR_REGISTERED:
        requireFields(payload, ['actor_id']);
        if (state.actors[payload.actor_id]) throw new IntentRejected('ALREADY_EXISTS', 'Actor already registered');
        break;
      case EVENT_TYPES.ROLE_GRANTED:
        requireFields(payload, ['actor_id', 'role']);
        if (!state.actors[payload.actor_id]) throw new IntentRejected('NOT_FOUND', 'Actor not found');
        if (!Object.values(ROLES).includes(payload.role)) throw new IntentRejected('BAD_PAYLOAD', 'Unknown role');
        break;
      case EVENT_TYPES.MISSION_CREATED:
        requireFields(payload, ['mission_id', 'title']);
        if (state.missions[payload.mission_id]) throw new IntentRejected('ALREADY_EXISTS', 'Mission exists');
        break;
      case EVENT_TYPES.MISSION_UPDATED:
        requireFields(payload, ['mission_id', 'patch']);
        if (!state.missions[payload.mission_id]) throw new IntentRejected('NOT_FOUND', 'Mission not found');
        break;
      case EVENT_TYPES.WORK_CREATED:
        requireFields(payload, ['work_id', 'title']);
        if (state.work[payload.work_id]) throw new IntentRejected('ALREADY_EXISTS', 'Work item exists');
        if (payload.mission_id && !state.missions[payload.mission_id]) throw new IntentRejected('NOT_FOUND', 'Mission not found');
        for (const dep of payload.dependencies || []) {
          if (!state.work[dep]) throw new IntentRejected('BAD_DEPENDENCY', `Unknown dependency: ${dep}`);
        }
        break;
      case EVENT_TYPES.WORK_CLAIMED: {
        requireFields(payload, ['work_id']);
        const work = state.work[payload.work_id];
        if (!work) throw new IntentRejected('NOT_FOUND', 'Work item not found');
        if (work.status === 'complete') throw new IntentRejected('INVALID_STATE', 'Completed work cannot be claimed');
        const activeLease = work.owner && (!work.lease_expires_at || Date.parse(work.lease_expires_at) > Date.now());
        if (work.exclusive && activeLease && work.owner !== actor) {
          throw new IntentRejected('OWNERSHIP_CONFLICT', `Work is owned by ${work.owner}`, { owner: work.owner });
        }
        for (const dep of work.dependencies || []) {
          if (state.work[dep]?.status !== 'complete') {
            throw new IntentRejected('DEPENDENCY_BLOCKED', `Dependency ${dep} is not complete`);
          }
        }
        break;
      }
      case EVENT_TYPES.WORK_RELEASED: {
        requireFields(payload, ['work_id']);
        const work = state.work[payload.work_id];
        if (!work) throw new IntentRejected('NOT_FOUND', 'Work item not found');
        if (!admin && work.owner !== actor) throw new IntentRejected('FORBIDDEN', 'Only owner/admin can release work');
        break;
      }
      case EVENT_TYPES.WORK_BLOCKED:
      case EVENT_TYPES.WORK_COMPLETED: {
        requireFields(payload, ['work_id']);
        const work = state.work[payload.work_id];
        if (!work) throw new IntentRejected('NOT_FOUND', 'Work item not found');
        if (!admin && work.owner !== actor) throw new IntentRejected('FORBIDDEN', 'Actor does not own this work');
        if (type === EVENT_TYPES.WORK_COMPLETED && work.status === 'complete') {
          throw new IntentRejected('INVALID_STATE', 'Work already complete');
        }
        break;
      }
      case EVENT_TYPES.OBSERVATION_RECORDED:
        requireFields(payload, ['observation_id', 'claim']);
        if (state.observations[payload.observation_id]) throw new IntentRejected('ALREADY_EXISTS', 'Observation exists');
        break;
      case EVENT_TYPES.EVIDENCE_ATTACHED:
        requireFields(payload, ['ref']);
        if (!payload.work_id && !payload.decision_id) throw new IntentRejected('BAD_PAYLOAD', 'Evidence needs work_id or decision_id');
        if (payload.work_id && !state.work[payload.work_id]) throw new IntentRejected('NOT_FOUND', 'Work item not found');
        if (payload.decision_id && !state.decisions[payload.decision_id]) throw new IntentRejected('NOT_FOUND', 'Decision not found');
        break;
      case EVENT_TYPES.DECISION_PROPOSED:
        requireFields(payload, ['decision_id', 'title', 'proposal']);
        if (state.decisions[payload.decision_id]) throw new IntentRejected('ALREADY_EXISTS', 'Decision exists');
        break;
      case EVENT_TYPES.DECISION_APPROVED:
      case EVENT_TYPES.DECISION_REJECTED: {
        requireFields(payload, ['decision_id']);
        const decision = state.decisions[payload.decision_id];
        if (!decision) throw new IntentRejected('NOT_FOUND', 'Decision not found');
        if (decision.status !== 'proposed') throw new IntentRejected('INVALID_STATE', 'Decision is already resolved');
        if (decision.proposer === actor) throw new IntentRejected('SELF_APPROVAL', 'Proposer cannot resolve own decision');
        break;
      }
      case EVENT_TYPES.ARTIFACT_COMMITTED:
        requireFields(payload, ['artifact_id', 'uri', 'digest']);
        if (state.artifacts[payload.artifact_id]) throw new IntentRejected('ALREADY_EXISTS', 'Artifact id already committed');
        if (!/^[a-fA-F0-9]{64}$/.test(payload.digest)) throw new IntentRejected('BAD_DIGEST', 'Artifact digest must be SHA-256 hex');
        break;
      case EVENT_TYPES.KNOWLEDGE_PROPOSED:
        requireFields(payload, ['knowledge_id', 'title', 'body']);
        if (state.knowledge[payload.knowledge_id]) throw new IntentRejected('ALREADY_EXISTS', 'Knowledge id exists');
        if (!Array.isArray(payload.provenance) || payload.provenance.length === 0) {
          throw new IntentRejected('NO_PROVENANCE', 'Candidate knowledge requires provenance');
        }
        break;
      case EVENT_TYPES.KNOWLEDGE_PROMOTED: {
        requireFields(payload, ['knowledge_id']);
        const knowledge = state.knowledge[payload.knowledge_id];
        if (!knowledge) throw new IntentRejected('NOT_FOUND', 'Knowledge not found');
        if (knowledge.status !== 'candidate') throw new IntentRejected('INVALID_STATE', 'Only candidate knowledge can be promoted');
        if (knowledge.proposed_by === actor) throw new IntentRejected('SELF_APPROVAL', 'Knowledge proposer cannot promote own claim');
        break;
      }
      case EVENT_TYPES.KNOWLEDGE_RETRACTED:
        requireFields(payload, ['knowledge_id']);
        if (!state.knowledge[payload.knowledge_id]) throw new IntentRejected('NOT_FOUND', 'Knowledge not found');
        break;
      case EVENT_TYPES.CONSTRAINT_SET:
        requireFields(payload, ['constraint_id', 'rule']);
        break;
      case EVENT_TYPES.CONSTRAINT_CLEARED:
        requireFields(payload, ['constraint_id']);
        if (!state.constraints[payload.constraint_id]?.active) throw new IntentRejected('NOT_FOUND', 'Active constraint not found');
        break;
      case EVENT_TYPES.AGENT_STATUS_SET:
        requireFields(payload, ['status']);
        if (!admin && payload.agent_id && payload.agent_id !== actor) {
          throw new IntentRejected('FORBIDDEN', 'Agent may only change its own status');
        }
        break;
      case EVENT_TYPES.LEASE_EXPIRED:
        requireFields(payload, ['work_id', 'owner']);
        if (!state.work[payload.work_id]) throw new IntentRejected('NOT_FOUND', 'Work item not found');
        break;
      case EVENT_TYPES.HEALTH_CHANGED:
        requireFields(payload, ['delta']);
        break;
      case EVENT_TYPES.BRANCH_CREATED:
      case EVENT_TYPES.BRANCH_MERGED:
        break;
      default:
        throw new IntentRejected('UNKNOWN_EVENT', `No validator for ${type}`);
    }
  }

  submit(intent) {
    const branch = intent.branch || 'main';
    const state = this.state(branch);
    this.validate(intent, state);
    const event = this.ledger.append({
      branch,
      type: intent.type,
      actor: intent.actor,
      payload: intent.payload || {},
      base_hash: intent.base_hash,
      meta: intent.meta || {}
    });
    this.onAccepted?.(event, this.state(branch));
    return event;
  }

  createBranch({ name, from = 'main', actor, base_hash }) {
    const state = this.state(from);
    const permissions = this.actorPermissions(state, actor);
    if (!permissions.has(PERMISSIONS.BRANCH)) throw new IntentRejected('FORBIDDEN', 'Actor cannot create branches');
    const event = this.ledger.createBranch({ name, from, actor, base_hash });
    this.onAccepted?.(event, this.state(name));
    return event;
  }
}
